#!/usr/bin/env python3
"""Step 1 of `/library/merge-bibs` — build the worklist of papers to merge.

    python3 merge_bibs_worklist.py --run-state /tmp/merge-bibs-run.json

Reads the run state the preflight wrote (library root + filter / force /
dry-run), selects the deep-indexed papers whose `references.bib` still needs
merging, and writes one citekey per line to `<report dir>/_worklist.txt`
(`_tools.merge_report_dir` — the `_dry-run/` subdirectory under a dry run, so
a dry run touches nothing a real run reads). Prints
`worklist=N skipped_uptodate=M` and `worklist_file=<path>`.

This rule used to be a heredoc in the skill's markdown (task 1037), which is
how a dry run could poison it unnoticed: nothing could pin it in a test.

The up-to-date rule (skipped unless `force`):
  * flag-bearing paper (`bib.imported`): skip iff `references.bib` gained no
    citekey since import (additions-only, vs `bib.importedKeys`);
  * legacy paper (no flag): skip iff a REAL merge report is at least as new as
    `references.bib` (`_tools.real_merge_report_is_current`) — a dry-run
    report never counts.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (  # noqa: E402
    _atomic_write_text,
    merge_report_dir,
    normalize_citekey,
    paper_folder,
    read_catalog,
    real_merge_report_is_current,
    references_bib_keys,
)

# `richIndexed` is the legacy spelling kept on read; new writes use `deepIndexed`.
DEEP_STATES = {"deepIndexed", "richIndexed"}


def build_worklist(
    library: Path, *, filter_glob: str = "", force: bool = False,
) -> tuple[list[str], int]:
    """(citekeys to merge, count skipped as up to date)."""
    todo: list[str] = []
    skipped_uptodate = 0
    for e in read_catalog(library).get("entries", []):
        ck = e.get("citekey", "")
        if not ck:
            continue
        if (e.get("indexed") or {}).get("state") not in DEEP_STATES:
            continue
        if filter_glob and not fnmatch.fnmatch(ck, filter_glob):
            continue
        if not (paper_folder(library, ck) / "references.bib").exists():
            continue
        if not force and _up_to_date(library, ck, e.get("bib") or {}):
            skipped_uptodate += 1
            continue
        todo.append(ck)
    return todo, skipped_uptodate


def _up_to_date(library: Path, ck: str, bib: dict) -> bool:
    if bib.get("imported"):
        # Decide SOLELY by content — never fall through to the weaker mtime
        # proxy: a content-confirmed addition must win even when a report's
        # mtime happens to be newer (sync/restore mtime resets).
        baseline = {normalize_citekey(k) for k in (bib.get("importedKeys") or [])}
        return not (set(references_bib_keys(library, ck)) - baseline)
    return real_merge_report_is_current(library, ck)


def write_worklist(library: Path, todo: list[str], *, dry_run: bool) -> Path:
    out = merge_report_dir(library, dry_run=dry_run) / "_worklist.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(out, "\n".join(todo) + ("\n" if todo else ""))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run-state", required=True,
                    help="Run-state JSON written by merge_bibs_preflight.py")
    args = ap.parse_args(argv)
    state = json.loads(Path(args.run_state).expanduser().read_text())
    library = Path(state["library_root"])
    run = state.get("run") or {}
    todo, skipped = build_worklist(
        library, filter_glob=run.get("filter") or "", force=bool(run.get("force")))
    out = write_worklist(library, todo, dry_run=bool(run.get("dry_run")))
    print(f"worklist={len(todo)} skipped_uptodate={skipped}")
    print(f"worklist_file={out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
