"""Authenticate a .bib entry against external sources.

Sources, in order of authority:
  1. Crossref     — https://api.crossref.org/works
  2. OpenAlex     — https://api.openalex.org/works
  3. Semantic Scholar — https://api.semanticscholar.org/graph/v1/paper/search
  4. arXiv        — https://export.arxiv.org/api/query

All free, no API keys. Each source contributes; disagreements are
resolved with conservative tie-breaks (prefer Crossref's published year,
prefer the longer author list, prefer the longer title, etc.).

Returns an AuthResult that the orchestrator can write to catalog.json.
"""

from __future__ import annotations

import html
import re
import subprocess
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

import requests

try:
    from rapidfuzz import fuzz  # type: ignore
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False


HEADERS = {
    "User-Agent": "virgil-library/0.1 (mailto:noone@example.com)",
}
TIMEOUT = 12


# ── Similarity (rapidfuzz preferred, fallback Levenshtein) ──────────────


def _ratio(a: str, b: str) -> float:
    a = (a or "").lower().strip()
    b = (b or "").lower().strip()
    if not a or not b:
        return 0.0
    if HAS_RAPIDFUZZ:
        return fuzz.ratio(a, b) / 100.0
    # Fallback: Jaccard over word sets — coarser but doesn't need rapidfuzz.
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _author_overlap(a: list[str], b: list[str]) -> int:
    """Count surnames that appear in both author lists."""
    def surnames(authors: list[str]) -> set[str]:
        out = set()
        for s in authors:
            # "Smith, Jane" or "Jane Smith"
            if "," in s:
                out.add(s.split(",", 1)[0].strip().lower())
            else:
                parts = s.strip().split()
                if parts:
                    out.add(parts[-1].lower())
        return out
    return len(surnames(a) & surnames(b))


# ── Wrong-record detection ─────────────────────────────────────────────

_REVIEW_VENUES = {"choice reviews online", "choice reviews", "choice"}


def _is_type_mismatch(entry_type: str, record: dict) -> bool:
    """Return True if the Crossref record's type is incompatible with the bib entry type."""
    if not entry_type:
        return False
    cr_type = (record.get("type") or "").lower()
    container = (record.get("container") or "").lower()
    if entry_type == "book" and cr_type in ("book-review", "journal-article"):
        return True
    if entry_type in ("incollection", "inbook") and cr_type == "journal-article":
        return True
    if container in _REVIEW_VENUES:
        return True
    return False


def _is_type_mismatch_strict(entry_type: str, record: dict, score: float) -> bool:
    """Stricter variant: also reject cross-axis matches (article<->book) below a
    near-perfect title score. Used to keep ‘Contributors’ pages from book
    front matter out of @incollection results, etc."""
    if _is_type_mismatch(entry_type, record):
        return True
    cr_type = (record.get("type") or "").lower()
    if entry_type in ("incollection", "inbook") and cr_type == "journal-article" and score < 0.98:
        return True
    if entry_type == "article" and cr_type in ("book-chapter", "book-part", "book") and score < 0.98:
        return True
    if entry_type == "book" and cr_type not in ("book", "monograph", "reference-book", "edited-book") and score < 0.98:
        return True
    return False


# ── Bib-type auto-conversion ───────────────────────────────────────────


def _propose_type(entry_type: str, cr_type: str) -> str:
    """If a Crossref-verified type disagrees with the input bib type, return
    the proposed bib type. Returns '' when no conversion applies."""
    if not entry_type or not cr_type:
        return ""
    cr_type = cr_type.lower()
    if cr_type == "posted-content" and entry_type != "unpublished":
        return "unpublished"
    if entry_type == "article" and cr_type == "book-chapter":
        return "incollection"
    return ""


# ── Source: Crossref ────────────────────────────────────────────────────


def crossref_search(title: str, author: str = "", filters: Optional[dict] = None) -> list[dict]:
    params = {"query.title": title, "rows": "3"}
    if author:
        params["query.author"] = author
    if filters:
        # Crossref `filter=` accepts comma-separated key:value pairs.
        # See https://api.crossref.org/swagger-ui/index.html#/Works
        filter_str = ",".join(f"{k}:{v}" for k, v in filters.items() if v)
        if filter_str:
            params["filter"] = filter_str
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
    except Exception:
        return []
    out: list[dict] = []
    for it in items:
        authors = []
        for a in it.get("author", []):
            given = a.get("given", "")
            family = a.get("family", "")
            if family:
                authors.append(f"{family}, {given}".strip(", "))
        out.append({
            "source": "crossref",
            "doi": it.get("DOI", ""),
            "title": " ".join(it.get("title", [])),
            "authors": authors,
            "year": _crossref_year(it),
            "type": it.get("type", ""),
            "container": " ".join(it.get("container-title", [])),
            "volume": it.get("volume", ""),
            "issue": it.get("issue", ""),
            "page": it.get("page", ""),
            "publisher": it.get("publisher", ""),
            "raw": it,
        })
    return out


