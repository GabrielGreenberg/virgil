"""CLI shim around `_tools.append_inbox_item`.

Skills shell out to this script so their inbox appends acquire the
`lock_inbox` lock — `fcntl.flock` is advisory, and Claude-driven
`Write`/`Edit` calls would bypass it otherwise.

Usage:
  python3 append_inbox_item.py --item-file <path> [--library <path>]

The item file is a JSON object describing a single notification, e.g.:

  {
    "kind": "indexed",
    "citekey": "smith1998",
    "at": "2026-05-11T20:06:20Z",
    "summary": "Deep-indexed smith1998"
  }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import append_inbox_item


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--item-file",
        required=True,
        type=Path,
        help="Path to a JSON file with the item to append.",
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
    item = json.loads(args.item_file.read_text())
    if not isinstance(item, dict):
        print(f"item file must contain a JSON object, got {type(item).__name__}",
              file=sys.stderr)
        return 2

    append_inbox_item(library, item)
    print(f"appended notification {item.get('kind', '?')} to {library}")
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
