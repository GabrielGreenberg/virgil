"""The library silo's ONE door for "where is the user's library?" (task 896).

The answer is the editor silo's `library_path.resolve_library` — the
documented, VALIDATED chain:

    --library  →  cwd (when it IS a library)  →  ./.virgil/library-path.json
               →  VIRGIL_LIBRARY_ROOT  →  ~/.config/virgil/library-path.json
               →  ~/Virgil-Library

Every candidate must look like a library (master.bib + .virgil/catalog.json +
.virgil/scripts/), and when none does the answer is a REFUSAL
(`LibraryNotFound`, carrying actionable text) — never an unchecked
`~/Virgil-Library` that a write then lands in.

Before this door, ~31 library scripts each hand-rolled their own order (env
first, cwd first, home unvalidated, the config file and folder pointer
ignored), so two scripts in one skill run could disagree about which library
they served. A census (`library/lib/__tests__/library-root-door-census.test.ts`)
now forbids a `VIRGIL_LIBRARY_ROOT` / `"Virgil-Library"` literal anywhere
under `library/scripts/` outside this file.

The SSOT lives in the OTHER silo, which lands in a sibling directory under
both layouts:

    repo:    library/scripts/_library_root.py  →  ../../editor/scripts/
    synced:  .virgil/scripts/library/…         →  ../editor/

Where it is not reachable (a library-only checkout, a partially-synced
folder) the door degrades to the subset of the chain it can state without
reading another silo's files — flag, cwd, env, ~/Virgil-Library — with the
SAME validation, and still refuses rather than guessing.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Optional, Union

PathLike = Union[str, Path, None]

_HERE = Path(__file__).resolve().parent
_SSOT_DIRS = (_HERE.parent.parent / "editor" / "scripts", _HERE.parent / "editor")

_ENV = "VIRGIL_LIBRARY_ROOT"
_DEFAULT = Path.home() / "Virgil-Library"


class LibraryNotFound(RuntimeError):
    """No candidate in the resolution chain is a real library."""


def _load_ssot():
    """Return the editor silo's `library_path` module, or None."""
    for d in _SSOT_DIRS:
        mod_path = d / "library_path.py"
        if not mod_path.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                "_virgil_library_path", mod_path
            )
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:
            continue
    return None


def looks_like_library(p: Path) -> bool:
    """The SSOT's validity test (mirrored only for the degraded path)."""
    mod = _load_ssot()
    if mod is not None:
        return bool(mod._looks_like_library(p))
    return (
        p.is_dir()
        and (p / "master.bib").exists()
        and (p / ".virgil" / "catalog.json").exists()
        and (p / ".virgil" / "scripts").is_dir()
    )


def _degraded(explicit: Optional[str]) -> Path:
    if explicit:
        candidates = [("--library flag", Path(explicit).expanduser())]
    else:
        candidates = [("current directory", Path.cwd())]
        env = os.environ.get(_ENV, "").strip()
        if env:
            candidates.append((_ENV, Path(env).expanduser()))
        candidates.append((str(_DEFAULT), _DEFAULT))
    tried = []
    for label, p in candidates:
        r = p.resolve()
        if looks_like_library(r):
            return r
        tried.append(f"  [{label}] {r}: not a valid library")
    raise LibraryNotFound(
        "No library found (editor/scripts/library_path.py is not reachable "
        "from here, so only the flag, the cwd, VIRGIL_LIBRARY_ROOT and "
        f"{_DEFAULT} were tried). Pass --library <abs-path>, run from the "
        f"library root, or set {_ENV}.\n"
        "  A valid library has master.bib + .virgil/catalog.json + .virgil/scripts/.\n"
        "  Tried:\n" + "\n".join(tried)
    )


def resolve_library_root(explicit: PathLike = None) -> Path:
    """Return the validated absolute library root, or raise LibraryNotFound."""
    flag = str(explicit) if explicit else None
    mod = _load_ssot()
    if mod is None:
        return _degraded(flag)
    try:
        return mod.resolve_library(flag)
    except mod.LibraryNotFound as e:
        raise LibraryNotFound(str(e)) from None


def library_root_or_exit(explicit: PathLike = None, code: int = 2) -> Path:
    """CLI form: print the refusal to stderr and exit `code` — never guess."""
    try:
        return resolve_library_root(explicit)
    except LibraryNotFound as e:
        print(f"error: {e}", file=sys.stderr)
        raise SystemExit(code)