def _crossref_year(item: dict) -> str:
    for key in ("published-print", "published-online", "issued"):
        dp = item.get(key, {}).get("date-parts", [[None]])
        if dp and dp[0] and dp[0][0]:
            return str(dp[0][0])
    return ""


# ── Source: OpenAlex ────────────────────────────────────────────────────


def openalex_search(title: str) -> list[dict]:
    url = (
        "https://api.openalex.org/works?per_page=3&search="
        + urllib.parse.quote(title)
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("results", [])
    except Exception:
        return []
    out: list[dict] = []
    for it in items:
        authors = []
        for a in it.get("authorships", []):
            name = a.get("author", {}).get("display_name")
            if name:
                authors.append(name)
        doi = it.get("doi", "")
        if doi.startswith("https://doi.org/"):
            doi = doi[len("https://doi.org/"):]
        out.append({
            "source": "openalex",
            "doi": doi,
            "title": it.get("title", ""),
            "authors": authors,
            "year": str(it.get("publication_year", "")) if it.get("publication_year") else "",
            "type": it.get("type", ""),
            "container": (it.get("primary_location", {}) or {})
                .get("source", {}).get("display_name", "") if it.get("primary_location") else "",
            "volume": "",
            "issue": "",
            "page": "",
            "publisher": (it.get("primary_location", {}) or {})
                .get("source", {}).get("host_organization_name", "") if it.get("primary_location") else "",
            "raw": it,
        })
    return out


# ── Source: Semantic Scholar ────────────────────────────────────────────


def semantic_scholar_search(title: str) -> list[dict]:
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/search?limit=3&query="
        + urllib.parse.quote(title)
        + "&fields=title,authors,year,externalIds,venue"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("data", [])
    except Exception:
        return []
    out: list[dict] = []
    for it in items:
        out.append({
            "source": "semanticscholar",
            "doi": (it.get("externalIds") or {}).get("DOI", ""),
            "title": it.get("title", ""),
            "authors": [a.get("name", "") for a in (it.get("authors") or [])],
            "year": str(it.get("year", "")) if it.get("year") else "",
            "type": "",
            "container": it.get("venue", ""),
            "volume": "",
            "issue": "",
            "page": "",
            "publisher": "",
            "raw": it,
        })
    return out


# ── Source: arXiv ───────────────────────────────────────────────────────


def arxiv_search(title: str) -> list[dict]:
    url = (
        "http://export.arxiv.org/api/query?search_query=ti:"
        + urllib.parse.quote(f'"{title}"')
        + "&max_results=3"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        root = ET.fromstring(r.text)
    except Exception:
        return []
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out: list[dict] = []
    for entry in root.findall("a:entry", ns):
        title_el = entry.find("a:title", ns)
        published = entry.find("a:published", ns)
        authors = [a.find("a:name", ns).text for a in entry.findall("a:author", ns) if a.find("a:name", ns) is not None]
        out.append({
            "source": "arxiv",
            "doi": "",
            "title": (title_el.text or "").strip() if title_el is not None else "",
            "authors": authors,
            "year": (published.text or "")[:4] if published is not None else "",
            "type": "preprint",
            "container": "arXiv",
            "volume": "",
            "issue": "",
            "page": "",
            "publisher": "arXiv",
            "raw": {},
        })
    return out


# ── DOI direct lookup ──────────────────────────────────────────────────


def _doi_lookup(doi: str) -> list[dict]:
    """Fetch a single Crossref record by DOI. Returns [] on failure."""
    if not doi:
        return []
    url = f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='')}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        it = r.json().get("message", {})
    except Exception:
        return []
    if not it:
        return []
    authors = []
    for a in it.get("author", []):
        given = a.get("given", "")
        family = a.get("family", "")
        if family:
            authors.append(f"{family}, {given}".strip(", "))
    return [{
        "source": "crossref-doi",
        "doi": it.get("DOI", ""),
        "title": " ".join(it.get("title", [])),
        "authors": authors,
        "year": _crossref_year(it),
        "type": it.get("type", ""),
        "container": " ".join(it.get("container-title", [])),
        "volume": it.get("volume", ""),
        "issue": it.get("issue", ""),
        "page": it.get("page", ""),
        "publisher": it.get("publisher", ""),
        "raw": it,
    }]


# ── ISBN direct lookup (OpenLibrary) ──────────────────────────────────


