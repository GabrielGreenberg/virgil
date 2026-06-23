"""CLI shim around `_tools.build_bib_index`.

Emits `.virgil/bib-index.json` — a slim, flat projection of master.bib that
the frontend reads INSTEAD of parsing the multi-MB master.bib with
citation-js on the browse path (library list + citation picker). Parsing the
real 34k-entry master.bib in the browser blocks the main thread ~2.6s
(~6s at 100k); JSON.parse of this slim index is ~15ms.

Normally rebuilt automatically at process exit by any skill/script that
writes master.bib or catalog.json (see `_tools.build_bib_index` /
`_mark_bib_index_dirty`). Run this directly to:
  - backfill an existing library that predates the bib-index, or
  - force a rebuild after an out-of-band master.bib edit.

The build is stamp-gated (mtime+size of master.bib): a no-op when master.bib
is unchanged unless `--force` is passed.

Usage:
  python3 build_bib_index.py [--library <path>] [--force]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import build_bib_index, BIB_INDEX_REL


def _resolve_library(explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser().resolve()
    cwd = Path.cwd()
    if (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path("~/Virgil-Library").expanduser()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--library", type=Path, default=None,
                    help="Library root. Defaults to cwd if it has .virgil/catalog.json, "
                         "else ~/Virgil-Library.")
    ap.add_argument("--force", action="store_true",
                    help="Rebuild even if master.bib is unchanged since the last index.")
    args = ap.parse_args()
    library = _resolve_library(args.library)

    t0 = time.perf_counter()
    wrote = build_bib_index(library, force=args.force)
    dt = (time.perf_counter() - t0) * 1000

    out = library / BIB_INDEX_REL
    if wrote:
        size_mb = out.stat().st_size / 1e6 if out.exists() else 0
        print(f"built {out} ({size_mb:.1f} MB) in {dt:.0f} ms")
    else:
        print(f"bib-index up to date ({out}); skipped in {dt:.0f} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
