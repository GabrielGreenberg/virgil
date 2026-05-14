"""Auto-replace italic `I` and `l` and `O` with `1`, `1`, and `0` in
year / page-range contexts.

1980s journal PDFs systematically mis-render italic numerals — the
font's `1` is visually identical to italic-serif `I` or `l`, and OCR
returns the letter form. This produces year tokens like `I960` or
`l987`, and page ranges like `28I-95`.

This script applies the substitution only in contexts that
unambiguously expect a digit:

- 4-digit year shape: `\\bI[0-9]{3}\\b` → `1...`
- Mid-string page-range: `\\bI[0-9]+--[0-9]+\\b` → `1...`
- After `pp\\.\\s+`: `(?:I|l)[0-9]+` → `1...`
- Inside parenthesized year: `\\((?:I|l)[0-9]{3}\\)` → `(1...)`
- `O` for `0` only in 4-digit year context: `\\bIOO0\\b` style.

Idempotent: clean input is a no-op.

(neander memo.)

Usage:
    python3 fix_italic_numerals.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SUBSTITUTIONS: list[tuple[re.Pattern, str]] = [
    # 4-digit year starting with `I`/`l`: e.g. `I960` → `1960`.
    (re.compile(r"\b[Il]([0-9]{3})\b"), r"1\1"),
    # 4-digit year with leading `I` followed by `O` and digits.
    (re.compile(r"\b[Il]O([0-9]{2})\b"), r"10\1"),
    # Page range with leading `I`: e.g. `I23--I45` (rare but possible).
    (re.compile(r"\b[Il]([0-9]+)--[Il]?([0-9]+)\b"), r"1\1--1\2"),
    # Bare page range with `I` substituted only on first digit.
    (re.compile(r"(?<=\bp\.\s)[Il]([0-9]+)"), r"1\1"),
    (re.compile(r"(?<=\bpp\.\s)[Il]([0-9]+)"), r"1\1"),
    # Parenthesized year (`(I960)` → `(1960)`).
    (re.compile(r"\(\s*[Il]([0-9]{3})\s*\)"), r"(1\1)"),
]


def fix(text: str) -> tuple[str, int]:
    """Returns (new_text, count_replacements_made)."""
    total = 0
    new_text = text
    for pat, repl in SUBSTITUTIONS:
        new_text, n = pat.subn(repl, new_text)
        total += n
    return new_text, total


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replace italic-OCR I/l/O with digits in year/page contexts.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = fix(text)
    if n == 0:
        print(f"No italic-numeral substitutions in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Made {n} italic-numeral substitutions{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