def _isbn_lookup(isbn: str) -> list[dict]:
    """Fetch a single OpenLibrary record by ISBN. Returns [] on failure.
    Used as a primary auth path for @book / @incollection / @inbook."""
    if not isbn:
        return []
    isbn_clean = isbn.replace("-", "").replace(" ", "").strip()
    if not isbn_clean:
        return []
    url = f"https://openlibrary.org/isbn/{urllib.parse.quote(isbn_clean)}.json"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        it = r.json()
    except Exception:
        return []
    if not it:
        return []
    # OpenLibrary's authors field is a list of {"key": "/authors/OLxxxA"}
    # references. Resolving each to a name is a separate API call, so we
    # fall back to the title-page-derived author already in the bib.
    authors: list[str] = []
    publish_date = it.get("publish_date", "")
    year = ""
    if publish_date:
        m = re.search(r"\b(\d{4})\b", publish_date)
        if m:
            year = m.group(1)
    publishers = it.get("publishers", [])
    return [{
        "source": "openlibrary-isbn",
        "doi": "",
        "title": it.get("title", ""),
        "authors": authors,
        "year": year,
        "type": "book",
        "container": "",
        "volume": "",
        "issue": "",
        "page": "",
        "publisher": publishers[0] if publishers else "",
        "raw": it,
    }]


# ── Google Books (free, no key) ────────────────────────────────────────


def _google_books_search(title: str, author: str = "") -> list[dict]:
    q_parts = [f'intitle:"{title}"']
    if author:
        q_parts.append(f'inauthor:"{author}"')
    q = "+".join(q_parts)
    url = f"https://www.googleapis.com/books/v1/volumes?q={urllib.parse.quote(q)}&maxResults=3"
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("items", [])
    except Exception:
        return []
    out = []
    for it in items:
        vi = it.get("volumeInfo", {})
        isbn = ""
        for ident in vi.get("industryIdentifiers", []):
            if ident.get("type") == "ISBN_13":
                isbn = ident.get("identifier", "")
                break
            if ident.get("type") == "ISBN_10" and not isbn:
                isbn = ident.get("identifier", "")
        out.append({
            "source": "google-books",
            "doi": "",
            "title": vi.get("title", ""),
            "authors": vi.get("authors", []),
            "year": vi.get("publishedDate", "")[:4] if vi.get("publishedDate") else "",
            "type": "book",
            "container": "",
            "volume": "",
            "issue": "",
            "page": "",
            "publisher": vi.get("publisher", ""),
            "isbn": isbn,
            "raw": it,
        })
    return out


# ── Recovery: DOI extraction from indexed paper ────────────────────────

_DOI_BODY_RE = re.compile(r"\b10\.\d{4,9}/[^\s)\}\],;'\"]+")


def _extract_dois_from_paper(library: Path, citekey: str) -> list[str]:
    """Find DOI candidates in papers/<ck>/main.tex and the source PDF.
    Deduplicated, ordered: tex first (already cleaned), then PDF first 3 pages."""
    seen: set[str] = set()
    out: list[str] = []
    tex_path = library / "papers" / citekey / "main.tex"
    if tex_path.exists():
        try:
            text = tex_path.read_text(errors="replace")
        except Exception:
            text = ""
        for m in _DOI_BODY_RE.finditer(text):
            doi = m.group(0).rstrip(".,;):]\"'")
            if doi and doi not in seen:
                seen.add(doi)
                out.append(doi)
    for ext in ("pdf",):
        src = library / "papers" / citekey / f"{citekey}.{ext}"
        if not src.exists():
            continue
        try:
            text = subprocess.run(
                ["pdftotext", "-f", "1", "-l", "3", str(src), "-"],
                capture_output=True, text=True, timeout=15, check=False,
            ).stdout
        except Exception:
            text = ""
        for m in _DOI_BODY_RE.finditer(text):
            doi = m.group(0).rstrip(".,;):]\"'")
            if doi and doi not in seen:
                seen.add(doi)
                out.append(doi)
    return out


# ── Recovery: section-title extraction from main.tex ──────────────────

_SECTION_RE = re.compile(r"\\section\*?\{([^}]+)\}")
_GENERIC_TITLES = {
    "introduction", "abstract", "bibliography", "references",
    "acknowledgements", "acknowledgments", "contributors", "contents",
    "preface", "foreword", "appendix", "notes", "summary", "conclusion",
    "conclusions", "background", "discussion", "results", "methods",
    "method", "materials and methods", "main text", "body", "footnotes",
}

