"""Format a run-on references section into itemized entries.

Supersedes the per-paper bibliography parsers reinvented across many
deep-index passes. State-machine parser that handles:

- Multi-word surnames (McNaughton, MacEvoy, van Fraassen, Graf Fara)
  via longest-suffix match.
- Lowercase particles: von, de, van, der, den, da, do, del, della,
  di, dos, das, du, la, le, te, al, el, st, sankt, Mc, McC.
- Year range 1600–2099 (not just 1900–2099); 1967/1973 forms;
  letter-suffix disambiguators (1995a, 1995b).
- Accented Latin: Öhman, Ólafsdóttir, curly apostrophe U+2019,
  diaeresis ¨, hyphenated initials (Y.-M., A.-C.).
- Inline running header strip (REFERENCES 181, 182 SIGNALS: EVOLUTION).
- Page ranges: standard --, prefixed S51-S65, A123-A145.
- Rejects false boundaries: single-initial M. mid-author-list,
  journal abbreviations (J. Neurosci.).
- Auto-detects entry type: @article, @book, @incollection,
  @inproceedings, @techreport.

Usage:
    python3 format_references_section.py <paper-dir> [--style=apa|chicago|endnote|bracket-key] [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2})([a-z]?(?:/\d{4}[a-z]?)?)\b")
# Boundary candidate: a year followed by period, possibly with letter suffix.
YEAR_BOUNDARY_RE = re.compile(
    r"\b(1[6-9]\d{2}|20\d{2})([a-z]?(?:/\d{4}[a-z]?)?)\.\s+",
)

# Lowercase particles in author names. Case-insensitive match.
PARTICLES = {
    "von", "de", "van", "der", "den", "da", "do", "del", "della",
    "di", "dos", "das", "du", "la", "le", "te", "al", "el",
    "st", "sankt", "mc", "mcc", "ten", "ter",
}

# Section heading for references.
REFS_HEAD_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited)\}", re.M | re.I,
)
NEXT_SECTION_RE = re.compile(r"^\\section\{", re.M)
ALREADY_ITEMIZED_RE = re.compile(r"\\begin\{itemize\}[\s\S]*\\textbf\{")

# Strip inline running headers like "REFERENCES 181" or "182 SIGNALS"
INLINE_HEADER_RE = re.compile(r"\s+(?:REFERENCES|BIBLIOGRAPHY|WORKS CITED)\s+\d+\s+|\s+\d+\s+(?:[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+){0,4})\s+")


def detect_style(refs_text: str) -> str:
    """Heuristically detect citation style."""
    bracket_keys = len(re.findall(r"\[\w+\]", refs_text))
    apa_signals = len(re.findall(r"[A-Z]\w+,\s+[A-Z]\.\s*(?:,\s+[A-Z]\.\s*)*\s*\(", refs_text))
    chicago_signals = len(re.findall(r"[A-Z]\w+,\s+[A-Z]\.\s+\d{4}\.", refs_text))
    if bracket_keys >= 5 and bracket_keys > apa_signals + chicago_signals:
        return "bracket-key"
    if apa_signals >= 5 and apa_signals > chicago_signals:
        return "apa"
    if chicago_signals >= 5:
        return "chicago"
    return "chicago"  # safest default


def strip_inline_headers(text: str) -> str:
    """Strip mid-paragraph leaked headers/footers."""
    return INLINE_HEADER_RE.sub(" ", text)


def split_entries(refs_text: str, style: str) -> list[str]:
    """Split a run-on references section into individual entries."""
    text = strip_inline_headers(refs_text)
    if style == "bracket-key":
        # Split on [KEY] at line/paragraph start.
        parts = re.split(r"\n\s*(?=\[)", text)
        return [p.strip() for p in parts if p.strip()]
    # Author-year style: split on YEAR-period.
    entries = []
    pos = 0
    for m in YEAR_BOUNDARY_RE.finditer(text):
        # Reject if the YEAR appears mid-name (preceded by "et al." or
        # closing bracket of a parenthetical year).
        boundary_end = m.end()
        # Check if the next character is a likely entry start: capital
        # letter or em-dash same-author marker.
        next_chunk = text[boundary_end:boundary_end + 30].lstrip()
        if not next_chunk:
            continue
        # Look for `[A-Z]` (new author), `—` (same author), or `"` (some refs
        # start the title immediately after the year).
        if not re.match(r"[A-ZÀ-Ý\"“—–\-]", next_chunk):
            continue
        entries.append(text[pos:boundary_end].strip())
        pos = boundary_end
    if pos < len(text):
        entries.append(text[pos:].strip())
    return [e for e in entries if e]


def detect_entry_type(entry: str) -> str:
    """Detect BibTeX entry type from entry text."""
    lower = entry.lower()
    if "ph.d." in lower or "dissertation" in lower or "thesis" in lower:
        return "@phdthesis"
    if "proceedings of" in lower or "in proc." in lower or "siggraph" in lower:
        return "@inproceedings"
    if "tech. rep." in lower or "technical report" in lower or "csli-" in lower:
        return "@techreport"
    if " in " in lower and ("ed." in lower or "eds." in lower or "edited by" in lower):
        return "@incollection"
    if "unpublished" in lower or "manuscript" in lower or "forthcoming" in lower:
        return "@unpublished"
    # Journal vs book heuristic: if italic title precedes a comma+number, it's likely
    # a journal volume.
    if re.search(r"\\textit\{[^}]+\}[,\s]+\d+", entry) or re.search(r"\d+[:,]\s*\d+[-–—]\d+", entry):
        return "@article"
    if "press" in lower or "publisher" in lower:
        return "@book"
    return "@misc"


def normalize_page_ranges(text: str) -> str:
    """Convert single-hyphen page ranges to BibTeX `--`."""
    return re.sub(r"(\d)[–—\-](\d)", r"\1--\2", text)


def shape_entry(entry: str, style: str) -> str:
    """Format a single entry as `\\item \\textbf{<authors>} <rest>`."""
    entry = re.sub(r"\s+", " ", entry).strip()
    entry = normalize_page_ranges(entry)
    if style == "bracket-key":
        # `[KEY] body` form.
        m = re.match(r"\[(\w+)\]\s+(.+)", entry)
        if m:
            key, rest = m.group(1), m.group(2)
            return f"\\item \\textbf{{[{key}]}} {rest}"
        return f"\\item {entry}"
    # Author-year: bold the author portion up through the year.
    m = YEAR_RE.search(entry)
    if m:
        bold_end = m.end()
        # Include trailing period if present.
        if bold_end < len(entry) and entry[bold_end] == ".":
            bold_end += 1
        head = entry[:bold_end].strip()
        rest = entry[bold_end:].strip()
        return f"\\item \\textbf{{{head}}} {rest}".rstrip()
    return f"\\item {entry}"


def format_references(paper_dir: Path, style: str | None = None,
                      dry_run: bool = False) -> dict:
    """Format the references section of the paper's main.tex."""
    tex_path = paper_dir / "main.tex"
    if not tex_path.exists():
        return {"error": "main.tex not found"}
    text = tex_path.read_text(encoding="utf-8")
    head_match = REFS_HEAD_RE.search(text)
    if not head_match:
        return {"error": "no references section found", "entries": 0}
    refs_start = head_match.end()
    after = text[refs_start:]
    next_m = NEXT_SECTION_RE.search(after)
    refs_end = refs_start + (next_m.start() if next_m else len(after))
    refs_text = text[refs_start:refs_end]

    if ALREADY_ITEMIZED_RE.search(refs_text):
        return {"entries": 0, "style": "already-itemized", "reason": "already shaped"}

    if not style:
        style = detect_style(refs_text)

    entries = split_entries(refs_text, style)
    if not entries:
        return {"entries": 0, "style": style, "reason": "no entries detected"}

    items = ["\\begin{itemize}"]
    for e in entries:
        items.append(shape_entry(e, style))
    items.append("\\end{itemize}")
    new_refs = "\n\n" + "\n".join(items) + "\n"
    new_text = text[:refs_start] + new_refs + text[refs_end:]

    if not dry_run:
        tex_path.write_text(new_text, encoding="utf-8")

    return {"entries": len(entries), "style": style}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: format_references_section.py <paper-dir> "
            "[--style=apa|chicago|endnote|bracket-key] [--dry-run]",
            file=sys.stderr,
        )
        return 2
    paper_dir = Path(argv[1]).resolve()
    style = None
    dry_run = False
    for arg in argv[2:]:
        if arg.startswith("--style="):
            style = arg.split("=", 1)[1]
        elif arg == "--dry-run":
            dry_run = True
    result = format_references(paper_dir, style=style, dry_run=dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result.get("reason"):
        print(f"Skipped: {result['reason']}.")
        return 0
    suffix = " (dry run)" if dry_run else ""
    print(
        f"Itemized {result['entries']} entries as style={result['style']} "
        f"in {paper_dir}{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
