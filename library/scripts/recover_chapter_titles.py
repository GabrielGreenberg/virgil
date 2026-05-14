"""Recover chapter-opening display titles that pymupdf dropped.

When extracting OCR'd books with large display-text chapter
openings, pymupdf sometimes skips the chapter title entirely — the
body picks up at the second sentence of the chapter, with no
`\\section{}` heading for the chapter.

This script:

1. Walks every `\\pgmark{N}` immediately followed by a body block
   that lacks a preceding `\\section{}` heading.
2. Reads the corresponding PDF page (`pdftotext -layout`) and
   extracts the first 1-3 lines of body content — these typically
   contain the chapter's display title.
3. Inserts a `\\section{<recovered-title>}` heading at body scope
   right before the body block.

Conservative: only fires when the recovered text looks title-shaped
(short, capitalized, no body punctuation).

(zeki memo.)

Usage:
    python3 recover_chapter_titles.py <citekey> [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
SECTION_RE = re.compile(r"\\section\{", re.M)


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _pdf_page_text(pdf: Path, page: int) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return ""
        return out.stdout
    except subprocess.SubprocessError:
        return ""


def _looks_like_chapter_title(line: str) -> bool:
    s = line.strip()
    if not s or len(s) < 4 or len(s) > 100:
        return False
    if not s[0].isupper():
        return False
    # No mid-sentence punctuation.
    if re.search(r"[,;]\s+\w", s):
        return False
    if re.search(r"\.\s+[A-Z]", s):
        return False
    # Reject lines that are clearly body prose (long, end with period).
    if len(s) > 70 and s.rstrip().endswith("."):
        return False
    return True


def _extract_title(pdf_text: str) -> str | None:
    for line in pdf_text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.match(r"^\d+\s*$", s):
            continue
        if re.match(r"^Chapter\s+\d+\s*$", s, re.I):
            continue
        if re.match(r"^\d+\s+[A-Z][A-Za-z\s]+$", s):
            continue
        if _looks_like_chapter_title(s):
            return s
        # Stop after first non-title-shaped non-blank line.
        return None
    return None


def recover(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists() or not pdf_path.exists():
        return {"error": "main.tex or PDF not found"}
    text = tex_path.read_text(encoding="utf-8")

    edits: list[tuple[int, str]] = []
    for m in PGMARK_RE.finditer(text):
        pgmark_end = m.end()
        try:
            page = int(m.group(1))
        except ValueError:
            continue
        # Check if there's a \section{} heading within the next 500 chars.
        following = text[pgmark_end:pgmark_end + 500]
        if SECTION_RE.search(following):
            continue
        # Look for body block after pgmark.
        body_m = re.search(r"\n([A-Z][^\n]{50,})", following)
        if body_m is None:
            continue
        title = _extract_title(_pdf_page_text(pdf_path, page))
        if title is None:
            continue
        # Insert position: at the start of the body block.
        insert_pos = pgmark_end + body_m.start()
        edits.append((insert_pos, f"\\section{{{title}}}\n\n"))

    if not edits:
        return {"recovered": 0}

    edits.sort(key=lambda e: -e[0])
    new_text = text
    for pos, ins in edits:
        new_text = new_text[:pos] + ins + new_text[pos:]
    if not dry_run:
        tex_path.write_text(new_text, encoding="utf-8")
    return {"recovered": len(edits)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recover dropped chapter-opening display titles.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = recover(args.citekey, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Recovered {result['recovered']} chapter title(s){suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
