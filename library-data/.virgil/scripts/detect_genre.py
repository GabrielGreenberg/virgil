"""Fast genre detection for a paper folder.

Inspects main.tex (and PDF page count) and emits one of:

  - book             : multi-chapter monograph, \\section{} count high,
                       no `article`-class signals.
  - article          : single-paper article, typical journal layout.
  - multi-article-pdf: PDF contains content from more than one article
                       (JSTOR scans, Annual Reviews appended TOCs, etc.).
                       Heuristic flag — confirm via detect_multi_article.py.
  - scanned-ocr      : OCR'd source (ligatures, drop-caps signature).
  - endnote-style    : per-chapter end-notes section (\\section{Notes}
                       with `^1\\. <body>` paragraphs at chapter end).

Multiple labels can apply; we emit the most discriminating one. If
ambiguous, defaults to `article` (the most common case and the one
where the standard /deep-index path works without genre-specific
tooling).

Usage:
    python3 detect_genre.py <paper-dir>

Output: prints the genre label to stdout, one word. Exit 0 always.
"""
from __future__ import annotations

import re
import sys
import subprocess
from pathlib import Path


SECTION_RE = re.compile(r"^\\section\{[^}]*\}", re.M)
LEAKED_FN_RE = re.compile(r"^(\d{1,3})[.\s]+[A-Z]", re.M)
LIGATURE_CHARS = "ﬀﬁﬂﬃﬄﬅﬆ"
DROPCAP_LIKELY_RE = re.compile(r"\\subsubsection\{[a-z][a-z]+ [a-z]", re.M)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def pdf_page_count(pdf_path: Path) -> int:
    """Return PDF page count via pdfinfo, or 0 if not available."""
    if not pdf_path.exists():
        return 0
    try:
        res = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            capture_output=True, text=True, check=True, timeout=10,
        )
        for line in res.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return 0


def detect(paper_dir: Path) -> str:
    """Return a genre label. See module docstring for the set."""
    citekey = paper_dir.name
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"

    if not tex_path.exists():
        return "article"

    tex = read_text(tex_path)
    sections = SECTION_RE.findall(tex)
    section_count = len(sections)

    # Notes-section signature (endnote-style).
    has_notes_section = bool(re.search(
        r"\\section\{(Notes|Endnotes|Chapter Notes)\}",
        tex, re.I,
    ))
    # Find paragraphs at chapter-end that look like notes blocks.
    chapter_end_notes = 0
    chapters = list(SECTION_RE.finditer(tex))
    for i, m in enumerate(chapters):
        start = m.start()
        end = chapters[i + 1].start() if i + 1 < len(chapters) else len(tex)
        chunk = tex[start:end]
        # Last paragraph of the chunk starts with "1. ", "2. ", etc.?
        if re.search(r"\n\s*1\.\s+\S.{20,}\n\s*2\.\s+\S", chunk):
            chapter_end_notes += 1

    pages = pdf_page_count(pdf_path)
    big_doc = pages >= 150 or section_count >= 8

    # Scanned-OCR signature: ligature characters present, or chapter-start
    # paragraphs that look like dropped-drop-cap residues.
    ligature_count = sum(tex.count(c) for c in LIGATURE_CHARS)
    dropcap_count = len(DROPCAP_LIKELY_RE.findall(tex))
    is_scanned = ligature_count > 100 or dropcap_count >= 3

    # Multi-article detection: heuristic only. If the PDF is short (< 60
    # pages) but contains >1 standalone TOC sections, or two distinct
    # `\title{}`-like patterns in the body, flag it.
    title_count = len(re.findall(r"^([A-Z][A-Z\s]+)$", tex, re.M))
    has_multi_article_smell = (
        pages > 0 and pages < 60 and
        (title_count >= 2 or re.search(r"\nABSTRACT\s*\n.*\nABSTRACT\s*\n", tex, re.S))
    )

    # Endnote-style: notes section with paragraph-numbered bodies.
    if has_notes_section or chapter_end_notes >= 2:
        return "endnote-style"

    if has_multi_article_smell:
        return "multi-article-pdf"

    if is_scanned:
        return "scanned-ocr"

    if big_doc:
        return "book"

    return "article"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: detect_genre.py <paper-dir>", file=sys.stderr)
        return 2
    paper_dir = Path(argv[1]).resolve()
    if not paper_dir.is_dir():
        print(f"not a directory: {paper_dir}", file=sys.stderr)
        return 2
    print(detect(paper_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
