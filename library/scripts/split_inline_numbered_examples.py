"""Pre-pass for bulk_convert_numbered_examples.py: hoist inline
mid-paragraph numbered examples onto their own paragraphs.

Linguistics / formal-semantics papers sometimes interleave numbered
examples with body prose:

    ...thus the formula (2) σ31 satisfies P31 only if x ∈ G is true...

`bulk_convert_numbered_examples.py` only detects paragraph-leading
`^(\\d+)\\s+` examples; the inline form above slips through. This
script detects mid-paragraph `(\\d+)\\s+[A-Z]` boundaries and splits
the paragraph so the converter sees one example per paragraph.

(abusch2013applying memo. Distinct from the formula-density work in
`mathify_formal_semantics.py` — that handles the math glyphs once the
example is in its own block.)

Guards:

- Skip if the `(N)` sits inside `\\cite{...}`, `\\section{...}`, math
  span (`$...$`), or another protected command. Reuses the same
  protected-command list as reattach_leaked_footnotes.py.
- Skip if the `(N)` is preceded by a hyphen / number / decimal point
  (e.g., `the value (2) above`) — only hoist when the surrounding text
  reads as a citation-to-an-example.
- Skip the References / Bibliography section entirely.

Idempotent: re-runs detect already-isolated `^(N)` paragraphs and
no-op.

Usage:
    python3 split_inline_numbered_examples.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


# Inline `(N)` preceded by non-paragraph-start, followed by capitalized
# word (the start of the example body). The lookbehind ensures we're
# inside a paragraph, not at the start of one.
INLINE_EX_RE = re.compile(
    r"(?<=[A-Za-z,;:.\?\!])\s+\((\d{1,3})\)\s+(?=[A-Z\\])",
)
REFS_SECTION_RE = re.compile(
    r"^\\section\*?\{(References|Bibliography|Works Cited)\b",
    re.M | re.I,
)
PROTECTED_CMDS = ("cite", "citet", "citep", "section", "subsection",
                  "subsubsection", "title", "author", "textbf", "textit",
                  "emph", "ref", "label", "pgmark", "footnote")


def _in_math_span(text: str, pos: int) -> bool:
    """Return True if `pos` falls inside `$...$` or `\\[...\\]`."""
    # Count $ before pos that aren't escaped.
    dollars = 0
    i = 0
    while i < pos:
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            i += 2
            continue
        if ch == "$":
            dollars += 1
        i += 1
    if dollars % 2 == 1:
        return True
    # Display math: walk back to nearest \[ or \] and check pairing.
    last_open = text.rfind("\\[", 0, pos)
    last_close = text.rfind("\\]", 0, pos)
    if last_open > last_close:
        return True
    return False


def _in_protected_arg(text: str, pos: int) -> bool:
    """Return True if pos is inside the brace argument of a protected
    command. Conservative window of 400 chars back."""
    head = text[max(0, pos - 400):pos]
    depth = 0
    i = len(head) - 1
    while i >= 0:
        if head[i] == "}":
            depth += 1
        elif head[i] == "{":
            depth -= 1
            if depth < 0:
                j = i - 1
                while j >= 0 and head[j].isalpha():
                    j -= 1
                if j >= 0 and head[j] == "\\":
                    cmd = head[j + 1:i]
                    if cmd in PROTECTED_CMDS:
                        return True
                return False
        i -= 1
    return False


def split_inline_examples(text: str) -> tuple[str, int]:
    """Return (new-text, count-of-splits)."""
    refs_match = REFS_SECTION_RE.search(text)
    body_end = refs_match.start() if refs_match else len(text)

    # Collect split positions from end-to-start so insertions don't
    # shift earlier offsets.
    splits: list[int] = []
    for m in INLINE_EX_RE.finditer(text, 0, body_end):
        pos = m.start()
        if _in_math_span(text, pos):
            continue
        if _in_protected_arg(text, pos):
            continue
        splits.append(pos)
    if not splits:
        return text, 0

    out = text
    for pos in reversed(splits):
        # Insert a paragraph break (`\n\n`) at the start of the match.
        # The `(N)` and surrounding whitespace are preserved.
        out = out[:pos] + "\n\n" + out[pos + 1:]  # +1 to consume the whitespace char
    return out, len(splits)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("texfile")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = Path(args.texfile)
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, n = split_inline_examples(text)
    suffix = " (dry run)" if args.dry_run else ""
    if n == 0:
        print(f"{path}: no inline numbered examples found{suffix}.")
    else:
        print(f"{path}: hoisted {n} inline numbered example(s){suffix}.")
    if not args.dry_run and n > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
