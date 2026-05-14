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


# Suffix derived from the citekey (e.g. `peacocke2017atemporal` → `a`).
# Used to disambiguate alphabetic-year-suffix mentions like
# "Peacocke 2017a" against bib keys that embed the suffix character.
_CITEKEY_YEAR_SUFFIX_RE = re.compile(r"\d{4}([a-z])(?=[a-z])")


def _citekey_year_suffix(citekey: str) -> str | None:
    m = _CITEKEY_YEAR_SUFFIX_RE.search(citekey)
    return m.group(1) if m else None


def parse_bib(bib_path: Path) -> dict[tuple, str]:
    """{(normalized-surname-tuple, year) → citekey}, reading both
    `author` and `editor` fields.

    Indexes under multiple keys per entry for robust lookup:
    - Full surname tuple at (surnames, year) — primary.
    - First-only at ((first,), year, "first-only") — for et al.
    - Each surname individually at ((surname,), year, "any-author") —
      for short-form mentions and endnote-style citations.
    - When the citekey embeds an alphabetic year-suffix (e.g.
      `peacocke2017atemporal`), the entry is *also* indexed under
      year+suffix (e.g. `2017a`) so that body mentions like
      "Peacocke 2017a" resolve correctly without manual SUFFIX_MAPs.
    """
    text = bib_path.read_text(encoding="utf-8")
    # `re.split(r"\n@", text)` keeps the leading `@` only on the first
    # entry, so strip it explicitly to normalize all entries to start
    # with the entry-type keyword.
    entries = [
        e.lstrip("@") for e in re.split(r"\n@", text) if e.strip()
    ]
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
        suffix = _citekey_year_suffix(citekey)
        # Build the list of (year-key) variants to index under: bare
        # year always; year+suffix when the citekey embeds one.
        year_variants = [year]
        if suffix:
            year_variants.append(year + suffix)
        author_parts = [a.strip() for a in re.split(r"\s+and\s+", author_str)]
        surnames = []
        for ap in author_parts:
            if "," in ap:
                surname = ap.split(",")[0].strip()
            else:
                tokens = ap.split()
                surname = tokens[-1] if tokens else ""
            surnames.append(normalize_surname(surname))
        for yv in year_variants:
            out[(tuple(surnames), yv)] = citekey
            if len(surnames) > 1:
                out[((surnames[0],), yv, "first-only")] = citekey
            for sn in surnames:
                out.setdefault(((sn,), yv, "any-author"), citekey)
    return out


def parse_bracket_keys(bib_path: Path) -> dict[str, str]:
    """For bracket-key style (SIGGRAPH/CS): map [KEY] inline labels to
    citekeys via a `note` or `label` field, or by heuristic derivation
    from author surnames + year.
    """
    text = bib_path.read_text(encoding="utf-8")
    entries = [
        e.lstrip("@") for e in re.split(r"\n@", text) if e.strip()
    ]
    out: dict[str, str] = {}
    for entry in entries:
        m_key = re.match(r"\w+\{([^,]+),", entry)
        m_label = re.search(r"(?:note|label)\s*=\s*\{\[([^\]]+)\]\}", entry)
        m_author = re.search(r"author\s*=\s*\{([^}]+)\}", entry)
        m_year = re.search(r"year\s*=\s*\{(\d{4})\}", entry)
        if not m_key:
            continue
        citekey = m_key.group(1).strip()
        if m_label:
            out[m_label.group(1).strip()] = citekey
            continue
        if m_author and m_year:
            authors = re.split(r"\s+and\s+", m_author.group(1))
            yr2 = m_year.group(1)[-2:]
            if len(authors) == 1:
                surname = authors[0].split(",")[0].strip() if "," in authors[0] else authors[0].split()[-1]
                tag = re.sub(r"[^A-Za-z]", "", surname)[:3].upper() + yr2
                out[tag] = citekey
            elif len(authors) <= 4:
                tag = ""
                for a in authors:
                    sn = a.split(",")[0].strip() if "," in a else a.split()[-1]
                    tag += re.sub(r"[^A-Za-z]", "", sn)[:1].upper()
                tag += yr2
                out[tag] = citekey
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
    "©", "Copyright ", "Copyright©",
]

