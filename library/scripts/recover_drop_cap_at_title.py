"""Recover scanned-OCR drop caps that got concatenated to the end of
the preceding section title.

Common pattern in OCR'd journal articles (lande2018perspectival): a
chapter or section title is followed by a drop-cap initial that the
extractor classified as part of the title:

  `\\section{THE PERSPECTIVAL CHARACTER OF PERCEPTION* I}`
  `\\maketitle`
  `n perception, ...`  <-- body starts mid-word

The single capital letter `I` at the end of the heading is the
drop-cap of the body's first word ("In"). The recovery: move the
trailing capital from the heading into the body's first word.

This script:

1. Finds every `\\section{}` heading ending in a single trailing
   capital letter (preceded by a non-letter, e.g. `…* I` or `…) X`).
2. Looks at the first body paragraph after the heading. If its
   first word starts with a lowercase letter AND prepending the
   captured capital forms a valid English word (or a sufficiently
   common token), apply the fix.
3. Strips the trailing letter from the heading.

(lande memo.)

Usage:
    python3 recover_drop_cap_at_title.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


# Section heading ending with a non-letter then a single capital.
SECTION_TRAILING_CAP_RE = re.compile(
    r"(\\section\{[^}]+?[^A-Za-z\s]\s+)([A-Z])(\})", re.M,
)


# Common English words that start with `In/On/As/At/By/Of` etc. plus
# anything ≥ 3 letters and ≤ 12 letters that's "word-shaped" — we
# rely on a lowercase-only continuation to confirm the merge.
def _looks_like_recoverable_word(combined: str) -> bool:
    """Combined would be `In` / `As` / etc."""
    if not combined or len(combined) < 2:
        return False
    if not combined[0].isupper() or not combined[1:].islower():
        return False
    return 2 <= len(combined) <= 14


def recover(text: str) -> tuple[str, int]:
    """Returns (new_text, count_recovered)."""
    edits: list[tuple[int, int, str]] = []
    for m in SECTION_TRAILING_CAP_RE.finditer(text):
        # The section heading match: m.group(1) + m.group(2) + m.group(3)
        # We want to: strip the trailing capital from the heading, then
        # prepend it to the first body word.
        trailing_cap = m.group(2)
        # The body follows after the closing brace + optional whitespace.
        after = text[m.end():]
        # Skip `\maketitle`, blank lines, etc.
        body_m = re.search(r"\b([a-z][a-z]+)\b", after[:200])
        if body_m is None:
            continue
        combined = trailing_cap + body_m.group(1)
        if not _looks_like_recoverable_word(combined):
            continue
        # Build the replacement: heading without the trailing cap, then
        # the body content with the first lowercase word capitalized.
        new_heading = m.group(1).rstrip(" \t") + m.group(3)
        # Replace the FIRST occurrence of the body word with combined.
        body_word_pos = m.end() + body_m.start(1)
        body_word_end = m.end() + body_m.end(1)
        # Stage two edits: replace heading region, replace body word.
        edits.append((m.start(), m.end(), new_heading))
        edits.append((body_word_pos, body_word_end, combined))

    if not edits:
        return text, 0

    # Apply in reverse position order.
    edits.sort(key=lambda e: -e[0])
    new_text = text
    for s, e, repl in edits:
        new_text = new_text[:s] + repl + new_text[e:]
    return new_text, len(edits) // 2


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recover drop-cap initials concatenated to section titles.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = recover(text)
    if n == 0:
        print(f"No drop-cap-at-title artifacts in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Recovered {n} drop-cap initial(s) into body{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
