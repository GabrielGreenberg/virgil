"""CLI shim around `_tools.update_catalog_entry`.

Skills shell out to this script so their catalog edits acquire the
`lock_catalog` lock — `fcntl.flock` is advisory, and Claude-driven
`Write`/`Edit` calls would bypass it otherwise.

Usage:
  python3 update_catalog_entry.py <citekey> --patch-file <path>
                                 [--library <path>]
                                 [--recompute-warning-kind <kind> ...]

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

Warnings: whole-array replace, or per-kind recompute
----------------------------------------------------
By default `indexed.warnings` REPLACES the row's array, like any other
list — so a patch that carries only your own lines destroys every other
kind on the row. That is why subskills used to defer their warnings to
one late owner (`deep-index.md` step 5).

Pass `--recompute-warning-kind <kind>` (repeatable) to make the write
per-kind instead: for each declared kind, lines whose head EXACTLY
equals it are dropped from the row and your patch's lines are appended;
everything else — other kinds, and `<kind>-false-positive:`
suppressions, whose heads differ — survives byte-identically. Declare
ONLY the kinds this pass actually recomputed; an empty `warnings` array
with a kind declared correctly clears that kind's stale lines.

  python3 update_catalog_entry.py smith2001 \
      --patch-file /tmp/warn.json \
      --recompute-warning-kind missing-bib-entry \
      --recompute-warning-kind ambiguous-citation

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
    ap.add_argument(
        "--recompute-warning-kind",
        action="append",
        default=[],
        dest="recompute_warning_kinds",
        metavar="KIND",
        help=(
            "Repeatable. Merge indexed.warnings per KIND instead of replacing "
            "the whole array: drop existing lines whose head equals KIND, "
            "append this patch's lines, leave every other line untouched. "
            "Declare only the kinds this pass recomputed."
        ),
    )
    args = ap.parse_args()

    library = _resolve_library(args.library)
    # Read+parse INSIDE the guarded region so exit 1 means exactly one thing.
    # These lines used to sit above the `try`, so an unparseable or missing
    # patch file escaped as an uncaught exception and CPython exited 1 — the
    # same code the KeyError below uses for "no catalog row for this citekey".
    # A caller branching on the code (authenticate-bib.md's pre-flight persist
    # does) then reports a failed write as a benign reference-only entry. Both
    # of these are refusals, not missing rows, so both are 2.
    try:
        patch = json.loads(args.patch_file.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"cannot read patch file {args.patch_file}: {e}", file=sys.stderr)
        return 2
    if not isinstance(patch, dict):
        print(f"patch file must contain a JSON object, got {type(patch).__name__}",
              file=sys.stderr)
        return 2

    try:
        update_catalog_entry(
            library,
            args.citekey,
            patch,
            recompute_warning_kinds=args.recompute_warning_kinds or None,
        )
    except KeyError as e:
        print(str(e), file=sys.stderr)
        return 1
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
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
