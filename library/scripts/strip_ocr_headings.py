"""Bulk-strip OCR-promoted-paragraph `\\subsection{}` / `\\subsubsection{}`
calls in scanned books.

When the extractor for an OCR'd book promotes paragraphs to headings
(via font-size heuristics that misfire on scanned-OCR variable
weights), the result is hundreds of `\\subsection{<body sentence>}`
calls littering the document. Per-heading AI triage is intractable
at scale.

This script detects the bulk-corruption regime by:

1. Counting `\\subsection` / `\\subsubsection` calls.
2. If > `--subsection-threshold` (default 100) AND > `--lowercase-ratio`
   (default 0.30) contain primarily lowercase content (or end without
   sentence-terminal punctuation), the bulk-corruption regime is
   active.
3. In bulk mode, unwrap every `\\subsection{X}` / `\\subsubsection{X}`
   whose argument matches any of:
   - > `--max-arg-chars` (default 50) characters
   - low letter-ratio (< 60% letters, > 20% punctuation)
   - mid-sentence punctuation (interior comma/semicolon/period+space)
   - starts with lowercase
   - all numeric / math-symbol
4. Leaves bona-fide headings intact.

Should run before `deep_preprocess.py`'s paragraph joiner so the
recovered prose flows correctly.

(fodor, dretske memos.)

Usage:
    python3 strip_ocr_headings.py <main.tex>
        [--subsection-threshold 100] [--lowercase-ratio 0.30]
        [--max-arg-chars 50] [--force-bulk] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SUBSEC_RE = re.compile(
    r"\\(subsection|subsubsection)\{([^}]+)\}"
)


def _looks_like_garbage_heading(arg: str, max_arg_chars: int) -> bool:
    if len(arg) > max_arg_chars:
        return True
    if not arg:
        return True
    letters = sum(1 for c in arg if c.isalpha())
    total = len(arg)
    letter_ratio = letters / max(1, total)
    punct = sum(1 for c in arg if c in ",.;:!?()/[]{}+*=&%$@<>|\\")
    punct_ratio = punct / max(1, total)
    if letter_ratio < 0.6 or punct_ratio > 0.2:
        return True
    # Starts with lowercase (not a stylistic choice — almost always
    # body prose).
    if arg[0].islower():
        return True
    # Mid-sentence punctuation: comma / semicolon / period+space
    # interior to the argument.
    if re.search(r"[,;]\s+\w", arg):
        return True
    if re.search(r"\.\s+[A-Z]", arg):
        return True
    # All-numeric / pure punctuation.
    if not re.search(r"[A-Za-z]", arg):
        return True
    return False


def _bulk_corruption_detected(
    text: str,
    subsection_threshold: int,
    lowercase_ratio: float,
) -> bool:
    matches = list(SUBSEC_RE.finditer(text))
    if len(matches) < subsection_threshold:
        return False
    lowercase_count = sum(
        1 for m in matches
        if m.group(2) and not m.group(2)[0].isupper()
    )
    return lowercase_count / len(matches) >= lowercase_ratio


def strip(
    text: str,
    subsection_threshold: int = 100,
    lowercase_ratio: float = 0.30,
    max_arg_chars: int = 50,
    force_bulk: bool = False,
) -> tuple[str, int]:
    """Returns (new_text, count_unwrapped)."""
    if not force_bulk and not _bulk_corruption_detected(
        text, subsection_threshold, lowercase_ratio,
    ):
        return text, 0

    def replace(m: re.Match) -> str:
        arg = m.group(2)
        if _looks_like_garbage_heading(arg, max_arg_chars):
            return arg
        return m.group(0)

    new_text, _ = SUBSEC_RE.subn(replace, text)
    # Count how many were actually unwrapped.
    new_matches = list(SUBSEC_RE.finditer(new_text))
    return new_text, len(SUBSEC_RE.findall(text)) - len(new_matches)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-strip OCR-promoted-paragraph subsection headings.",
    )
    parser.add_argument("tex")
    parser.add_argument("--subsection-threshold", type=int, default=100)
    parser.add_argument("--lowercase-ratio", type=float, default=0.30)
    parser.add_argument("--max-arg-chars", type=int, default=50)
    parser.add_argument("--force-bulk", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, count = strip(
        text,
        args.subsection_threshold,
        args.lowercase_ratio,
        args.max_arg_chars,
        args.force_bulk,
    )
    if count == 0:
        print(f"No bulk-corruption regime detected in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Unwrapped {count} OCR-promoted-paragraph headings{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
