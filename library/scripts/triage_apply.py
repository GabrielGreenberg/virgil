"""Apply a reviewed triage JSONL: move files, append bib stubs, enqueue indexing.

Reads JSONL from --input (or stdin) where each line is one row produced by
`triage_batch.py` and possibly edited by the operator. For each row:

- `flags: ["whole-handbook"]`  → move file to unsorted/_pending/, emit
                                  triage-needs-chapter-info notification, no queue
- `flags: ["variant-copy"]`    → move file to papers/<existingCitekey>/variants/
                                  if existingCitekey set; else fall through to
                                  normal new-paper flow with citekey suffix
- `flags: ["unsupported-ext"]` / `flags: ["error"]` → skip (logged)
- otherwise                    → append @<type>{<citekey>, ...} to master.bib,
                                  move file to papers/<citekey>/<citekey>.<ext>,
                                  write queue/<citekey>.json (kind=index)

Bumps catalog-version.txt once at the end so the frontend re-renders. Designed
to be idempotent on the queue side — if the queue file already exists, leaves it.

Usage:
  python3 triage_apply.py --input triage.jsonl [--library ~/Virgil-Library]
  python3 triage_batch.py | python3 triage_apply.py
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (
    TERMINAL_BIB_STATES,
    admit_catalog_row,
    append_inbox_item,
    bump_catalog_version,
    citekey_matches,
    is_terminal_bib_state,
    lock_catalog,
    read_catalog,
    read_master_bib,
    resolve_bib_state,
    update_master_bib_entry,
    write_catalog,
    write_paper_bib_entry,
)


# ── The notification vocabulary ───────────────────────────────────────────
#
# Every `kind` this script can append to the inbox, DECLARED once. Like
# `triage_batch.TRIAGE_FLAGS` it is an OPEN set that grows with the pipeline,
# so the skills must not carry a hand copy — read it with
# `--print-notification-kinds`.
#
# `triage-bib-ignored-<state>` is a FAMILY, not a kind: the head is completed
# by the SETTLED state that won, so its membership is derived from
# `_tools.TERMINAL_BIB_STATES` rather than written down (the shape
# `fuse_alternate.py --print-recompute-flags` already has for the
# `pgmark-fusion-` heads — a hand list silently under-covers the day a state is
# added). `--print-notification-kinds` expands it.
#
# Held to the code by `library/lib/__tests__/triage-vocabulary.test.ts`, which
# discovers the emitted set from this file's own `"kind": "…"` sites.
NOTIFICATION_KINDS: tuple[str, ...] = (
    "triaged",
    "triage-filename-mismatch",
    "triage-duplicate-work",
    "triage-needs-title",
    "triage-needs-metadata",
    "triage-needs-chapter-info",
    "triage-bib-imported",
    "triage-bib-summary",
    "triage-bib-folded-duplicate",
    "triage-bib-parse-failed",
    "triage-bib-cleanup-failed",
)

#: The one head whose tail is a `_tools.TERMINAL_BIB_STATES` member.
NOTIFICATION_KIND_FAMILY_HEAD = "triage-bib-ignored-"


def notification_kinds() -> list[str]:
    """The full emitted vocabulary, family expanded — the reader's door."""
    return sorted(NOTIFICATION_KINDS) + sorted(
        NOTIFICATION_KIND_FAMILY_HEAD + state for state in TERMINAL_BIB_STATES
    )


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_queue_entry(library: Path, citekey: str, kind: str = "index") -> bool:
    """Write queue/<citekey>.json. Returns False if already present."""
    qdir = library / ".virgil" / "queue"
    qdir.mkdir(parents=True, exist_ok=True)
    qf = qdir / f"{citekey}.json"
    if qf.exists():
        return False
    qf.write_text(json.dumps({
        "kind": kind,
        "status": "requested",
        "citekey": citekey,
        "requestedAt": _now(),
        "attempts": 0,
    }, indent=2) + "\n")
    return True


