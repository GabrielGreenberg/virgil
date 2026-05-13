"""Recover dropped drop-cap initials in OCR'd chapter starts.

OCR commonly drops the styled drop-cap glyph at chapter starts,
leaving body text like `ower is the ability to do work...` (instead
of `Power is the ability...`). This script:

1. Walks `\\section{}` headings.
2. For each chapter, inspects the first body paragraph.
3. Detects a likely dropped drop-cap: first word starts with a
   lowercase letter, and prepending a capital letter would form a
   real English word (heuristic: try common prefixes A-Z and pick
   the one that yields a dictionary word).
4. Cross-checks with the PDF page via `pdftotext -layout` to find
   the actual missing letter.
5. Emits a patch list (one suggestion per drop-cap detected).

The patches are NOT auto-applied — they're emitted as edit
suggestions for the operator to apply via Edit (the call is
context-dependent and risk of false-positive is non-trivial).

Usage:
    python3 recover_drop_caps.py <paper-dir>

Output: prints a list of suggestions to stdout.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


SECTION_RE = re.compile(r"\\section\{([^}]+)\}", re.M)
PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
LOWERCASE_START_PARA_RE = re.compile(
    r"\\section\{[^}]+\}\s*(?:\\pgmark\{\d+\}\s*)?\n\n+([a-z][a-z]+)\b",
    re.M,
)


def get_page_text(pdf_path: Path, pdf_page: int) -> str:
    try:
        res = subprocess.run(
            ["pdftotext", "-layout", "-f", str(pdf_page), "-l", str(pdf_page),
             str(pdf_path), "-"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        return res.stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def detect_offset(pdf_path: Path, tex: str) -> int | None:
    pgmarks = [int(m.group(1)) for m in PGMARK_RE.finditer(tex)]
    if not pgmarks:
        return None
    target = min(pgmarks)
    for pdf_page in range(max(1, target), target + 30):
        text = get_page_text(pdf_path, pdf_page)
        for line in text.split("\n"):
            if line.strip() == str(target):
                return pdf_page - target
    return None


def find_chapter_first_pgmark(tex: str, section_pos: int) -> int | None:
    """Find the first pgmark after section_pos."""
    chunk = tex[section_pos:section_pos + 2000]
    m = PGMARK_RE.search(chunk)
    return int(m.group(1)) if m else None


def find_drop_cap_candidates(tex: str) -> list[tuple[str, int, str, int]]:
    """Find chapters where the first body word starts lowercase.

    Returns list of (chapter_title, position, lowercase_first_word,
    chapter_pgmark).
    """
    results = []
    for m in LOWERCASE_START_PARA_RE.finditer(tex):
        # Find the section title — look back from match start.
        section_start = tex.rfind(r"\section{", 0, m.start())
        if section_start == -1:
            continue
        section_match = SECTION_RE.match(tex[section_start:])
        if not section_match:
            continue
        title = section_match.group(1)
        word = m.group(1)
        pgmark = find_chapter_first_pgmark(tex, section_start)
        if pgmark is None:
            continue
        results.append((title, m.start(1), word, pgmark))
    return results


def recover_initial_letter(pdf_path: Path, pdf_page: int, word_tail: str) -> str | None:
    """Find the missing initial letter via PDF page inspection."""
    page_text = get_page_text(pdf_path, pdf_page)
    if not page_text:
        return None
    # Try prefixes A-Z + word_tail and see which appears in PDF text.
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        candidate = letter + word_tail
        if candidate in page_text:
            return letter
    # Case-insensitive fallback.
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        candidate = (letter + word_tail).lower()
        if candidate in page_text.lower():
            return letter
    return None


def recover_drop_caps(paper_dir: Path) -> dict:
    citekey = paper_dir.name
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists():
        return {"error": "main.tex not found", "suggestions": []}
    tex = tex_path.read_text(encoding="utf-8")
    if not pdf_path.exists():
        return {"error": "PDF not found; can't recover drop-cap from extraction-only", "suggestions": []}

    candidates = find_drop_cap_candidates(tex)
    if not candidates:
        return {"suggestions": []}

    offset = detect_offset(pdf_path, tex)
    if offset is None:
        return {"error": "could not detect PDF offset", "suggestions": []}

    suggestions = []
    for title, pos, word_tail, pgmark in candidates:
        pdf_page = pgmark + offset
        letter = recover_initial_letter(pdf_path, pdf_page, word_tail)
        if letter:
            suggestions.append({
                "chapter": title,
                "position": pos,
                "current": word_tail,
                "recovered": letter + word_tail,
                "letter": letter,
            })
    return {"suggestions": suggestions}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: recover_drop_caps.py <paper-dir>", file=sys.stderr)
        return 2
    paper_dir = Path(argv[1]).resolve()
    result = recover_drop_caps(paper_dir)
    if result.get("error"):
        print(f"error: {result['error']}", file=sys.stderr)
        if not result["suggestions"]:
            return 1
    if not result["suggestions"]:
        print(f"No drop-cap candidates detected in {paper_dir}.")
        return 0
    print(f"Found {len(result['suggestions'])} drop-cap recovery suggestions:")
    for s in result["suggestions"]:
        print(f"  Chapter {s['chapter']!r}: '{s['current']}' -> '{s['recovered']}'")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
