"""Strip trailing printed-page numbers from \\footnote{...} bodies.

PDF footnote-zone extraction often leaves a printed page-number footer
glued onto the end of the last footnote body on a page:

    \\footnote{Body text. 27}    -> \\footnote{Body text.}

Detects: \\footnote{...} whose body ends with a sentence-terminator (or
closing brace/quote) followed by whitespace and 1-3 digits. Strips the
digits. Idempotent on already-clean input.

Usage:
    python3 clean_fn_trailing_pagenum.py papers/<citekey>/main.tex
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def clean(tex: str) -> tuple[str, int]:
    pattern = re.compile(
        r"\\footnote\{((?:[^{}]|\{[^{}]*\})*?)([\.\!\?\}\']\s*)(\d{1,3})\s*\}"
    )
    count = 0

    def _sub(m: "re.Match[str]") -> str:
        nonlocal count
        count += 1
        body = m.group(1) + m.group(2).rstrip()
        return f"\\footnote{{{body}}}"

    return pattern.sub(_sub, tex), count


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: clean_fn_trailing_pagenum.py <main.tex>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    tex = path.read_text(encoding="utf-8")
    new, count = clean(tex)
    if count:
        path.write_text(new, encoding="utf-8")
    print(f"Stripped {count} trailing page numbers from \\footnote{{}} bodies.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