_EXTRACTION_ARTIFACT_TITLES = frozenset({
    "list of figures", "list of tables", "list of abbreviations",
    "table of contents", "about the author", "about the authors",
    "introduction", "preface", "bibliography", "index", "contents",
    "acknowledgments", "acknowledgements", "notes", "abstract",
    "glossary", "appendix", "foreword", "contributors",
})


def _extract_section_titles(library: Path, citekey: str) -> list[str]:
    """Return up to 5 candidate titles from the indexed paper's section
    headings. Filters generic headings like ‘Introduction’ aggressively so
    we don't re-search Crossref for them."""
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return []
    try:
        text = tex_path.read_text(errors="replace")
    except Exception:
        return []
    out: list[str] = []
    for m in _SECTION_RE.finditer(text):
        title = m.group(1).strip()
        if not title or len(title) < 4 or len(title) > 250:
            continue
        if title.lower() in _GENERIC_TITLES:
            continue
        if title.isdigit():
            continue
        out.append(title)
        if len(out) >= 5:
            break
    return out


# ── Recovery: journal+author+year search ──────────────────────────────

_JOURNAL_ALIASES = {
    "tics": "Trends in Cognitive Sciences",
    "trends in cognitive sciences": "Trends in Cognitive Sciences",
    "trends cogn sci": "Trends in Cognitive Sciences",
    "j philos": "Journal of Philosophy",
    "the journal of philosophy": "Journal of Philosophy",
    "phil rev": "Philosophical Review",
    "philos rev": "Philosophical Review",
    "the philosophical review": "Philosophical Review",
    "phil stud": "Philosophical Studies",
    "philosophical studies": "Philosophical Studies",
    "mind and language": "Mind & Language",
    "mind language": "Mind & Language",
    "australasian j philos": "Australasian Journal of Philosophy",
    "ajp": "Australasian Journal of Philosophy",
    "j semantics": "Journal of Semantics",
    "j pragmatics": "Journal of Pragmatics",
    "vis res": "Vision Research",
}


def _normalize_journal(name: str) -> str:
    if not name:
        return ""
    key = re.sub(r"[^a-z]+", " ", name.lower()).strip()
    return _JOURNAL_ALIASES.get(key, name.strip())


def _sniff_journal_from_title(title: str) -> str:
    """Pull a probable journal name out of a junk title like
    ‘dialectica Vol. 61, N° 4’ — take the segment before Vol/No/year."""
    if not title:
        return ""
    parts = re.split(r"\b(?:Vol(?:ume)?\.?|No\.?|N°|\d{4})\b",
                     title, maxsplit=1, flags=re.IGNORECASE)
    candidate = parts[0].strip(", \t([{")
    candidate = re.sub(r"[\s,\.\-:;()\[\]{}]+$", "", candidate)
    if 4 <= len(candidate) <= 60 and candidate[0].isalpha():
        return candidate
    return ""


def _search_by_journal(authors: list[str], journal: str, year: str = "") -> list[dict]:
    """Crossref query by author surname + container-title + year.
    Used when the bib title is junk but we have a journal field."""
    journal = _normalize_journal(journal)
    if not journal or not authors:
        return []
    surname_raw = authors[0]
    if "," in surname_raw:
        surname = surname_raw.split(",", 1)[0].strip()
    else:
        toks = surname_raw.split()
        surname = toks[-1] if toks else ""
    if not surname:
        return []
    params = {
        "query.author": surname,
        "query.container-title": journal,
        "rows": "5",
    }
    if year and str(year).isdigit():
        params["filter"] = f"from-pub-date:{year},until-pub-date:{year}"
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
    except Exception:
        return []
    out: list[dict] = []
    for it in items:
        author_list = []
        for a in it.get("author", []):
            given = a.get("given", "")
            family = a.get("family", "")
            if family:
                author_list.append(f"{family}, {given}".strip(", "))
        out.append({
            "source": "crossref-journal-author-year",
            "doi": it.get("DOI", ""),
            "title": " ".join(it.get("title", [])),
            "authors": author_list,
            "year": _crossref_year(it),
            "type": it.get("type", ""),
            "container": " ".join(it.get("container-title", [])),
            "volume": it.get("volume", ""),
            "issue": it.get("issue", ""),
            "page": it.get("page", ""),
            "publisher": it.get("publisher", ""),
            "raw": it,
        })
    return out


# ── Entity decoding & author sentinels ────────────────────────────────

_AUTHOR_SENTINELS = {"&na;", "anonymous", ""}


def _is_author_sentinel(name: str) -> bool:
    s = name.strip().lower()
    return s in _AUTHOR_SENTINELS or bool(re.fullmatch(r"[\s\W]+", s))


