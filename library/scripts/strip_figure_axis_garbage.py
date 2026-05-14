"""Strip short single-token paragraphs (axis labels, layer names,
sub-letters) that precede a figure caption.

When pymupdf extracts a paper with embedded figures (especially
neuroscience / vision-science papers from Annual Reviews), each
figure's axis labels and panel-letter annotations come out as
separate short paragraphs in `main.tex`, scattered between body
prose and the figure caption.

This script:

1. Finds every `\\begin{quote}\\textit{Figure N(\\.\\d+)?\\b…}` figure
   caption marker.
2. Walks BACKWARD up to `--max-lookback` lines, removing each
   preceding "garbage" paragraph that matches:
   - ≤ 30 chars, AND
   - mostly non-alphabetic OR a single uppercase letter (`a`, `b`,
     `c`), single short token (`X`, `Y`), axis-label pattern (`0`,
     `10`, `100`), OR a 1-2 word layer name (`V1`, `V2`, `LGN`).
3. Stops at the first paragraph that's clearly body prose (≥ 50
   chars and ending in sentence-terminal punctuation).

(kriegeskorte memo.)

Usage:
    python3 strip_figure_axis_garbage.py <main.tex>
        [--max-lookback 12] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FIGURE_CAPTION_RE = re.compile(
    r"\\begin\{quote\}\s*\\textit\{Figure\s+\d+(?:\.\d+)?[^}]*\}"
)


def _is_garbage(para: str) -> bool:
    s = para.strip()
    if not s:
        return True
    if len(s) > 30:
        return False
    letters = sum(1 for c in s if c.isalpha())
    if letters == 0:
        return True
    if letters / max(1, len(s)) < 0.4:
        return True
    if re.match(r"^[a-z]\.?\s*$", s):
        return True
    if re.match(r"^[A-Z]\d?\.?\s*$", s):
        return True
    if re.match(r"^\d+\s*$", s):
        return True
    if len(s.split()) <= 2 and s.isupper():
        return True
    return False


def _is_body_prose(para: str) -> bool:
    s = para.strip()
    if len(s) < 50:
        return False
    return s.rstrip().endswith((".", "!", "?", ":", ";", ")"))


def strip(text: str, max_lookback: int = 12) -> tuple[str, int]:
    """Returns (new_text, paragraphs_stripped)."""
    # Identify figure-caption positions.
    captions = [m.start() for m in FIGURE_CAPTION_RE.finditer(text)]
    if not captions:
        return text, 0

    # Build a paragraph-position map.
    paragraphs: list[tuple[int, int]] = []  # (start, end)
    for m in re.finditer(r"[^\n]+(?:\n(?!\n)[^\n]*)*", text):
        paragraphs.append((m.start(), m.end()))

    delete_ranges: list[tuple[int, int]] = []
    for cap_pos in captions:
        # Find the paragraph containing the caption.
        cap_para_idx = next(
            (i for i, (s, e) in enumerate(paragraphs) if s <= cap_pos < e),
            None,
        )
        if cap_para_idx is None or cap_para_idx == 0:
            continue
        # Walk backward.
        looked = 0
        for i in range(cap_para_idx - 1, -1, -1):
            looked += 1
            if looked > max_lookback:
                break
            ps, pe = paragraphs[i]
            body = text[ps:pe]
            if _is_body_prose(body):
                break
            if _is_garbage(body):
                # Extend `pe` to include the trailing paragraph break.
                end = pe
                if end < len(text) and text[end:end + 2] == "\n\n":
                    end += 2
                delete_ranges.append((ps, end))
            else:
                break

    if not delete_ranges:
        return text, 0

    # Apply in reverse position so earlier ranges stay valid.
    delete_ranges = sorted(set(delete_ranges), reverse=True)
    new_text = text
    for s, e in delete_ranges:
        new_text = new_text[:s] + new_text[e:]
    return new_text, len(delete_ranges)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip figure axis-label garbage paragraphs.",
    )
    parser.add_argument("tex")
    parser.add_argument("--max-lookback", type=int, default=12)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = strip(text, args.max_lookback)
    if n == 0:
        print(f"No figure-axis garbage paragraphs in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Stripped {n} figure-axis garbage paragraph(s){suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
