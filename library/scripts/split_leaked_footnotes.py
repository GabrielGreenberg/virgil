"""Pre-pass to `reattach_leaked_footnotes.py`: split glued / OCR-jammed
footnote-body paragraphs into separate paragraphs so the main
reattacher's `^N <body>` pattern matches each one.

Two transformations:

1. **Missing separator after leading digit.** OCR'd dissertations
   (Stanford 1994 style, etc.) commonly emit `^Nbody...` with no
   space between the footnote number and the body's first capital
   letter. The reattacher's canonical pattern `^N[.\\s]+[A-Z]` fails.
   This pass inserts a space, turning `^Nbody` into `^N body`.

2. **Glued multi-footnote paragraphs.** When the extractor
   concatenates several footnote bodies into one paragraph (column
   text + paragraph-joiner), the result is `^N body1. M body2. K
   body3.` where N, M, K are monotonically ascending. This pass
   splits at each `[\\.!?]\\s+(\\d{1,3})([A-Z\"'])` boundary that
   passes a monotonic-ordinal check.

Both transformations are conservative: numbers must fall in 1–200,
the next-number check enforces `prev_n + 1 <= n <= prev_n + 50` (a
small jump for missing intermediate footnotes), and we only operate
in regions outside the References / Bibliography sections.

Idempotent: clean input is a no-op.

(leong, lande, shin, clark memos.)

Usage:
    python3 split_leaked_footnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REFS_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)
LEADING_DIGIT_NO_SEP_RE = re.compile(
    r"^(\d{1,3})([A-Z\"'“‘])",
    re.M,
)
GLUED_FN_RE = re.compile(
    r"([\.!?])\s+(\d{1,3})([A-Z\"'“‘])"
)
PARAGRAPH_START_NUM_RE = re.compile(r"^(\d{1,3})[\.\s]+[A-Z]", re.M)


def _body_range(text: str) -> tuple[int, int]:
    """Return (body_start, body_end) excluding back-matter."""
    refs_m = REFS_RE.search(text)
    body_end = refs_m.start() if refs_m else len(text)
    # Body start: after \maketitle or after \begin{document}.
    body_start = 0
    mt = text.find("\\maketitle")
    if mt > 0:
        body_start = mt + len("\\maketitle")
    else:
        bd = text.find("\\begin{document}")
        if bd > 0:
            body_start = bd + len("\\begin{document}")
    return body_start, body_end


def _split_paragraph(paragraph: str) -> list[str]:
    """Apply the two transformations to a single paragraph."""
    # First: insert space after leading-digit-without-separator.
    m = LEADING_DIGIT_NO_SEP_RE.match(paragraph)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 200:
            paragraph = f"{m.group(1)} {paragraph[m.end(1):]}"

    # Decide if this looks like a leaked-fn paragraph at all. If not,
    # don't apply the glued-split transformation.
    if not PARAGRAPH_START_NUM_RE.match(paragraph):
        return [paragraph]

    # Collect candidate split points in the paragraph body. We require
    # monotonic ordinals to firm up the heuristic.
    head_m = PARAGRAPH_START_NUM_RE.match(paragraph)
    if not head_m:
        return [paragraph]
    prev_n = int(head_m.group(1))
    splits: list[int] = []  # char positions where a new paragraph starts
    pos = head_m.end()
    while pos < len(paragraph):
        next_m = GLUED_FN_RE.search(paragraph, pos)
        if not next_m:
            break
        n = int(next_m.group(2))
        if prev_n < n <= prev_n + 50 and 1 <= n <= 200:
            # The split point is right before the digit.
            split_at = next_m.start() + len(next_m.group(1)) + 1
            # `+1` skips the whitespace; we keep the period attached to
            # the previous paragraph.
            splits.append(split_at)
            prev_n = n
        pos = next_m.end()

    if not splits:
        return [paragraph]

    pieces: list[str] = []
    prev = 0
    for s in splits:
        pieces.append(paragraph[prev:s].rstrip())
        prev = s
    pieces.append(paragraph[prev:].rstrip())
    # Re-apply leading-digit-without-separator insertion to each piece
    # produced by the split, since the original space-fix only ran on
    # the source paragraph's first leading digit.
    out: list[str] = []
    for piece in pieces:
        if not piece:
            continue
        m2 = LEADING_DIGIT_NO_SEP_RE.match(piece)
        if m2:
            n = int(m2.group(1))
            if 1 <= n <= 200:
                piece = f"{m2.group(1)} {piece[m2.end(1):]}"
        out.append(piece)
    return out


def split_paragraphs(text: str) -> tuple[str, int, int]:
    """Returns (new_text, paragraphs_split, separators_inserted)."""
    body_start, body_end = _body_range(text)
    head = text[:body_start]
    body = text[body_start:body_end]
    tail = text[body_end:]

    paragraphs = re.split(r"(\n\s*\n)", body)  # keep separators in stream
    paragraphs_split = 0
    separators_inserted = 0
    out_pieces: list[str] = []
    for chunk in paragraphs:
        if re.match(r"^\n\s*\n$", chunk):
            out_pieces.append(chunk)
            continue
        original = chunk
        pieces = _split_paragraph(chunk)
        if len(pieces) > 1:
            paragraphs_split += len(pieces) - 1
            out_pieces.append("\n\n".join(pieces))
        else:
            single = pieces[0]
            if single != original:
                separators_inserted += 1
            out_pieces.append(single)
    return head + "".join(out_pieces) + tail, paragraphs_split, separators_inserted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pre-pass: split glued / no-separator leaked-fn paragraphs.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, splits, seps = split_paragraphs(text)
    if splits == 0 and seps == 0:
        print(f"No leaked-fn splits/separators needed in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Split {splits} glued-fn paragraphs; inserted {seps} missing "
        f"separators{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
