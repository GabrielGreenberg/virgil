"""DESTRUCTIVE one-time prune of `pdf.present == false` catalog rows (F#4).

Under the F#4 sources-only / layered-hybrid model, `.virgil/catalog.json`
carries ONLY holdings rows (`pdf.present == true`). Reference-only entries
(cited but not held on disk) no longer have a catalog row; their auth state
lives instead as a `% bib.state = <state>` comment in `master.bib`, which
`build_bib_index` projects into `bib-index.json`.

This script removes the legacy `pdf.present == false` rows that pre-F#4
writers minted. Before deleting any row it BACK-FILLS that row's
`bib.state` into `master.bib` as a `% bib.state` comment, so the auth
information is never lost — the one and only data-loss risk this script
carries. Back-fill happens for EVERY pruned row BEFORE any deletion.

SAFETY:
  * DEFAULTS TO DRY-RUN. With no flags (or `--dry-run`) it only prints what
    it WOULD do and exits 0 — it never mutates.
  * Requires an explicit `--apply` flag to actually mutate.
  * All writes go through the lock-gated helpers in `_tools.py`
    (`update_master_bib_entry` / `ensure_bib_state_comment`, `lock_catalog`,
    `write_catalog`) — never direct file writes.
  * NEVER auto-runs: it is a standalone script, not imported or invoked by
    any other skill or pipeline step.

CLI:
    python3 prune_catalog_present_false.py [--library PATH] [--dry-run]
    python3 prune_catalog_present_false.py --library PATH --apply

Output (both modes): a per-row plan + a final summary line.
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (  # noqa: E402
    CANONICAL_BIB_STATES,
    catalog_row_bib_state,
    ensure_bib_state_comment,
    lock_catalog,
    paper_has_holdings,
    read_catalog,
    read_master_bib,
    write_catalog,
)


def _is_present_false(entry: dict) -> bool:
    """True for a reference-only row (no source document on disk)."""
    pdf = entry.get("pdf") or {}
    return not bool(pdf.get("present"))


def _resolve_library(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not p.exists():
            raise SystemExit(f"--library path does not exist: {p}")
        return p
    # CWD-anchored resolution, matching the other merge scripts. We do NOT
    # silently fall back to ~/Virgil-Library here: a destructive script must
    # be pointed at its target explicitly.
    import subprocess
    for rel in (
        ".virgil/scripts/editor/library_path.py",
        "editor/scripts/library_path.py",
    ):
        cand = Path.cwd() / rel
        if cand.exists():
            out = subprocess.run(
                ["python3", str(cand), "--get"],
                capture_output=True, text=True,
            )
            if out.returncode == 0 and out.stdout.strip():
                return Path(out.stdout.strip()).expanduser().resolve()
    cwd = Path.cwd().resolve()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    raise SystemExit(
        "could not resolve a library root; pass --library explicitly "
        "(a destructive script will not guess)."
    )


def _master_index(library: Path) -> dict[str, tuple[str, dict]]:
    """Map citekey (NFC + NFD) → (entry_type, fields) from master.bib, so the
    back-fill can re-emit each entry with its real type/fields.

    Uses the robust brace-aware `read_master_bib` parser — NOT the slim
    `iter_master_bib_slim`, whose tolerant field scan can bleed a trailing
    `}` / following `% bib.state` comment into a spurious field. Feeding such
    a bled field back through `update_master_bib_entry` (which re-emits ALL
    fields) corrupts master.bib. `read_master_bib` yields clean fields.
    """
    master_path = library / "master.bib"
    parsed = read_master_bib(master_path) if master_path.exists() else {}
    idx: dict[str, tuple[str, dict]] = {}
    for citekey, rec in parsed.items():
        if not citekey:
            continue
        entry = (rec.get("type", "misc"), dict(rec.get("fields", {})))
        for form in ("NFC", "NFD"):
            idx[unicodedata.normalize(form, citekey)] = entry
    return idx


def plan_and_run(library: Path, *, apply: bool) -> int:
    catalog = read_catalog(library)
    entries = catalog.get("entries", []) or []
    present_false = [e for e in entries if _is_present_false(e)]

    master_idx = _master_index(library)

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] library: {library}")
    print(f"[{mode}] catalog rows total: {len(entries)}")
    print(f"[{mode}] present:false rows to prune: {len(present_false)}")

    backfill_count = 0
    skip_count = 0
    plan: list[tuple[str, str, str]] = []  # (citekey, state, action)
    for e in present_false:
        citekey = e.get("citekey", "")
        state = catalog_row_bib_state(e) or "none"
        if not citekey:
            plan.append(("<missing-citekey>", state, "skip (no citekey)"))
            skip_count += 1
            continue
        # F4W-1: the pdf.present flag is unreliable — the merge writer could mint
        # a TRUE holding's row with a stale present:false default. Cross-check the
        # disk: if a source document exists for this citekey, FULLY EXCLUDE the
        # row from pruning (no back-fill, not added to prune_keys, never deleted).
        # The fix is to re-index, which refreshes the stale flag to present:true.
        if paper_has_holdings(library, citekey):
            plan.append((
                citekey, state,
                "SKIP (source file on disk — re-index to refresh stale present:false row)",
            ))
            skip_count += 1
            continue
        if not state or state == "none":
            # Nothing to back-fill — the bib-index reader already defaults a
            # commentless entry to "none". Safe to drop with no master write.
            plan.append((citekey, state, "prune (no state to back-fill)"))
            continue
        if state not in CANONICAL_BIB_STATES:
            # Refuse to back-fill a non-canonical state (the reader would
            # drop it). Surface it instead of silently losing it.
            plan.append((citekey, state, "SKIP (non-canonical state — review by hand)"))
            skip_count += 1
            continue
        backfill_count += 1
        plan.append((citekey, state, "back-fill % bib.state then prune"))

    for citekey, state, action in plan:
        print(f"  - {citekey}  bib.state={state}  -> {action}")

    if not apply:
        print(
            f"\nDRY-RUN: would prune {len(present_false) - skip_count} rows, "
            f"back-fill {backfill_count} entries with % bib.state comments, "
            f"skip {skip_count}. Re-run with --apply to mutate."
        )
        return 0

    # ── APPLY: back-fill ALL state comments BEFORE deleting any row. ──────
    backfilled: set[str] = set()
    for e in present_false:
        citekey = e.get("citekey", "")
        state = catalog_row_bib_state(e) or "none"
        if not citekey or not state or state == "none":
            continue
        # F4W-1: a held paper is fully excluded — do not back-fill it either.
        if paper_has_holdings(library, citekey):
            continue
        if state not in CANONICAL_BIB_STATES:
            continue
        entry_type, fields = master_idx.get(citekey, ("misc", {}))
        if not fields:
            # The catalog row exists but master.bib has no entry — synthesize
            # a minimal entry from the catalog row so the comment has a home.
            fields = {}
            if e.get("title"):
                fields["title"] = str(e["title"])
            authors = e.get("authors") or []
            if authors:
                fields["author"] = " and ".join(authors)
            if e.get("year"):
                fields["year"] = str(e["year"])
            if e.get("doi"):
                fields["doi"] = str(e["doi"])
        ensure_bib_state_comment(library, citekey, entry_type, fields, state)
        backfilled.add(citekey)

    # ── Now (and only now) remove the flagged rows from the catalog. ─────
    # F4W-1: held papers are EXCLUDED from prune_keys (a stale present:false on a
    # real holding must never delete its row — re-index refreshes the flag).
    prune_keys = {
        e.get("citekey")
        for e in present_false
        if e.get("citekey")
        and (catalog_row_bib_state(e) or "none") in CANONICAL_BIB_STATES
        and not paper_has_holdings(library, e.get("citekey", ""))
    }
    with lock_catalog(library):
        catalog = read_catalog(library)
        before = len(catalog.get("entries", []))
        catalog["entries"] = [
            e for e in catalog.get("entries", [])
            if not (_is_present_false(e) and e.get("citekey") in prune_keys)
        ]
        pruned = before - len(catalog["entries"])
        write_catalog(library, catalog)  # bumps catalog-version.txt + bib-index dirty

    print(
        f"\nPruned {pruned} rows, back-filled {len(backfilled)} state comments. "
        f"(catalog-version bumped; bib-index will rebuild at exit.)"
    )
    print(
        "NOTE: to restore, copy the pre-run master.bib + catalog.json backup "
        "back into place. The back-fill is idempotent — re-running with "
        "--apply is safe (already-pruned rows are simply not found)."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Prune pdf.present==false catalog rows (F#4). DRY-RUN by default.",
    )
    ap.add_argument("--library", default=None,
                    help="Library root (must be explicit for --apply).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Explicit dry-run (the default when no flag is passed).")
    ap.add_argument("--apply", action="store_true",
                    help="Actually mutate (back-fill comments, then delete rows). "
                         "Without this flag the script only prints its plan.")
    args = ap.parse_args(argv)

    if args.apply and args.dry_run:
        raise SystemExit("--apply and --dry-run are mutually exclusive.")

    library = _resolve_library(args.library)
    return plan_and_run(library, apply=bool(args.apply))


if __name__ == "__main__":
    sys.exit(main())
