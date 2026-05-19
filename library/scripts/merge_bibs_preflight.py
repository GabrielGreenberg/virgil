"""Pre-flight checks + snapshot for `/library:merge-bibs`.

The merge-bibs skill walks every deep-indexed paper's references.bib and
folds it into master.bib. The helper (merge_paper_references.py) does
read-modify-write on master.bib + catalog.json under in-process
`fcntl.flock`s. Those locks serialize writes within one Python process,
but they do NOT protect against:

  * The cloud sync layer (Dropbox, iCloud) creating "conflicted copy"
    files when rapid atomic-renames outpace the upload queue. On
    2026-05-17 a parallel run inside a Dropbox-synced library produced
    ~4000 conflict files and silently truncated master.bib from 1975
    entries to 886.
  * Other writers — a second Claude session running
    `/library:index-pending`, an iterate-skill run, a stale
    drain_queue.py — touching the same files concurrently.

This script runs once at the start of `/library:merge-bibs`. It does
three jobs in order, each in service of "the user can always recover":

  1. Snapshot master.bib, .virgil/catalog.json,
     .virgil/notifications/inbox.json to a path OUTSIDE the synced
     library (so Dropbox can't lose the snapshot itself). The skill's
     postflight uses this snapshot to detect damage; the user can copy
     it back manually if needed.
  2. Detect whether the library is sync-mounted (CloudStorage,
     classic Dropbox path, iCloud Drive). If so, the orchestrator
     defaults --batch to 1.
  3. Detect other writers (process list, queue lock files, recently-
     modified critical files). If any are present, the orchestrator
     refuses to start.

CLI:

    python3 merge_bibs_preflight.py [--library PATH]

Emits JSON to stdout with the shape consumed by merge-bibs.md::Step 0.
Exits non-zero only on hard errors (missing library, permission
problems). "Other writers detected" exits zero with the info in the
JSON — the orchestrator decides what to do.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# Snapshot retention — keep the last N pre-merge snapshots.
RETAIN_SNAPSHOTS = 5

# Recency threshold for "other writers" — anything modified more
# recently than this looks like an in-flight operation.
WRITER_WINDOW_SECONDS = 60

# Process patterns that indicate someone else is mutating the library.
COMPETING_WRITER_PATTERNS = [
    "merge_paper_references",
    "drain_queue",
    "index_paper.py",
    "deep_preprocess",
    "merge_bibs_driver",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def _resolve_library(explicit: Optional[str]) -> Path:
    """Find the library via library_path.py, the same way the skill bootstrap does.

    Mirrors merge_paper_references.py::_resolve_library — anchors on
    `Path.cwd()` because the skill bootstrap always `cd`s to the library
    root before invoking helpers. Tries the synced-PWA layout first,
    then the upstream-repo layout.
    """
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not (p / "master.bib").exists():
            raise SystemExit(f"--library {p}: no master.bib found")
        return p
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
    raise SystemExit("could not resolve library root via library_path.py")


def _backup_root() -> Path:
    """Where snapshots live — OUTSIDE any sync folder, per design."""
    return Path.home() / "Library" / "Application Support" / "Virgil" / "backups"


def _library_id(library: Path) -> str:
    """Stable short ID per library so multiple libraries don't collide."""
    h = hashlib.sha1(str(library).encode("utf-8")).hexdigest()[:10]
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", library.name)[:40]
    return f"{safe_name}-{h}"


def _detect_sync_mount(library: Path) -> tuple[bool, str]:
    """Return (is_sync_mounted, sync_kind).

    Detection is path-based — fast, no network, no kernel inspection.
    Covers all three storage providers Apple exposes under
    `~/Library/CloudStorage/`, the legacy `~/Dropbox/` location, and
    `~/iCloud Drive/`. False positives are harmless (just costs the
    user a single explicit --allow-parallel-sync flag); false
    negatives are dangerous, so err toward detection.
    """
    path = str(library)
    home = str(Path.home())
    checks = [
        ("CloudStorage/Dropbox", "Dropbox (CloudStorage)"),
        ("CloudStorage/iCloud", "iCloud Drive (CloudStorage)"),
        ("CloudStorage/GoogleDrive", "Google Drive (CloudStorage)"),
        ("CloudStorage/OneDrive", "OneDrive (CloudStorage)"),
        ("CloudStorage/Box", "Box (CloudStorage)"),
        (f"{home}/Dropbox", "Dropbox (legacy)"),
        (f"{home}/iCloud Drive", "iCloud Drive (legacy)"),
        (f"{home}/Google Drive", "Google Drive (legacy)"),
        (f"{home}/OneDrive", "OneDrive (legacy)"),
    ]
    for needle, label in checks:
        if needle in path:
            return True, label
    return False, ""


