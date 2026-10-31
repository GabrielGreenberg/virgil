"""Re-mirror one citekey's master.bib row into its paper's references.bib.

    python3 .virgil/scripts/library/resync_paper_bib.py <citekey>

The sync step `/library/authenticate-bib` (step 6) and `/library/apply-bib-edit`
(step 3) both run after a master.bib write. Before task 1396 each skill wrapped
`index_paper._resync_references_bib` in its own heredoc: a private helper that
answered one bool for three outcomes — so a legitimate "no paper folder" skip
and a missing master row printed the same line — and a raw traceback for the
other two. This script owns the distinction as an exit code, the same shape as
`master_entry.py` (task 1229):

  **0** synced — the `<citekey>` block in `papers/<citekey>/references.bib` was
        upserted; every other entry survives byte-identically. One stdout line.
  **4** no paper folder — `papers/<citekey>/` does not exist (a hand-added bib
        entry with no indexed paper). A LEGITIMATE skip; one stdout line,
        nothing written.
  **3** master row absent — the folder exists but master.bib has no entry for
        the citekey. Right after a successful master write this is a DEFECT;
        a one-line note on stderr, nothing written.
  **2** master entry unreadable — its braces never balance, master.bib is
        missing or cannot be read/decoded, or there is no library here. The
        door's message on stderr, verbatim; nothing written.
  **5** splice refused (`BibSpliceRefused`) — references.bib is too malformed
        to splice safely and was left byte-for-byte untouched. The message on
        stderr, verbatim; the file needs a human repair.

Each calling skill states its own POLICY per code next to the call; this
script only states the facts. The library root comes from the silo's one
validated resolver (`_library_root.py`); callers `cd` into the root first.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _bib_parse import BibSpliceRefused  # noqa: E402
from _library_root import library_root_or_exit  # noqa: E402
from _tools import (  # noqa: E402
    RESYNC_ABSENT,
    RESYNC_NO_PAPER,
    BibEntryUnbalanced,
    resync_paper_bib,
)

EXIT_SYNCED = 0
EXIT_UNREADABLE = 2
EXIT_ABSENT = 3
EXIT_NO_PAPER = 4
EXIT_SPLICE_REFUSED = 5


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Re-mirror a citekey's master.bib row into "
                    "papers/<citekey>/references.bib (exit 0 synced / "
                    "4 no paper folder / 3 master row absent / "
                    "2 master entry unreadable / 5 splice refused).",
    )
    parser.add_argument("citekey")
    args = parser.parse_args(argv)
    library = library_root_or_exit(code=EXIT_UNREADABLE)
    try:
        outcome = resync_paper_bib(library, args.citekey)
    except BibSpliceRefused as e:
        print(f"refused: references.bib left untouched — {e}", file=sys.stderr)
        return EXIT_SPLICE_REFUSED
    except BibEntryUnbalanced as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_UNREADABLE
    except (OSError, UnicodeDecodeError) as e:
        print(f"error: master.bib could not be read: {e}", file=sys.stderr)
        return EXIT_UNREADABLE
    if outcome == RESYNC_NO_PAPER:
        print(f"skipped: no papers/{args.citekey}/ folder — nothing to resync")
        return EXIT_NO_PAPER
    if outcome == RESYNC_ABSENT:
        print(f"absent: master.bib has no entry for {args.citekey}",
              file=sys.stderr)
        return EXIT_ABSENT
    print(f"references.bib resynced for {args.citekey}")
    return EXIT_SYNCED


if __name__ == "__main__":
    sys.exit(main())
