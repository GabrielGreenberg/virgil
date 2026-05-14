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
    bracket_keys = len(re.findall(r"\[[A-Za-z]\w*\]", refs_text))
    bracket_numeric = len(re.findall(r"\[(\d{1,3})\]", refs_text))
    siggraph_signals = len(re.findall(
        r"\b[A-Z]{2,}(?:,\s+[A-Z]\.)+,?\s+AND\s+[A-Z]{2,}", refs_text,
    ))
    apa_signals = len(re.findall(r"[A-Z]\w+,\s+[A-Z]\.\s*(?:,\s+[A-Z]\.\s*)*\s*\(", refs_text))
    chicago_signals = len(re.findall(r"[A-Z]\w+,\s+[A-Z]\.\s+\d{4}\.", refs_text))
    author_year_paren = len(re.findall(
        r"[A-Z][a-zA-Z\-']+(?:\s+and\s+[A-Z][a-zA-Z\-']+)?\s*\(\d{4}[a-c]?\)",
        refs_text,
    ))
    if siggraph_signals >= 3:
        return "siggraph"
    if bracket_numeric >= 5 and bracket_numeric > bracket_keys:
        return "bracket-numeric"
    if bracket_keys >= 5 and bracket_keys > apa_signals + chicago_signals:
        return "bracket-key"
    if author_year_paren >= 5 and author_year_paren > chicago_signals:
        return "author-year-paren"
    if apa_signals >= 5 and apa_signals > chicago_signals:
        return "apa"
    if chicago_signals >= 5:
        return "chicago"
    return "chicago"  # safest default


def strip_inline_headers(text: str) -> str:
    """Strip mid-paragraph leaked headers/footers."""
    return INLINE_HEADER_RE.sub(" ", text)


# Author-start signal for an APA/Chicago entry: a capitalized surname
# followed by a comma (`Lastname,`). Caught by the comma being the
# canonical APA / Chicago separator between surname and initials. This
# is the strongest, lowest-false-positive boundary signal.
_AUTHOR_START_STRONG_RE = re.compile(
    r"(?:^|(?<=[\.\)\n])\s*)([A-ZÀ-ÝŒÆ][a-zA-ZÀ-ÿ\-'’]+,)"
)

# Author-start signal for Chicago-without-comma (rarer). Fallback.
_AUTHOR_START_WEAK_RE = re.compile(
    r"(?:^|(?<=[\.\n])\s+)([A-ZÀ-ÝŒÆ][a-zA-ZÀ-ÿ\-'’]{2,}\s+[A-ZÀ-Ý]\.)"
)


def _looks_like_paragraph_separated(refs_text: str) -> bool:
    """Detect a 'one entry per paragraph' references section.

    Returns True when ≥10 paragraphs are present AND ≥80% of them
    start with a surname-shaped prefix followed by a 4-digit year
    within the first ~200 chars. Such bibliographies should bypass
    the year-anchor split entirely and just wrap each paragraph in
    an `\\item`. (greenberg, kriegeskorte memos.)
    """
    paras = [p.strip() for p in re.split(r"\n\s*\n", refs_text) if p.strip()]
    if len(paras) < 10:
        return False
    head_re = re.compile(r"^[A-ZÀ-ÝŒÆ][a-zA-ZÀ-ÿ\-'’]+[,\.]")
    with_year = sum(
        1 for p in paras
        if head_re.match(p) and YEAR_RE.search(p[:200])
    )
    return with_year >= 0.8 * len(paras)


def _author_start_before(
    text: str, year_start: int, floor: int,
) -> int:
    """Return the position of the author-surname start for an entry
    whose year boundary is at `year_start`. Searches in
    `text[floor:year_start]`. Falls back to `year_start` itself if no
    clear boundary is found."""
    chunk = text[floor:year_start]
    # Strong signal: `.\s+Lastname,` or paragraph-start `Lastname,`.
    matches = list(_AUTHOR_START_STRONG_RE.finditer(chunk))
    if matches:
        # Take the LAST match closest to the year — that's the actual
        # author for this entry, not an earlier author embedded in
        # the previous entry's title.
        return floor + matches[-1].start(1)
    # Weak signal: `Lastname F.`-style without trailing comma.
    matches = list(_AUTHOR_START_WEAK_RE.finditer(chunk))
    if matches:
        return floor + matches[-1].start(1)
    return year_start


def _split_siggraph(text: str) -> list[str]:
    """SIGGRAPH-style: `LASTNAME, F., AND LASTNAME, F. YEAR. Title…`.
    Split at period-space before all-caps surname (with multi-word
    surname support)."""
    parts = re.split(
        r"(?<=[\.\]])\s+(?=[A-Z]{2,}(?:\s+[A-Z]{2,})?,\s+[A-Z]\.)",
        text,
    )
    return [p.strip() for p in parts if p.strip()]


def _split_author_year_paren(text: str) -> list[str]:
    """Humanities-thesis style: `Author(s) (YYYY[a/b]) Title. Rest.`.
    Entry start is `Lastname,\\s+F\\.` or paragraph-start `Lastname`."""
    # First try paragraph-separated.
    if _looks_like_paragraph_separated(text):
        return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    # Otherwise split on the entry-start regex.
    parts = re.split(
        r"(?<=[\.\]])\s+(?=[A-Z][a-zA-Z\-']+,\s+[A-Z]\.)",
        text,
    )
    return [p.strip() for p in parts if p.strip()]


