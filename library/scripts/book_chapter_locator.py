"""Insert `\\section{Chapter N: Title}` headings into a book's
`main.tex` at the correct body positions.

Companion to `extract_book_toc.py`. Reads a JSON TOC payload (list
of `{chapter_number, title, page}`) and, for each entry, locates
the corresponding `\\pgmark{page}` in `main.tex` and inserts a
`\\section{Chapter N: Title}` line right after it (or just before
the body content of that page).

Skips chapters whose body position cannot be found (catalog warns
those as `chapter-locator-missed: chapter N`).

(zeki memo.)

Usage:
    python3 book_chapter_locator.py <citekey> <toc.json> [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
EXISTING_SECTION_RE = re.compile(
    r"\\section\{(?:Chapter\s+)?(\d{1,3})\b", re.I,
)


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _find_pgmark_position(text: str, page: int) -> int | None:
    for m in PGMARK_RE.finditer(text):
        try:
            v = int(m.group(1))
        except ValueError:
            continue
        if v == page:
            return m.end()
    return None


def locate(
    citekey: str, toc: list[dict], dry_run: bool = False,
) -> dict:
    library = _resolve_library_root()
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}"}
    text = tex_path.read_text(encoding="utf-8")

    # Skip chapters that already have a section heading.
    existing_nums: set[int] = set()
    for m in EXISTING_SECTION_RE.finditer(text):
        try:
            existing_nums.add(int(m.group(1)))
        except ValueError:
            continue

    edits: list[tuple[int, str]] = []
    inserted = 0
    missed: list[int] = []
    for entry in toc:
        num = entry.get("chapter_number")
        title = entry.get("title", "")
        page = entry.get("page")
        if num is None or page is None or num in existing_nums:
            continue
        pos = _find_pgmark_position(text, page)
        if pos is None:
            missed.append(num)
            continue
        # Insert after the pgmark's next paragraph break (so the heading
        # ends up at body scope, not inline).
        next_para = text.find("\n\n", pos)
        if next_para < 0:
            next_para = pos
        else:
            next_para += 2
        heading = f"\n\\section{{Chapter {num}: {title}}}\n\n"
        edits.append((next_para, heading))
        inserted += 1

    if not edits:
        return {"inserted": 0, "missed": missed}

    edits.sort(key=lambda e: -e[0])
    new_text = text
    for pos, ins in edits:
        new_text = new_text[:pos] + ins + new_text[pos:]
    if not dry_run:
        tex_path.write_text(new_text, encoding="utf-8")
    return {"inserted": inserted, "missed": missed}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Insert chapter headings from a TOC JSON.",
    )
    parser.add_argument("citekey")
    parser.add_argument("toc_json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        toc = json.loads(Path(args.toc_json).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    result = locate(args.citekey, toc, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Inserted {result['inserted']} chapter headings{suffix}; "
        f"missed: {result['missed']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