def _decode_entities(text: str) -> str:
    """Decode HTML entities from API responses into LaTeX-safe text.
    Returns empty string for the &NA; sentinel (metadata-not-available)."""
    if not text:
        return ""
    if "&NA;" in text or "&na;" in text:
        cleaned = re.sub(r"&[Nn][Aa];", "", text).strip()
        if not cleaned:
            return ""
        text = cleaned
    if "&" not in text:
        return text
    decoded = html.unescape(text)
    decoded = decoded.replace("&", r"\&")
    return decoded


# ── Title hygiene ─────────────────────────────────────────────────────

_TITLE_PRESERVE_LOWERCASE = {
    "a", "an", "the", "and", "or", "but", "for", "nor", "of", "in",
    "on", "at", "to", "by", "as", "is", "vs", "via", "with", "from",
}


def _is_journal_as_title(title: str, journal: str) -> bool:
    if not title or not journal:
        return False
    return _ratio(title, journal) >= 0.85


def _is_byline_as_title(title: str, authors_field: str) -> bool:
    if not title or not authors_field or len(title) > 120:
        return False
    surnames: set[str] = set()
    for a in authors_field.split(" and "):
        toks = re.findall(r"[A-Za-z][A-Za-z'\-]+", a)
        if toks:
            surnames.add(toks[-1].lower())
    if not surnames:
        return False
    title_toks = {t.lower() for t in re.findall(r"[A-Za-z][A-Za-z'\-]+", title)}
    return surnames.issubset(title_toks)


def _is_all_caps_title(title: str) -> bool:
    if len(title) < 9:
        return False
    letters = [c for c in title if c.isalpha()]
    if not letters:
        return False
    upper = sum(1 for c in letters if c.isupper())
    return upper / len(letters) > 0.6


def _normalize_title_caps(title: str) -> str:
    """Smart title-case for ALL-CAPS titles.
      - First word: always capitalized.
      - Common connectors (and, of, the, ...) at non-first positions: lowercased.
      - Short ALL-CAPS alphabetic tokens of 2-3 chars: preserved as acronyms
        (NP, LSA, MIT). 4+ char ALL-CAPS tokens are treated as ordinary words
        because it's safer to title-case 'BEST' as 'Best' than to leave 'TYPE'
        as 'TYPE'."""
    title = title.rstrip(" *†‡§¶")
    out: list[str] = []
    for i, word in enumerate(title.split()):
        # Strip trailing punctuation for classification, keep it in the output.
        bare = re.sub(r"[^\w'\-]+$", "", word)
        suffix = word[len(bare):]
        if i == 0:
            out.append(bare.capitalize() + suffix)
            continue
        if bare.lower() in _TITLE_PRESERVE_LOWERCASE:
            out.append(bare.lower() + suffix)
        elif bare.isupper() and bare.isalpha() and 2 <= len(bare) <= 3:
            out.append(bare + suffix)
        else:
            out.append(bare.capitalize() + suffix)
    return " ".join(out)


def _normalize_author_caps(author_str: str) -> str:
    """Title-case ALL-CAPS author names. Preserves initials (J., A.B.)."""
    parts = author_str.split(" and ")
    out: list[str] = []
    for part in parts:
        part = part.strip()
        if not part or not _is_all_caps_title(part):
            out.append(part)
            continue
        words: list[str] = []
        for word in part.split():
            bare = re.sub(r"[^\w.\-']+$", "", word)
            suffix = word[len(bare):]
            if re.fullmatch(r"[A-Z]\.(?:[A-Z]\.)*", bare):
                words.append(bare + suffix)
            elif bare.endswith(".") and len(bare) <= 3:
                words.append(bare + suffix)
            else:
                words.append(bare.capitalize() + suffix)
        out.append(" ".join(words))
    return " and ".join(out)


def assert_title_clean(fields: dict) -> tuple[bool, str]:
    """Returns (is_clean, reason). Mutates fields to apply normalization
    when the title is salvageable (e.g., ALL-CAPS → title case, trailing
    footnote markers stripped). Returns False only when the title is
    structurally wrong (empty, byline, equal to journal)."""
    title = (fields.get("title") or "").strip()
    if not title:
        return False, "title is empty"
    if _is_journal_as_title(title, fields.get("journal", "")):
        return False, "title equals journal"
    if _is_journal_as_title(title, fields.get("booktitle", "")):
        return False, "title equals booktitle"
    if _is_byline_as_title(title, fields.get("author", "")):
        return False, "title is the author byline"
    if _is_all_caps_title(title):
        fields["title"] = _normalize_title_caps(title)
    elif title != title.rstrip(" *†‡§¶"):
        fields["title"] = title.rstrip(" *†‡§¶")
    return True, ""


# ── Combine and rank ────────────────────────────────────────────────────