# Tokens that look like surnames but aren't — month names, day names,
# common article-structure labels. Used by all citation styles to drop
# false-positive year matches in acknowledgements, proofs, and figure
# captions. (peacocke memo follow-up.)
NOT_A_SURNAME = frozenset({
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Saturday", "Sunday",
    "Volume", "Chapter", "Section", "Figure", "Table", "Appendix",
    "Theorem", "Proposition", "Lemma", "Corollary", "Definition",
    "Example", "Remark",
})


def _passes_surname_guard(surname_token: str) -> bool:
    """Reject single-token "surnames" that are actually month names,
    day names, structural labels (`Theorem`), etc."""
    return surname_token not in NOT_A_SURNAME


def _is_valid_year(year_str: str) -> bool:
    """Year range guard: 1500–2099. Filters out junk like `1234`,
    OCR-mistakes like `i960`, and stray paragraph numbers."""
    try:
        y = int(year_str[:4])
    except ValueError:
        return False
    return 1500 <= y <= 2099


def rewrite_citations(text: str, bibmap: dict[tuple, str],
                      style: str = "chicago") -> tuple[str, int, list[str]]:
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

    # Author atom supports lowercase particles (von, de, van der, Mc),
    # up to 3 deep, plus accented Latin capitals AND fused-surname
    # prefixes (`Mc`/`Mac`/`O'`/`D'`/`De`/`Du`/`La`/`Le`/`St`/`Van`/
    # `Von` directly attached: McDowell, MacEvoy, O'Brien, D'Alembert).
    # `\b` anchors the particle so "le" in "title\nMcDowell" doesn't
    # capture the tail of "title" as a particle. (peacocke / davidson
    # memos.)
    particle_pat = r"(?:\b(?:von|de|van|der|den|da|do|del|della|di|dos|das|du|la|le|te|al|el|st|sankt|Mc|McC|ten|ter)\s+){0,3}"
    fused_prefix = r"(?:Mc|Mac|O[’']|D[’']|De|Du|La|Le|St|Van|Von)"
    plain_surname = r"[A-ZÀ-Ý][a-zà-ÿ\-']+(?:[-'][A-Z][a-z]+)?"
    fused_surname = rf"\b{fused_prefix}[A-Z][a-z]+"
    surname_alt = rf"(?:{fused_surname}|\b{plain_surname})"
    author_atom = rf"{particle_pat}{surname_alt}"
    if style == "apa":
        citation_re = re.compile(
            rf"({author_atom}(?:\s*(?:,\s*|\s+and\s+|\s+&\s+){author_atom})*(?:\s+et\s+al\.?)?)\s*,\s*(\d{{4}}[a-c]?)\b"
        )
    else:
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

        # Year-range guard: skip non-publication years (1234, 0123).
        if not _is_valid_year(year_part):
            continue

        et_al = "et al" in author_part.lower()
        cleaned = re.sub(r"\s+et\s+al\.?", "", author_part).strip()
        parts = re.split(r"\s+(?:and|&)\s+", cleaned)
        # Surname guard: skip if the single-token author is a month
        # name, day name, or article-structure label.
        last_tokens = [p.split()[-1] for p in parts]
        if (
            len(last_tokens) == 1
            and not _passes_surname_guard(last_tokens[0])
        ):
            continue
        surnames = [normalize_surname(t) for t in last_tokens]

        citekey = None
        for try_year in [year_part, year_part[:4]]:
            citekey = bibmap.get((tuple(surnames), try_year))
            if citekey:
                break
            if et_al or len(surnames) == 1:
                citekey = bibmap.get(((surnames[0],), try_year, "first-only"))
                if citekey:
                    break
            # Fall through to "any-author" index — useful for short-form
            # citations and multi-word surname mismatches.
            for sn in surnames:
                citekey = bibmap.get(((sn,), try_year, "any-author"))
                if citekey:
                    break
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


def rewrite_bracket_keys(text: str, bracket_map: dict[str, str]) -> tuple[str, int]:
    """For bracket-key style: rewrite inline `[KEY]` to `\\cite{citekey}`."""
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]
    count = 0
    def replace(m):
        nonlocal count
        key = m.group(1)
        ck = bracket_map.get(key)
        if not ck:
            return m.group(0)
        count += 1
        return f"\\cite{{{ck}}}"
    new_body = re.sub(r"\[([A-Z][\w+]*)\]", replace, body)
    return new_body + tail, count


