"""Promote inline section labels to `\\section{}` / `\\subsection{}`.

Many journal/venue styles emit section headings as inline labels in
the body text rather than as styled headings the extractor can
recognize. After extraction these look like ordinary paragraphs
starting with a numbered all-caps label:

  - LSA (Language journal): `1. INTRODUCTION.`, `2.1. METHODS.`
  - JoP (Journal of Philosophy): `i.`, `ii.`, `iii.`
  - Wiley / Cognitive Science: `1. Introduction.`, `2.1. Methods.`

This script promotes these labels to proper LaTeX section commands,
with depth derived from the label's dot count:

  - `^1.` → `\\section{Title}` (no leading number — LaTeX auto-numbers)
  - `^1.1.` → `\\subsection{Title}`
  - `^1.1.1.` → `\\subsubsection{Title}`
  - `^i.` (JoP style) → `\\section{Title}`
  - `^ii.` → `\\section{Title}`

Title-cases all-caps text where the source rendered uppercase.

(clark, fan, decarlo, lande memos.)

Usage:
    python3 promote_inline_section_labels.py <main.tex>
        [--style=default|jp|wiley] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


# Numbered label: `1.` / `2.1.` / `3.1.2.` followed by an all-caps
# (or title-case) title, terminated by a period and the next sentence.
# Match must start at line-start so we don't promote body prose.
LABEL_NUMERIC_RE = re.compile(
    r"^([0-9]+(?:\.[0-9]+){0,2})\.\s+([A-Z][A-Z \-']{3,40}[A-Z])\.\s+(?=[A-Z])",
    re.M,
)
LABEL_NUMERIC_TITLECASE_RE = re.compile(
    r"^([0-9]+(?:\.[0-9]+){0,2})\.\s+([A-Z][a-zA-Z \-']{3,60})\.\s+(?=[A-Z])",
    re.M,
)
# JoP-style lowercase Roman: `i.`, `ii.`, `iii.`, `iv.`, `v.`, ...
LABEL_ROMAN_LOWER_RE = re.compile(
    r"^([ivxl]+)\.\s+([A-Z][A-Za-z \-']{3,60})\.\s+(?=[A-Z])",
    re.M,
)


def _title_case_all_caps(s: str) -> str:
    """Convert `INTRODUCTION` → `Introduction`. Preserve mixed-case."""
    if s == s.upper() and any(c.isalpha() for c in s):
        small_words = {"of", "in", "on", "at", "by", "and", "or", "the", "a", "an", "to", "for", "with"}
        out_words = []
        for i, w in enumerate(s.split()):
            lw = w.lower()
            if i > 0 and lw in small_words:
                out_words.append(lw)
            else:
                out_words.append(lw.capitalize())
        return " ".join(out_words)
    return s


def _depth_for_numeric(label: str) -> str:
    dots = label.count(".")
    if dots == 0:
        return "section"
    if dots == 1:
        return "subsection"
    return "subsubsection"


def promote(
    text: str, style: str = "default",
) -> tuple[str, int]:
    """Returns (new_text, count_promoted)."""
    count = 0

    def numeric_replace(m: re.Match, title_re_groups: int) -> str:
        nonlocal count
        label = m.group(1)
        title = _title_case_all_caps(m.group(2))
        depth = _depth_for_numeric(label)
        count += 1
        return f"\\{depth}{{{title}}}\n\n"

    new_text = LABEL_NUMERIC_RE.sub(
        lambda m: numeric_replace(m, 2), text,
    )
    # Title-case variant (Cognitive Science / Wiley style).
    if style in ("default", "wiley"):
        new_text = LABEL_NUMERIC_TITLECASE_RE.sub(
            lambda m: numeric_replace(m, 2), new_text,
        )

    # JoP-style lowercase Roman.
    if style in ("default", "jp"):
        def roman_replace(m: re.Match) -> str:
            nonlocal count
            title = _title_case_all_caps(m.group(2))
            count += 1
            return f"\\section{{{title}}}\n\n"

        new_text = LABEL_ROMAN_LOWER_RE.sub(roman_replace, new_text)

    return new_text, count


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Promote inline section labels to LaTeX section commands.",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--style",
        default="default",
        choices=["default", "jp", "wiley"],
        help="`jp` enables lowercase Roman; `wiley` enables title-case.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, count = promote(text, args.style)
    if count == 0:
        print(f"No inline section labels promoted in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Promoted {count} inline section labels (style={args.style}){suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
