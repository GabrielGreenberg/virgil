#!/usr/bin/env python3
"""Terminal-side skill-bundle sync — the CLI twin of the app's skill-sync.

The app syncs a paper folder's skills on doc-open (library/lib/skill-sync.ts,
`syncSkillBundle`). That is the ONLY sync trigger, so a paper you cowork on
from a terminal without re-opening in Virgil runs a frozen bundle forever —
which is exactly how a June-4 bundle held the dev-dream capture layer out of
the busiest paper for ten weeks. This script gives a terminal session the same
sync, from the same served bundle, with the same on-disk layout.

CONTRACT TWIN NOTICE: the path-routing table below (`disk_path_for`) and the
stamp shape mirror library/lib/skill-sync.ts (`diskPathFor`, `OnDiskVersion`)
byte-for-byte in behavior. skill-sync.ts is the SSOT; a change there must be
mirrored here (test_sync_skills.py pins the routing table against fixtures).
Unlike the app, this script never touches `.virgil/library-path.json` — it
cannot know the library root; the app owns that file.

Usage (from a paper folder, or with an explicit target):
    python3 .virgil/scripts/editor/sync_skills.py --check   # fresh? (exit 0/1)
    python3 .virgil/scripts/editor/sync_skills.py           # sync if stale
    python3 editor/scripts/sync_skills.py <paperDir> --from-local public/skill-bundle

Exit codes: 0 fresh/synced · 1 stale (--check only) · 2 error (network, bad
manifest — always soft-failable by callers; a cowork session must never be
blocked by a sync hiccup).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_BASE_URL = "https://gabrielgreenberg.github.io/virgil/skill-bundle"
VERSION_REL = Path(".virgil/.skill-bundle-version.json")
FETCH_TIMEOUT_S = 20


def disk_path_for(subsystem: str, bundle_path: str) -> str | None:
    """Mirror of skill-sync.ts `diskPathFor` — see the twin notice above.
    Returns a folder-relative POSIX path, or None for unrecognized shapes
    (skipped, defence against malformed manifests)."""
    if subsystem == "library" and bundle_path == "CLAUDE.md":
        return ".claude/CLAUDE.md"
    if subsystem == "manifest":
        return f".claude/virgil/{bundle_path}"
    if bundle_path.startswith("claude-commands/"):
        rest = bundle_path[len("claude-commands/"):]
        return f".claude/commands/{subsystem}/{rest}"
    if bundle_path.startswith("scripts/"):
        rest = bundle_path[len("scripts/"):]
        return f".virgil/scripts/{subsystem}/{rest}"
    return None


class BundleSource:
    """Reads manifest + files from the served bundle or a local build dir."""

    def __init__(self, base_url: str | None, local_dir: Path | None):
        self.base_url = (base_url or "").rstrip("/")
        self.local_dir = local_dir

    def _read(self, rel: str) -> bytes:
        if self.local_dir is not None:
            return (self.local_dir / rel).read_bytes()
        url = f"{self.base_url}/{rel}"
        req = urllib.request.Request(url, headers={"Cache-Control": "no-store"})
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            return resp.read()

    def manifest(self) -> dict:
        return json.loads(self._read("bundle-manifest.json").decode("utf-8"))

    def file(self, subsystem: str, bundle_path: str) -> bytes:
        return self._read(f"{subsystem}/{bundle_path}")


def _atomic_write(path: Path, data: bytes) -> None:
    # temp+rename: this script may be overwriting ITSELF (it ships in the
    # bundle it syncs), and a torn write to a .py would break the next run.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp-skillsync")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def read_stamp(folder: Path) -> dict | None:
    try:
        return json.loads((folder / VERSION_REL).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def sync(folder: Path, source: BundleSource, *, check_only: bool = False) -> int:
    manifest = source.manifest()
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        print("sync_skills: bundle manifest has no version — aborting.")
        return 2

    stamp = read_stamp(folder)
    on_disk = stamp.get("version") if stamp else None
    if on_disk == version:
        print(f"sync_skills: fresh (v{version}).")
        return 0
    if check_only:
        print(f"sync_skills: STALE — on disk {on_disk or 'none'}, served {version}.")
        return 1

    written: list[str] = []  # "<subsystem>/<bundlePath>", the stamp's files list
    for src in manifest.get("sources", []):
        name = src.get("name")
        for bundle_path in src.get("files", []):
            rel = disk_path_for(name, bundle_path)
            if rel is None:
                continue
            data = source.file(name, bundle_path)
            _atomic_write(folder / rel, data)
            written.append(f"{name}/{bundle_path}")

    # Clean up files that left the bundle (same rule as skill-sync.ts step 4):
    # anything the OLD stamp managed that the new manifest no longer lists.
    removed: list[str] = []
    new_set = set(written)
    for old_entry in (stamp or {}).get("files", []):
        if old_entry in new_set:
            continue
        sub, _, bundle_path = old_entry.partition("/")
        rel = disk_path_for(sub, bundle_path)
        if rel is None:
            continue
        try:
            (folder / rel).unlink()
            removed.append(old_entry)
        except OSError:
            pass

    _atomic_write(
        folder / VERSION_REL,
        json.dumps(
            {
                "version": version,
                "syncedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "files": written,
            },
            indent=2,
        ).encode("utf-8"),
    )
    print(
        f"sync_skills: updated {on_disk or 'none'} → {version} "
        f"({len(written)} files written, {len(removed)} removed). "
        "New command prompts load in your NEXT session; scripts are live now."
    )
    return 0


def resolve_folder(arg: str | None) -> Path | None:
    """Explicit arg wins; else the nearest ancestor of cwd (or of this script's
    synced location) that contains a `.virgil/` dir."""
    if arg:
        return Path(arg).expanduser().resolve()
    for start in (Path.cwd(), Path(__file__).resolve().parent):
        for cand in (start, *start.parents):
            if (cand / ".virgil").is_dir():
                return cand
    return None


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("folder", nargs="?", help="paper folder (default: nearest ancestor with .virgil/)")
    ap.add_argument("--check", action="store_true", help="report fresh/stale without writing")
    ap.add_argument("--from-local", metavar="DIR", help="read the bundle from a local build dir (public/skill-bundle)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"served bundle base URL (default {DEFAULT_BASE_URL})")
    args = ap.parse_args(argv)

    folder = resolve_folder(args.folder)
    if folder is None:
        print("sync_skills: no paper folder found (no .virgil/ ancestor; pass one explicitly).")
        return 2

    local_dir = Path(args.from_local).expanduser().resolve() if args.from_local else None
    source = BundleSource(None if local_dir else args.base_url, local_dir)
    try:
        return sync(folder, source, check_only=args.check)
    except (urllib.error.URLError, OSError, json.JSONDecodeError, TimeoutError) as err:
        print(f"sync_skills: could not sync ({err}) — continuing with the on-disk bundle.")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
