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
    append_inbox_item,
    bump_catalog_version,
    emit_bib_entry,
    lock_catalog,
    read_catalog,
    read_master_bib,
    update_master_bib_entry,
    write_catalog,
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
    return citekey in read_master_bib(library / "master.bib")


def _bib_state_for_citekey(catalog: dict, citekey: str) -> str:
    for e in catalog.get("entries", []):
        if e.get("citekey") == citekey:
            return ((e.get("bib") or {}).get("state")) or "none"
    return "none"


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


def _write_references_bib(paper_dir: Path, citekey: str, entry_type: str, fields: dict[str, str]) -> None:
    paper_dir.mkdir(parents=True, exist_ok=True)
    (paper_dir / "references.bib").write_text(emit_bib_entry(citekey, entry_type, fields))


def _upsert_catalog_row_bib_only(
    library: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
    field_changes: list[dict[str, str]] | None = None,
    bib_state: str = "unverified",
) -> None:
    """Insert or update a bib-only catalog row (no source file, indexed=none).

    Read-modify-write is serialized via `lock_catalog` so concurrent
    triage runs don't drop each other's row updates.
    """
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
            if e.get("citekey") == citekey:
                # Preserve addedAt; only update mutable fields.
                preserved = {
                    "addedAt": e.get("addedAt", now),
                    "tags": e.get("tags"),
                    "originalFilename": e.get("originalFilename"),
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
        catalog["entries"].append(base_row)
        write_catalog(library, catalog)


def apply_bib_row(row: dict[str, Any], library: Path) -> dict[str, str]:
    """Apply one bib-only triage row.

    For .bib imports we don't move a source file; we upsert the bib entry
    and create/refresh the bib-only catalog row + paper folder skeleton.
    The source .bib file in unsorted/ is removed by the caller after all
    rows from a given file have been applied (or parked on parse failure).
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
    existing_state = _bib_state_for_citekey(catalog, citekey)

    # ── Authenticated / manuscript winners stay put. ──────────────────
    if existing_state in ("authenticated", "manuscript"):
        append_inbox_item(library, {
            "kind": "triage-bib-ignored-authenticated" if existing_state == "authenticated"
                    else "triage-bib-ignored-manuscript",
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
    if existing_state in ("unverified", "failed", "none"):
        # Pull the existing entry from master.bib and merge.
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
    _write_references_bib(paper_dir, citekey, entry_type, merged_fields)

    # Catalog row (bib-only).
    _upsert_catalog_row_bib_only(
        library, citekey, entry_type, merged_fields,
        field_changes=field_changes,
        bib_state=final_state,
    )

    # Queue authentication unless this is an explicit manuscript.
    queued = False
    if final_state != "manuscript":
        queued = _write_queue_entry(library, citekey, kind="authenticate")

    summary_bits = [f"{citekey} ({entry_type})"]
    if field_changes:
        summary_bits.append(f"merged {len(field_changes)} field(s)")
    if final_state == "manuscript":
        summary_bits.append("manuscript — no auth queued")
    elif queued:
        summary_bits.append("queued authenticate")
    else:
        summary_bits.append("authenticate already queued")

    append_inbox_item(library, {
        "kind": "triage-bib-imported",
        "filename": filename,
        "citekey": citekey,
        "entryType": entry_type,
        "merged": bool(field_changes),
        "state": final_state,
        "at": _now(),
    })
    return {
        "status": "bib-imported",
        "summary": f"{filename} → {' · '.join(summary_bits)}",
    }


def apply_row(row: dict[str, Any], library: Path) -> dict[str, str]:
    """Apply one triage row. Returns a result dict with `status` and `summary`."""
    filename = row.get("filename", "")
    flags = row.get("flags", []) or []

    # ── Bib-only branch: no source-file move, fan-out from a .bib import. ──
    if "bib-only" in flags:
        return apply_bib_row(row, library)

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
    if not _master_has_citekey(library, citekey):
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
    append_inbox_item(library, {
        "kind": "triaged",
        "summary": f"Triaged {filename} → {citekey} ({entry_type})",
        "at": _now(),
    })
    return {"status": "triaged", "summary": f"{filename} → {citekey} ({entry_type})"}


def main() -> int:
    p = argparse.ArgumentParser(description="Apply a reviewed triage JSONL.")
    p.add_argument("--input", default="-",
                   help="JSONL input path; '-' for stdin (default)")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    args = p.parse_args()

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

    counts: dict[str, int] = {}
    # Track which source .bib files in unsorted/ have been touched, and
    # whether any of their rows hit a parse failure.
    bib_files: dict[str, dict[str, int]] = {}
    for row in rows:
        try:
            result = apply_row(row, library)
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