@dataclass
class Match:
    source: str
    score: float
    record: dict


def best_match(seed_title: str, seed_authors: list[str], records: list[dict],
               *, seed_year: str = "") -> Optional[Match]:
    if not records:
        return None
    best: Optional[Match] = None
    for r in records:
        title_sim = _ratio(seed_title, r.get("title", ""))
        rec_authors = r.get("authors", [])
        if rec_authors and all(_is_author_sentinel(a) for a in rec_authors):
            author_overlap = 0
        else:
            author_overlap = _author_overlap(seed_authors, rec_authors)
        score = title_sim * 0.85 + min(author_overlap, 2) * 0.075
        # Year-distance penalty: large gaps almost certainly mean wrong work.
        rec_year = r.get("year", "")
        if (seed_year and rec_year
                and seed_year.isdigit() and rec_year.isdigit()):
            year_diff = abs(int(seed_year) - int(rec_year))
            if year_diff > 2:
                score /= (1 + year_diff / 5)
        if best is None or score > best.score:
            best = Match(source=r["source"], score=score, record=r)
    return best


@dataclass
class FieldChange:
    field: str
    from_value: str
    to_value: str
    source: str
    at: str


@dataclass
class AuthResult:
    state: str  # authenticated | unverified | failed | manuscript
    doi_verified: bool = False
    sources: list[str] = field(default_factory=list)
    field_changes: list[dict] = field(default_factory=list)
    matched_record: Optional[dict] = None
    score: float = 0.0
    note: str = ""
    proposed_type: str = ""  # set when Crossref type disagrees with input entry_type


