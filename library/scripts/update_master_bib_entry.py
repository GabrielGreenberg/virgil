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
      [--merge-existing] [--allow-field-drop]

**The write is a WHOLE-BLOCK REPLACEMENT, not a diff.** `_tools.update_master_bib_entry`
finds the brace-balanced `@<type>{<citekey>, ...}` block and replaces it with a block
emitted from EXACTLY the fields dict handed in — this shim passes `--fields-file`
through unmerged. So the fields file must be the COMPLETE field set the entry should
end up with, not just the fields you changed. Hand it a change-set and every unlisted
field (pages, volume, publisher, doi, isbn, url, note) is destroyed.

Two flags exist so a caller that only holds a change-set can't cause that loss —
see "Field-preservation guard" below.

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

Field-preservation guard (always on for a REPLACE)
--------------------------------------------------
Before an in-place REPLACE (the citekey IS already in master.bib — an append is
never guarded, since there is nothing to drop), the incoming field set is compared
against the entry's current one. If the write would DROP any currently-non-empty
field, it is refused: the message names the dropped fields and the shim exits
nonzero. This is the counterpart of the duplicate-work guard on the append side —
together they mean neither half of the upsert can silently lose data.

Three ways past it, per intent:

  --merge-existing    You hold a CHANGE-SET, not a complete entry. The incoming
                      fields are merged OVER the entry's current fields, so
                      unlisted fields survive. This is the right flag for any
                      caller that computed a field diff (an auth pass, a
                      cover-page metadata correction).
  --drop-field NAME   Remove this NAMED field (repeatable). Because it is applied
                      AFTER the merge, it is the only removal signal that
                      composes with --merge-existing — use it for a field that
                      stops applying when the entry type changes (`journal` on
                      @article → @incollection; journal/booktitle/volume/number/
                      pages on → @unpublished, mirroring what index_paper.py does
                      in-process for the same auth flow).
  --allow-field-drop  You hold a COMPLETE entry and its omissions are deliberate
                      (a user clearing fields). This trusts omission as removal,
                      so it is inert under --merge-existing — that mode re-adds
                      every current field, leaving nothing omitted. Reach for
                      --drop-field there instead.

Field names are compared case-insensitively (`read_master_bib` lowercases them,
an incoming `DOI` and an on-file `doi` are the same field). The citekey is
resolved under Unicode normalization too, so a diacritic entry stored NFD is
found when the caller passes NFC and vice versa (1976-Tichý memo) — matching how
the writer itself searches, so the guard can never be bypassed by a form mismatch.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import citekey_matches, read_master_bib, update_master_bib_entry


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
    ap.add_argument(
        "--merge-existing",
        action="store_true",
        help="Merge the incoming fields OVER the entry's current fields instead of "
        "replacing them wholesale. Use when you hold a change-set, not a complete entry.",
    )
    ap.add_argument(
        "--drop-field",
        action="append",
        default=[],
        metavar="NAME",
        help="Remove this field from the entry (repeatable). The one removal signal "
        "that composes with --merge-existing — use it for a field that stops applying "
        "after an entry-type change, e.g. --drop-field journal on @article → "
        "@incollection.",
    )
    ap.add_argument(
        "--allow-field-drop",
        action="store_true",
        help="Permit a replace that drops currently-non-empty fields by OMISSION "
        "(you hold a complete entry and the removals are deliberate). Inert under "
        "--merge-existing, which re-adds every current field — name the field with "
        "--drop-field instead.",
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

    existing = read_master_bib(library / "master.bib")
    # Resolve the STORED spelling of the citekey. `read_master_bib` keys entries
    # byte-for-byte as the file spells them and never normalizes, while the
    # writer normalizes to NFC and then searches under BOTH NFC and NFD (the
    # 1976-Tichý memo: master.bib genuinely carries either form). A raw
    # `args.citekey in existing` test therefore disagrees with the writer on any
    # diacritic citekey stored in the other normalization — it would report
    # "append", skip this whole guard, and then let the writer find and
    # whole-block-replace the entry anyway. That is precisely the silent data
    # loss the guard exists to prevent, so match the writer's normalization.
    stored_key = next(
        (k for k in existing if citekey_matches(k, args.citekey)), None,
    )
    is_append = stored_key is None

    # Field-preservation guard — only for a REPLACE. The write below is a
    # whole-block replacement, so any currently-non-empty field missing from
    # `fields` is destroyed. Refuse rather than lose it; `--merge-existing`
    # (I hold a change-set), `--drop-field` (remove this NAMED field) and
    # `--allow-field-drop` (trust my omissions wholesale) are the sanctioned
    # ways through. Mirrors the append-side duplicate guard: neither half of
    # the upsert may silently lose data.
    if not is_append:
        current = existing[stored_key].get("fields") or {}
        drop_names = {d.lower() for d in args.drop_field}
        if args.merge_existing:
            # Incoming wins per field; everything else survives.
            merged = {k: str(v) for k, v in current.items() if str(v).strip()}
            lowered = {k.lower(): k for k in merged}
            for k, v in fields.items():
                merged.pop(lowered.get(k.lower(), ""), None)
                merged[k] = v
            fields = merged
        # Named removals apply AFTER the merge, which is what makes
        # `--drop-field` the one removal signal that composes with
        # `--merge-existing` (the merge re-adds every current field, so an
        # omission can no longer express "remove this").
        if drop_names:
            fields = {k: v for k, v in fields.items() if k.lower() not in drop_names}
        incoming_lower = {k.lower() for k in fields}
        dropped = sorted(
            k for k, v in current.items()
            if str(v).strip()
            and k.lower() not in incoming_lower
            and k.lower() not in drop_names   # named = deliberate, not a loss
        )
        if dropped and not args.allow_field_drop:
            print(
                f"refusing to update {args.citekey}: this write replaces the whole "
                f"entry, and the fields file omits {len(dropped)} field(s) the entry "
                f"currently has — {', '.join(dropped)}.\n"
                f"If you built a change-set rather than a complete entry, re-run with "
                f"--merge-existing. If a specific field is meant to go, name it: "
                f"--drop-field <name> (repeatable, composes with --merge-existing). "
                f"To trust your omissions wholesale, re-run with --allow-field-drop.",
                file=sys.stderr,
            )
            return 4

    # Duplicate-work guard — only for an APPEND (new citekey). An in-place
    # replace of an existing citekey is a legitimate update and is never guarded.
    if args.guard and is_append:
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
