"""Detect and repair `\\footnote{...}` insertions that landed inside
`\\cite{...}` / `\\citet{...}` / etc. brace arguments.

This is a safety net for `reattach_leaked_footnotes.py`. Even with
the citation-argument guard, brace-imbalance from OCR or from
earlier passes can produce a state where a footnote is nested inside
a citation key. The natbib parser then either silently includes the
footnote body in the cite key (breaking lookup) or errors out at
compile time.

This script:

1. Finds every `\\footnote{...}` whose start position is inside the
   brace argument of a `\\cite`-family command.
2. Extracts the footnote (body + braces) out to body scope, inserting
   it right after the citation's closing brace.
3. Reports the affected sites and citekeys.

(davidson, willats memos.)

Usage:
    python3 fix_footnote_in_citation_args.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


CITE_FAMILY = (
    "cite", "citet", "citep", "citealp", "citealt", "citeauthor",
    "citeyear", "citeyearpar",
)
FOOTNOTE_OPEN_RE = re.compile(r"\\footnote\{")
CITE_OPEN_RE = re.compile(rf"\\(?:{'|'.join(CITE_FAMILY)})(?:\[[^\]]*\])?\{{")


def _matching_close(text: str, open_pos: int) -> int:
    depth = 1
    i = open_pos + 1
    while i < len(text) and depth > 0:
        c = text[i]
        if c == "\\" and i + 1 < len(text):
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def find_nested_footnotes(text: str) -> list[tuple[int, int, int, int]]:
    """Return list of (cite_open, cite_close, fn_open, fn_end) where
    `fn_open` is the position of `\\footnote{` and the footnote is
    fully inside the cite's brace argument."""
    out: list[tuple[int, int, int, int]] = []
    for cm in CITE_OPEN_RE.finditer(text):
        cite_open = cm.end() - 1  # the `{`
        cite_close = _matching_close(text, cite_open)
        if cite_close < 0:
            continue
        # Search for any \footnote{ that starts between cite_open+1 and
        # cite_close.
        for fm in FOOTNOTE_OPEN_RE.finditer(text, cite_open + 1, cite_close):
            fn_open = fm.start()
            fn_body_close = _matching_close(text, fm.end() - 1)
            if fn_body_close < 0 or fn_body_close > cite_close:
                continue
            out.append((cite_open, cite_close, fn_open, fn_body_close))
    return out


def repair(text: str) -> tuple[str, int]:
    """Lift each nested footnote out of its enclosing citation arg
    and place it right after the cite's `}`. Returns (new_text,
    count_repaired)."""
    nested = find_nested_footnotes(text)
    if not nested:
        return text, 0
    # Apply in reverse so offsets stay valid.
    new_text = text
    repaired = 0
    # Group by cite_close so a cite with multiple nested footnotes is
    # handled coherently: we collect all footnotes from one cite,
    # remove them in reverse, then insert them after the cite's `}`.
    by_cite: dict[int, list[tuple[int, int]]] = {}
    for cite_open, cite_close, fn_open, fn_end in nested:
        by_cite.setdefault(cite_close, []).append((fn_open, fn_end))

    for cite_close in sorted(by_cite.keys(), reverse=True):
        fns = sorted(by_cite[cite_close], reverse=True)
        extracted: list[str] = []
        for fn_open, fn_end in fns:
            # Slice the entire `\footnote{...}` including outer braces.
            full_end = fn_end + 1
            footnote_text = new_text[fn_open:full_end]
            extracted.append(footnote_text)
            # Remove from inside the citation.
            new_text = new_text[:fn_open] + new_text[full_end:]
            repaired += 1
            cite_close -= (full_end - fn_open)  # adjust cite_close
        # Insert the extracted footnotes after the cite's close `}`.
        insertion_pos = cite_close + 1
        insertion = "".join(reversed(extracted))
        new_text = (
            new_text[:insertion_pos] + insertion + new_text[insertion_pos:]
        )
    return new_text, repaired


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lift \\footnote{} out of \\cite{} brace args.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, count = repair(text)
    if count == 0:
        print(f"No nested \\footnote{{}}-in-\\cite{{}} in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Lifted {count} \\footnote{{}} out of cite args{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
