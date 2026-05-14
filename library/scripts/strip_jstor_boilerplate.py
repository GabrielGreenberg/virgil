"""Strip the JSTOR cover-page boilerplate from `main.tex`.

JSTOR PDFs prepend an 8-12-paragraph cover block with the article
title, author list, journal reference, DOI, stable URL, accessed
date, terms-of-use, and contact information. After extraction this
block sits at the top of the body and pollutes both the body text
and any title/author/date extraction.

Signature lines: "Author(s):", "Stable URL", "JSTOR is a not-for-profit",
"Terms and Conditions of Use", "Accessed:", "DOI: ".

This script:

1. Locates the body region (after `\\maketitle` / `\\begin{document}`).
2. Finds the first `\\pgmark{N}` whose `N >= 1` AND whose body context
   doesn't contain JSTOR signature lines.
3. Strips everything from body start up to that pgmark.

Should run as part of `/library/index-paper`, not deep-index, since
it changes extraction-level state.

(clark memo.)

Usage:
    python3 strip_jstor_boilerplate.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


JSTOR_SIGNATURES = (
    "Author(s):",
    "Stable URL",
    "JSTOR is a not-for-profit",
    "JSTOR is a digital library",
    "Terms and Conditions of Use",
    "Accessed:",
    "Your use of the JSTOR",
    "The Linguistic Society of America",
    "is collaborating with JSTOR",
)
PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def detect_and_strip(text: str) -> tuple[str, int]:
    """Returns (new_text, chars_stripped)."""
    body_start_m = re.search(r"\\maketitle|\\begin\{document\}", text)
    if not body_start_m:
        return text, 0
    body_start = body_start_m.end()

    # Quick check: does the body contain ANY JSTOR signature?
    body_head = text[body_start:body_start + 5000]
    if not any(sig in body_head for sig in JSTOR_SIGNATURES):
        return text, 0

    # Find the first pgmark after the cover block.
    # Heuristic: take the first pgmark whose preceding context doesn't
    # have a JSTOR signature, OR the first pgmark with N >= 5
    # (article body usually starts beyond cover page).
    for m in PGMARK_RE.finditer(text, body_start):
        ctx_lo = max(body_start, m.start() - 300)
        ctx = text[ctx_lo:m.start()]
        try:
            v = int(m.group(1))
        except ValueError:
            continue
        if any(sig in ctx for sig in JSTOR_SIGNATURES):
            continue
        if v >= 5 or not any(sig in body_head[:m.start() - body_start] for sig in JSTOR_SIGNATURES):
            cut_to = m.start()
            new_text = text[:body_start] + "\n\n" + text[cut_to:]
            return new_text, cut_to - body_start
    return text, 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip JSTOR cover-page boilerplate from main.tex.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = detect_and_strip(text)
    if n == 0:
        print(f"No JSTOR boilerplate detected in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Stripped {n} chars of JSTOR cover-page boilerplate{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