def parse_numeric_bracket_keys(refs_section: str) -> dict[str, str]:
    """Parse an itemized bracket-numeric bibliography and return a
    `{N -> citekey}` map. Expects entries shaped like:

        \\item \\textbf{[12]} Lastname, F. Title. ...

    Citekeys are derived from the entry body via the first-author
    surname + 4-digit year + first significant title word.
    """
    out: dict[str, str] = {}
    for m in re.finditer(
        r"\\item\s+\\textbf\{\[(\d+)\]\}\s+([^\n]+)", refs_section,
    ):
        num = m.group(1)
        body = m.group(2)
        # Surname: first capitalized word followed by `, F.` or `. F.`.
        surname_m = re.match(
            r"([A-Z][a-zA-Z\-']+)(?:\s*,|\s+[A-Z]\.)",
            body,
        )
        year_m = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", body)
        if not (surname_m and year_m):
            continue
        surname = normalize_surname(surname_m.group(1))
        year = year_m.group(1)
        # Try the first significant title word: skip articles/preps.
        title_m = re.search(
            r'(?:[\."\']\s+)([A-Z][a-zA-Z]+)',
            body[year_m.end():],
        )
        title_word = ""
        if title_m:
            tw = title_m.group(1).lower()
            if tw not in {"the", "an", "of", "on", "in", "and", "for", "with", "to"}:
                title_word = tw[:8]
        out[num] = f"{surname}{year}{title_word}"
    return out


def rewrite_bracket_numeric(
    text: str, numeric_map: dict[str, str],
) -> tuple[str, int]:
    """For bracket-numeric style (CS theses, Vancouver): rewrite
    `[N]`, `[N, M]`, `[N-M]`, `[N--M]` to `\\cite{key1,key2,...}`.

    Skips occurrences inside the References section itself.
    """
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]
    count = 0

    def expand_run(numbers: list[str]) -> list[str]:
        keys: list[str] = []
        for n in numbers:
            ck = numeric_map.get(n)
            if ck:
                keys.append(ck)
        return keys

    def replace(m: re.Match) -> str:
        nonlocal count
        content = m.group(1)
        nums: list[str] = []
        for piece in re.split(r"\s*,\s*", content):
            range_m = re.match(r"(\d+)\s*(?:--|-)\s*(\d+)$", piece)
            if range_m:
                lo, hi = int(range_m.group(1)), int(range_m.group(2))
                if hi - lo > 50:
                    return m.group(0)
                nums.extend(str(i) for i in range(lo, hi + 1))
            elif piece.isdigit():
                nums.append(piece)
            else:
                return m.group(0)
        keys = expand_run(nums)
        if not keys:
            return m.group(0)
        count += 1
        return "\\cite{" + ",".join(keys) + "}"

    new_body = re.sub(r"\[((?:\d+(?:\s*(?:--|-)\s*\d+)?)(?:\s*,\s*\d+(?:\s*(?:--|-)\s*\d+)?)*)\]",
                      replace, body)
    return new_body + tail, count


