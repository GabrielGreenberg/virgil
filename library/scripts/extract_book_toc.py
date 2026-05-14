"""Extract a structured Table of Contents from a book's PDF.

Long-form books need a TOC to feed the chapter-locator that adds
`\\section{Chapter N: Title}` headings into the body. This script:

1. Scans the first `--max-toc-pages` (default 30) PDF pages for a
   Table-of-Contents region. Detected by:
   - Presence of a `TABLE OF CONTENTS` or `CONTENTS` heading line.
   - Density of TOC-shaped lines: `<chapter#> <title> ... <page>`
     with optional dot leaders.
2. Parses each TOC line into `{chapter_number, title, page}`.
3. Handles multi-column layouts by recognizing the visual gap
   between the number/title and page columns (uses `-layout`
   spacing).
4. Emits JSON to stdout (or `--out` file).

Pairs with `book_chapter_locator.py` which consumes the JSON and
inserts `\\section{}` headings at the correct body positions.

(zeki memo.)

Usage:
    python3 extract_book_toc.py <citekey>
        [--max-toc-pages 30] [--out toc.json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


CONTENTS_HEAD_RE = re.compile(
    r"\b(TABLE\s+OF\s+CONTENTS|CONTENTS)\b", re.I,
)
# Possible TOC entry shapes (with dot-leaders or column gap):
#   "1   The retina and the visual image    9"
#   "1. Introduction ......................... 1"
#   "Chapter 1: Title page 15"
TOC_LINE_RES = [
    re.compile(r"^\s*(?:Chapter\s+)?(\d{1,3})[\.:]?\s+([A-Z][^\d]{3,80}?)\s+\.?\s*\.{2,}?\s*(\d{1,4})\s*$"),
    re.compile(r"^\s*(?:Chapter\s+)?(\d{1,3})[\.:]?\s+([A-Z][A-Za-z][^\d]{3,80}?)\s{2,}(\d{1,4})\s*$"),
    re.compile(r"^\s*(?:Chapter\s+)?(\d{1,3})\s+([A-Z][A-Za-z][^\d]{3,80}?),?\s+(\d{1,4})\s*$"),
]


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _extract_pdf_pages(pdf: Path, first: int, last: int) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(first), "-l", str(last),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=30,
        )
        return out.stdout if out.returncode == 0 else ""
    except subprocess.SubprocessError:
        return ""


def _parse_toc_block(toc_text: str) -> list[dict]:
    entries: list[dict] = []
    seen: set[int] = set()
    for line in toc_text.split("\n"):
        for pat in TOC_LINE_RES:
            m = pat.match(line)
            if not m:
                continue
            try:
                num = int(m.group(1))
                page = int(m.group(3))
            except ValueError:
                continue
            if num in seen:
                continue
            seen.add(num)
            entries.append({
                "chapter_number": num,
                "title": m.group(2).strip().rstrip(".,;:"),
                "page": page,
            })
            break
    return entries


def extract(citekey: str, max_toc_pages: int = 30) -> dict:
    library = _resolve_library_root()
    pdf_path = library / "papers" / citekey / f"{citekey}.pdf"
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}", "entries": []}
    head = _extract_pdf_pages(pdf_path, 1, max_toc_pages)
    if not head:
        return {"error": "pdftotext failed or empty", "entries": []}
    # Find the CONTENTS marker, take the region from there to the next
    # page break that isn't followed by more TOC lines.
    cm = CONTENTS_HEAD_RE.search(head)
    if not cm:
        # No explicit heading — try parsing the whole region anyway.
        entries = _parse_toc_block(head)
    else:
        entries = _parse_toc_block(head[cm.end():])
    # Sort entries by chapter number for sanity.
    entries.sort(key=lambda e: e["chapter_number"])
    return {"entries": entries}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract a structured Table of Contents from a book PDF.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--max-toc-pages", type=int, default=30)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    result = extract(args.citekey, args.max_toc_pages)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    payload = json.dumps(result["entries"], indent=2)
    if args.out:
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
        print(f"Wrote {len(result['entries'])} TOC entries to {args.out}.")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
