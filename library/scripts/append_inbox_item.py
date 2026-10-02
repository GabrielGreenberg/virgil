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

`kind` is validated by the door (`_tools.resolve_inbox_item`, task 799): a
declared kind passes, a settled `bib.state` value (`unverified`, `canonical`,
…) is mapped onto the toast enum by `bib_state_to_notification_kind` (the raw
state kept in `state`), and anything else is REFUSED with exit 2 — nothing is
written. `severity` is stamped by the door; don't supply it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import InboxKindError, append_inbox_item, resolve_inbox_item


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
        help="Library root (default: the one validated resolver, _library_root.py).",
    )
    args = ap.parse_args()

    library = _resolve_library(args.library)
    item = json.loads(args.item_file.read_text())
    if not isinstance(item, dict):
        print(f"item file must contain a JSON object, got {type(item).__name__}",
              file=sys.stderr)
        return 2

    try:
        resolved = resolve_inbox_item(item)
    except InboxKindError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    append_inbox_item(library, resolved)
    print(f"appended notification {resolved['kind']} ({resolved['severity']}) to {library}")
    return 0


from _library_root import library_root_or_exit  # noqa: E402  (task 896)


def _resolve_library(explicit: Path | None) -> Path:
    """Delegate to the library silo's one validated door (task 896)."""
    return library_root_or_exit(explicit)


if __name__ == "__main__":
    sys.exit(main())
