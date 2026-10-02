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
3.5. Exits 0 when the comparison RAN (clean or with alerts — the
orchestrator decides how to surface them).

**The guard fails CLOSED** (task 798). A snapshot dir that is empty,
missing, the library itself, or lacks the preflight's
`manifest.json` is REFUSED — `clean: false`, an `error`, exit 2. An empty
`--snapshot-dir ""` (a shell variable that did not survive to this Bash
call) used to resolve to cwd = the library root, compare master.bib with
itself, and report `clean: true` after the very truncation this step
exists to catch. Without `--library`, the library is the one the
snapshot's manifest names, not whatever cwd happens to be.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Optional


ENTRY_RE = re.compile(r'^@[A-Za-z]+\{([^,\s\n]+)', re.MULTILINE)


from _library_root import library_root_or_exit  # noqa: E402  (task 896)


def _resolve_library(explicit: Optional[str]) -> Path:
    """Delegate to the library silo's one validated door (task 896)."""
    return library_root_or_exit(explicit)


def _count_bib_entries(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return len(ENTRY_RE.findall(path.read_text(errors="replace")))
    except OSError:
        return 0


def _catalog_summary(path: Path) -> dict:
    """Total entries + indexed.state distribution + holdings (pdf.present) count."""
    if not path.exists():
        return {"total": 0, "indexed_states": {}, "present": 0}
    try:
        cat = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"total": 0, "indexed_states": {}, "present": 0}
    entries = cat.get("entries", []) or []
    states: Counter[str] = Counter()
    present = 0
    for e in entries:
        s = (e.get("indexed") or {}).get("state", "none")
        states[s] += 1
        if (e.get("pdf") or {}).get("present"):
            present += 1
    return {"total": len(entries), "indexed_states": dict(states), "present": present}


def _check_master(snap_dir: Path, library: Path) -> dict:
    before = _count_bib_entries(snap_dir / "master.bib")
    after = _count_bib_entries(library / "master.bib")
    return {
        "before": before,
        "after": after,
        "delta": after - before,
        "shrank": after < before,
    }


# indexed.state values that represent real indexing work. A drop in any of
# these is genuine data loss. `none` is deliberately EXCLUDED: under the F#4
# holdings-only model the pruned/never-minted reference rows all carry
# indexed.state == "none", so a `none` count decline is the expected effect
# of the model, not a regression.
_REAL_INDEX_STATES = frozenset({
    "indexed", "deepIndexed", "richIndexed", "running", "queued", "failed",
})


def _check_catalog(snap_dir: Path, library: Path) -> dict:
    before = _catalog_summary(snap_dir / "catalog.json")
    after = _catalog_summary(library / ".virgil" / "catalog.json")
    state_regressions: list[dict] = []
    for state, n_before in before["indexed_states"].items():
        if state not in _REAL_INDEX_STATES:
            continue  # `none` drops are expected reference-row prunes (F#4)
        n_after = after["indexed_states"].get(state, 0)
        if n_after < n_before:
            state_regressions.append({
                "state": state,
                "before": n_before,
                "after": n_after,
            })
    # F4W-2: coarse holdings floor. A held-but-not-yet-indexed paper
    # (pdf.present==true, indexed.state=="none") wiped during a merge produces
    # NEITHER a master.bib shrink NOR a real-index-state regression (none is
    # excluded), so it would slip through silently. Counting rows with
    # pdf.present==true catches a vanishing source-file row regardless of its
    # indexed.state.
    before_present = before.get("present", 0)
    after_present = after.get("present", 0)
    return {
        "before_total": before["total"],
        "after_total": after["total"],
        "delta": after["total"] - before["total"],
        "shrank": after["total"] < before["total"],
        "state_regressions": state_regressions,
        "before_states": before["indexed_states"],
        "after_states": after["indexed_states"],
        "before_present": before_present,
        "after_present": after_present,
        "present_dropped": after_present < before_present,
    }


