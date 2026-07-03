#!/usr/bin/env python3
"""Cleanup CLI for the work-identity de-duplication pipeline.

Four subcommands (see ``DEDUP_DESIGN.md`` §"Deliverables" and §"Non-negotiable
safety"):

* ``scan``   — cluster the library, pick a survivor per cluster, and emit an
  auditable plan JSON + a human report. **Never writes to the library.**
* ``apply``  — execute a plan under locks, with an off-library backup, optimistic
  concurrency (``--expect-sha``), reversible folder archival, and an alias map.
* ``verify`` — post-apply invariants (nonzero exit if a hard invariant fails).
* ``check``  — fast "any same-work clusters left?" for the drain loop.

This module is an I/O *driver*. All identity logic lives in the frozen pure core
``work_identity`` and the frozen I/O bridge ``dedup_index`` — both are imported,
never edited. The only bib/catalog surgery here is the plan-execution mechanics
(text splicing, row removal, folder moves) that the bridge deliberately leaves to
the caller.

Safety contract enforced here (``DEDUP_DESIGN.md`` §"Non-negotiable safety"):

* Never delete a ``papers/<ck>/`` folder — archive to ``.virgil/_dedup-archive/``.
* Never drop a deep-index member: survivor selection keeps highest depth, and a
  loser flagged ``archive-folder`` is *moved*, never removed.
* Hold ``lock_master_bib`` / ``lock_catalog`` across the ENTIRE read→compute→write.
* Pre-apply backup of master.bib + catalog to a caller-supplied off-library path;
  abort if the live master.bib sha changed since scan (``--expect-sha``).
* ``distinct`` and ``uncertain`` clusters are never auto-applied — only clusters
  the plan lists (and, per ``--tiers``, of the requested tier) are touched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import work_identity as wi
import dedup_index as di
import _tools


# ─────────────────────────────────────────────────────────────────────────
# Small helpers
# ─────────────────────────────────────────────────────────────────────────


def _sha256_file(path: Path) -> str:
    """Hex sha256 of a file, or ``""`` if absent."""
    if not path.exists():
        return ""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_json(path: Path) -> dict:
    return json.loads(Path(path).read_text())


def _records_by_ck(records: list[dict]) -> dict[str, dict]:
    """citekey → record (last write wins, mirroring WorkIndex)."""
    out: dict[str, dict] = {}
    for r in records:
        ck = r.get("citekey")
        if ck:
            out[ck] = r
    return out


# ─────────────────────────────────────────────────────────────────────────
# scan
# ─────────────────────────────────────────────────────────────────────────


def _member_actions(
    ck: str,
    *,
    is_survivor: bool,
    rec: dict,
    in_master: bool,
    survivor_union_changed: bool,
) -> list[str]:
    """Decide the action list for one cluster member.

    Survivor:
      * always ``keep``; ``rewrite-master-entry`` only if its union changed
        (so ``apply`` re-emits exactly the survivors that need it).
    Loser:
      * ``archive-folder`` if it has a ``papers/<ck>`` folder OR is
        indexed/deepIndexed (its extraction is real work) — else ``drop-row``
        (bib-only stub).
      * ``remove-master-entry`` if it has a master.bib entry.
      * always ``alias`` (loser → survivor).
    """
    meta = rec.get("meta", {}) or {}
    if is_survivor:
        acts = ["keep"]
        if survivor_union_changed:
            acts.append("rewrite-master-entry")
        return acts

    acts: list[str] = []
    has_folder = bool(meta.get("has_folder"))
    idx_state = str(meta.get("indexed_state") or "").lower()
    is_indexed = idx_state.startswith("deep") or idx_state == "indexed"
    if has_folder or is_indexed:
        acts.append("archive-folder")
    else:
        acts.append("drop-row")
    if in_master:
        acts.append("remove-master-entry")
    acts.append("alias")
    return acts


def build_plan(library: Path) -> dict:
    """Compute the full de-dup plan for ``library`` (pure read; no writes)."""
    library = Path(library)
    master_path = library / "master.bib"
    master_sha = _sha256_file(master_path)

    records = di.load_library_records(library)
    loadbearing = di.loadbearing_keys(library)
    by_ck = _records_by_ck(records)
    in_master = set(_tools.read_master_bib(master_path).keys())

    clusters, uncertain_pairs = wi.cluster(records)

    plan_clusters: list[dict] = []
    n_auto = 0
    n_conflict = 0
    for members in clusters:
        cluster_recs = [by_ck[ck] for ck in members if ck in by_ck]
        pick = wi.pick_survivor(cluster_recs, loadbearing)
        survivor = pick["survivor"]
        conflict = pick["survivor_conflict"]
        tier = "conflict" if conflict else "auto"
        if conflict:
            n_conflict += 1
        else:
            n_auto += 1

        losers = [ck for ck in pick["ranked"] if ck != survivor]
        survivor_fields = (by_ck.get(survivor, {}).get("fields", {}) or {})
        loser_fields_list = [
            (by_ck.get(ck, {}).get("fields", {}) or {}) for ck in losers
        ]
        union_preview, provenance = wi.union_fields(survivor_fields, loser_fields_list)
        survivor_union_changed = bool(provenance)

        member_entries: list[dict] = []
        for ck in pick["ranked"]:
            rec = by_ck.get(ck, {})
            role = "survivor" if ck == survivor else "loser"
            actions = _member_actions(
                ck,
                is_survivor=(ck == survivor),
                rec=rec,
                in_master=(ck in in_master),
                survivor_union_changed=survivor_union_changed,
            )
            meta = rec.get("meta", {}) or {}
            member_entries.append({
                "citekey": ck,
                "role": role,
                "actions": actions,
                "meta": {
                    "bib_state": meta.get("bib_state"),
                    "indexed_state": meta.get("indexed_state"),
                    "has_folder": bool(meta.get("has_folder")),
                    "in_master": ck in in_master,
                    "type": rec.get("type", "misc"),
                },
            })

        # Stable work_key: survivor's DOI, else its normalized title, else ck.
        fp = wi.fingerprint(survivor_fields, by_ck.get(survivor, {}).get("type", ""))
        work_key = fp.doi or fp.title_norm or survivor

        plan_clusters.append({
            "work_key": work_key,
            "tier": tier,
            "survivor": survivor,
            "ranked": pick["ranked"],
            "survivor_conflict": conflict,
            "members": member_entries,
            "union_preview": union_preview,
            "provenance": provenance,
            "reasons": pick["reasons"],
        })

    plan_clusters.sort(key=lambda c: c["survivor"])

    uncertain_out = []
    for a, b, v in uncertain_pairs:
        uncertain_out.append({
            "a": a,
            "b": b,
            "confidence": v.confidence,
            "reasons": list(v.reasons),
        })

    n_losers = sum(
        1 for c in plan_clusters for m in c["members"] if m["role"] == "loser"
    )
    stats = {
        "clusters": len(plan_clusters),
        "auto": n_auto,
        "conflict": n_conflict,
        "losers": n_losers,
        "uncertain_pairs": len(uncertain_out),
        "records": len(records),
    }

    return {
        "generated_at": None,  # caller stamps; no clock in-script (per contract)
        "master_sha": master_sha,
        "stats": stats,
        "clusters": plan_clusters,
        "uncertain_pairs": uncertain_out,
    }


def _render_report(plan: dict) -> str:
    """Human-readable Markdown summary of a plan."""
    st = plan["stats"]
    lines: list[str] = []
    lines.append("# De-duplication scan report")
    lines.append("")
    lines.append(f"- master.bib sha256: `{plan['master_sha'] or '(absent)'}`")
    lines.append(f"- records scanned: **{st['records']}**")
    lines.append(f"- same-work clusters: **{st['clusters']}** "
                 f"(auto: {st['auto']}, conflict: {st['conflict']})")
    lines.append(f"- losers to collapse: **{st['losers']}**")
    lines.append(f"- uncertain pairs (for adjudication): **{st['uncertain_pairs']}**")
    lines.append("")
    lines.append("## Top clusters")
    lines.append("")
    top = plan["clusters"][:30]
    if not top:
        lines.append("_(none)_")
    for c in top:
        losers = [m["citekey"] for m in c["members"] if m["role"] == "loser"]
        lines.append(f"### `{c['survivor']}`  ({c['tier']})")
        lines.append(f"- work_key: `{c['work_key']}`")
        lines.append(f"- survivor: `{c['survivor']}`")
        lines.append(f"- losers: {', '.join('`'+l+'`' for l in losers) or '_(none)_'}")
        if c["survivor_conflict"]:
            lbm = c["reasons"].get("loadbearing_members", [])
            lines.append(f"- ⚠️ survivor_conflict — load-bearing members: "
                         f"{', '.join('`'+m+'`' for m in lbm)}")
        if c["provenance"]:
            fld = ", ".join(sorted(c["provenance"].keys()))
            lines.append(f"- union back-fills survivor fields: {fld}")
        lines.append("")
    if st["clusters"] > 30:
        lines.append(f"_… and {st['clusters'] - 30} more clusters (see plan.json)._")
        lines.append("")
    lines.append("## Uncertain pairs")
    lines.append("")
    lines.append(f"{st['uncertain_pairs']} pair(s) flagged for adjudication "
                 f"(never auto-merged).")
    lines.append("")
    return "\n".join(lines)


def cmd_scan(args: argparse.Namespace) -> int:
    library = Path(args.library).expanduser().resolve()
    plan = build_plan(library)
    if args.out:
        Path(args.out).write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n")
    else:
        print(json.dumps(plan, indent=2, ensure_ascii=False))
    if args.report:
        Path(args.report).write_text(_render_report(plan))
    st = plan["stats"]
    print(
        f"scan: {st['clusters']} clusters "
        f"(auto {st['auto']}, conflict {st['conflict']}), "
        f"{st['losers']} losers, {st['uncertain_pairs']} uncertain"
        + (f" → {args.out}" if args.out else ""),
        file=sys.stderr,
    )
    return 0


# ─────────────────────────────────────────────────────────────────────────
# apply
# ─────────────────────────────────────────────────────────────────────────


# Line-anchored entry opener (identical to _tools._BIB_ENTRY_START_RE — the
# same regex read_master_bib delimits entries with; we reuse the module's
# compiled object so the two can never drift).
_ENTRY_START_RE = _tools._BIB_ENTRY_START_RE


def _entry_spans(text: str) -> list[tuple[str, str, int, int]]:
    """Yield (citekey, entry_type, block_start, block_end) for every entry in
    ``text``, block-anchored so drop/replace is a pure slice.

    ``block_start`` is extended backward to swallow the entry's own preceding
    ``% bib.state = ...`` comment (and any blank lines between comment and
    ``@``). ``block_end`` extends forward through exactly ONE trailing blank
    line, so removing a block leaves the surrounding blank-line rhythm intact.
    """
    starts = list(_ENTRY_START_RE.finditer(text))
    spans: list[tuple[str, str, int, int]] = []
    for idx, m in enumerate(starts):
        entry_type = m.group(1).lower()
        citekey = m.group(2).strip()
        at_pos = m.start()

        # Brace-balanced end of THIS entry, capped at the next opener.
        seg_end = starts[idx + 1].start() if idx + 1 < len(starts) else len(text)
        brace = text.find("{", at_pos)
        depth = 1
        j = brace + 1
        while j < seg_end and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        entry_end = j if depth == 0 else seg_end

        # Extend start backward over a preceding `% bib.state` comment.
        block_start = at_pos
        line_start = text.rfind("\n", 0, at_pos)
        line_start = 0 if line_start == -1 else line_start + 1
        # Walk backward over blank lines then a single bib.state comment.
        cur = line_start
        while cur > 0:
            prev_end = cur - 1  # the '\n' at cur-1
            prev_start = text.rfind("\n", 0, prev_end)
            prev_start = 0 if prev_start == -1 else prev_start + 1
            prev_line = text[prev_start:prev_end]
            if prev_line.strip() == "":
                cur = prev_start
                continue
            if prev_line.lstrip().startswith("% bib.state"):
                block_start = prev_start
            break
        else:
            block_start = at_pos if line_start == at_pos else block_start

        # Extend end forward through ONE trailing blank line.
        block_end = entry_end
        if block_end < len(text) and text[block_end] == "\n":
            block_end += 1  # consume the newline that ends the `}` line
            # consume one more if the next line is blank
            nxt_nl = text.find("\n", block_end)
            line = text[block_end: nxt_nl if nxt_nl != -1 else len(text)]
            if line.strip() == "":
                block_end = (nxt_nl + 1) if nxt_nl != -1 else len(text)

        spans.append((citekey, entry_type, block_start, block_end))
    return spans


def _state_for_entry(text: str, block_start: int, at_pos: int) -> str:
    """Extract the ``% bib.state`` value inside [block_start, at_pos), or ""."""
    prefix = text[block_start:at_pos]
    m = re.search(r"(?m)^%\s*bib\.state\s*=\s*([\w-]+)", prefix)
    return m.group(1) if m else ""


def _rewrite_master_bib(
    text: str,
    *,
    drop_keys: set[str],
    rewrites: dict[str, dict],
) -> str:
    """Single-pass text surgery over master.bib.

    * ``drop_keys`` — citekeys whose whole block (+ preceding bib.state comment
      + one trailing blank line) is removed.
    * ``rewrites`` — ``{citekey: {"type", "fields"}}`` survivors whose union
      changed; re-emit the block (preserving/refreshing its bib.state comment),
      untouched otherwise.

    Everything else (header, untouched entries) is copied verbatim. Matches on
    both NFC and NFD forms of a key so diacritic drift can't miss.
    """
    import unicodedata

    def _forms(k: str) -> set[str]:
        return {unicodedata.normalize("NFC", k), unicodedata.normalize("NFD", k)}

    drop_all_forms: set[str] = set()
    for k in drop_keys:
        drop_all_forms |= _forms(k)
    rewrite_by_form: dict[str, str] = {}
    for k in rewrites:
        for f in _forms(k):
            rewrite_by_form[f] = k

    spans = _entry_spans(text)
    out_parts: list[str] = []
    cursor = 0
    for citekey, entry_type, bstart, bend in spans:
        # Copy any inter-entry text verbatim (header, blank lines we didn't own).
        if bstart > cursor:
            out_parts.append(text[cursor:bstart])
        if citekey in drop_all_forms:
            pass  # drop the block entirely
        elif citekey in rewrite_by_form:
            key = rewrite_by_form[citekey]
            spec = rewrites[key]
            at_pos = text.find("@", bstart)
            state = _state_for_entry(text, bstart, at_pos)
            block = ""
            if state:
                block += f"% bib.state = {state}\n"
            block += _tools.emit_bib_entry(
                unicodedata.normalize("NFC", citekey), spec["type"], spec["fields"]
            )
            # Preserve the trailing blank-line rhythm the original block had.
            trailing = text[bstart:bend]
            tnl = 0
            k = len(trailing) - 1
            while k >= 0 and trailing[k] == "\n":
                tnl += 1
                k -= 1
            # emit_bib_entry already ends in exactly one '\n'; add the rest.
            if tnl > 1:
                block += "\n" * (tnl - 1)
            out_parts.append(block)
        else:
            out_parts.append(text[bstart:bend])
        cursor = bend
    if cursor < len(text):
        out_parts.append(text[cursor:])
    return "".join(out_parts)


def _collect_plan_ops(plan: dict, tiers: set[str]) -> dict:
    """Reduce a plan to concrete operations for the requested tiers.

    Returns a dict with:
      * ``drop_master``   : set[loser ck] — remove-master-entry
      * ``rewrite_master``: {survivor ck: {"type","fields"}} — union changed
      * ``drop_rows``     : set[loser ck] — drop-row (bib-only)
      * ``archive_rows``  : set[loser ck] — archive-folder
      * ``aliases``       : {loser ck: (survivor ck, work_key, tier)}
      * ``backfill``      : {survivor ck: union_preview fields}
    """
    drop_master: set[str] = set()
    rewrite_master: dict[str, dict] = {}
    drop_rows: set[str] = set()
    archive_rows: set[str] = set()
    aliases: dict[str, tuple] = {}
    backfill: dict[str, dict] = {}

    for c in plan.get("clusters", []):
        if c.get("tier") not in tiers:
            continue
        survivor = c["survivor"]
        backfill[survivor] = c.get("union_preview", {}) or {}
        for m in c["members"]:
            ck = m["citekey"]
            acts = set(m.get("actions", []))
            if m["role"] == "survivor":
                if "rewrite-master-entry" in acts:
                    rewrite_master[ck] = {
                        "type": m["meta"].get("type", "misc"),
                        "fields": c.get("union_preview", {}) or {},
                    }
                continue
            # loser
            if "remove-master-entry" in acts:
                drop_master.add(ck)
            if "archive-folder" in acts:
                archive_rows.add(ck)
            elif "drop-row" in acts:
                drop_rows.add(ck)
            aliases[ck] = (survivor, c.get("work_key", survivor), c.get("tier"))

    return {
        "drop_master": drop_master,
        "rewrite_master": rewrite_master,
        "drop_rows": drop_rows,
        "archive_rows": archive_rows,
        "aliases": aliases,
        "backfill": backfill,
    }


def _apply_catalog(
    library: Path,
    ops: dict,
) -> tuple[int, int]:
    """Catalog surgery under ``lock_catalog``. Returns (rows_removed, folders_archived)."""
    archive_dir = library / ".virgil" / "_dedup-archive"
    manifest = archive_dir / "manifest.jsonl"
    papers_dir = library / "papers"

    drop_rows = ops["drop_rows"]
    archive_rows = ops["archive_rows"]
    backfill = ops["backfill"]
    loser_all = drop_rows | archive_rows

    rows_removed = 0
    folders_archived = 0

    with _tools.lock_catalog(library):
        catalog = _tools.read_catalog(library)
        entries = catalog.get("entries", [])
        by_ck = {_tools.normalize_citekey(e.get("citekey", "")): e for e in entries}

        # Backfill survivor top-level fields (title/doi/year/authors) from union.
        for surv, union in backfill.items():
            row = by_ck.get(_tools.normalize_citekey(surv))
            if row is None:
                continue
            union = union or {}
            if not str(row.get("title") or "").strip() and union.get("title"):
                row["title"] = union["title"]
            if not str(row.get("doi") or "").strip() and union.get("doi"):
                row["doi"] = union["doi"]
            if not str(row.get("year") or "").strip() and union.get("year"):
                row["year"] = str(union["year"])
            has_authors = bool(row.get("authors")) or bool(str(row.get("author") or "").strip())
            if not has_authors and union.get("author"):
                row["authors"] = [a.strip() for a in re.split(r"\s+and\s+", union["author"]) if a.strip()]

        # Archive folders for archive-folder losers, record manifest.
        manifest_lines: list[str] = []
        for ck in sorted(archive_rows):
            src = None
            for form in ("NFC", "NFD"):
                import unicodedata
                cand = papers_dir / unicodedata.normalize(form, ck)
                if cand.is_dir():
                    src = cand
                    break
            if src is not None:
                archive_dir.mkdir(parents=True, exist_ok=True)
                dst = archive_dir / src.name
                if dst.exists():
                    # Never clobber; suffix to keep it reversible.
                    n = 1
                    while (archive_dir / f"{src.name}.{n}").exists():
                        n += 1
                    dst = archive_dir / f"{src.name}.{n}"
                os.rename(src, dst)  # move, never delete
                folders_archived += 1
                manifest_lines.append(json.dumps({
                    "citekey": ck,
                    "from": str(src.relative_to(library)),
                    "to": str(dst.relative_to(library)),
                    "at": None,
                }, ensure_ascii=False))

        if manifest_lines:
            archive_dir.mkdir(parents=True, exist_ok=True)
            with open(manifest, "a") as f:
                for line in manifest_lines:
                    f.write(line + "\n")

        # Remove loser rows.
        loser_norm = {_tools.normalize_citekey(x) for x in loser_all}
        new_entries = []
        for e in entries:
            if _tools.normalize_citekey(e.get("citekey", "")) in loser_norm:
                rows_removed += 1
                continue
            new_entries.append(e)
        catalog["entries"] = new_entries

        _tools.write_catalog(library, catalog)

    return rows_removed, folders_archived


def cmd_apply(args: argparse.Namespace) -> int:
    library = Path(args.library).expanduser().resolve()
    plan = _load_json(Path(args.plan))
    tiers = {t.strip() for t in args.tiers.split(",") if t.strip()}
    ops = _collect_plan_ops(plan, tiers)

    master_path = library / "master.bib"
    catalog_path = library / ".virgil" / "catalog.json"

    # ── PREFLIGHT: optimistic concurrency ────────────────────────────────
    live_sha = _sha256_file(master_path)
    if args.expect_sha and args.expect_sha != live_sha:
        print(
            f"ABORT: master.bib sha mismatch.\n"
            f"  expected: {args.expect_sha}\n"
            f"  live:     {live_sha}\n"
            f"The library changed since scan — re-run scan and retry.",
            file=sys.stderr,
        )
        return 2

    # ── Backup (required off-library path) ───────────────────────────────
    if not args.backup_dir:
        print(
            "ABORT: --backup-dir is required (no default clock in-script). "
            "Pass an off-library backup directory.",
            file=sys.stderr,
        )
        return 2
    backup_dir = Path(args.backup_dir).expanduser()

    if args.dry_run:
        print("DRY RUN — no changes will be written.")
        print(f"  master entries to remove: {len(ops['drop_master'])}")
        print(f"  master entries to rewrite: {len(ops['rewrite_master'])}")
        print(f"  catalog rows to drop (bib-only): {len(ops['drop_rows'])}")
        print(f"  catalog rows to archive (folder): {len(ops['archive_rows'])}")
        print(f"  aliases to add: {len(ops['aliases'])}")
        print(f"  backup dir: {backup_dir}")
        print(f"  tiers: {sorted(tiers)}")
        return 0

    backup_dir.mkdir(parents=True, exist_ok=True)
    if master_path.exists():
        _tools._atomic_write_text(backup_dir / "master.bib.bak", master_path.read_text())
    if catalog_path.exists():
        _tools._atomic_write_text(backup_dir / "catalog.json.bak", catalog_path.read_text())

    # ── MASTER.BIB: whole read→compute→write under one lock ──────────────
    entries_removed = 0
    with _tools.lock_master_bib(library):
        # Re-verify sha INSIDE the lock: closes the TOCTOU window between the
        # preflight check and lock acquisition (a local writer could have
        # committed in between). Backup is already written; abort cleanly with
        # master.bib byte-unchanged.
        if args.expect_sha and _sha256_file(master_path) != args.expect_sha:
            print(
                "ABORT: master.bib changed between preflight and lock — "
                "no changes written. Re-run scan and retry.",
                file=sys.stderr,
            )
            return 2
        text = master_path.read_text() if master_path.exists() else ""
        before = set(_tools.read_master_bib(master_path).keys())
        new_text = _rewrite_master_bib(
            text,
            drop_keys=ops["drop_master"],
            rewrites=ops["rewrite_master"],
        )
        _tools._atomic_write_text(master_path, new_text)
    # Recount after to report actual removals.
    after = set(_tools.read_master_bib(master_path).keys())
    entries_removed = len(before - after)
    _tools._mark_bib_index_dirty(library)

    # ── CATALOG: rows + folder archival under lock ───────────────────────
    rows_removed, folders_archived = _apply_catalog(library, ops)

    # ── ALIASES: merge, don't clobber ────────────────────────────────────
    aliases = di.load_aliases(library)
    added = 0
    for loser, (survivor, work_key, tier) in ops["aliases"].items():
        if loser not in aliases:
            added += 1
        aliases[loser] = {
            "survivor": survivor,
            "work_key": work_key,
            "at": None,
            "reason": tier,
        }
    di.save_aliases(library, aliases)

    print(
        f"apply: entries removed {entries_removed}, "
        f"rows removed {rows_removed}, "
        f"folders archived {folders_archived}, "
        f"aliases added {added}"
    )
    return 0


# ─────────────────────────────────────────────────────────────────────────
# verify
# ─────────────────────────────────────────────────────────────────────────


def cmd_verify(args: argparse.Namespace) -> int:
    library = Path(args.library).expanduser().resolve()
    master = _tools.read_master_bib(library / "master.bib")
    master_keys = {_tools.normalize_citekey(k) for k in master}
    catalog = _tools.read_catalog(library)
    cat_keys = [_tools.normalize_citekey(e.get("citekey", "")) for e in catalog.get("entries", [])]

    aliases = di.load_aliases(library)
    dropped = {_tools.normalize_citekey(k) for k in aliases}

    hard_fail = False

    # Invariant 1: every catalog citekey present in master.bib (report residue).
    residue = [ck for ck in cat_keys if ck and ck not in master_keys]
    if residue:
        print(f"NOTE: {len(residue)} catalog citekey(s) absent from master.bib "
              f"(known residue): {', '.join(residue[:12])}"
              + (" …" if len(residue) > 12 else ""))

    # Invariant 2 (HARD): no surviving master entry citekey is itself a dropped
    # (aliased-away) loser.
    still_present = sorted(dropped & master_keys)
    if still_present:
        hard_fail = True
        print(f"FAIL: {len(still_present)} dropped-loser key(s) still in master.bib: "
              f"{', '.join(still_present[:12])}", file=sys.stderr)

    # Invariant 2b (HARD): no catalog row references a dropped key.
    cat_dropped = sorted(set(cat_keys) & dropped)
    if cat_dropped:
        hard_fail = True
        print(f"FAIL: {len(cat_dropped)} dropped-loser key(s) still have catalog rows: "
              f"{', '.join(cat_dropped[:12])}", file=sys.stderr)

    # Invariant 3 (report): remaining same-cluster count.
    records = di.load_library_records(library)
    clusters, uncertain = wi.cluster(records)
    print(f"remaining same-work clusters: {len(clusters)}")
    print(f"uncertain pairs: {len(uncertain)}")
    print(f"catalog rows: {len([c for c in cat_keys if c])}, "
          f"master entries: {len(master_keys)}, "
          f"aliases recorded: {len(aliases)}")

    if hard_fail:
        print("verify: FAILED (hard invariant violated)", file=sys.stderr)
        return 1
    print("verify: OK" + (f" ({len(residue)} known residue)" if residue else ""))
    return 0


# ─────────────────────────────────────────────────────────────────────────
# check
# ─────────────────────────────────────────────────────────────────────────


def _load_distinct_pairs(library: Path) -> set:
    """Load ``.virgil/dedup-distinct.json`` → set of frozenset({a,b}) pairs that
    an adjudicator judged NOT the same work, so ``check`` doesn't re-flag them."""
    p = Path(library) / ".virgil" / "dedup-distinct.json"
    if not p.exists():
        return set()
    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return set()
    return {frozenset(pair) for pair in data.get("pairs", []) if len(pair) == 2}


