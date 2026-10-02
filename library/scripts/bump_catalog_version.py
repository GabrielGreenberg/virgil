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
        help="Library root (default: the one validated resolver, _library_root.py).",
    )
    args = ap.parse_args()
    library = _resolve_library(args.library)
    bump_catalog_version(library)
    print(f"bumped catalog-version.txt in {library}")
    return 0


from _library_root import library_root_or_exit  # noqa: E402  (task 896)


def _resolve_library(explicit: Path | None) -> Path:
    """Delegate to the library silo's one validated door (task 896)."""
    return library_root_or_exit(explicit)


if __name__ == "__main__":
    sys.exit(main())