def rewrite_bracket_author_year(
    text: str, bibmap: dict[tuple, str],
) -> tuple[str, int, list[str]]:
    """SIGGRAPH/Eurographics inline style: rewrite `[Author Year]` and
    `[A1 Y1; A2 Y2]` multi-citation. Also handles textual `Author [Year]`."""
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]

    count = 0
    unresolved: list[str] = []

    one_cite = re.compile(
        r"\[\s*([A-Z][a-zA-Z\-']+(?:\s+(?:et\s+al\.?|and\s+[A-Z][a-zA-Z\-']+))?)\s+(\d{4}[a-c]?)\s*\]"
    )
    multi_cite = re.compile(
        r"\[\s*((?:[A-Z][a-zA-Z\-']+(?:\s+(?:et\s+al\.?|and\s+[A-Z][a-zA-Z\-']+))?\s+\d{4}[a-c]?\s*;?\s*)+)\]"
    )

    def lookup(author: str, year: str) -> str | None:
        if not _is_valid_year(year):
            return None
        last = normalize_surname(author.split()[-1])
        if not _passes_surname_guard(author.split()[-1]):
            return None
        ck = bibmap.get(((last,), year))
        if ck:
            return ck
        return bibmap.get(((last,), year, "first-only")) or bibmap.get(
            ((last,), year, "any-author"))

    def replace_multi(m: re.Match) -> str:
        nonlocal count
        keys: list[str] = []
        for sub in re.findall(
            r"([A-Z][a-zA-Z\-']+(?:\s+(?:et\s+al\.?|and\s+[A-Z][a-zA-Z\-']+))?)\s+(\d{4}[a-c]?)",
            m.group(1),
        ):
            ck = lookup(sub[0], sub[1])
            if ck:
                keys.append(ck)
            else:
                unresolved.append(f"{sub[0]} {sub[1]}")
        if not keys:
            return m.group(0)
        count += 1
        return "\\cite{" + ",".join(keys) + "}"

    new_body = multi_cite.sub(replace_multi, body)
    # one_cite is now redundant for paren-bracketed mentions but still
    # handles `Author [Year]` textual form (Year alone in brackets).
    return new_body + tail, count, unresolved


def rewrite_author_year_paren(
    text: str, bibmap: dict[tuple, str],
) -> tuple[str, int, list[str]]:
    """Humanities-thesis style: `Author (Year)` and variants. Rewrites
    to `\\citet{key}` (textual). `\\citep{key}` would parenthesize the
    whole author-year, which is wrong here — only the year is in
    parens in the source.
    """
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]
    count = 0
    unresolved: list[str] = []

    pattern = re.compile(
        r"([A-Z][a-zA-Z\-']+(?:\s+(?:and|et\s+al\.?)\s+(?:[A-Z][a-zA-Z\-']+)?)?)\s+\((\d{4}[a-c]?)(?:,\s*p+\.?\s*(\d+(?:[-–]\d+)?))?\)"
    )

    def replace(m: re.Match) -> str:
        nonlocal count
        author_part, year_part, page_part = m.group(1), m.group(2), m.group(3)
        if not _is_valid_year(year_part):
            return m.group(0)
        last = normalize_surname(author_part.split()[-1])
        if not _passes_surname_guard(author_part.split()[-1]):
            return m.group(0)
        ck = (
            bibmap.get(((last,), year_part))
            or bibmap.get(((last,), year_part, "first-only"))
            or bibmap.get(((last,), year_part, "any-author"))
        )
        if not ck:
            unresolved.append(f"{author_part} ({year_part})")
            return m.group(0)
        count += 1
        if page_part:
            page_arg = page_part.replace("-", "--")
            return f"\\citet[p.~{page_arg}]{{{ck}}}"
        return f"\\citet{{{ck}}}"

    new_body = pattern.sub(replace, body)
    return new_body + tail, count, unresolved


def rewrite_bracket_locator(
    text: str, bibmap: dict[tuple, str],
) -> tuple[str, int, list[str]]:
    """Lee-2023-style: `Author [Year: page]` / `Author [Year]`."""
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]
    count = 0
    unresolved: list[str] = []

    pattern = re.compile(
        r"([A-Z][a-zA-Z\-']+)\s+\[(\d{4}[a-c]?)(?:\s*[:,]\s*(\d+(?:[-–]\d+)?))?\]"
    )

    def replace(m: re.Match) -> str:
        nonlocal count
        author, year, page = m.group(1), m.group(2), m.group(3)
        if not _is_valid_year(year):
            return m.group(0)
        if not _passes_surname_guard(author):
            return m.group(0)
        last = normalize_surname(author)
        ck = (
            bibmap.get(((last,), year))
            or bibmap.get(((last,), year, "first-only"))
            or bibmap.get(((last,), year, "any-author"))
        )
        if not ck:
            unresolved.append(f"{author} [{year}]")
            return m.group(0)
        count += 1
        if page:
            return f"\\citet[p.~{page.replace('-', '--')}]{{{ck}}}"
        return f"\\citet{{{ck}}}"

    new_body = pattern.sub(replace, body)
    return new_body + tail, count, unresolved


