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

Duplicate-work guard (`--guard`, default on)
--------------------------------------------
Before an APPEND (i.e. when the citekey is NOT already in master.bib — an
in-place replace of the same citekey is never guarded), the work-identity
intake guard runs `find_work_in_library` over the incoming fields. If the
library already holds the SAME work under a DIFFERENT citekey, the append is
refused: a clear message names the existing entry and the shim exits nonzero.
Pass `--no-guard` to bypass (e.g. a deliberate re-add of a known-distinct work
the guard can't tell apart).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import read_master_bib, update_master_bib_entry


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
    ap.add_argument(
        "--guard",
        dest="guard",
        action="store_true",
        default=True,
        help="Run the work-identity duplicate guard before an APPEND (default).",
    )
    ap.add_argument(
        "--no-guard",
        dest="guard",
        action="store_false",
        help="Skip the duplicate-work guard (allow the append unconditionally).",
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

    # Duplicate-work guard — only for an APPEND (new citekey). An in-place
    # replace of an existing citekey is a legitimate update and is never guarded.
    if args.guard:
        existing = read_master_bib(library / "master.bib")
        is_append = args.citekey not in existing
        if is_append:
            # Lazy import to avoid any import cycle through _tools.
            from dedup_index import find_work_in_library
            match = find_work_in_library(
                fields, args.entry_type, library,
                incoming_citekey=args.citekey,
                include_uncertain=False,   # only a hard `same`/alias refuses
            )
            if match is not None and match.citekey != args.citekey:
                reasons = "; ".join(match.reasons) if match.reasons else match.relation
                print(
                    f"refusing to append {args.citekey}: the library already holds "
                    f"this work as {match.citekey!r} "
                    f"(relation={match.relation}, confidence={match.confidence:.2f}; "
                    f"{reasons}).\n"
                    f"Re-run with --no-guard to override, or update {match.citekey} "
                    f"in place instead.",
                    file=sys.stderr,
                )
                return 3

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
