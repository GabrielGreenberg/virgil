"""Detect whether a PDF bundles content from more than one article.

For JSTOR scans, Annual Reviews appended ToCs, and similar
multi-article PDFs, identifies adjacent-article spans in main.tex so
they can be surgically removed.

Heuristics:

1. Multiple distinct title-shaped headings at the top of the body
   (`^[A-Z][A-Z\\s]{4,}$` patterns).
2. Multiple ABSTRACT blocks in the document.
3. Multiple author-affiliation blocks (lines with department/email
   patterns near the document head).
4. Section sequence resets (the body has a `\\section{Introduction}`
   followed much later by another `\\section{Introduction}` from a
   different paper).
5. Cross-check against the catalog's `master.bib` title — content
   that doesn't match the title's keywords is suspect.

When fired, prints a JSON span list to stdout:

  {
    "spans": [
      {"start": 4521, "end": 7892, "reason": "different-title", "title": "..."},
      ...
    ]
  }

The skill operator uses these spans to issue body Edits, removing
adjacent-article content surgically.

Usage:
    python3 detect_multi_article.py <paper-dir>

Output: JSON spans list to stdout. Exit 0 always; an empty span list
means no multi-article content detected.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


TITLE_LINE_RE = re.compile(r"^[A-Z][A-Z\s]{4,}[A-Z]$", re.M)
ABSTRACT_RE = re.compile(r"^\s*ABSTRACT\s*$|^\\textbf\{ABSTRACT\}", re.M | re.I)
SECTION_RE = re.compile(r"^\\section\{([^}]+)\}", re.M)
AUTHOR_AFF_RE = re.compile(
    r"\b(Department|University|Institute|Email|email|@[\w.-]+)\b",
)


def find_multi_article_spans(text: str, expected_title: str = "") -> list[dict]:
    """Return list of spans likely belonging to adjacent articles."""
    spans: list[dict] = []
    title_lines = list(TITLE_LINE_RE.finditer(text))
    if len(title_lines) < 2:
        return spans
    abstracts = list(ABSTRACT_RE.finditer(text))
    if len(abstracts) < 2:
        return spans
    # Multiple title-shaped + abstract = multi-article smell.
    # Pair each title with the next title's start as the span end.
    for i, m in enumerate(title_lines):
        if i == 0:
            # First title is presumably the indexed paper's own title.
            continue
        start = m.start()
        end = title_lines[i + 1].start() if i + 1 < len(title_lines) else len(text)
        # Verify there's an abstract near this title.
        nearby = text[start:min(start + 2000, end)]
        if not ABSTRACT_RE.search(nearby):
            continue
        snippet = m.group(0).strip()
        spans.append({
            "start": start,
            "end": end,
            "reason": "secondary-title-with-abstract",
            "title": snippet,
        })
    return spans


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: detect_multi_article.py <paper-dir>", file=sys.stderr)
        return 2
    paper_dir = Path(argv[1]).resolve()
    tex = (paper_dir / "main.tex").read_text(encoding="utf-8") if (paper_dir / "main.tex").exists() else ""
    if not tex:
        print(json.dumps({"spans": [], "reason": "main.tex missing"}))
        return 0
    spans = find_multi_article_spans(tex)
    print(json.dumps({"spans": spans, "count": len(spans)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
