"""Detect post-article journal-volume Table-of-Contents pages in
`main.tex`.

Annual Reviews and similar journal PDFs commonly include the
volume's TOC AFTER the article body (different failure mode than
multi-article interleaving, which `detect_multi_article.py` handles).
After extraction, this TOC sits as a run of `\\subsubsection{}` /
short-paragraph blocks each with `Author Author … <page-number>`
form, after the bibliography.

This script:

1. Locates the References section.
2. Scans the text after References for ≥ 4 consecutive paragraph-leading
   `\\subsubsection{}` calls each followed by an `Author Author …
   <page>` pattern.
3. Returns the line range to delete (caller decides whether to
   apply).

(kriegeskorte memo.)

Usage:
    python3 detect_journal_toc.py <main.tex>
        [--strip] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REFS_HEAD_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited)\b",
    re.M | re.I,
)
SUBSUB_RE = re.compile(r"^\\subsubsection\{([^}]+)\}", re.M)
TOC_AUTHOR_LINE_RE = re.compile(
    r"^\s*[A-Z][a-zA-Z\-' ]+[,\s][A-Z][a-zA-Z\-' ]+.*?(\d{1,4})\s*$",
    re.M,
)


def detect(text: str) -> tuple[int, int] | None:
    """Return (start, end) char range of the TOC block, or None."""
    refs_m = REFS_HEAD_RE.search(text)
    if not refs_m:
        return None
    tail = text[refs_m.end():]
    # Find consecutive \subsubsection{} calls in the tail. We want a
    # run of at least 4 with associated TOC-author lines.
    subsubs = list(SUBSUB_RE.finditer(tail))
    if len(subsubs) < 4:
        return None
    # Check each subsubsection's following 6 lines for a TOC-author-line
    # pattern.
    runs: list[list[re.Match]] = []
    current: list[re.Match] = []
    for ss in subsubs:
        end = ss.end()
        following = tail[end:end + 400]
        if TOC_AUTHOR_LINE_RE.search(following):
            current.append(ss)
        else:
            if len(current) >= 4:
                runs.append(current)
            current = []
    if len(current) >= 4:
        runs.append(current)
    if not runs:
        return None
    run = runs[0]
    start = refs_m.end() + run[0].start()
    end = refs_m.end() + run[-1].end()
    # Extend `end` to next \section{} or end of text.
    next_section = re.search(r"\\section\{", tail[run[-1].end():])
    if next_section:
        end = refs_m.end() + run[-1].end() + next_section.start()
    else:
        end = len(text)
    return start, end


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect post-article journal-volume TOC block.",
    )
    parser.add_argument("tex")
    parser.add_argument("--strip", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    span = detect(text)
    if span is None:
        print(f"No journal-volume TOC detected in {p}.")
        return 0
    start, end = span
    line_start = text[:start].count("\n") + 1
    line_end = text[:end].count("\n") + 1
    print(
        f"Detected TOC block: lines {line_start}-{line_end} "
        f"({end - start} chars)."
    )
    if args.strip:
        new_text = text[:start] + text[end:]
        if not args.dry_run:
            p.write_text(new_text, encoding="utf-8")
        suffix = " (dry run)" if args.dry_run else ""
        print(f"Stripped TOC block{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
