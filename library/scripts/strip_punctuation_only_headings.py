"""Strip `\\subsection{<arg>}` / `\\subsubsection{<arg>}` where the
argument is ≥80% non-alphabetic punctuation (`* *`, `**`, `Δ`, `+`,
`. .`, `· ·`, etc.).

These are usually figure significance markers or section dividers
that got extracted as headings. The fix: unwrap them to plain text.

(fan memo.)

Usage:
    python3 strip_punctuation_only_headings.py <main.tex>
        [--ratio 0.8] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


HEADING_RE = re.compile(
    r"\\(subsection|subsubsection|section)\{([^}]+)\}"
)


def _is_punctuation_only(arg: str, ratio: float) -> bool:
    if not arg:
        return True
    letters = sum(1 for c in arg if c.isalpha())
    if letters == 0:
        return True
    non_alpha = len(arg) - letters
    return non_alpha / max(1, len(arg)) >= ratio


def strip(text: str, ratio: float = 0.8) -> tuple[str, int]:
    """Returns (new_text, count_stripped)."""
    def replace(m: re.Match) -> str:
        arg = m.group(2)
        if _is_punctuation_only(arg, ratio):
            return arg
        return m.group(0)

    new_text, _ = HEADING_RE.subn(replace, text)
    # Count by diff.
    before = len(HEADING_RE.findall(text))
    after = len(HEADING_RE.findall(new_text))
    return new_text, before - after


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip punctuation-only headings.",
    )
    parser.add_argument("tex")
    parser.add_argument("--ratio", type=float, default=0.8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = strip(text, args.ratio)
    if n == 0:
        print(f"No punctuation-only headings in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Unwrapped {n} punctuation-only headings{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
