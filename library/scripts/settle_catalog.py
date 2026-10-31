"""Settle one citekey's catalog row (or `% bib.state` comment) from master.bib.

    python3 .virgil/scripts/library/settle_catalog.py <citekey> <verdict.json>

`/library/authenticate-bib` step 7. Runs
`index_paper.sync_catalog_entry_from_master` with the run's verdict file and
prints the state master.bib SETTLED (task 797) — the one the skill reports
from then on, not the verdict it asked for:

    settled state: <state>

Before task 1396 the skill reached the helper through a heredoc that imported
it as an underscore-private name and assumed cwd was the library root.

  **0** settled — the `settled state:` line on stdout (its value may be empty
        when master.bib has no entry for the citekey);
  **2** nothing settled — the verdict file cannot be read or parsed, master.bib
        cannot be read, the entry's braces never balance, or there is no
        library here. The message on stderr, verbatim.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _library_root import library_root_or_exit  # noqa: E402
from _tools import BibEntryUnbalanced  # noqa: E402

EXIT_SETTLED = 0
EXIT_FAILED = 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Settle a citekey's catalog row / bib.state from master.bib "
                    "and print `settled state: <state>` (exit 0 / 2).",
    )
    parser.add_argument("citekey")
    parser.add_argument("verdict", help="path to the run's verdict.json")
    args = parser.parse_args(argv)
    library = library_root_or_exit(code=EXIT_FAILED)
    try:
        verdict = json.loads(Path(args.verdict).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        print(f"error: verdict file {args.verdict} could not be read: {e}",
              file=sys.stderr)
        return EXIT_FAILED
    # Imported late: index_paper pulls the whole extraction pipeline.
    from index_paper import sync_catalog_entry_from_master
    try:
        settled = sync_catalog_entry_from_master(library, args.citekey, verdict)
    except BibEntryUnbalanced as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_FAILED
    except (OSError, UnicodeDecodeError) as e:
        print(f"error: master.bib could not be read: {e}", file=sys.stderr)
        return EXIT_FAILED
    print(f"settled state: {settled}")
    return EXIT_SETTLED


if __name__ == "__main__":
    sys.exit(main())