def _build_field_changes(rec: dict, current_fields: dict, effective_type: str,
                         source: str) -> list[dict]:
    """Diff a matched external record against the current bib fields and
    return the list of field_changes to apply. Type-aware: booktitle vs
    journal, volume/number/pages skipped for books, isbn for books only."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    pairs: list[tuple[str, str]] = [
        ("title", rec.get("title", "")),
        ("year", rec.get("year", "")),
        ("doi", rec.get("doi", "")),
    ]
    if rec.get("container"):
        if effective_type in ("incollection", "inbook"):
            pairs.append(("booktitle", rec["container"]))
        elif effective_type == "book":
            pass
        else:
            pairs.append(("journal", rec["container"]))
    if effective_type != "book":
        if rec.get("volume"):
            pairs.append(("volume", rec["volume"]))
        if rec.get("issue"):
            pairs.append(("number", rec["issue"]))
        if rec.get("page"):
            pairs.append(("pages", rec["page"]))
    if rec.get("publisher"):
        pairs.append(("publisher", rec["publisher"]))
    if rec.get("isbn") and effective_type in ("book", "incollection", "inbook"):
        pairs.append(("isbn", rec["isbn"]))
    if rec.get("authors"):
        pairs.append(("author", " and ".join(rec["authors"])))

    field_changes: list[dict] = []
    for fld, new_val in pairs:
        if not new_val:
            continue
        cur = (current_fields.get(fld) or "").strip()
        new_str = _decode_entities(str(new_val).strip())
        if not new_str:
            continue
        if fld == "author" and _is_author_sentinel(new_str):
            continue
        if fld in ("title", "booktitle") and _is_all_caps_title(new_str):
            new_str = _normalize_title_caps(new_str)
        if fld in ("author", "editor") and _is_all_caps_title(new_str):
            new_str = _normalize_author_caps(new_str)
        if cur == new_str:
            continue
        field_changes.append({
            "field": fld, "from": cur, "to": new_str,
            "source": source, "at": now,
        })
    return field_changes


def _authenticated_from_record(rec: dict, current_fields: dict, entry_type: str,
                               sources: list[str], score: float, note: str,
                               doi_verified: bool) -> AuthResult:
    """Build an AuthResult(state='authenticated') from a single matched
    record. Used by the DOI fast-path and recovery steps."""
    proposed_type = _propose_type(entry_type, rec.get("type", ""))
    effective_type = proposed_type or entry_type
    field_changes = _build_field_changes(
        rec, current_fields, effective_type,
        source=sources[-1] if sources else (rec.get("source") or "external"),
    )
    return AuthResult(
        state="authenticated",
        doi_verified=doi_verified,
        sources=sources,
        field_changes=field_changes,
        matched_record=rec,
        score=score,
        note=note,
        proposed_type=proposed_type,
    )


def _authenticate_core(seed_title: str, seed_authors: list[str],
                       current_fields: dict, *, entry_type: str = "") -> AuthResult:
    """The original multi-source title-search flow. Returns either an
    'authenticated', 'unverified', or 'failed' result. No recovery chain.
    Called by `authenticate()` and re-called by the section-title recovery
    step with a different seed_title."""
    matches: list[Match] = []
    sources_consulted: list[str] = []

    crossref_filters: dict[str, str] = {}
    if current_fields.get("isbn"):
        crossref_filters["isbn"] = current_fields["isbn"].replace("-", "").strip()
    if entry_type in ("incollection", "inbook") and current_fields.get("booktitle"):
        crossref_filters["container-title"] = current_fields["booktitle"]
    elif entry_type == "article" and current_fields.get("journal"):
        crossref_filters["container-title"] = current_fields["journal"]
    type_filter = {
        "article": "journal-article",
        "incollection": "book-chapter",
        "inbook": "book-chapter",
        "book": "book",
    }.get(entry_type, "")
    if type_filter:
        crossref_filters["type"] = type_filter

    # ISBN direct lookup — primary auth path for books / book chapters.
    isbn_verified = False
    existing_isbn = (current_fields.get("isbn") or "").strip()
    if existing_isbn and entry_type in ("book", "incollection", "inbook"):
        isbn_recs = _isbn_lookup(existing_isbn)
        if isbn_recs:
            sources_consulted.append("openlibrary-isbn")
            im = best_match(seed_title, seed_authors, isbn_recs,
                           seed_year=current_fields.get("year", ""))
            if im and im.score >= 0.7:
                matches.append(im)
                isbn_verified = True
        time.sleep(0.2)

    # Google Books fallback for books when no ISBN is known.
    if entry_type in ("book", "incollection", "inbook") and not isbn_verified:
        try:
            gb_recs = _google_books_search(
                seed_title, ", ".join(seed_authors[:2])
            )
            sources_consulted.append("google-books")
            gm = best_match(seed_title, seed_authors, gb_recs,
                           seed_year=current_fields.get("year", ""))
            if gm and gm.score >= 0.7:
                matches.append(gm)
        except Exception:
            pass
        time.sleep(0.2)

    for fn, name in [
        (crossref_search, "crossref"),
        (openalex_search, "openalex"),
        (semantic_scholar_search, "semanticscholar"),
        (arxiv_search, "arxiv"),
    ]:
        try:
            if name == "crossref":
                recs = fn(seed_title, ", ".join(seed_authors[:2]),
                          filters=crossref_filters or None)
            else:
                recs = fn(seed_title)
        except Exception:
            recs = []
        sources_consulted.append(name)
        m = best_match(seed_title, seed_authors, recs,
                      seed_year=current_fields.get("year", ""))
        if m and m.score >= 0.7:
            matches.append(m)
        time.sleep(0.2)

    # P14: strict type-aware filtering — drop cross-axis matches below 0.98.
    matches = [m for m in matches
               if not _is_type_mismatch_strict(entry_type, m.record, m.score)]

    if not matches:
        return AuthResult(state="failed", sources=sources_consulted, score=0.0,
                          note="no source produced a match above threshold")

    best = max(matches, key=lambda m: m.score)
    rec_has_doi = bool(best.record.get("doi"))
    if best.score >= 0.92 and rec_has_doi:
        state = "authenticated"
    elif best.score >= 0.92 and len(matches) >= 2:
        state = "authenticated"
    elif best.score >= 0.85 and rec_has_doi:
        state = "authenticated"
    elif isbn_verified and best.score >= 0.85:
        state = "authenticated"
    else:
        state = "unverified"

    proposed_type = _propose_type(entry_type, best.record.get("type", "")) if rec_has_doi else ""
    effective_type = proposed_type or entry_type
    field_changes = _build_field_changes(
        best.record, current_fields, effective_type, source=best.source,
    )

    note = f"matched {best.source} with score {best.score:.2f}"
    if proposed_type:
        note += f"; type {entry_type!r} → {proposed_type!r} per Crossref"
    return AuthResult(
        state=state,
        doi_verified=bool(best.record.get("doi")),
        sources=[m.source for m in matches],
        field_changes=field_changes,
        matched_record=best.record,
        score=best.score,
        note=note,
        proposed_type=proposed_type,
    )


def authenticate(seed_title: str, seed_authors: list[str], current_fields: dict,
                 *, entry_type: str = "",
                 library: Optional[Path] = None,
                 citekey: Optional[str] = None) -> AuthResult:
    """Authenticate a bib entry against external sources.

    Pipeline:
      0. Short-circuit @unpublished and SEP-URL entries.
      1. DOI fast-path: if `fields.doi` is set and Crossref returns a record,
         trust it unconditionally and return authenticated immediately.
      2. Main multi-source title search (`_authenticate_core`).
      3. If still not authenticated AND library+citekey provided, run the
         recovery chain:
           3a. Extract DOIs from papers/<ck>/main.tex and the source PDF;
               verify each via Crossref, accept on author overlap.
           3b. Extract first non-generic \\section{} from main.tex; re-run
               the main search with that title.
           3c. Search Crossref by author surname + journal/booktitle + year,
               ignoring the (junk) title.
      4. Return the best result obtained.
    """
    if entry_type == "unpublished":
        return AuthResult(
            state="manuscript",
            note="entry_type=unpublished; skipped external authentication",
        )

    if re.search(r"plato\.stanford\.edu", current_fields.get("url", "")):
        return AuthResult(
            state="authenticated",
            doi_verified=False,
            sources=["sep"],
            score=1.0,
            note="SEP entry verified by URL (reference work; not in DOI registries)",
        )

    # Reject extraction-artifact titles before any API calls.
    if seed_title.strip().lower() in _EXTRACTION_ARTIFACT_TITLES:
        return AuthResult(
            state="failed",
            note=f"seed title {seed_title!r} is a structural heading, not a paper title",
        )

    # P7: DOI fast-path. The DOI is the canonical identifier; if Crossref
    # returns a record for it, that IS the paper, regardless of how junk
    # the bib's title field is. Field changes will replace the junk title.
    existing_doi = (current_fields.get("doi") or "").strip()
    if existing_doi:
        doi_recs = _doi_lookup(existing_doi)
        if doi_recs:
            rec = doi_recs[0]
            title_sim = _ratio(seed_title, rec.get("title", ""))
            rec_title = rec.get("title", "")[:80]
            return _authenticated_from_record(
                rec, current_fields, entry_type,
                sources=["crossref-doi"],
                score=max(title_sim, 0.95),
                note=f"DOI fast-path: {existing_doi} verified via Crossref (title sim={title_sim:.2f}, record={rec_title!r})",
                doi_verified=True,
            )
        time.sleep(0.2)

    # Main search.
    result = _authenticate_core(seed_title, seed_authors, current_fields,
                                entry_type=entry_type)
    if result.state == "authenticated":
        return result

    # Recovery chain — only if we know where the indexed paper lives.
    if not (library and citekey):
        return result

    # P11: DOI extraction from indexed paper.
    paper_dois = _extract_dois_from_paper(library, citekey)
    for doi in paper_dois:
        recs = _doi_lookup(doi)
        if not recs:
            time.sleep(0.2)
            continue
        rec = recs[0]
        # The DOI could be a citation in the body, not the paper itself —
        # require at least one author surname to match.
        if not _author_overlap(seed_authors, rec.get("authors", [])):
            time.sleep(0.2)
            continue
        return _authenticated_from_record(
            rec, current_fields, entry_type,
            sources=list(result.sources) + ["crossref-paper-doi"],
            score=0.95,
            note=f"DOI {doi} extracted from indexed paper {citekey!r}",
            doi_verified=True,
        )

    # P12: section-title recovery — re-run main search with a clean candidate.
    for cand_title in _extract_section_titles(library, citekey):
        sub = _authenticate_core(cand_title, seed_authors, current_fields,
                                 entry_type=entry_type)
        if sub.state == "authenticated":
            sub.note = f"recovered via section title {cand_title!r} from main.tex; " + sub.note
            sub.sources = sub.sources + ["paper-section-title"]
            return sub

    # P13: journal + author + year search (ignore junk title).
    journal = (current_fields.get("journal")
               or current_fields.get("booktitle")
               or _sniff_journal_from_title(seed_title))
    year = current_fields.get("year", "")
    if journal:
        recs = _search_by_journal(seed_authors, journal, year)
        # Author overlap is the validator since title is unreliable here.
        viable = [r for r in recs
                  if _author_overlap(seed_authors, r.get("authors", [])) >= 1]
        if viable:
            # Pick the one with the closest year if multiple — otherwise first.
            target_year = str(year).strip() if year else ""
            if target_year:
                viable.sort(key=lambda r: 0 if r.get("year") == target_year else 1)
            rec = viable[0]
            return _authenticated_from_record(
                rec, current_fields, entry_type,
                sources=list(result.sources) + ["crossref-journal-author-year"],
                score=0.9,
                note=f"recovered via journal+author+year search (journal={journal!r}, year={year!r})",
                doi_verified=bool(rec.get("doi")),
            )

    # Nothing recovered — return the original (unverified or failed) result.
    return result


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("usage: python bib_auth.py <title> [<author>]")
        sys.exit(2)
    title = sys.argv[1]
    authors = sys.argv[2:]
    result = authenticate(title, authors, {})
    print(json.dumps(asdict(result), indent=2))
