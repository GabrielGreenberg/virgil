"""Compare the pgmark count in main.tex against the catalog's
recorded `indexed.pgmarkCount` and surface drift as a punch-list line.

Catalogs sometimes carry a stale pgmark count from the initial
index-paper run; later deep-index passes add or remove markers without
updating the count, leading to silent drift the audit never sees.
Run in di-preflight so the convergence loop notices.

Output (on stdout):

    pgmark-coverage: <citekey> main.tex=<N> catalog=<M> ((+/-)<delta>)

Exit codes:
- 0 — counts match (or catalog has no recorded count).
- 1 — counts diverge.

Usage:
    python3 verify_pgmark_coverage.py <citekey> [--library <path>]
        [--update-catalog]   # write the in-file count back to catalog

If `--update-catalog` is passed AND the counts differ, the catalog
row's `indexed.pgmarkCount` is rewritten to the in-file count (via
the locked update_catalog_entry.py path).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tools import (
    citekey_matches, lock_catalog, normalize_citekey,
    read_catalog, write_catalog,
)


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def count_pgmarks(tex_path: Path) -> int:
    try:
        text = tex_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return 0
    return len(PGMARK_RE.findall(text))


def catalog_pgmark_count(library: Path, citekey: str) -> int | None:
    catalog = read_catalog(library)
    for e in catalog.get("entries", []):
        if citekey_matches(e.get("citekey", ""), citekey):
            indexed = e.get("indexed") or {}
            val = indexed.get("pgmarkCount")
            if isinstance(val, int):
                return val
            return None
    return None


def update_catalog_pgmark_count(library: Path, citekey: str, count: int) -> bool:
    with lock_catalog(library):
        catalog = read_catalog(library)
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), citekey):
                indexed = e.setdefault("indexed", {})
                indexed["pgmarkCount"] = count
                write_catalog(library, catalog)
                return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("citekey")
    ap.add_argument("--library", type=Path, default=None)
    ap.add_argument("--update-catalog", action="store_true")
    args = ap.parse_args()
    library = args.library
    if library is None:
        cwd = Path.cwd()
        if (cwd / "master.bib").exists():
            library = cwd
        else:
            library = Path("~/Virgil-Library").expanduser()
    library = library.resolve()
    citekey = normalize_citekey(args.citekey)
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    if not tex_path.exists():
        print(f"error: {tex_path} not found", file=sys.stderr)
        return 2
    file_count = count_pgmarks(tex_path)
    catalog_count = catalog_pgmark_count(library, citekey)
    if catalog_count is None:
        print(
            f"pgmark-coverage: {citekey} main.tex={file_count} catalog=<unset>"
        )
        if args.update_catalog and file_count > 0:
            update_catalog_pgmark_count(library, citekey, file_count)
            print(f"  → catalog updated to {file_count}")
        return 0
    delta = file_count - catalog_count
    sign = "+" if delta > 0 else ""
    print(
        f"pgmark-coverage: {citekey} "
        f"main.tex={file_count} catalog={catalog_count} ({sign}{delta})"
    )
    if delta == 0:
        return 0
    if args.update_catalog:
        update_catalog_pgmark_count(library, citekey, file_count)
        print(f"  → catalog updated to {file_count}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
