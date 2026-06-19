"""CLI shim around `_tools.invalidate_changed_imports`.

Sweep every imported catalog row and clear `bib.imported` on any paper
whose `references.bib` has gained a citekey since it was imported into
`master.bib` (additions-only — removals are ignored). This is the
steady-state catch-all for the "imported" badge: run it from the drain
(`/library/index-pending`) so the badge clears on the next skill pass no
matter which writer changed `references.bib`. Self-locks via the catalog
helpers; bumps `catalog-version.txt` only for rows that actually flip.

Pass an optional <citekey> to scope the check to a single paper (used by
single-paper writer skills like /library/clean-bibliography after they
re-emit references.bib); omit it to sweep the whole catalog (the
/library/index-pending steady-state drain).

Usage:
  python3 invalidate_bib_imports.py [<citekey>] [--library <path>]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import invalidate_bib_imported_if_added, invalidate_changed_imports


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "citekey",
        nargs="?",
        default=None,
        help="Scope to a single paper. Omit to sweep the whole catalog.",
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
    if args.citekey:
        flipped = [args.citekey] if invalidate_bib_imported_if_added(library, args.citekey) else []
    else:
        flipped = invalidate_changed_imports(library)
    if flipped:
        print(f"cleared bib.imported on {len(flipped)}: {', '.join(flipped)}")
    else:
        print("no imported paper changed; nothing to clear")
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
