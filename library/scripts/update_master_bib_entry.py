"""CLI shim around `_tools.update_master_bib_entry`.

Skills shell out to this script so their master.bib edits acquire the
`lock_master_bib` lock — `fcntl.flock` is advisory, and Claude-driven
`Write`/`Edit` calls would bypass it otherwise.

Usage:
  python3 update_master_bib_entry.py <citekey>
      --entry-type <type>
      --fields-file <path>
      [--bib-state <state>]
      [--library <path>]

The fields file is a JSON object mapping bib field names to string
values, e.g.:

  {
    "author": "Smith, John and Doe, Jane",
    "title": "An Example Paper",
    "year": "2020",
    "journal": "Journal of Examples",
    "volume": "12",
    "number": "3",
    "pages": "45--67",
    "doi": "10.1234/example.2020"
  }

If `--bib-state` is given, the existing `% bib.state = ...` comment
line (if any) is replaced with the new value.

Replaces an existing @<type>{<citekey>, ...} block in place, or
appends at the end if no such block exists.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import update_master_bib_entry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("citekey")
    ap.add_argument(
        "--entry-type",
        required=True,
        help="Bib entry type, e.g. 'article', 'book', 'incollection', 'unpublished'.",
    )
    ap.add_argument(
        "--fields-file",
        required=True,
        type=Path,
        help="Path to a JSON file mapping field names to string values.",
    )
    ap.add_argument(
        "--bib-state",
        default="",
        help="Value for the leading bib.state comment. Omit to keep existing.",
    )
    ap.add_argument(
        "--library",
        type=Path,
        default=None,
        help="Library root. Defaults to the cwd if it contains master.bib, "
        "else ~/Virgil-Library.",
    )
    args = ap.parse_args()

    library = _resolve_library(args.library)
    fields = json.loads(args.fields_file.read_text())
    if not isinstance(fields, dict):
        print(f"fields file must contain a JSON object, got {type(fields).__name__}",
              file=sys.stderr)
        return 2
    # Coerce all values to str — bib fields are textual.
    fields = {k: str(v) for k, v in fields.items() if v not in (None, "")}

    update_master_bib_entry(
        library, args.citekey, args.entry_type, fields,
        bib_state=args.bib_state,
    )
    print(f"updated master.bib entry for {args.citekey} in {library}")
    return 0


def _resolve_library(explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser().resolve()
    cwd = Path.cwd()
    if (cwd / "master.bib").exists():
        return cwd
    return Path("~/Virgil-Library").expanduser()


if __name__ == "__main__":
    sys.exit(main())
