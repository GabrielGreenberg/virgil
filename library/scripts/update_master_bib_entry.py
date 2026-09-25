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
      [--base-raw-file <path> --base-type <type>]

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
line (if any) is replaced with the new value — unless that would LOWER a
settled state (authenticated / manuscript / canonical), which is held
(and noted on stderr) without `--allow-downgrade` (task 621).

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

Per-field base check (`--base-raw-file`, requires --merge-existing)
------------------------------------------------------------------
A caller holding a DIFF computed against an earlier read of the entry (the
Library's manual bib edit — task 763) names that read: `--base-raw-file` is the
block as it was read, `--base-type` its entry type. Every field the write would
set (`--fields-file`) or remove (`--drop-field`) is then checked against it: if
the field's value on disk is no longer the base value — someone changed it since
— and is not already the value this write wants, that field is REFUSED (the
newer on-disk value is kept) and the rest of the write proceeds. A type change is
held the same way, and an UNCHANGED type (`--entry-type` == `--base-type`) keeps
whatever type is on disk now. Refusals are listed on stderr and the shim exits 5
(after writing whatever was not refused); if nothing was left to write, nothing
is written. The entry must still exist — a diff cannot be appended (exit 2).
Values compare with whitespace runs collapsed, both sides read by this same
parser, so a base read by a different parser can never manufacture a conflict.

Field names are compared case-insensitively (`read_master_bib` lowercases them,
an incoming `DOI` and an on-file `doi` are the same field). The citekey is
resolved under Unicode normalization too, so a diacritic entry stored NFD is
found when the caller passes NFC and vice versa (1976-Tichý memo) — matching how
the writer itself searches, so the guard can never be bypassed by a form mismatch.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (
    citekey_matches,
    master_entry_for,
    read_master_bib,
    update_master_bib_entry,
)


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
    ap.add_argument(
        "--base-raw-file",
        type=Path,
        default=None,
        help="The entry's BibTeX block as the caller read it before computing its "
        "change-set. Each field set or dropped is refused (kept as on disk) if it "
        "changed since. Requires --merge-existing; pair with --base-type.",
    )
    ap.add_argument(
        "--base-type",
        default="",
        help="The entry type in the --base-raw-file read. An --entry-type equal to "
        "it keeps the type on disk; a different one is refused if the disk type "
        "also moved.",
    )
    ap.add_argument(
        "--allow-downgrade",
        action="store_true",
        help="Permit --bib-state to LOWER a settled state (authenticated / "
        "manuscript / canonical → anything else). Without it the settled state "
        "is held and only the fields are written.",
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

    # The one read door (`_tools.master_entry_for`, task 621): the writer's
    # own locator — NFC then NFD, last entry wins — so the guard below judges
    # exactly the entry the write will replace. A raw `args.citekey in
    # read_master_bib(...)` disagreed with the writer on a diacritic citekey
    # stored in the other normalization: it reported "append", skipped the
    # guard, and the writer whole-block-replaced the entry anyway.
    existing_entry = master_entry_for(library, args.citekey)
    is_append = existing_entry is None

    drop_fields = list(args.drop_field)
    entry_type = args.entry_type
    refused: list[str] = []
    if args.base_raw_file is not None:
        if not args.merge_existing:
            print("--base-raw-file requires --merge-existing (it checks a "
                  "change-set, not a complete entry)", file=sys.stderr)
            return 2
        if is_append:
            print(f"refusing to update {args.citekey}: the entry is no longer in "
                  f"master.bib, and a change-set cannot recreate it.", file=sys.stderr)
            return 2
        base = _read_base_entry(args.base_raw_file)
        if base is None:
            print(f"refusing to update {args.citekey}: --base-raw-file holds no "
                  f"readable BibTeX entry, so no field can be checked against it.",
                  file=sys.stderr)
            return 2
        fields, drop_fields, entry_type, refused = _hold_changed_since_base(
            base_fields=base.get("fields") or {},
            base_type=args.base_type or base.get("type") or "",
            disk_fields=existing_entry.get("fields") or {},
            disk_type=existing_entry.get("type") or entry_type,
            fields=fields,
            drop_fields=drop_fields,
            entry_type=entry_type,
        )
        if not fields and not drop_fields and \
                entry_type.lower() == (existing_entry.get("type") or "").lower():
            _report_refused(args.citekey, refused)
            if not refused:
                print(f"nothing to change in master.bib entry for {args.citekey}")
            return 5 if refused else 0

    # Field-preservation guard — only for a REPLACE. The write below is a
    # whole-block replacement, so any currently-non-empty field missing from
    # `fields` is destroyed. Refuse rather than lose it; `--merge-existing`
    # (I hold a change-set), `--drop-field` (remove this NAMED field) and
    # `--allow-field-drop` (trust my omissions wholesale) are the sanctioned
    # ways through. Mirrors the append-side duplicate guard: neither half of
    # the upsert may silently lose data.
    if not is_append:
        current = existing_entry.get("fields") or {}
        drop_names = {d.lower() for d in drop_fields}
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
            fields, entry_type, library,
            incoming_citekey=args.citekey,
            include_uncertain=False,   # only a hard `same`/alias refuses
        )
        # NFC-insensitive: a match differing only by normalization form is
        # this very entry, and refusing the append would be a false guard.
        if match is not None and not citekey_matches(match.citekey, args.citekey):
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

    written_state = update_master_bib_entry(
        library, args.citekey, entry_type, fields,
        bib_state=args.bib_state,
        allow_downgrade=args.allow_downgrade,
    )
    print(f"updated master.bib entry for {args.citekey} in {library}")
    if args.bib_state and written_state != args.bib_state:
        print(
            f"note: {args.citekey} is settled (bib.state={written_state}); "
            f"--bib-state {args.bib_state} was not applied. Pass "
            "--allow-downgrade for a deliberate downgrade.",
            file=sys.stderr,
        )
    if refused:
        _report_refused(args.citekey, refused)
        return 5
    return 0


def _norm(v: object) -> str:
    return " ".join(str(v or "").split())


def _read_base_entry(path: Path) -> "dict | None":
    """Parse the caller's base block with the SAME parser that reads the disk
    entry, so an unchanged field compares equal by construction."""
    parsed = read_master_bib(Path(os.devnull), text=path.read_text())
    return next(iter(parsed.values()), None)


def _hold_changed_since_base(
    *,
    base_fields: dict,
    base_type: str,
    disk_fields: dict,
    disk_type: str,
    fields: dict[str, str],
    drop_fields: list[str],
    entry_type: str,
) -> tuple[dict[str, str], list[str], str, list[str]]:
    """Drop from the change-set every field that moved on disk since the base.

    A field is held when its disk value differs from the base value AND from the
    value this write wants (an edit that already matches the disk is no
    conflict). Returns (fields, drop_fields, entry_type, refusal lines)."""
    base = {k.lower(): _norm(v) for k, v in base_fields.items()}
    disk = {k.lower(): _norm(v) for k, v in disk_fields.items()}
    refused: list[str] = []
    kept: dict[str, str] = {}
    for k, v in fields.items():
        cur, was = disk.get(k.lower(), ""), base.get(k.lower(), "")
        if cur != was and cur != _norm(v):
            refused.append(f"{k}: changed on disk since the edit was opened "
                           f"(now {cur or '(empty)'!r}); your value {v!r} was not applied")
        else:
            kept[k] = v
    kept_drops: list[str] = []
    for k in drop_fields:
        cur, was = disk.get(k.lower(), ""), base.get(k.lower(), "")
        if cur != was and cur:
            refused.append(f"{k}: changed on disk since the edit was opened "
                           f"(now {cur!r}); not removed")
        else:
            kept_drops.append(k)
    if not base_type or entry_type.lower() == base_type.lower():
        entry_type = disk_type            # the user left the type alone
    elif disk_type.lower() not in (base_type.lower(), entry_type.lower()):
        refused.append(f"entry type: changed on disk to @{disk_type} since the edit "
                       f"was opened; @{entry_type} was not applied")
        entry_type = disk_type
    return kept, kept_drops, entry_type, refused


def _report_refused(citekey: str, refused: list[str]) -> None:
    if not refused:
        return
    print(f"held {len(refused)} change(s) to {citekey} that the entry had "
          f"already moved past:", file=sys.stderr)
    for line in refused:
        print(f"  - {line}", file=sys.stderr)


def _resolve_library(explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser().resolve()
    cwd = Path.cwd()
    if (cwd / "master.bib").exists():
        return cwd
    return Path("~/Virgil-Library").expanduser()


if __name__ == "__main__":
    sys.exit(main())
