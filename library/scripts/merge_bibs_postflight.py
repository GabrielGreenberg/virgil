"""Post-flight verification for `/library:merge-bibs`.

Runs after all per-paper merges complete. Compares the live library
state against the snapshot taken by `merge_bibs_preflight.py` and
flags anything that looks like data loss:

  * master.bib entry count shrank (the merge helper only adds entries
    per its own contract, so any shrinkage is a sync-race casualty).
  * catalog.json entry count shrank.
  * catalog.json `indexed.state` distribution lost ground in any
    state (especially `deepIndexed` / `richIndexed` / `indexed`).

On any alert, prints a copy-paste-ready restore command so the user
can rewind without thinking about it.

CLI:

    python3 merge_bibs_postflight.py --snapshot-dir <path> [--library PATH]

Emits JSON to stdout with the shape consumed by merge-bibs.md::Step
3.5. Exits 0 always — the orchestrator inspects the JSON and decides
how to surface alerts in its final reply.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Optional


ENTRY_RE = re.compile(r'^@[A-Za-z]+\{([^,\s\n]+)', re.MULTILINE)


def _resolve_library(explicit: Optional[str]) -> Path:
    """Match merge_paper_references.py's CWD-anchored resolution."""
    if explicit:
        return Path(explicit).expanduser().resolve()
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
    raise SystemExit("could not resolve library root")


def _count_bib_entries(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return len(ENTRY_RE.findall(path.read_text(errors="replace")))
    except OSError:
        return 0


def _catalog_summary(path: Path) -> dict:
    """Total entries + indexed.state distribution."""
    if not path.exists():
        return {"total": 0, "indexed_states": {}}
    try:
        cat = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"total": 0, "indexed_states": {}}
    entries = cat.get("entries", []) or []
    states: Counter[str] = Counter()
    for e in entries:
        s = (e.get("indexed") or {}).get("state", "none")
        states[s] += 1
    return {"total": len(entries), "indexed_states": dict(states)}


def _check_master(snap_dir: Path, library: Path) -> dict:
    before = _count_bib_entries(snap_dir / "master.bib")
    after = _count_bib_entries(library / "master.bib")
    return {
        "before": before,
        "after": after,
        "delta": after - before,
        "shrank": after < before,
    }


def _check_catalog(snap_dir: Path, library: Path) -> dict:
    before = _catalog_summary(snap_dir / "catalog.json")
    after = _catalog_summary(library / ".virgil" / "catalog.json")
    state_regressions: list[dict] = []
    for state, n_before in before["indexed_states"].items():
        n_after = after["indexed_states"].get(state, 0)
        if n_after < n_before:
            state_regressions.append({
                "state": state,
                "before": n_before,
                "after": n_after,
            })
    return {
        "before_total": before["total"],
        "after_total": after["total"],
        "delta": after["total"] - before["total"],
        "shrank": after["total"] < before["total"],
        "state_regressions": state_regressions,
        "before_states": before["indexed_states"],
        "after_states": after["indexed_states"],
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot-dir", required=True,
                    help="Snapshot directory written by merge_bibs_preflight.py")
    ap.add_argument("--library", default=None)
    args = ap.parse_args(argv)

    snap_dir = Path(args.snapshot_dir).expanduser().resolve()
    if not snap_dir.is_dir():
        print(json.dumps({"error": f"snapshot dir not found: {snap_dir}"}))
        return 0

    library = _resolve_library(args.library)
    master = _check_master(snap_dir, library)
    catalog = _check_catalog(snap_dir, library)

    alerts: list[str] = []
    if master["shrank"]:
        alerts.append(
            f"master.bib shrank: {master['before']} -> {master['after']} entries "
            f"(delta {master['delta']:+d})"
        )
    if catalog["shrank"]:
        alerts.append(
            f"catalog.json shrank: {catalog['before_total']} -> "
            f"{catalog['after_total']} entries (delta {catalog['delta']:+d})"
        )
    for r in catalog["state_regressions"]:
        alerts.append(
            f"catalog.json indexed.state.{r['state']} regressed: "
            f"{r['before']} -> {r['after']}"
        )

    restore_cmds: list[str] = []
    if alerts:
        restore_cmds.append(f"cp '{snap_dir}/master.bib' '{library}/master.bib'")
        restore_cmds.append(
            f"cp '{snap_dir}/catalog.json' '{library}/.virgil/catalog.json'"
        )
        # inbox restore is optional; merge only appends one notification, no data loss risk

    result = {
        "library_root": str(library),
        "snapshot_dir": str(snap_dir),
        "master_bib": master,
        "catalog_json": catalog,
        "alerts": alerts,
        "clean": not alerts,
        "restore_commands": restore_cmds,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
