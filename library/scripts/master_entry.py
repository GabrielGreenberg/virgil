"""Print one citekey's raw `master.bib` block — the CLI face of the read door.

    python3 .virgil/scripts/library/master_entry.py <citekey> > base.bib

`_tools.master_entry_for` has THREE answers, not two (task 621): the entry,
None (absent), or a raise (`BibEntryUnbalanced` when the entry's braces never
balance, or an I/O / decode error — it never swallows). A skill that wrapped
it in a heredoc and read "empty stdout" as "absent" collapsed the third answer
into the second: a damaged entry the user can plainly see in master.bib was
reported as "not in master.bib — nothing to authenticate" (task 1229). This
script owns the distinction as an exit code, so no caller infers it from a
file's emptiness:

  **0** found — the entry's raw `@type{key, …}` block on stdout, nothing
        else;
  **3** absent — master.bib has no entry for the citekey; a one-line note on
        stderr, NOTHING on stdout;
  **2** unreadable — the entry's braces never balance, master.bib cannot be
        read or decoded, or there is no library here; the door's message on
        stderr, verbatim, NOTHING on stdout. Report it and leave the file for
        a human — its fields are a guess.

The library root comes from the silo's one validated resolver
(`_library_root.py`); callers `cd` into the root first, as with every other
library script.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _library_root import library_root_or_exit  # noqa: E402
from _tools import BibEntryUnbalanced, master_entry_for  # noqa: E402

EXIT_FOUND = 0
EXIT_UNREADABLE = 2
EXIT_ABSENT = 3


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Print one citekey's raw master.bib block "
                    "(exit 0 found / 3 absent / 2 unreadable).",
    )
    parser.add_argument("citekey")
    args = parser.parse_args(argv)
    library = library_root_or_exit(code=EXIT_UNREADABLE)
    try:
        entry = master_entry_for(library, args.citekey)
    except BibEntryUnbalanced as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_UNREADABLE
    except (OSError, UnicodeDecodeError) as e:
        print(f"error: master.bib could not be read: {e}", file=sys.stderr)
        return EXIT_UNREADABLE
    if entry is None:
        print(f"absent: master.bib has no entry for {args.citekey}",
              file=sys.stderr)
        return EXIT_ABSENT
    sys.stdout.write(entry["raw"])
    return EXIT_FOUND


if __name__ == "__main__":
    sys.exit(main())