def _master_has_citekey(library: Path, citekey: str) -> bool:
    # NFC-insensitive: `read_master_bib` keys the dict by the SPELLING on
    # disk, so a raw `in` reports a real NFD-spelled entry as missing and
    # triage appends a SECOND entry for the same work. The raw hit stays as
    # the O(1) fast path (it is right whenever the spellings agree, which is
    # every ASCII citekey); only a miss pays the scan over a 34k-entry
    # master.bib.
    keys = read_master_bib(library / "master.bib")
    if citekey in keys:
        return True
    return any(citekey_matches(k, citekey) for k in keys)


def _record_alias(library: Path, loser_ck: str, survivor_ck: str, match) -> None:
    """Record `loser_ck → survivor_ck` in `.virgil/aliases.json` (durable).

    So a later re-intake of `loser_ck` resolves straight to the survivor. Lazy
    imports the alias I/O from `dedup_index`; failure to persist the alias is
    non-fatal (the fold decision already stands) — we just skip the record.
    """
    try:
        from dedup_index import load_aliases, save_aliases
        aliases = load_aliases(library)
        if loser_ck in aliases:
            return
        aliases[loser_ck] = {
            "survivor": survivor_ck,
            "work_key": None,
            "at": _now(),
            "reason": f"triage-fold ({getattr(match, 'relation', 'same')})",
        }
        save_aliases(library, aliases)
    except Exception:
        pass


def _bib_state_for_citekey(library: Path, citekey: str, catalog: dict) -> str:
    """The F#4 read, through the one door: master.bib's `% bib.state` comment
    is the HOME, the catalog row the pre-F#4 fallback.

    Reading the catalog alone (the pre-442 shape) answered "none" for every
    fileless reference, so the authenticated-winner guard below could not fire
    and a `.bib` drop silently overwrote the user's authenticated fields and
    downgraded the state."""
    return resolve_bib_state(library, citekey, catalog=catalog)