def rewrite_possessive(
    text: str, bibmap: dict[tuple, str],
) -> tuple[str, int]:
    """Rewrite possessive forms `Author's Year` to
    `\\citeauthor{key}'s \\citeyearpar{key}` (clark1990quotations memo)."""
    refs_start = text.find(r"\section{References}")
    if refs_start < 0:
        refs_start = len(text)
    body = text[:refs_start]
    tail = text[refs_start:]
    count = 0

    pattern = re.compile(
        r"([A-Z][a-zA-Z\-']+)['’]s\s+(\d{4}[a-c]?)\b"
    )

    def replace(m: re.Match) -> str:
        nonlocal count
        author, year = m.group(1), m.group(2)
        if not _is_valid_year(year) or not _passes_surname_guard(author):
            return m.group(0)
        last = normalize_surname(author)
        ck = (
            bibmap.get(((last,), year))
            or bibmap.get(((last,), year, "first-only"))
            or bibmap.get(((last,), year, "any-author"))
        )
        if not ck:
            return m.group(0)
        count += 1
        return f"\\citeauthor{{{ck}}}'s \\citeyearpar{{{ck}}}"

    new_body = pattern.sub(replace, body)
    return new_body + tail, count


_SUPPORTED_STYLES = (
    "apa", "chicago", "bracket-key", "bracket-numeric",
    "bracket-author-year", "author-year-paren", "bracket-locator",
)


def main() -> int:
    args = sys.argv[1:]
    style = "chicago"
    also_possessive = False
    positional = []
    for a in args:
        if a.startswith("--style="):
            style = a.split("=", 1)[1]
        elif a == "--also-possessive":
            also_possessive = True
        else:
            positional.append(a)
    if len(positional) != 2:
        print(
            "usage: rewrite_citations.py <main.tex> <references.bib> "
            f"[--style={'|'.join(_SUPPORTED_STYLES)}] "
            "[--also-possessive]",
            file=sys.stderr,
        )
        return 2
    tex_path = Path(positional[0])
    bib_path = Path(positional[1])

    tex = tex_path.read_text(encoding="utf-8")
    tex, ocr_fixes = fix_ocr_years(tex)

    unresolved: list[str] = []
    count = 0
    new_tex = tex

    if style == "bracket-key":
        bracket_map = parse_bracket_keys(bib_path)
        new_tex, count = rewrite_bracket_keys(tex, bracket_map)
    elif style == "bracket-numeric":
        refs_start = tex.find(r"\section{References}")
        if refs_start < 0:
            refs_section = ""
        else:
            refs_section = tex[refs_start:]
        numeric_map = parse_numeric_bracket_keys(refs_section)
        new_tex, count = rewrite_bracket_numeric(tex, numeric_map)
    elif style == "bracket-author-year":
        bibmap = parse_bib(bib_path)
        new_tex, count, unresolved = rewrite_bracket_author_year(tex, bibmap)
    elif style == "author-year-paren":
        bibmap = parse_bib(bib_path)
        new_tex, count, unresolved = rewrite_author_year_paren(tex, bibmap)
    elif style == "bracket-locator":
        bibmap = parse_bib(bib_path)
        new_tex, count, unresolved = rewrite_bracket_locator(tex, bibmap)
    else:
        bibmap = parse_bib(bib_path)
        new_tex, count, unresolved = rewrite_citations(tex, bibmap, style=style)

    if also_possessive and style not in {"bracket-key", "bracket-numeric"}:
        bibmap = parse_bib(bib_path)
        new_tex, poss_count = rewrite_possessive(new_tex, bibmap)
        count += poss_count
        if poss_count:
            print(f"Possessive rewrites: {poss_count}")

    if ocr_fixes:
        print(f"OCR year fixes: {ocr_fixes}")
    if count or ocr_fixes:
        tex_path.write_text(new_tex, encoding="utf-8")
    if count:
        print(
            f"Rewrote {count} {style}-style mentions to "
            f"\\cite/\\citealt/\\citet."
        )

    if unresolved:
        seen = set()
        deduped = [u for u in unresolved if not (u in seen or seen.add(u))]
        print(f"\nUnresolved ({len(deduped)} unique):")
        for u in deduped[:30]:
            print(f"  - {u}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
