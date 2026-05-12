"""CLI shim around `_tools.bump_catalog_version`.

For skills that need to signal the frontend that something changed
(e.g. files moved on disk, notifications appended) without actually
mutating `catalog.json` — typically after appending an inbox item or
moving a file. The version bump is what triggers the frontend's 6-second
catalog reload.

Usage:
  python3 bump_catalog_version.py [--library <path>]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import bump_catalog_version


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--library",
        type=Path,
        default=None,
        help="Library root. Defaults to the cwd if it contains .virgil/catalog.json, "
        "else ~/Virgil-Library.",
    )
    args = ap.parse_args()
    library = _resolve_library(args.library)
    bump_catalog_version(library)
    print(f"bumped catalog-version.txt in {library}")
    return 0


def _resolve_library(explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser().resolve()
    cwd = Path.cwd()
    if (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path("~/Virgil-Library").expanduser()


if __name__ == "__main__":
    sys.exit(main())