def _merge_bib_fields(
    existing: dict[str, str],
    incoming: dict[str, str],
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Union fields. For conflicts, prefer incoming. Empty values never overwrite.

    Returns (merged_fields, change_log) where change_log entries match the
    BibFieldChange shape in library/lib/catalog.ts.
    """
    merged = dict(existing)
    changes: list[dict[str, str]] = []
    now = _now()
    for k, new_v in incoming.items():
        new_v = (new_v or "").strip()
        if not new_v:
            continue
        old_v = (existing.get(k) or "").strip()
        if old_v == new_v:
            continue
        merged[k] = new_v
        changes.append({
            "field": k,
            "from": old_v,
            "to": new_v,
            "source": "bib-import",
            "at": now,
        })
    return merged, changes


def _virgil_sidecars(paper_dir: Path) -> None:
    virgil_dir = paper_dir / "virgil"
    virgil_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "virgil.json": {"paragraphs": {}},
        "notes.json": {"notes": []},
        "footnotes.json": {"footnotes": []},
    }
    for name, content in files.items():
        p = virgil_dir / name
        if not p.exists():
            p.write_text(json.dumps(content, indent=2) + "\n")


# `_write_references_bib` used to `write_text` a single emitted entry over the
# whole file. A .bib drop whose citekey collides with an ALREADY-DEEP-INDEXED
# paper therefore replaced that paper's cited works with one entry. Routed
# through the shared upsert writer (task 168).


def _upsert_catalog_row_bib_only(
    library: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
    field_changes: list[dict[str, str]] | None = None,
    bib_state: str = "unverified",
) -> None:
    """Write the catalog row a `.bib` entry is entitled to — usually none.

    A `.bib` import carries no source document, so its entry is
    reference-only: under the F#4 sources-only model it must NOT mint a
    catalog row. The auth state already lives in the `% bib.state` comment
    in master.bib (written by the `update_master_bib_entry` call in
    `apply_bib_row`), which `build_bib_index` projects into bib-index.json.
    The gate itself is `_tools.admit_catalog_row` — one shared door since
    task 443, rather than three writers each spelling `paper_has_holdings`
    and each discharging the state by hand (one of them forgot to).

    The one exception: if a HOLDINGS row already exists for this citekey
    (the `.bib` import names a citekey that's also held on disk), we still
    refresh that existing row's bib fields in place — never clobbering its
    `pdf.present`/`indexed` — so a real holding doesn't lose its merged
    field history. We never CREATE a `pdf.present=false` row here.

    Read-modify-write is serialized via `lock_catalog` so concurrent
    triage runs don't drop each other's row updates.
    """
    bib_status_min: dict[str, Any] = {"state": bib_state}
    if field_changes:
        bib_status_min["fieldChanges"] = field_changes

    if not admit_catalog_row(
        library, citekey,
        entry_type=entry_type, fields=fields, bib_state=bib_state,
        bib=bib_status_min,
    ):
        # Reference-only, and there is nothing left to do here: the door has
        # discharged the state to the `% bib.state` comment in master.bib (a
        # re-assert of what `apply_bib_row` wrote a moment ago, and free —
        # `update_master_bib_entry` skips a byte-identical write) and has
        # refreshed an already-existing row without minting one. That
        # exception used to be hand-written here and nowhere else, which is
        # how the third writer came to lose it; it is the door's now, so all
        # three writers keep it.
        return

    title = fields.get("title", "") or ""
    authors_str = fields.get("author", "") or ""
    authors = [a.strip() for a in authors_str.split(" and ") if a.strip()]
    year_str = fields.get("year", "") or ""
    year_int: int | None = None
    if year_str:
        m = re.search(r"\b(\d{4})\b", year_str)
        if m:
            try:
                year_int = int(m.group(1))
            except ValueError:
                year_int = None
    doi = fields.get("doi", "") or ""

    bib_status: dict[str, Any] = {"state": bib_state}
    if field_changes:
        bib_status["fieldChanges"] = field_changes

    now = _now()
    base_row = {
        "citekey": citekey,
        "title": title,
        "authors": authors,
        "year": year_int,
        "doi": doi,
        "addedAt": now,
        "updatedAt": now,
        "pdf": {"present": False},
        "indexed": {"state": "none"},
        "bib": bib_status,
    }

    with lock_catalog(library):
        catalog = read_catalog(library)
        catalog.setdefault("version", 1)
        catalog.setdefault("entries", [])
        for i, e in enumerate(catalog["entries"]):
            if citekey_matches(e.get("citekey", ""), citekey):
                # Preserve addedAt; only update mutable fields. F#4: never
                # clobber a holding's pdf/indexed status with the bib-only
                # placeholders — this path now runs only for real holdings.
                preserved = {
                    "addedAt": e.get("addedAt", now),
                    "tags": e.get("tags"),
                    "originalFilename": e.get("originalFilename"),
                    "pdf": e.get("pdf"),
                    "indexed": e.get("indexed"),
                }
                merged_bib = dict(e.get("bib") or {})
                merged_bib.update(bib_status)
                existing_changes = (e.get("bib") or {}).get("fieldChanges") or []
                new_changes = bib_status.get("fieldChanges") or []
                if existing_changes or new_changes:
                    merged_bib["fieldChanges"] = existing_changes + new_changes
                updated = dict(base_row)
                updated["addedAt"] = preserved["addedAt"]
                updated["bib"] = merged_bib
                for k, v in preserved.items():
                    if k != "addedAt" and v is not None:
                        updated[k] = v
                catalog["entries"][i] = updated
                write_catalog(library, catalog)
                return
        # New holdings row: reflect the source file actually present on disk.
        base_row["pdf"] = {"present": True}
        catalog["entries"].append(base_row)
        write_catalog(library, catalog)


def _guard_find(
    library: Path,
    fields: dict[str, str],
    entry_type: str,
    citekey: str,
    index,
):
    """Consult the work-identity intake guard. Returns a `Match` or None.

    Lazy-imports `dedup_index` inside the call so importing `triage_apply`
    never drags in the dedup stack (and there's no import cycle). Never raises
    on a clean miss; on any guard error we degrade to "no match" so triage is
    never blocked by a guard hiccup.
    """
    try:
        from dedup_index import find_work_in_library
        return find_work_in_library(
            fields, entry_type, library,
            index=index,
            incoming_citekey=citekey,
            include_uncertain=True,
        )
    except Exception:
        return None


def apply_bib_row(
    row: dict[str, Any],
    library: Path,
    *,
    guard_index=None,
) -> dict[str, str]:
    """Apply one bib-only triage row.

    For .bib imports we don't move a source file; we upsert the bib entry
    (with its `% bib.state` comment — the F#4 home for the auth state) and
    create the paper-folder skeleton. Under F#4 a source-less entry is
    reference-only and gets NO catalog row: `_upsert_catalog_row_bib_only`
    only REFRESHES an already-existing holdings row, it never mints one.
    The source .bib file in unsorted/ is removed by the caller after all
    rows from a given file have been applied (or parked on parse failure).

    `guard_index` is a shared `work_identity.WorkIndex` built ONCE per apply
    run (see `main`) and threaded through. Before minting a NEW bib-only row we
    consult the work-identity guard: a `same`/`alias` hit folds the row into the
    existing citekey (records an alias, reports "folded into <ck>"); an
    `uncertain` hit still mints the row but flags `possibleDuplicateOf`.
    """
    filename = row.get("filename", "")
    flags = row.get("flags", []) or []

    if "bib-parse-failed" in flags:
        # The whole file failed to parse — leave it for human handling.
        return {"status": "bib-parse-failed", "summary": f"{filename}: parse failed"}
    if "bib-no-citekey" in flags or not row.get("proposedCitekey"):
        return {"status": "bib-skipped-no-citekey", "summary": f"{filename}: bib entry missing citekey"}

    citekey = row["proposedCitekey"].strip()
    entry_type = (row.get("proposedType") or "misc").strip().lower()
    incoming_fields = dict(row.get("proposedFields") or {})
    proposed_state = (row.get("proposedBibState") or "unverified").strip().lower()

    catalog = read_catalog(library)
    existing_state = _bib_state_for_citekey(library, citekey, catalog)

    # ── Work-identity intake guard (before minting a bib-only row). ────
    # Only meaningful when the incoming citekey is genuinely new — an existing
    # citekey is an update/merge of the SAME record (handled below), not a new
    # duplicate. A `same`/`alias` verdict under a DIFFERENT citekey folds this
    # row into the survivor; an `uncertain` verdict mints but flags for review.
    if guard_index is not None and not _master_has_citekey(library, citekey):
        match = _guard_find(library, incoming_fields, entry_type, citekey, guard_index)
        if match is not None and not citekey_matches(match.citekey, citekey):
            if match.relation in ("same", "alias"):
                _record_alias(library, citekey, match.citekey, match)
                append_inbox_item(library, {
                    "kind": "triage-bib-folded-duplicate",
                    "filename": filename,
                    "citekey": citekey,
                    "foldedInto": match.citekey,
                    "relation": match.relation,
                    "confidence": match.confidence,
                    "at": _now(),
                })
                return {
                    "status": "bib-folded",
                    "summary": (
                        f"{filename}: {citekey} folded into existing "
                        f"{match.citekey} ({match.relation}, conf={match.confidence:.2f})"
                    ),
                }
            # relation == "uncertain": mint the row, but flag it for review.
            row.setdefault("_possibleDuplicateOf", match.citekey)

    # ── A SETTLED entry stays put. ────────────────────────────────────
    # The set is `TERMINAL_BIB_STATES`, not a hand pair: `canonical` is
    # terminal too, and naming only authenticated/manuscript here let a drop
    # replace a canonical entry's fields wholesale and stamp it `unverified`.
    if is_terminal_bib_state(existing_state):
        append_inbox_item(library, {
            "kind": f"triage-bib-ignored-{existing_state}",
            "filename": filename,
            "citekey": citekey,
            "existingState": existing_state,
            "at": _now(),
        })
        return {
            "status": "bib-ignored",
            "summary": f"{citekey}: existing bib.state={existing_state}; new entry ignored",
        }

    # ── Otherwise merge (incoming wins on conflict; existing fills the rest). ──
    field_changes: list[dict[str, str]] = []
    merged_fields = incoming_fields
    # Unconditional: every state that reaches here is non-terminal, so the
    # existing fields are always merged in rather than replaced. Gating this on
    # a hand list of states (the pre-442 `unverified/failed/none`) dropped the
    # existing fields wholesale for any state the list forgot — `needs-reauth`
    # was one, and its whole meaning is "these fields are not yet trusted".
    try:
        from _bib_parse import read_master_bib
        existing_master = read_master_bib(library / "master.bib")
    except Exception:
        existing_master = {}
    existing_entry = existing_master.get(citekey)
    if existing_entry:
        merged_fields, field_changes = _merge_bib_fields(
            existing_entry["fields"], incoming_fields,
        )
        # Keep the more specific entry type if existing is more specific
        # (e.g., existing says "incollection" but incoming says "misc").
        if entry_type == "misc" and existing_entry.get("type"):
            entry_type = existing_entry["type"]

    final_state = "manuscript" if proposed_state == "manuscript" else "unverified"
    update_master_bib_entry(library, citekey, entry_type, merged_fields, bib_state=final_state)

    # Per-paper folder + sidecars (no source file, no main.tex).
    paper_dir = library / "papers" / citekey
    _virgil_sidecars(paper_dir)
    write_paper_bib_entry(paper_dir, citekey, entry_type, merged_fields)

    # Catalog row — refresh-only. Mints nothing for a source-less entry
    # (F#4 holdings gate, `_tools.admit_catalog_row`).
    _upsert_catalog_row_bib_only(
        library, citekey, entry_type, merged_fields,
        field_changes=field_changes,
        bib_state=final_state,
    )

    # Queue authentication unless this is an explicit manuscript.
    queued = False
    if final_state != "manuscript":
        queued = _write_queue_entry(library, citekey, kind="authenticate")

    possible_dup = row.get("_possibleDuplicateOf")

    summary_bits = [f"{citekey} ({entry_type})"]
    if field_changes:
        summary_bits.append(f"merged {len(field_changes)} field(s)")
    if final_state == "manuscript":
        summary_bits.append("manuscript — no auth queued")
    elif queued:
        summary_bits.append("queued authenticate")
    else:
        summary_bits.append("authenticate already queued")
    if possible_dup:
        summary_bits.append(f"possibleDuplicateOf {possible_dup}")

    inbox_item = {
        "kind": "triage-bib-imported",
        "filename": filename,
        "citekey": citekey,
        "entryType": entry_type,
        "merged": bool(field_changes),
        "state": final_state,
        "at": _now(),
    }
    if possible_dup:
        inbox_item["possibleDuplicateOf"] = possible_dup
    append_inbox_item(library, inbox_item)
    result = {
        "status": "bib-imported",
        "summary": f"{filename} → {' · '.join(summary_bits)}",
    }
    if possible_dup:
        result["possibleDuplicateOf"] = possible_dup
    return result


def apply_row(row: dict[str, Any], library: Path, *, guard_index=None) -> dict[str, str]:
    """Apply one triage row. Returns a result dict with `status` and `summary`.

    `guard_index` is a shared `work_identity.WorkIndex` built once per apply run
    and threaded through to the intake guards (bib fan-out + PDF/DOCX stub).
    """
    filename = row.get("filename", "")
    flags = row.get("flags", []) or []

    # ── Bib-only branch: no source-file move, fan-out from a .bib import. ──
    if "bib-only" in flags:
        return apply_bib_row(row, library, guard_index=guard_index)

    src = library / "unsorted" / filename
    if not src.exists():
        return {"status": "skipped", "summary": f"{filename}: source missing"}

    ext = row.get("extension") or src.suffix.lstrip(".").lower()

    # ── Whole-handbook: park in _pending, notify, no queue ─────────────
    if "whole-handbook" in flags:
        pending = library / "unsorted" / "_pending"
        pending.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(pending / filename))
        append_inbox_item(library, {
            "kind": "triage-needs-chapter-info",
            "filename": filename,
            "candidateAuthor": row.get("filenameAuthor", ""),
            "handbookTitle": next((n for n in row.get("notes", []) if "handbook" in n.lower() or "edited volume" in n.lower()), ""),
            "at": _now(),
        })
        return {"status": "needs-chapter-info", "summary": f"{filename}: parked in _pending/"}

    # ── Variant-copy: archive under existing citekey ───────────────────
    if "variant-copy" in flags:
        existing = row.get("existingCitekey", "")
        if existing:
            variants_dir = library / "papers" / existing / "variants"
            variants_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(variants_dir / filename))
            append_inbox_item(library, {
                "kind": "triaged",
                "summary": f"Kept {filename} as variant archive of {existing}",
                "at": _now(),
            })
            return {"status": "variant", "summary": f"{filename} → papers/{existing}/variants/"}
        # Fall through with a citekey suffix bump if no existingCitekey.

    # ── Skip rows the batch script flagged as unprocessable ────────────
    if "unsupported-ext" in flags or "error" in flags:
        return {"status": "skipped", "summary": f"{filename}: {','.join(flags)}"}

    # ── Needs-title: park in _pending, notify, no queue ──────────────
    if "needs-title" in flags:
        pending = library / "unsorted" / "_pending"
        pending.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(pending / filename))
        append_inbox_item(library, {
            "kind": "triage-needs-title",
            "filename": filename,
            "proposedCitekey": row.get("proposedCitekey", ""),
            "at": _now(),
        })
        return {"status": "needs-title", "summary": f"{filename}: parked in _pending/ (no title extracted)"}

    # ── Needs-metadata: quarantine to _needs-metadata/ instead of
    # minting `papers/unnamed-N/` garbage directories. See
    # 2026-05-16-triage-no-name-pdfs.md.
    if "needs-metadata" in flags or not row.get("proposedCitekey"):
        quarantine = library / "unsorted" / "_needs-metadata"
        quarantine.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(quarantine / filename))
        append_inbox_item(library, {
            "kind": "triage-needs-metadata",
            "filename": filename,
            "byline": row.get("byline", []),
            "at": _now(),
        })
        return {
            "status": "needs-metadata",
            "summary": (
                f"{filename}: quarantined to _needs-metadata/ "
                f"(heuristic could not derive citekey)"
            ),
        }

    # ── Normal flow: bib stub + file move + queue ──────────────────────
    citekey = row.get("proposedCitekey", "")
    entry_type = row.get("proposedType") or "article"
    proposed_fields = dict(row.get("proposedFields", {}) or {})

    if not citekey:
        return {"status": "skipped", "summary": f"{filename}: no citekey"}

    # Filename mismatch: append a notification (audit trail).
    if "filename-mismatch" in flags:
        append_inbox_item(library, {
            "kind": "triage-filename-mismatch",
            "originalFilename": filename,
            "filenameAuthor": row.get("filenameAuthor", ""),
            "contentAuthor": row.get("contentAuthor", ""),
            "newCitekey": citekey,
            "at": _now(),
        })

    # Append bib stub if not already in master.bib. Check-then-write
    # is fine here: `update_master_bib_entry` is locked, so the worst
    # case under a race is the stub being written twice with the same
    # content (idempotent).
    duplicate_of: str | None = None
    if not _master_has_citekey(library, citekey):
        # ── Work-identity intake guard (PDF/DOCX intake). ──────────────
        # A held source is higher-stakes than a bib stub: on a `same`-work
        # hit under a DIFFERENT citekey we DO NOT silently drop the second
        # copy (the operator dropped a real file). We flag a duplicate-work
        # decision, record `duplicateOf`, and still index by default so the
        # extraction lands and the human can decide. `uncertain` is flagged
        # the same way but never blocks.
        if guard_index is not None:
            match = _guard_find(library, proposed_fields, entry_type, citekey, guard_index)
            if match is not None and not citekey_matches(match.citekey, citekey):
                duplicate_of = match.citekey
                append_inbox_item(library, {
                    "kind": "triage-duplicate-work",
                    "filename": filename,
                    "citekey": citekey,
                    "duplicateOf": match.citekey,
                    "relation": match.relation,
                    "confidence": match.confidence,
                    "decision": "indexed-with-flag",
                    "reasons": list(match.reasons),
                    "at": _now(),
                })
        update_master_bib_entry(
            library, citekey, entry_type, proposed_fields,
            bib_state="unverified",
        )

    # Move file to papers/<citekey>/<citekey>.<ext>.
    paper_dir = library / "papers" / citekey
    paper_dir.mkdir(parents=True, exist_ok=True)
    dest = paper_dir / f"{citekey}.{ext}"
    if dest.exists():
        # Don't overwrite — return a clear error so the operator can resolve.
        return {"status": "collision", "summary": f"{filename}: {dest.name} already exists in papers/{citekey}/"}
    shutil.move(str(src), str(dest))

    # Write queue entry.
    _write_queue_entry(library, citekey, kind="index")
    triaged_summary = f"Triaged {filename} → {citekey} ({entry_type})"
    if duplicate_of:
        triaged_summary += f" [duplicateOf {duplicate_of} — flagged for review]"
    append_inbox_item(library, {
        "kind": "triaged",
        "summary": triaged_summary,
        "at": _now(),
        **({"duplicateOf": duplicate_of} if duplicate_of else {}),
    })
    result = {"status": "triaged", "summary": f"{filename} → {citekey} ({entry_type})"}
    if duplicate_of:
        result["duplicateOf"] = duplicate_of
        result["summary"] += f" [duplicateOf {duplicate_of}]"
    return result


def main() -> int:
    p = argparse.ArgumentParser(description="Apply a reviewed triage JSONL.")
    p.add_argument("--input", default="-",
                   help="JSONL input path; '-' for stdin (default)")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--print-notification-kinds", action="store_true",
                   help=(
                       "Print the notification vocabulary (one per line, the "
                       "`triage-bib-ignored-<state>` family expanded) and "
                       "exit. The DOOR for any reader that needs the set."
                   ))
    args = p.parse_args()

    if args.print_notification_kinds:
        for kind in notification_kinds():
            print(kind)
        return 0

    library = Path(args.library).expanduser()

    if args.input == "-":
        text = sys.stdin.read()
    else:
        text = Path(args.input).expanduser().read_text()

    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"Skipping malformed line: {e}", file=sys.stderr)

    if not rows:
        print("No rows to apply.", file=sys.stderr)
        return 0

    # Cluster-size guard: when >10 rows claim to be variants of the
    # same sibling, the variant-copy heuristic almost certainly
    # mis-fired (placeholder-named backlog where every file matched
    # `<base>.<N>.<ext>` against a phantom parent). Strip the
    # variant-copy flag from all the children so they get re-derived
    # citekeys normally. See 2026-05-16-triage-no-name-pdfs.md.
    from collections import Counter
    sibling_counter: Counter[str] = Counter()
    for r in rows:
        if "variant-copy" in (r.get("flags") or []):
            sib = r.get("siblingFilename", "")
            if sib:
                sibling_counter[sib] += 1
    suspicious = {sib for sib, c in sibling_counter.items() if c > 10}
    if suspicious:
        print(
            f"Cluster-size guard: stripping variant-copy from {sum(sibling_counter[s] for s in suspicious)} "
            f"rows across {len(suspicious)} suspicious parents: "
            f"{sorted(suspicious)[:5]}{'…' if len(suspicious) > 5 else ''}",
            file=sys.stderr,
        )
        for r in rows:
            if "variant-copy" in (r.get("flags") or []):
                sib = r.get("siblingFilename", "")
                if sib in suspicious:
                    r["flags"] = [f for f in r["flags"] if f != "variant-copy"]
                    r["notes"] = (r.get("notes") or []) + [
                        f"variant-copy stripped: parent {sib!r} had "
                        f"{sibling_counter[sib]} children (cluster-size guard)"
                    ]
                    # If we have no citekey at all now, mark for quarantine.
                    if not r.get("proposedCitekey"):
                        r["flags"].append("needs-metadata")

    # Build the work-identity guard index ONCE for the whole apply run (a full
    # master.bib + catalog scan is expensive; every row's intake guard reuses
    # it). Lazy-imported so triage_apply stays importable without the dedup
    # stack; a failure to build it degrades to "no guard" (triage still runs).
    guard_index = None
    try:
        from dedup_index import build_index
        guard_index = build_index(library)
    except Exception as e:
        print(f"Note: work-identity guard unavailable ({e}); "
              f"proceeding without duplicate detection.", file=sys.stderr)

    counts: dict[str, int] = {}
    # Track which source .bib files in unsorted/ have been touched, and
    # whether any of their rows hit a parse failure.
    bib_files: dict[str, dict[str, int]] = {}
    for row in rows:
        try:
            result = apply_row(row, library, guard_index=guard_index)
        except Exception as e:
            result = {"status": "error", "summary": f"{row.get('filename','?')}: {e}"}
        status = result["status"]
        counts[status] = counts.get(status, 0) + 1
        print(f"  [{status}] {result['summary']}")

        if (row.get("extension") or "").lower() == "bib":
            fn = row.get("filename") or ""
            stats = bib_files.setdefault(fn, {"ok": 0, "failed": 0})
            if status in ("bib-imported",):
                stats["ok"] += 1
            elif status in ("bib-ignored",):
                stats["ok"] += 1  # processed cleanly even if ignored
            else:
                stats["failed"] += 1

    # ── Source .bib disposition. ──────────────────────────────────────
    for fn, stats in bib_files.items():
        src = library / "unsorted" / fn
        if not src.exists():
            continue
        if stats["failed"] == 0:
            try:
                # unlink-exempt: this site has a STRONGER policy than the
                # shared helper's stderr warning (task 496) — a refused delete
                # of a fully-applied source .bib is reported to the library's
                # own inbox, where an operator will see it. Routing it through
                # `unlink_tolerant` would downgrade that to a warning nobody
                # reads.
                src.unlink()
            except Exception as e:
                append_inbox_item(library, {
                    "kind": "triage-bib-cleanup-failed",
                    "filename": fn,
                    "error": str(e),
                    "at": _now(),
                })
            else:
                append_inbox_item(library, {
                    "kind": "triage-bib-summary",
                    "filename": fn,
                    "imported": stats["ok"],
                    "failed": stats["failed"],
                    "at": _now(),
                })
        else:
            # Park unparseable / partially-failed files for human review.
            pending = library / "unsorted" / "_pending"
            pending.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(src), str(pending / fn))
            except Exception:
                pass
            append_inbox_item(library, {
                "kind": "triage-bib-parse-failed",
                "filename": fn,
                "imported": stats["ok"],
                "failed": stats["failed"],
                "at": _now(),
            })

    if counts:
        bump_catalog_version(library)

    print(f"\nDone. {len(rows)} rows: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