def _detect_competing_processes() -> list[dict]:
    """Look for processes whose argv suggests they're touching the library."""
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            capture_output=True, text=True, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    hits: list[dict] = []
    my_pid = os.getpid()
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            pid_s, command = line.split(None, 1)
            pid = int(pid_s)
        except (ValueError, IndexError):
            continue
        if pid == my_pid:
            continue
        for pat in COMPETING_WRITER_PATTERNS:
            if pat in command:
                hits.append({"pid": pid, "pattern": pat, "command": command[:200]})
                break
    return hits


def _detect_queue_locks(library: Path) -> list[str]:
    """Non-empty .lock files in .virgil/queue/ mean a drain is in-flight."""
    qd = library / ".virgil" / "queue"
    if not qd.is_dir():
        return []
    fresh = []
    for p in qd.glob("*.lock"):
        try:
            st = p.stat()
        except OSError:
            continue
        if st.st_size > 0:
            fresh.append(str(p.relative_to(library)))
    return fresh


def _detect_recent_mods(library: Path) -> list[dict]:
    """Critical files modified within WRITER_WINDOW_SECONDS look active."""
    cutoff = time.time() - WRITER_WINDOW_SECONDS
    watched = [
        library / "master.bib",
        library / ".virgil" / "catalog.json",
        library / ".virgil" / "notifications" / "inbox.json",
    ]
    hits = []
    for p in watched:
        try:
            mt = p.stat().st_mtime
        except OSError:
            continue
        if mt > cutoff:
            hits.append({
                "path": str(p.relative_to(library)),
                "mtime_age_s": round(time.time() - mt, 1),
            })
    return hits


def _take_snapshot(library: Path) -> Path:
    """Copy the critical state files to a timestamped dir outside the library."""
    snap_dir = _backup_root() / _library_id(library) / f"merge-bibs-{_now_iso()}"
    snap_dir.mkdir(parents=True, exist_ok=True)
    files = [
        (library / "master.bib", "master.bib"),
        (library / ".virgil" / "catalog.json", "catalog.json"),
        (library / ".virgil" / "notifications" / "inbox.json", "inbox.json"),
    ]
    for src, dst_name in files:
        if src.exists():
            shutil.copy2(src, snap_dir / dst_name)
    # Tiny manifest so the snapshot is self-describing.
    manifest = {
        "snapshot_at": _now_iso(),
        "library_root": str(library),
        "files": [
            {
                "name": dst_name,
                "present": (snap_dir / dst_name).exists(),
                "size": (snap_dir / dst_name).stat().st_size
                if (snap_dir / dst_name).exists() else 0,
            }
            for _, dst_name in files
        ],
    }
    (snap_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return snap_dir


def _prune_old_snapshots(library: Path) -> int:
    """Keep only the most-recent RETAIN_SNAPSHOTS for this library."""
    lib_dir = _backup_root() / _library_id(library)
    if not lib_dir.is_dir():
        return 0
    snaps = sorted(
        [p for p in lib_dir.iterdir() if p.is_dir() and p.name.startswith("merge-bibs-")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    pruned = 0
    for p in snaps[RETAIN_SNAPSHOTS:]:
        try:
            shutil.rmtree(p)
            pruned += 1
        except OSError:
            pass
    return pruned


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--library", default=None,
                    help="Library root (default: auto-resolve via library_path.py)")
    ap.add_argument("--skip-snapshot", action="store_true",
                    help="Run safety checks only; don't snapshot. For testing.")
    args = ap.parse_args(argv)

    library = _resolve_library(args.library)

    sync_mounted, sync_kind = _detect_sync_mount(library)
    competing = _detect_competing_processes()
    queue_locks = _detect_queue_locks(library)
    recent_mods = _detect_recent_mods(library)

    snapshot_dir: Optional[str] = None
    snapshot_pruned = 0
    if not args.skip_snapshot:
        snap = _take_snapshot(library)
        snapshot_dir = str(snap)
        snapshot_pruned = _prune_old_snapshots(library)

    result = {
        "library_root": str(library),
        "library_id": _library_id(library),
        "snapshot_dir": snapshot_dir,
        "snapshot_pruned": snapshot_pruned,
        "sync_mounted": sync_mounted,
        "sync_kind": sync_kind,
        "recommended_batch": 1 if sync_mounted else 5,
        "other_writers": {
            "processes": competing,
            "queue_locks": queue_locks,
            "recent_mods": recent_mods,
        },
        "any_writers": bool(competing or queue_locks or recent_mods),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
