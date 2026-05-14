"""Tier-0 sibling to `reattach_leaked_footnotes.py` for sources where
pymupdf preserved footnote bodies but converted call-site markers to
Unicode superscript digits.

Modern OUP / Cambridge / Springer extracts produce this pattern:

  - Body text: `...the magnitude¹ of...`
  - Footnote bodies (leaked as paragraphs): `¹ Magnitudes are said...`

The standard ASCII-digit reattacher misses both ends — the body
marker isn't an ASCII `1`, and the leak prefix `¹ ` isn't matched by
the canonical `^N[.\\s]+[A-Z]` pattern.

This script:

1. Finds paragraphs starting with a Unicode superscript-digit run.
2. For each, locates the matching superscript marker in the chapter's
   body, *replacing* the marker with `\\footnote{<body>}` (cleaner
   than appending, since the superscript was the rendered call site).
3. Removes the leaked paragraph.
4. Applies the same TOC-skip / citation-arg / pgmark-preservation
   guards as the ASCII reattacher.

(peacocke memo follow-up — promoted to a standalone script.)

Usage:
    python3 reattach_super_footnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SUPER_MAP = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
}
SUPER_RE = re.compile(r"[⁰¹²³⁴⁵⁶⁷⁸⁹]+")
LEAKED_SUPER_PARA_RE = re.compile(
    r"^([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s+([A-Z\"“‘][^\n]*(?:\n(?!\n)[^\n]*)*?)(?=\n\s*\n|\Z)",
    re.M,
)
SECTION_RE = re.compile(r"^\\section\{([^}]+)\}", re.M)
REFS_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)
PGMARK_LITERAL_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{\d+\}")
PROTECTED_CMDS = frozenset({
    "cite", "citet", "citep", "citealp", "citealt", "citeauthor",
    "citeyear", "citeyearpar", "section", "subsection", "subsubsection",
    "title", "author", "textbf", "textit", "emph", "ref", "label",
    "pgmark",
})


def _super_to_ascii(s: str) -> str:
    return "".join(SUPER_MAP.get(c, c) for c in s)


def _chapter_boundaries(text: str) -> list[tuple[int, int]]:
    sections = list(SECTION_RE.finditer(text))
    refs_match = REFS_RE.search(text)
    body_end = refs_match.start() if refs_match else len(text)
    boundaries: list[tuple[int, int]] = []
    if not sections:
        return [(0, body_end)]
    for i, m in enumerate(sections):
        if refs_match and m.start() >= refs_match.start():
            break
        start = m.start()
        end = sections[i + 1].start() if i + 1 < len(sections) else body_end
        if end > start:
            boundaries.append((start, end))
    return boundaries


def _position_in_protected_arg(text: str, pos: int) -> bool:
    depth = 0
    i = pos - 1
    while i >= 0:
        c = text[i]
        if c in "{}" and i > 0 and text[i - 1] == "\\":
            i -= 2
            continue
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                j = i - 1
                if j >= 0 and text[j] == "]":
                    k = j - 1
                    while k >= 0 and text[k] != "[":
                        k -= 1
                    if k >= 0:
                        j = k - 1
                end = j + 1
                while j >= 0 and (text[j].isalpha() or text[j] == "*"):
                    j -= 1
                if j >= 0 and text[j] == "\\":
                    cmd = text[j + 1:end].rstrip("*")
                    if cmd in PROTECTED_CMDS:
                        return True
                depth = 0
            else:
                depth -= 1
        i -= 1
    return False


def _find_super_call_site(
    text: str, super_run: str, chapter_start: int, leaked_start: int,
) -> tuple[int, int] | None:
    """Find the rightmost occurrence of `super_run` (an exact Unicode
    superscript string like `¹²`) in `text[chapter_start:leaked_start]`.
    Returns (start, end) of the matched superscript run, or None."""
    search = text[chapter_start:leaked_start]
    matches: list[tuple[int, int]] = []
    for m in SUPER_RE.finditer(search):
        if m.group(0) == super_run:
            matches.append((chapter_start + m.start(), chapter_start + m.end()))
    if not matches:
        return None
    # Rightmost is most likely the actual call site (closest to body).
    return matches[-1]


def reattach(text: str) -> tuple[str, dict]:
    chapters = _chapter_boundaries(text)
    if not chapters:
        return text, {"placed": 0, "unplaced": 0}

    insertions: list[tuple[int, int, str]] = []  # (replace_start, replace_end, new)
    deletions: list[tuple[int, int]] = []
    placed = 0
    unplaced = 0

    for cs, ce in chapters:
        chunk = text[cs:ce]
        for m in LEAKED_SUPER_PARA_RE.finditer(chunk):
            super_marker = m.group(1)
            body = m.group(2).strip()
            ascii_n = _super_to_ascii(super_marker)
            try:
                n = int(ascii_n)
            except ValueError:
                continue
            if not (1 <= n <= 999):
                continue
            if len(body) < 20:
                continue
            leaked_start = cs + m.start()
            site = _find_super_call_site(text, super_marker, cs, leaked_start)
            if site is None:
                unplaced += 1
                continue
            site_start, site_end = site
            if _position_in_protected_arg(text, site_start):
                unplaced += 1
                continue
            # Pgmark-preservation.
            pgmarks = PGMARK_LITERAL_RE.findall(body)
            cleaned_body = PGMARK_LITERAL_RE.sub("", body).strip()
            cleaned_body = re.sub(r"\s{2,}", " ", cleaned_body)
            footnote = f"\\footnote{{{cleaned_body}}}"
            if pgmarks:
                footnote += " " + " ".join(pgmarks)
            insertions.append((site_start, site_end, footnote))
            deletions.append((cs + m.start(), cs + m.end()))
            placed += 1

    # Apply both in reverse order, sorted by start position.
    combined: list[tuple[int, int, str]] = []
    for s, e, new in insertions:
        combined.append((s, e, new))
    for s, e in deletions:
        combined.append((s, e, ""))
    combined.sort(key=lambda x: -x[0])

    new_text = text
    for s, e, new in combined:
        new_text = new_text[:s] + new + new_text[e:]

    return new_text, {"placed": placed, "unplaced": unplaced}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Tier-0 reattacher for Unicode-superscript leaked footnotes.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, stats = reattach(text)
    if stats["placed"] == 0 and stats["unplaced"] == 0:
        print(f"No superscript-prefixed leaked paragraphs in {p}.")
        return 0
    if not args.dry_run and stats["placed"] > 0:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Reattached {stats['placed']} superscript leaked footnotes "
        f"({stats['unplaced']} unplaced){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
