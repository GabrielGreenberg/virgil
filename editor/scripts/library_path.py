#!/usr/bin/env python3
"""Resolve the Virgil Library root for editor-side skills.

The library location lives only in browser IndexedDB
(`library-folder-handle`) — invisible to a Claude Code session. This
script gives every editor-side skill a single, reliable way to find
the library's filesystem path.

Resolution chain (first hit wins):

  1. Explicit `--library <path>` flag.
  2. `./.virgil/library-path.json`  (per-folder pointer, written by the
     Virgil PWA into every Virgil-managed folder on doc-open). Lets
     `/library:*` skills work from any paper folder without env or
     global-config setup.
  3. `VIRGIL_LIBRARY_ROOT` environment variable.
  4. `~/.config/virgil/library-path.json`  ({"libraryRoot": "...", "version": 1}).
  5. `~/Virgil-Library/`  (legacy default).

A path "looks like a library" only if it contains all three of
`master.bib`, `.virgil/catalog.json`, and `.virgil/scripts/`. Stale
records bail with an actionable error rather than silently falling
through.

CLI:

  python3 library_path.py --get
  python3 library_path.py --set <abs-path>

`--get` prints the resolved absolute path or exits non-zero with an
instruction.
`--set` validates and persists to the central config file.

Library callers import `resolve_library(explicit=None)`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional


CONFIG_FILE = Path.home() / ".config" / "virgil" / "library-path.json"
LOCAL_POINTER = Path(".virgil") / "library-path.json"
DEFAULT_FALLBACK = Path.home() / "Virgil-Library"


def _looks_like_library(p: Path) -> bool:
    if not p.is_dir():
        return False
    return (
        (p / "master.bib").exists()
        and (p / ".virgil" / "catalog.json").exists()
        and (p / ".virgil" / "scripts").is_dir()
    )


def _read_config_path() -> Optional[Path]:
    if not CONFIG_FILE.exists():
        return None
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    root = data.get("libraryRoot")
    if not isinstance(root, str) or not root.strip():
        return None
    return Path(root).expanduser()


def _read_local_pointer() -> Optional[Path]:
    """Read the per-folder pointer at `./.virgil/library-path.json`.

    Written by the Virgil PWA's sync engine into every Virgil-managed
    folder. Either contains a concrete absolute path (dev workflows can
    write this) or `libraryRoot: null` (production FSA can't extract
    an abs path from a folder handle, so it leaves the field null and
    relies on the rest of the chain). Null is a "fall through" signal,
    not an error.
    """
    if not LOCAL_POINTER.exists():
        return None
    try:
        data = json.loads(LOCAL_POINTER.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    root = data.get("libraryRoot")
    if not isinstance(root, str) or not root.strip():
        return None
    return Path(root).expanduser()


class LibraryNotFound(RuntimeError):
    """Raised when no resolution-chain entry yields a valid library."""


def _instructions() -> str:
    return (
        "No library set up. Pick a library in Virgil first.\n"
        "  If you have a library on disk, point this folder at it:\n"
        f"    * --library <abs-path>  (one-shot, just this command)\n"
        f"    * VIRGIL_LIBRARY_ROOT=<abs-path>  (this shell)\n"
        f"    * python3 editor/scripts/library_path.py --set <abs-path>\n"
        f"      (writes {CONFIG_FILE} — persistent)\n"
        f"    * place the library at the default {DEFAULT_FALLBACK}\n"
        "  A valid library has master.bib + .virgil/catalog.json + .virgil/scripts/."
    )


def resolve_library(explicit: Optional[str] = None) -> Path:
    """Return the absolute path to the user's Virgil Library.

    Raises ``LibraryNotFound`` (with an actionable message) when nothing
    in the resolution chain points at a real library. Never returns a
    fallback that doesn't actually look like a library.
    """
    candidates: list[tuple[str, Path]] = []
    if explicit:
        candidates.append(("--library flag", Path(explicit).expanduser()))
    local = _read_local_pointer()
    if local:
        candidates.append((str(LOCAL_POINTER), local))
    env = os.environ.get("VIRGIL_LIBRARY_ROOT", "").strip()
    if env:
        candidates.append(("VIRGIL_LIBRARY_ROOT", Path(env).expanduser()))
    cfg = _read_config_path()
    if cfg:
        candidates.append((str(CONFIG_FILE), cfg))
    candidates.append((str(DEFAULT_FALLBACK), DEFAULT_FALLBACK))

    errors: list[str] = []
    for label, p in candidates:
        try:
            resolved = p.resolve()
        except OSError as e:
            errors.append(f"  [{label}] {p}: {e}")
            continue
        if _looks_like_library(resolved):
            return resolved
        errors.append(f"  [{label}] {resolved}: not a valid library")

    msg = _instructions()
    if errors:
        msg += "\n  Tried:\n" + "\n".join(errors)
    raise LibraryNotFound(msg)


def set_library_path(path: str) -> Path:
    """Validate ``path`` and persist it to ``CONFIG_FILE``.

    Returns the resolved absolute path on success. Raises
    ``LibraryNotFound`` if the path doesn't look like a library.
    """
    p = Path(path).expanduser().resolve()
    if not _looks_like_library(p):
        raise LibraryNotFound(
            f"{p}: not a valid library (missing one of master.bib, "
            ".virgil/catalog.json, .virgil/scripts/)."
        )
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"libraryRoot": str(p), "version": 1}
    CONFIG_FILE.write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    return p


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--get", action="store_true", help="resolve and print the library path")
    group.add_argument("--set", metavar="PATH", help="validate and persist a library path")
    ap.add_argument("--library", help="explicit library path (for --get only)")
    args = ap.parse_args(argv)

    if args.set:
        try:
            resolved = set_library_path(args.set)
        except LibraryNotFound as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        print(str(resolved))
        return 0

    try:
        resolved = resolve_library(args.library)
    except LibraryNotFound as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(str(resolved))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
