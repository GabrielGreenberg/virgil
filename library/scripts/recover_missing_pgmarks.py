"""Recover missing `\\pgmark{N}` anchors for body pages the original
extraction missed.

A common /index-paper failure mode: the pgmark detector picks up only
the body pages where the printed-page-number footer is cleanly visible
in `pdftotext` output, and silently drops the front portion (often
pages 1-N where N is small) because of small-font footnote interference
with the header/footer detector.

This script:

1. Reads `main.tex` to find the lowest existing `\\pgmark{N}` (call it L).
2. Pins the PDF-page → printed-page offset by:
   a. Finding the PDF page on which the printed page-number footer
      shows "L" (via `pdftotext -layout`).
   b. Offset = pdf_page(L) - L.
3. For each printed page p in [1, L-1]:
   a. Run `pdftotext -layout` on PDF page p+offset.
   b. Extract the first ~8 words of body prose (skipping running headers,
      section headings, footnote-zone lines, page-number footers).
   c. Locate that prose in `main.tex` after the body-start position.
   d. Insert `\\pgmark{p}` immediately before it.

If a page's first body words can't be located in `main.tex`, the script
prints a diagnostic and skips it. Common reasons:
- The PDF page is a section title page (no body prose)
- The body prose is inside an existing `\\footnote{}` argument
- The page-break body fragment was silently dropped by the extractor
  (recover with `recover_page_break_fragments.py` first)

Usage:
    python3 recover_missing_pgmarks.py papers/<citekey>/main.tex papers/<citekey>/<citekey>.pdf
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


def get_page_text(pdf_path: Path, pdf_page: int) -> str:
    res = subprocess.run(
        ["pdftotext", "-layout", "-f", str(pdf_page), "-l", str(pdf_page),
         str(pdf_path), "-"],
        capture_output=True, text=True, check=True,
    )
    return res.stdout


def detect_offset(pdf_path: Path, target_printed: int, search_range: int = 30) -> int | None:
    """Find the PDF page on which the printed page-number footer = target_printed.

    Walks PDF pages target_printed-2 through target_printed + search_range,
    checking each for a line that's just `<target_printed>` (page-number
    footer). Returns the PDF page number, or None.
    """
    for pdf_page in range(max(1, target_printed), target_printed + search_range):
        try:
            text = get_page_text(pdf_path, pdf_page)
        except subprocess.CalledProcessError:
            return None
        for line in text.split("\n"):
            if line.strip() == str(target_printed):
                return pdf_page
    return None


def extract_first_body_words(page_text: str) -> str | None:
    """Extract the first ~8 words of body prose from a page's pdftotext output.

    Skips: running headers, section/subsection headings, footnote-zone
    lines (small integer alone + indented body), page-number footers.
    """
    lines = page_text.split("\n")
    body_lines = []
    in_footnote_zone = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Footnote-zone marker: small integer alone on line
        if re.fullmatch(r"\d{1,3}", stripped):
            if int(stripped) <= 200:
                in_footnote_zone = True
                continue

        # Indented continuation = part of footnote body
        if in_footnote_zone and line.startswith((" ", "\t")):
            continue
        else:
            # Page-number footer
            if re.fullmatch(r"\d{1,4}", stripped):
                continue
            in_footnote_zone = False

        # Skip section headings (all-caps with optional numeric/roman prefix)
        if re.fullmatch(r"(?:\d+|I|II|III|IV|V|VI|VII|VIII|IX|X)?\s*[A-Z][A-Z0-9 .,'\-:]+", stripped):
            letters = re.sub(r"[^a-zA-Z]", "", stripped)
            if letters and sum(c.isupper() for c in letters) / len(letters) > 0.85:
                continue

        body_lines.append(stripped)
        if len(" ".join(body_lines).split()) >= 12:
            break

    if not body_lines:
        return None

    words = " ".join(body_lines).split()
    return " ".join(words[:8])


def normalize_for_match(s: str) -> str:
    s = re.sub(r"[‘’']", "'", s)
    s = re.sub(r"[“”\"]", '"', s)
    s = re.sub(r"[—–]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def find_position_in_body(needle: str, haystack: str, start_search: int = 0) -> int | None:
    """Fuzzy match: increasing-length prefix, flexible whitespace, normalized punctuation."""
    needle = normalize_for_match(needle)
    haystack_norm = normalize_for_match(haystack)
    needle_words = needle.split()
    for n_words in [8, 7, 6, 5, 4]:
        if n_words > len(needle_words):
            continue
        prefix = " ".join(needle_words[:n_words])
        pattern = re.escape(prefix)
        pattern = re.sub(r"\\ ", r"\\s+", pattern)
        m = re.search(pattern, haystack_norm[start_search:])
        if m:
            return start_search + m.start()
    return None


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: recover_missing_pgmarks.py <main.tex> <pdf>", file=sys.stderr)
        return 2

    tex_path = Path(sys.argv[1])
    pdf_path = Path(sys.argv[2])

    tex = tex_path.read_text(encoding="utf-8")

    # Find the lowest existing \pgmark{N}
    pgmarks = sorted(set(int(m.group(1)) for m in re.finditer(r"\\pgmark(?:\[[a-zA-Z]+\])?\{(\d+)\}", tex)))
    if not pgmarks:
        print("ERROR: no existing pgmarks in main.tex; can't pin offset", file=sys.stderr)
        return 1
    lowest = pgmarks[0]
    if lowest == 1:
        print("No missing pgmarks before the lowest existing one — nothing to do.")
        return 0

    # Detect offset using the lowest existing pgmark as anchor
    pdf_page_of_lowest = detect_offset(pdf_path, lowest)
    if pdf_page_of_lowest is None:
        print(f"ERROR: can't find PDF page containing printed-page footer '{lowest}'", file=sys.stderr)
        return 1
    offset = pdf_page_of_lowest - lowest
    print(f"Offset: PDF page = printed page + {offset} (anchored on pgmark {lowest})")

    # Find body region: after the first \section heading (skipping front-matter sections
    # like \section{Contents} that aren't body chapters).
    # Heuristic: body starts at the FIRST \section that's followed within ~5 lines by
    # a paragraph of body prose (not another heading or itemize). For simplicity, we
    # accept the first \section after the lowest existing pgmark's position is wrong —
    # body-start is BEFORE the lowest pgmark. Instead, use the lowest existing pgmark's
    # position MINUS the body so far. Simpler: try matches from start of file forward.
    body_start = 0
    # Skip past front-matter sections (Contents, Preface)
    for heading in [r"\section{The enigma of depiction}", r"\section{Introduction}",
                    r"\section{Chapter 1}", r"\section{1"]:
        idx = tex.find(heading)
        if idx >= 0:
            body_start = idx
            break
    if body_start == 0:
        # Fallback: use position right after the first \section
        m = re.search(r"\\section\{[^}]+\}", tex)
        if m:
            body_start = m.start()

    body_end = re.search(r"\\pgmark\{" + str(lowest) + r"\}", tex)
    body_end = body_end.start() if body_end else len(tex)

    insertions: list[tuple[int, str]] = []
    cursor = body_start
    placed = []
    missing = []
    for printed_page in range(1, lowest):
        pdf_page = printed_page + offset
        try:
            page_text = get_page_text(pdf_path, pdf_page)
        except subprocess.CalledProcessError:
            missing.append(printed_page)
            continue

        first_words = extract_first_body_words(page_text)
        if not first_words:
            missing.append(printed_page)
            continue

        pos = find_position_in_body(first_words, tex[:body_end], cursor)
        if pos is None:
            missing.append(printed_page)
            continue

        pgmark_text = f"\n\\pgmark{{{printed_page}}}\n"
        insertions.append((pos, pgmark_text))
        cursor = pos + 1

    insertions.sort(key=lambda x: -x[0])
    new_tex = tex
    for pos, text in insertions:
        new_tex = new_tex[:pos] + text + new_tex[pos:]
        placed.append(int(re.search(r"\\pgmark\{(\d+)\}", text).group(1)))

    if insertions:
        tex_path.write_text(new_tex, encoding="utf-8")
    print(f"Restored {len(insertions)} pgmarks (printed pages {sorted(placed)}).")
    if missing:
        print(f"Couldn't auto-place: {sorted(missing)}")
        print("These typically need manual placement: page may be a title page, the")
        print("call site may be inside a \\footnote{}, or the body fragment may have")
        print("been dropped by the extractor (try recover_page_break_fragments.py first).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