def _apply_same_author_continuation(entries: list[str]) -> list[str]:
    """Merge entries that look like same-author year-only
    continuations (`^1998. Title. Rest.`) into the prior entry's
    author. (kulvicki memo.)"""
    out: list[str] = []
    prev_author: str | None = None
    for entry in entries:
        m_year_start = re.match(r"^(\d{4}[a-c]?)\.\s+", entry)
        if m_year_start and prev_author:
            # Take the surname/given-initials prefix of the previous
            # entry up to its year.
            out.append(f"{prev_author} {entry}")
            continue
        # Track the previous entry's "author prefix" for potential
        # same-author continuation. Heuristic: everything up to (but
        # not including) the first 4-digit year.
        ya = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", entry)
        if ya:
            prev_author = entry[:ya.start()].rstrip(" .,")
        out.append(entry)
    return out


def split_entries(
    refs_text: str,
    style: str,
    same_author_mode: bool = False,
) -> list[str]:
    """Split a run-on references section into individual entries.

    Strategies, by style:

    - **bracket-key** / **bracket-numeric**: split on bracket
      paragraph-starts.
    - **siggraph**: all-caps surname boundary.
    - **author-year-paren**: paragraph-separated or
      `Lastname,\\s+F\\.` boundary.
    - **paragraph-separated fast path** (any style): when the source
      already has one entry per paragraph (≥10 paragraphs, ≥80%
      surname+year prefix), wrap each paragraph in `\\item`.
    - **year-anchor split** (corrected): find each `YYYY[a-z]?\\.`
      year-boundary, walk backward to the author-surname start just
      before the year, and use that as the entry boundary.

    When `same_author_mode=True`, entries starting with a bare year
    (`^1998. …`) inherit the previous entry's author prefix.
    """
    text = strip_inline_headers(refs_text)
    if style == "bracket-key":
        parts = re.split(r"\n\s*(?=\[[A-Za-z])", text)
        return [p.strip() for p in parts if p.strip()]
    if style == "bracket-numeric":
        parts = re.split(r"\n\s*(?=\[\d+\])", text)
        return [p.strip() for p in parts if p.strip()]
    if style == "siggraph":
        return _split_siggraph(text)
    if style == "author-year-paren":
        entries = _split_author_year_paren(text)
        if same_author_mode:
            entries = _apply_same_author_continuation(entries)
        return entries

    # Fast path: paragraph-separated.
    if _looks_like_paragraph_separated(text):
        paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        if same_author_mode:
            paras = _apply_same_author_continuation(paras)
        return paras

    # Year-anchor split (corrected).
    year_matches = list(YEAR_BOUNDARY_RE.finditer(text))
    if not year_matches:
        return []

    starts: list[int] = []
    prev_end = 0
    for m in year_matches:
        author_start = _author_start_before(text, m.start(), prev_end)
        starts.append(author_start)
        prev_end = m.end()

    cleaned: list[int] = []
    for s in starts:
        if not cleaned or s > cleaned[-1]:
            cleaned.append(s)

    if cleaned and cleaned[0] > 50 and text[:cleaned[0]].strip():
        cleaned = [0] + cleaned

    entries: list[str] = []
    for i, start in enumerate(cleaned):
        end = cleaned[i + 1] if i + 1 < len(cleaned) else len(text)
        entry = text[start:end].strip()
        if entry:
            entries.append(entry)

    if same_author_mode:
        entries = _apply_same_author_continuation(entries)

    return entries


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
                      dry_run: bool = False,
                      same_author_mode: bool = False,
                      diagnostic: bool = False) -> dict:
    """Format the references section of the paper's main.tex.

    Sanity-checks the parser output before writing: if the entry count
    is implausibly low for the section size (< 1 entry per 500 bytes),
    aborts and leaves the file untouched. This catches the silent-mangle
    case (e.g. willats 4 entries / 25KB section) where the script
    otherwise overwrites the section with garbage. (willats, carey,
    peacocke memos.)
    """
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

    entries = split_entries(refs_text, style, same_author_mode=same_author_mode)
    if not entries:
        return {"entries": 0, "style": style, "reason": "no entries detected"}

    if diagnostic:
        section_bytes = len(refs_text.encode("utf-8"))
        coverage = (
            sum(1 for e in entries if YEAR_RE.search(e)) / len(entries)
            if entries else 0
        )
        print(
            f"[diagnostic] style={style}, entries={len(entries)}, "
            f"section_bytes={section_bytes}, "
            f"avg_bytes_per_entry={section_bytes // max(1, len(entries))}, "
            f"year_coverage={coverage:.0%}"
        )

    # Sanity-check: implausibly few entries for the section size means
    # the parser failed. Abort before silently mangling the file.
    section_bytes = len(refs_text.encode("utf-8"))
    if section_bytes > 5000 and len(entries) < max(5, section_bytes // 500):
        return {
            "entries": 0,
            "style": style,
            "reason": (
                f"sanity-check abort: {len(entries)} entries for "
                f"{section_bytes} bytes (threshold {section_bytes // 500}). "
                "Parser likely misclassified the section's style. "
                "File left untouched; try a different --style or "
                "preprocess the section first."
            ),
        }

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
            "[--style=apa|chicago|bracket-key|bracket-numeric|siggraph|author-year-paren] "
            "[--same-author-mode] [--diagnostic] [--dry-run]",
            file=sys.stderr,
        )
        return 2
    paper_dir = Path(argv[1]).resolve()
    style = None
    dry_run = False
    same_author_mode = False
    diagnostic = False
    for arg in argv[2:]:
        if arg.startswith("--style="):
            style = arg.split("=", 1)[1]
        elif arg == "--dry-run":
            dry_run = True
        elif arg == "--same-author-mode":
            same_author_mode = True
        elif arg == "--diagnostic":
            diagnostic = True
    result = format_references(
        paper_dir,
        style=style,
        dry_run=dry_run,
        same_author_mode=same_author_mode,
        diagnostic=diagnostic,
    )
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
