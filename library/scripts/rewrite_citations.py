"""Rewrite bare `Author Year` mentions in main.tex body to natbib
\\cite / \\citealt / \\citet commands.

Parses references.bib (treating both `author = {}` and `editor = {}`
fields identically) into a {(normalized-surname-tuple, year) → citekey}
map. Walks the body region (everything before \\section{References}),
finding bare `Author Year` and `(Author Year)` mentions, and rewrites:

- `(Author Year)` parenthetical → `\\cite{key}`
- `Author Year` inside `\\footnote{...}` argument → `\\citealt{key}`
- `Author Year` bare in body prose → `\\citealt{key}`

Skips mentions inside existing `\\cite…{}` commands and inside
non-citation contexts (front-matter `First published`, ISBN, classical
references like `Poetics 1448a`, etc.).

Also fixes common OCR year garbles (`i960` → `1960`).

Usage:
    python3 rewrite_citations.py papers/<citekey>/main.tex papers/<citekey>/references.bib
"""
from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path


def normalize_surname(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"(jr|sr|iii)$", "", s)
    return s


def parse_bib(bib_path: Path) -> dict[tuple, str]:
    """{(normalized-surname-tuple, year) → citekey}, reading both
    `author` and `editor` fields."""
    text = bib_path.read_text(encoding="utf-8")
    entries = re.split(r"\n@", text)
    out: dict[tuple, str] = {}
    for entry in entries:
        m_key = re.match(r"\w+\{([^,]+),", entry)
        m_author = re.search(r"(?:author|editor)\s*=\s*\{([^}]+)\}", entry)
        m_year = re.search(r"year\s*=\s*\{(\d{4})\}", entry)
        if not (m_key and m_author and m_year):
            continue
        citekey = m_key.group(1).strip()
        author_str = m_author.group(1)
        year = m_year.group(1)
        author_parts = [a.strip() for a in re.split(r"\s+and\s+", author_str)]
        surnames = []
        for ap in author_parts:
            if "," in ap:
                surname = ap.split(",")[0].strip()
            else:
                tokens = ap.split()
                surname = tokens[-1] if tokens else ""
            surnames.append(normalize_surname(surname))
        out[(tuple(surnames), year)] = citekey
        if len(surnames) > 1:
            out[((surnames[0],), year, "first-only")] = citekey
    return out


def fix_ocr_years(text: str) -> tuple[str, int]:
    """Fix `i960` → `1960` type OCR garbles."""
    new_text, n = re.subn(r"\b([A-Z][a-z]+)\s+i9(\d{2})\b", r"\1 19\2", text)
    return new_text, n


def find_footnote_ranges(text: str) -> list[tuple[int, int]]:
    """Return list of (start, end) char positions for `\\footnote{...}`
    arguments (content between { and matching })."""
    ranges = []
    i = 0
    while True:
        idx = text.find(r"\footnote{", i)
        if idx < 0:
            break
        body_start = idx + len(r"\footnote{")
        depth = 1
        j = body_start
        while j < len(text) and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth == 0:
            ranges.append((body_start, j))
            i = j
        else:
            i = body_start
    return ranges


SKIP_CONTEXTS = [
    "First published", "Reprinted ", "© Cambridge",
    "Cambridge University Press", "ISBN ", "Poetics 14",
]


def rewrite_citations(text: str, bibmap: dict[tuple, str]) -> tuple[str, int, list[str]]:
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]

    cite_re = re.compile(r"\\cite[a-z]*(?:\[[^\]]*\])?\{[^}]+\}")
    cite_ranges = [(m.start(), m.end()) for m in cite_re.finditer(body)]
    fn_ranges = find_footnote_ranges(body)

    def _inside_any(pos: int, ranges) -> bool:
        return any(s <= pos < e for s, e in ranges)

    author_atom = r"[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?"
    citation_re = re.compile(
        rf"({author_atom}(?:\s+(?:and|&)\s+{author_atom})?(?:\s+et\s+al\.?)?)\s+(\d{{4}}[a-c]?)\b"
    )

    rewrites: list[tuple[int, int, str]] = []
    unresolved: list[str] = []

    for m in citation_re.finditer(body):
        start, end = m.start(), m.end()
        if _inside_any(start, cite_ranges):
            continue

        ctx = body[max(0, start - 80):end + 20]
        if any(skip in ctx for skip in SKIP_CONTEXTS):
            continue

        author_part = m.group(1).strip()
        year_part = m.group(2)

        et_al = "et al" in author_part.lower()
        cleaned = re.sub(r"\s+et\s+al\.?", "", author_part).strip()
        parts = re.split(r"\s+(?:and|&)\s+", cleaned)
        surnames = [normalize_surname(p.split()[-1]) for p in parts]

        citekey = None
        for try_year in [year_part, year_part[:4]]:
            citekey = bibmap.get((tuple(surnames), try_year))
            if citekey:
                break
            if et_al or len(surnames) == 1:
                citekey = bibmap.get(((surnames[0],), try_year, "first-only"))
                if citekey:
                    break

        if not citekey:
            unresolved.append(f"{author_part} {year_part}")
            continue

        in_footnote = _inside_any(start, fn_ranges)
        char_before = body[start - 1] if start > 0 else ""
        char_after = body[end] if end < len(body) else ""

        if char_before == "(":
            close_paren_pos = end + 1 if char_after == ")" else end
            rewrites.append((start - 1, close_paren_pos, "\\cite{" + citekey + "}"))
        elif in_footnote:
            rewrites.append((start, end, "\\citealt{" + citekey + "}"))
        else:
            rewrites.append((start, end, "\\citealt{" + citekey + "}"))

    # Apply rewrites right-to-left
    rewrites.sort(key=lambda r: -r[0])
    new_body = body
    for start, end, new in rewrites:
        new_body = new_body[:start] + new + new_body[end:]

    return new_body + tail, len(rewrites), unresolved


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: rewrite_citations.py <main.tex> <references.bib>", file=sys.stderr)
        return 2
    tex_path = Path(sys.argv[1])
    bib_path = Path(sys.argv[2])

    tex = tex_path.read_text(encoding="utf-8")
    tex, ocr_fixes = fix_ocr_years(tex)
    bibmap = parse_bib(bib_path)
    new_tex, count, unresolved = rewrite_citations(tex, bibmap)

    if ocr_fixes:
        tex = new_tex
        print(f"OCR year fixes: {ocr_fixes}")
    if count:
        tex_path.write_text(new_tex, encoding="utf-8")
        print(f"Rewrote {count} bare author-year mentions to \\cite/\\citealt/\\citet.")
    elif ocr_fixes:
        tex_path.write_text(new_tex, encoding="utf-8")

    if unresolved:
        seen = set()
        deduped = [u for u in unresolved if not (u in seen or seen.add(u))]
        print(f"\nUnresolved ({len(deduped)} unique):")
        for u in deduped[:30]:
            print(f"  - {u}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