def cmd_check(args: argparse.Namespace) -> int:
    """Recurrence detector: report same-work clusters that are NOT already
    known-distinct. Every within-cluster pair being in the distinct registry
    means the cluster was adjudicated-distinct and is ignored."""
    library = Path(args.library).expanduser().resolve()
    records = di.load_library_records(library)
    clusters, _uncertain = wi.cluster(records)
    distinct = _load_distinct_pairs(library)

    def is_resolved(members: list) -> bool:
        # Fully resolved iff every pair of members is registered as distinct.
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                if frozenset((members[i], members[j])) not in distinct:
                    return False
        return True

    unresolved = [c for c in clusters if not is_resolved(c)]
    known = len(clusters) - len(unresolved)
    print(f"same-work clusters: {len(unresolved)} unresolved"
          f" ({known} known-distinct ignored, {len(distinct)} distinct pairs registered)")
    if unresolved and getattr(args, "list", False):
        for c in unresolved[:50]:
            print("  " + ", ".join(c))
    return 1 if unresolved else 0


# ─────────────────────────────────────────────────────────────────────────
# CLI wiring
# ─────────────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="dedup.py",
        description="Work-identity de-duplication cleanup CLI.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help="cluster the library, emit plan + report")
    p_scan.add_argument("--library", required=True)
    p_scan.add_argument("--out", help="write plan JSON here (default: stdout)")
    p_scan.add_argument("--report", help="write a human report.md here")
    p_scan.set_defaults(func=cmd_scan)

    p_apply = sub.add_parser("apply", help="execute a plan under locks + backup")
    p_apply.add_argument("--library", required=True)
    p_apply.add_argument("--plan", required=True)
    p_apply.add_argument("--tiers", default="auto",
                         help="comma-separated tiers to apply (auto,conflict)")
    p_apply.add_argument("--dry-run", action="store_true")
    p_apply.add_argument("--expect-sha", default=None,
                         help="abort if master.bib sha256 differs (optimistic concurrency)")
    p_apply.add_argument("--backup-dir", default=None,
                         help="REQUIRED off-library dir for master.bib + catalog backup")
    p_apply.set_defaults(func=cmd_apply)

    p_verify = sub.add_parser("verify", help="post-apply invariants")
    p_verify.add_argument("--library", required=True)
    p_verify.set_defaults(func=cmd_verify)

    p_check = sub.add_parser("check", help="fast: any UNRESOLVED same-work clusters left?")
    p_check.add_argument("--library", required=True)
    p_check.add_argument("--list", action="store_true", help="print the unresolved clusters")
    p_check.set_defaults(func=cmd_check)

    return ap


def main(argv: Optional[list[str]] = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
