"""Consolidate margin-glossary term definitions into a single
glossary block.

Annual Reviews PDFs (and similar journal styles) put term
definitions in margin boxes that flow alongside the body text. After
pymupdf extraction, these become standalone paragraphs with shape
`^<TermName>: <definition>$` scattered through `main.tex` —
between body paragraphs, in the middle of sentences, etc.

This script:

1. Walks `main.tex` for standalone single-paragraph term-definition
   patterns: `^[A-Z][A-Za-z\\-]+:\\s+[A-Z]`. Conservative — the term
   must be capitalized and short (≤4 words), the line standalone,
   and the definition reasonably brief (≤200 chars).
2. Groups consecutive term-definition paragraphs into clusters.
3. Removes each cluster from its in-body position and emits a single
   `\\begin{quote}\\textbf{Margin glossary.} \\textbf{T1:} def1.
   \\textbf{T2:} def2. ... \\end{quote}` block placed at the start
   of the nearest enclosing `\\section{}` (or right after the
   section heading).

(kriegeskorte memo.)

Usage:
    python3 consolidate_margin_glossary.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


# Term-definition paragraph: short Title-Case term, colon, definition.
TERM_DEF_RE = re.compile(
    r"^([A-Z][A-Za-z\-]+(?:\s+[A-Z][A-Za-z\-]+){0,3}):\s+([A-Z][^\n]{20,200})$",
    re.M,
)
SECTION_RE = re.compile(r"\\section\{[^}]+\}", re.M)
REFS_HEAD_RE = re.compile(
    r"\\section\{(References|Bibliography|Works Cited|Notes)\b", re.I,
)


def _find_clusters(text: str) -> list[list[tuple[int, int, str, str]]]:
    """Group consecutive term-def matches into clusters when each
    pair is separated by no more than one paragraph break."""
    paragraphs = list(re.finditer(r"[^\n]+(?:\n(?!\n)[^\n]*)*", text))
    refs_m = REFS_HEAD_RE.search(text)
    body_end = refs_m.start() if refs_m else len(text)

    matches: list[tuple[int, int, str, str]] = []
    for m in TERM_DEF_RE.finditer(text):
        if m.start() >= body_end:
            continue
        # Verify this match IS the entire paragraph (no body prose
        # before/after on the same paragraph).
        para_start = text.rfind("\n\n", 0, m.start()) + 2 if text.rfind("\n\n", 0, m.start()) >= 0 else 0
        para_end = text.find("\n\n", m.end()) if text.find("\n\n", m.end()) >= 0 else len(text)
        para_body = text[para_start:para_end].strip()
        if para_body != m.group(0).strip():
            continue
        matches.append((para_start, para_end, m.group(1), m.group(2)))

    if not matches:
        return []
    clusters: list[list[tuple[int, int, str, str]]] = []
    current: list[tuple[int, int, str, str]] = [matches[0]]
    for prev, m in zip(matches, matches[1:]):
        gap = m[0] - prev[1]
        if gap < 800:  # within ~800 chars / a few paragraphs
            current.append(m)
        else:
            if len(current) >= 1:
                clusters.append(current)
            current = [m]
    if current:
        clusters.append(current)
    return clusters


def _enclosing_section_start(text: str, pos: int) -> int:
    """Return char-position right AFTER the nearest preceding
    \\section{} heading."""
    last_section_end = 0
    for m in SECTION_RE.finditer(text, 0, pos):
        last_section_end = m.end()
    return last_section_end


def consolidate(text: str) -> tuple[str, int]:
    """Returns (new_text, clusters_consolidated)."""
    clusters = _find_clusters(text)
    if not clusters:
        return text, 0
    # Process in reverse so insertions don't shift earlier positions.
    new_text = text
    consolidated = 0
    for cluster in reversed(clusters):
        # Remove each term-def paragraph (in reverse position).
        for para_start, para_end, _term, _defn in reversed(cluster):
            new_text = (
                new_text[:para_start]
                + new_text[para_end:]
            )
        # Compute insertion position: at the START of the enclosing
        # section in the (now-edited) text. We use the FIRST cluster
        # member's paragraph-start as a stand-in for the section
        # location.
        first_start = cluster[0][0]
        # After removals, find a stable insertion point: the start of
        # the same section in the new_text.
        insert_pos = _enclosing_section_start(new_text, first_start)
        items = " ".join(
            f"\\textbf{{{term}:}} {defn}" for _, _, term, defn in cluster
        )
        block = (
            "\n\n\\begin{quote}\\textbf{Margin glossary.} "
            + items
            + "\\end{quote}\n\n"
        )
        new_text = new_text[:insert_pos] + block + new_text[insert_pos:]
        consolidated += 1
    return new_text, consolidated


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Consolidate margin glossary term-definitions.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, n = consolidate(text)
    if n == 0:
        print(f"No margin-glossary clusters detected in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Consolidated {n} margin-glossary cluster(s){suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
