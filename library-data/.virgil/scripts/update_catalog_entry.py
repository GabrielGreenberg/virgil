"""CLI shim around `_tools.update_catalog_entry`.

Skills shell out to this script so their catalog edits acquire the
`lock_catalog` lock — `fcntl.flock` is advisory, and Claude-driven
`Write`/`Edit` calls would bypass it otherwise.

Usage:
  python3 update_catalog_entry.py <citekey> --patch-file <path>
                                 [--library <path>]

The patch file is a JSON object that is deep-merged into the existing
catalog entry (nested objects merge; arrays and scalars replace).
Example:

  {
    "indexed": {
      "state": "deepIndexed",
      "lastIndexedAt": "2026-05-11T20:06:20Z",
      "exampleCount": 14,
      "warnings": ["missing-bib-entry: Smith 1998"]
    }
  }

The script also bumps `.virgil/catalog-version.txt` so the frontend
picks up the change on its next poll.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import update_catalog_entry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("citekey")
    ap.add_argument(
        "--patch-file",
        required=True,
        type=Path,
        help="Path to a JSON file with the patch to apply.",
    )
    ap.add_argument(
        "--library",
        type=Path,
        default=None,
        help="Library root. Defaults to the cwd if it contains .virgil/catalog.json, "
        "else ~/Virgil-Library.",
    )
    args = ap.parse_args()

    library = _resolve_library(args.library)
    patch = json.loads(args.patch_file.read_text())
    if not isinstance(patch, dict):
        print(f"patch file must contain a JSON object, got {type(patch).__name__}",
              file=sys.stderr)
        return 2

    try:
        update_catalog_entry(library, args.citekey, patch)
    except KeyError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"updated catalog row for {args.citekey} in {library}")
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