def _validate_snapshot(raw: str) -> tuple[Optional[Path], dict, Optional[str]]:
    """(snap_dir, manifest, error) — a snapshot is real or it is refused."""
    if not raw or not raw.strip():
        return None, {}, ("empty --snapshot-dir (the preflight's snapshot path "
                          "did not reach this step — source the run-state .env)")
    snap_dir = Path(raw).expanduser().resolve()
    if not snap_dir.is_dir():
        return snap_dir, {}, f"snapshot dir not found: {snap_dir}"
    mpath = snap_dir / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text())
    except (OSError, json.JSONDecodeError):
        return snap_dir, {}, f"no preflight manifest.json in {snap_dir}"
    for f in manifest.get("files", []) or []:
        if f.get("present") and not (snap_dir / f.get("name", "")).exists():
            return snap_dir, manifest, (
                f"snapshot {snap_dir} is missing {f.get('name')} "
                "that its manifest records")
    return snap_dir, manifest, None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot-dir", required=True,
                    help="Snapshot directory written by merge_bibs_preflight.py")
    ap.add_argument("--library", default=None)
    args = ap.parse_args(argv)

    snap_dir, manifest, error = _validate_snapshot(args.snapshot_dir)
    library: Optional[Path] = None
    if error is None:
        if args.library:
            library = _resolve_library(args.library)
        elif manifest.get("library_root"):
            # The preflight's record of the library goes through the same
            # validated door as a flag would (task 896).
            library = _resolve_library(manifest["library_root"])
        else:
            library = _resolve_library(None)
        if snap_dir == library:
            error = (f"snapshot dir {snap_dir} is the library itself — "
                     "not a preflight snapshot")
    if error is not None:
        print(json.dumps({
            "error": error,
            "snapshot_dir": str(snap_dir) if snap_dir else args.snapshot_dir,
            "library_root": str(library) if library else None,
            "alerts": [f"postflight could not run: {error}"],
            "clean": False,
            "restore_commands": [],
        }, indent=2))
        return 2
    master = _check_master(snap_dir, library)
    catalog = _check_catalog(snap_dir, library)

    alerts: list[str] = []
    if master["shrank"]:
        alerts.append(
            f"master.bib shrank: {master['before']} -> {master['after']} entries "
            f"(delta {master['delta']:+d})"
        )
    # F#4: a bare catalog.json total decline is NO LONGER an alert. Under the
    # holdings-only model the merge legitimately removes/never-mints
    # reference-only rows (their auth state moved to the `% bib.state`
    # comment in master.bib), so the catalog total shrinks by design. True
    # data loss now shows up ONLY as (a) a master.bib shrink — the bib is the
    # canonical store and the merge only appends to it — or (b) an
    # indexed.state regression (a holding that lost its indexed status). A
    # pure catalog total drop with no state regression is expected and clean.
    if catalog["shrank"] and not catalog["state_regressions"]:
        # Informational only — recorded in the JSON, not surfaced as an alert.
        pass
    for r in catalog["state_regressions"]:
        alerts.append(
            f"catalog.json indexed.state.{r['state']} regressed: "
            f"{r['before']} -> {r['after']}"
        )
    # F4W-2: holdings floor — a present:true row disappearing is data loss even
    # when indexed.state=="none" (so no master shrink, no state regression fires).
    if catalog["present_dropped"]:
        alerts.append(
            f"catalog.json holdings dropped: {catalog['before_present']} -> "
            f"{catalog['after_present']} (delta "
            f"{catalog['after_present'] - catalog['before_present']:+d}) — "
            f"a present:true row disappeared"
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
        # F#4: a catalog total shrink with no indexed-state regression is the
        # expected effect of the holdings-only model, not an alert.
        "catalog_shrank_expected": bool(
            catalog["shrank"] and not catalog["state_regressions"]
        ),
        "alerts": alerts,
        "clean": not alerts,
        "restore_commands": restore_cmds,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
