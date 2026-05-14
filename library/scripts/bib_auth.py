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


def _authors_compatible(seed: list[str], candidate: list[str],
                        title_sim: float) -> bool:
    """Return True when the candidate's authors are compatible with the
    seed's authors. Strict by default (≥1 surname overlap), with a
    high-title-confidence escape hatch for the abbreviated-bib case
    (single-author bib for a multi-author paper).

    The escape hatch matters when the bib has only the first author and
    the canonical record has 3+ authors — surname overlap can still be
    zero if the bib's spelling diverges (e.g. "Devlin, J." vs the arXiv
    record's "Jacob Devlin"), and we shouldn't reject the match in that
    case if the title is a near-perfect hit.
    """
    if _author_overlap(seed, candidate) >= 1:
        return True
    seed_clean = [a for a in seed if not _is_author_sentinel(a)]
    cand_clean = [a for a in candidate if not _is_author_sentinel(a)]
    if len(seed_clean) == 1 and len(cand_clean) >= 3 and title_sim >= 0.95:
        return True
    return False


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
    if entry_type == "article" and cr_type == "proceedings-article":
        return "inproceedings"
    return ""


# ── Conference venue allowlist (Phase B) ──────────────────────────────
#
# Bibs frequently store ML-conference papers as @article with the venue
# in `journal=`. Crossref does index many of these but only as
# `proceedings-article`, which the entry_type-filtered search misses.
# When the venue normalizes into this set, _authenticate_core retries
# Crossref with type:proceedings-article and lets _propose_type suggest
# converting the bib type to inproceedings.

def _normalize_venue_key(name: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace; canonicalize
    "proceedings of (the) X" to "proceedings of x"."""
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"\bproceedings\s+of\s+(the\s+)?", "proceedings of ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


_CONFERENCE_VENUES = frozenset({
    "advances in neural information processing systems",
    "proceedings of neurips",
    "proceedings of nips",
    "proceedings of icml",
    "proceedings of iclr",
    "proceedings of cvpr",
    "proceedings of iccv",
    "proceedings of eccv",
    "proceedings of emnlp",
    "proceedings of acl",
    "proceedings of naacl",
    "proceedings of conll",
    "proceedings of aaai",
    "proceedings of ijcai",
    "proceedings of icra",
    "proceedings of iros",
    "proceedings of kdd",
    "proceedings of www",
    "proceedings of sigir",
})


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

# Modern (post-2007) IDs look like 1810.04805 or 1810.04805v2.
# Legacy IDs look like cs.CL/0703040 or hep-th/9711200.
_ARXIV_MODERN_RE = re.compile(
    r"\b(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b", re.IGNORECASE,
)
_ARXIV_LEGACY_RE = re.compile(
    r"\barXiv:\s*([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?\b", re.IGNORECASE,
)
_ARXIV_FIELDS_TO_SCAN = (
    "eprint", "archivePrefix", "url", "journal", "note",
    "howpublished", "booktitle",
)


def _extract_arxiv_id_from_fields(current_fields: dict) -> tuple[str, str]:
    """Scan known bib fields for an arXiv ID. Returns (arxiv_id, source_field)
    or ('', '')."""
    for fld in _ARXIV_FIELDS_TO_SCAN:
        val = current_fields.get(fld) or ""
        if not val:
            continue
        # Modern requires "arXiv:" prefix or a dotted-ID context to avoid
        # false positives on volume.issue numbers.
        m = re.search(r"\barXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?\b", val, re.IGNORECASE)
        if m:
            return m.group(1), fld
        # arxiv.org URL
        m = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?\b", val, re.IGNORECASE)
        if m:
            return m.group(1), fld
        # eprint/archivePrefix fields can hold the bare ID without "arXiv:".
        if fld in ("eprint", "archivePrefix"):
            m = re.search(r"^\s*(\d{4}\.\d{4,5})(?:v\d+)?\s*$", val, re.IGNORECASE)
            if m:
                return m.group(1), fld
        m = _ARXIV_LEGACY_RE.search(val)
        if m:
            return m.group(1), fld
    return "", ""


def _parse_arxiv_atom(xml_text: str) -> list[dict]:
    """Parse the arXiv Atom XML response into our common record shape."""
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out: list[dict] = []
    for entry in root.findall("a:entry", ns):
        title_el = entry.find("a:title", ns)
        published = entry.find("a:published", ns)
        id_el = entry.find("a:id", ns)
        authors = [
            a.find("a:name", ns).text
            for a in entry.findall("a:author", ns)
            if a.find("a:name", ns) is not None
        ]
        # Extract canonical ID from <id>http://arxiv.org/abs/1810.04805v2</id>
        arxiv_id = ""
        if id_el is not None and id_el.text:
            m = re.search(r"abs/([^v\s]+)(?:v\d+)?", id_el.text)
            if m:
                arxiv_id = m.group(1)
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
            "arxiv_id": arxiv_id,
            "raw": {},
        })
    return out


def arxiv_search(title: str) -> list[dict]:
    url = (
        "http://export.arxiv.org/api/query?search_query=ti:"
        + urllib.parse.quote(f'"{title}"')
        + "&max_results=3"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
    except Exception:
        return []
    return _parse_arxiv_atom(r.text)


def _arxiv_id_lookup(arxiv_id: str) -> list[dict]:
    """Deterministic lookup of an arXiv record by ID. Hits the
    ``id_list=`` endpoint, which is exact (not fuzzy) and returns full
    canonical metadata."""
    if not arxiv_id:
        return []
    url = (
        "http://export.arxiv.org/api/query?id_list="
        + urllib.parse.quote(arxiv_id)
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
    except Exception:
        return []
    return _parse_arxiv_atom(r.text)


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


# ── OpenLibrary title search (Phase C) ─────────────────────────────────


def _openlibrary_title_search(title: str, author: str = "") -> list[dict]:
    """Fuzzy title search on OpenLibrary. Returns up to 3 hits with ISBN
    when present. Used alongside Google Books for books without DOI/ISBN
    in the bib — the two sources independently corroborate (or not).

    OpenLibrary's search is sensitive to input shape — subtitled titles
    and comma-formatted ("Lastname, First") author strings frequently
    return zero hits. Normalize to main-title-only and surname-only
    before querying. (Default search response also omits ISBN/publisher;
    explicit `fields=` brings them back.)
    """
    if not title:
        return []
    main_title = title.split(":", 1)[0].strip() if ":" in title else title
    surname = ""
    if author:
        first = author.split(" and ")[0]
        if "," in first:
            surname = first.split(",", 1)[0].strip()
        else:
            toks = first.strip().split()
            surname = toks[-1] if toks else ""
    params = {
        "title": main_title,
        "limit": "3",
        "fields": "title,author_name,first_publish_year,isbn,publisher,key",
    }
    if surname:
        params["author"] = surname
    url = (
        "https://openlibrary.org/search.json?"
        + urllib.parse.urlencode(params)
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        docs = r.json().get("docs", [])
    except Exception:
        return []
    out: list[dict] = []
    for d in docs:
        # Prefer the first ISBN-13; OpenLibrary returns a flat list mixing
        # 10- and 13-digit ISBNs across editions.
        isbn = ""
        for cand in d.get("isbn", []) or []:
            cand_clean = cand.replace("-", "").replace(" ", "")
            if len(cand_clean) == 13:
                isbn = cand_clean
                break
            if len(cand_clean) == 10 and not isbn:
                isbn = cand_clean
        publishers = d.get("publisher", []) or []
        year = ""
        if d.get("first_publish_year"):
            year = str(d["first_publish_year"])
        out.append({
            "source": "openlibrary-search",
            "doi": "",
            "title": d.get("title", ""),
            "authors": d.get("author_name", []) or [],
            "year": year,
            "type": "book",
            "container": "",
            "volume": "",
            "issue": "",
            "page": "",
            "publisher": publishers[0] if publishers else "",
            "isbn": isbn,
            "raw": d,
        })
    return out


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


# ── Recovery: ISBN extraction from indexed paper (Phase C) ─────────────

# ISBN-13 (with optional dashes/spaces) or ISBN-10 (last char may be X).
_ISBN_RE = re.compile(
    r"\b(?:ISBN(?:-1[03])?:?\s*)?"
    r"(97[89](?:[- ]?\d){10}|(?:\d(?:[- ]?\d){8})[\dXx])\b",
    re.IGNORECASE,
)


def _isbn_check_digit_valid(isbn_clean: str) -> bool:
    """Validate ISBN-10 or ISBN-13 check digit. Rejects garbage that
    happens to match the regex (page numbers, dates, etc.)."""
    s = isbn_clean.upper()
    if len(s) == 13 and s.isdigit():
        total = 0
        for i, ch in enumerate(s):
            n = int(ch)
            total += n if i % 2 == 0 else n * 3
        return total % 10 == 0
    if len(s) == 10:
        total = 0
        for i, ch in enumerate(s):
            if ch == "X":
                if i != 9:
                    return False
                n = 10
            elif ch.isdigit():
                n = int(ch)
            else:
                return False
            total += n * (10 - i)
        return total % 11 == 0
    return False


def _extract_isbns_from_paper(library: Path, citekey: str) -> list[str]:
    """Find candidate ISBNs in the first/last 3 pages of the source PDF.
    Returns deduplicated, check-digit-validated ISBNs (10- or 13-digit,
    no dashes). Used as a recovery path for books with no DOI / no ISBN
    in the bib."""
    src = library / "papers" / citekey / f"{citekey}.pdf"
    if not src.exists():
        return []
    seen: set[str] = set()
    out: list[str] = []
    # First 3 pages cover the copyright page (the typical ISBN location).
    # Last 3 pages are a secondary location for paperback reprints.
    for page_args in (["-f", "1", "-l", "3"], ["-l", "-3"]):
        try:
            text = subprocess.run(
                ["pdftotext", *page_args, str(src), "-"],
                capture_output=True, text=True, timeout=15, check=False,
            ).stdout
        except Exception:
            text = ""
        for m in _ISBN_RE.finditer(text):
            cand = re.sub(r"[\- ]", "", m.group(1)).upper()
            if cand in seen:
                continue
            if not _isbn_check_digit_valid(cand):
                continue
            seen.add(cand)
            out.append(cand)
    return out


# ── Indexed-paper page-range extraction (Phase D2 — DOI fast-path
#    cross-check). When a bib has a pre-existing DOI, the fast-path
#    used to trust it unconditionally. The 2026-05-09 audit found 3
#    cases where prior fuzzy searches had written the wrong DOI to the
#    bib, then later runs' DOI fast-path stamped them as
#    `authenticated` at score=1.0. The cross-check below compares the
#    DOI's resolved Crossref `page` field to the printed page range
#    recovered by `\pgmark{N}` markers in the indexed PDF.

_PGMARK_BODY_RE = re.compile(r"\\pgmark\{(\d+)\}")


def _pgmark_range_from_paper(library: Path, citekey: str) -> Optional[tuple[int, int]]:
    """Return (min, max) printed page numbers from the indexed
    `papers/<ck>/main.tex`'s `\\pgmark{N}` markers, or None if the file
    doesn't exist / has no markers / isn't yet indexed."""
    p = library / "papers" / citekey / "main.tex"
    if not p.exists():
        return None
    try:
        text = p.read_text(errors="replace")
    except Exception:
        return None
    nums = [int(m.group(1)) for m in _PGMARK_BODY_RE.finditer(text)]
    if not nums:
        return None
    return (min(nums), max(nums))


def _parse_crossref_page_range(pg: str) -> Optional[tuple[int, int]]:
    """Parse a Crossref `page` value (`'272-277'`, `'243'`, `'1293-1302'`,
    or various unicode-dash forms) into `(start, end)`. Returns None for
    non-numeric / malformed values."""
    if not pg:
        return None
    s = " ".join(pg.split())
    m = re.match(r"^(\d+)\s*[-–—]+\s*(\d+)$", s)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"^(\d+)$", s)
    if m:
        n = int(m.group(1))
        return (n, n)
    return None


_TEX_AUTHOR_RE = re.compile(r"\\author\{([^}]+)\}")


def _maketitle_author_count(library: Path, citekey: str) -> Optional[int]:
    """Count distinct authors visible in the indexed PDF's
    `papers/<ck>/main.tex` `\\maketitle` block (the `\\author{...}`
    line). Returns None if main.tex doesn't exist or has no
    `\\author` line.

    Used by the post-search cross-check: when a fuzzy match returns a
    record with a wildly different author count (single-author book
    matched to a 7-author journal paper, etc.), the author count from
    the PDF — extracted at indexing time, before any auth contamination
    — is a reliable cross-reference."""
    p = library / "papers" / citekey / "main.tex"
    if not p.exists():
        return None
    try:
        head = p.read_text(errors="replace")[:8000]
    except Exception:
        return None
    m = _TEX_AUTHOR_RE.search(head)
    if not m:
        return None
    raw = m.group(1)
    parts = [a.strip() for a in re.split(r"\\and|,| and ", raw) if a.strip()]
    return len(parts) or None


def _record_authors_compatible(
    rec: dict, library: Optional[Path], citekey: Optional[str],
) -> tuple[bool, str]:
    """Cross-check the matched record's author count against the
    indexed PDF's `\\author{}` line. Reject when the counts diverge
    by ≥ 3 (a strong signal that the match is for a different paper).

    Returns `(True, "")` when:
      - library / citekey not provided (caller didn't ask), OR
      - main.tex has no `\\author{}` line we can count, OR
      - record has no authors list, OR
      - counts are within 2 of each other (allowing for "et al"
        abbreviations and editor lists).

    Note: the bib's `author` field can lie (single-author overwrites
    happen all the time), but the PDF's `\\author{}` line is set at
    indexing time from the source title page and is generally honest.
    """
    if not (library and citekey):
        return (True, "")
    pdf_count = _maketitle_author_count(library, citekey)
    if pdf_count is None:
        return (True, "")
    rec_authors = rec.get("authors") or []
    rec_count = len([a for a in rec_authors if a and not _is_author_sentinel(a)])
    if rec_count == 0:
        return (True, "")
    if abs(rec_count - pdf_count) >= 3:
        return (False,
                f"PDF title page lists {pdf_count} authors but the matched "
                f"record has {rec_count}; mismatch suggests this is the "
                f"wrong paper.")
    return (True, "")


def _doi_fast_path_pages_compatible(
    rec: dict, library: Optional[Path], citekey: Optional[str],
) -> tuple[bool, str]:
    """For the DOI fast-path: cross-check the Crossref record's `page`
    against the indexed PDF's printed page range. Returns
    `(ok, reason_if_not_ok)`.

    Returns `(True, "")` when:
      - the library / citekey aren't passed in (caller didn't ask for the
        check — backward-compatible), OR
      - the indexed PDF has no pgmarks yet (paper wasn't indexed; we
        can't verify either way), OR
      - the pgmark range looks like the page-number detector latched
        onto the publication year instead of the page numbers (every
        mark is between 1900 and 2030, range span ≤ 30) — we can't
        trust the cross-check in that case, so we let the DOI through
        on the original verification basis, OR
      - the Crossref record has no parseable `page` field, OR
      - the ranges overlap (genuine match), OR
      - the PDF is plausibly an advance-article offprint (PDF starts at
        0 or 1, Crossref starts somewhere far higher — common for OUP /
        Springer / T&F online-first PDFs).

    Returns `(False, reason)` when the ranges are clearly disjoint —
    e.g. PDF prints 491-553 but Crossref's record is 215-239 (the
    `greenberg2023map` 2026-05-09 case).
    """
    if not (library and citekey):
        return (True, "")
    pdf_range = _pgmark_range_from_paper(library, citekey)
    if not pdf_range:
        return (True, "")
    pdf_min, pdf_max = pdf_range
    # Year-as-pgmark suspicion: the pgmark detector occasionally locks
    # onto a year string in the header/footer (©2007-2023, etc.) and
    # emits years instead of printed page numbers. When every mark is
    # in [1900, 2030] AND the span is small (≤ 30, typical for
    # publication-date ranges), treat the pgmark range as untrustworthy
    # and skip the cross-check.
    if 1900 <= pdf_min and pdf_max <= 2030 and (pdf_max - pdf_min) <= 30:
        return (True, "")
    cr_pages = _parse_crossref_page_range(rec.get("page", ""))
    if not cr_pages:
        return (True, "")
    cr_start, cr_end = cr_pages
    # Advance-article carve-out (offprint with reset pagination).
    if pdf_min in (0, 1) and cr_start > 10:
        return (True, "")
    # Disjoint ranges (with a small slop for off-by-one cover-page noise).
    if cr_start < pdf_min - 5 or cr_start > pdf_max + 5:
        return (False,
                f"PDF prints pages {pdf_min}-{pdf_max} but Crossref's record "
                f"for this DOI spans {cr_start}-{cr_end}; DOI is for a "
                f"different paper.")
    return (True, "")


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


_BOOK_SOURCES = {
    "google-books", "openlibrary-search", "openlibrary-isbn",
}


def _book_title_sim(seed: str, candidate: str) -> float:
    """Title similarity tolerant of subtitle elision common in book
    catalogs — OpenLibrary, for example, often lists the main title
    without the colon-subtitle. When exactly one side has a colon, also
    score by main-title-only and take the max."""
    direct = _ratio(seed, candidate)
    seed_l = (seed or "").strip().lower()
    cand_l = (candidate or "").strip().lower()
    if not seed_l or not cand_l:
        return direct
    seed_has_colon = ":" in seed_l
    cand_has_colon = ":" in cand_l
    if seed_has_colon != cand_has_colon:
        seed_main = seed_l.split(":", 1)[0].strip() if seed_has_colon else seed_l
        cand_main = cand_l.split(":", 1)[0].strip() if cand_has_colon else cand_l
        return max(direct, _ratio(seed_main, cand_main))
    return direct


def best_match(seed_title: str, seed_authors: list[str], records: list[dict],
               *, seed_year: str = "") -> Optional[Match]:
    if not records:
        return None
    best: Optional[Match] = None
    for r in records:
        if r.get("source") in _BOOK_SOURCES:
            title_sim = _book_title_sim(seed_title, r.get("title", ""))
        else:
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
    # Self-heal: when matched from arXiv, write back eprint/archivePrefix
    # so the next run can find the entry via the deterministic ID path
    # without needing to re-parse the journal/note field.
    if rec.get("source") == "arxiv" and rec.get("arxiv_id"):
        pairs.append(("eprint", rec["arxiv_id"]))
        pairs.append(("archivePrefix", "arXiv"))

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

    # Google Books + OpenLibrary fallback for books when no ISBN is
    # verified yet. Running both engines lets us require two-source
    # agreement on DOI-less books, which is the bookworld analogue of
    # Crossref+OpenAlex agreement on journal articles.
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

        try:
            ol_recs = _openlibrary_title_search(
                seed_title, ", ".join(seed_authors[:2])
            )
            sources_consulted.append("openlibrary-search")
            om = best_match(seed_title, seed_authors, ol_recs,
                           seed_year=current_fields.get("year", ""))
            if om and om.score >= 0.7:
                matches.append(om)
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

    # Phase B: conference-proceedings fallback. NeurIPS/ICML/etc. papers
    # mistyped as @article fall through the type:journal-article filter
    # above. Two retries when the journal is a known conference venue:
    #   1) type:proceedings-article + container-title — catches modern
    #      conferences that mint DOIs (post-2017 NeurIPS, ICRA, etc.).
    #   2) broad title+author without type filter — catches journal
    #      republications of conference papers (e.g. AlexNet 2012 NeurIPS
    #      republished in 2017 CACM as journal-article). Gated on a very
    #      high title similarity + author overlap to keep this path
    #      conservative; bypasses the year-distance penalty since
    #      republications routinely shift years.
    if entry_type == "article":
        journal = current_fields.get("journal", "")
        if journal and _normalize_venue_key(journal) in _CONFERENCE_VENUES:
            try:
                conf_recs = crossref_search(
                    seed_title, ", ".join(seed_authors[:2]),
                    filters={"type": "proceedings-article",
                             "container-title": journal},
                )
            except Exception:
                conf_recs = []
            sources_consulted.append("crossref-conference")
            cm = best_match(seed_title, seed_authors, conf_recs,
                            seed_year=current_fields.get("year", ""))
            if cm and cm.score >= 0.7:
                matches.append(cm)
            time.sleep(0.2)

            try:
                broad_recs = crossref_search(
                    seed_title, ", ".join(seed_authors[:2]),
                )
            except Exception:
                broad_recs = []
            for rec in broad_recs:
                title_sim = _ratio(seed_title, rec.get("title", ""))
                if title_sim >= 0.97 and _author_overlap(
                        seed_authors, rec.get("authors", [])) >= 1:
                    sources_consulted.append("crossref-republication")
                    matches.append(Match(
                        source="crossref-republication",
                        score=max(title_sim, 0.95),
                        record=rec,
                    ))
                    break
            time.sleep(0.2)

    # P14: strict type-aware filtering — drop cross-axis matches below 0.98.
    matches = [m for m in matches
               if not _is_type_mismatch_strict(entry_type, m.record, m.score)]

    if not matches:
        return AuthResult(state="failed", sources=sources_consulted, score=0.0,
                          note="no source produced a match above threshold")

    best = max(matches, key=lambda m: m.score)
    rec_has_doi = bool(best.record.get("doi"))
    # Phase C: book-cross-source acceptance. For book-typed entries
    # without a DOI from any source, accept when Google Books AND
    # OpenLibrary both score ≥0.85 — two independent book authorities
    # agreeing is the bookworld analogue of Crossref+OpenAlex agreement.
    book_cross_source = False
    if entry_type in ("book", "incollection", "inbook") and not rec_has_doi:
        gb = next((m for m in matches if m.source == "google-books"), None)
        ol = next((m for m in matches if m.source == "openlibrary-search"), None)
        if gb and ol and gb.score >= 0.85 and ol.score >= 0.85:
            book_cross_source = True
    if best.score >= 0.92 and rec_has_doi:
        state = "authenticated"
    elif best.score >= 0.92 and len(matches) >= 2:
        state = "authenticated"
    elif best.score >= 0.85 and rec_has_doi:
        state = "authenticated"
    elif isbn_verified and best.score >= 0.85:
        state = "authenticated"
    elif book_cross_source:
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
    #
    # Important caveat: the bib's DOI may have been written by a *prior*
    # fuzzy auth (crossref-search / crossref-journal-author-year), and
    # the "fast-path" then re-confirms a junk match against itself. The
    # 2026-05-09 audit caught three such cases (greenberg2023map,
    # lewis1969convention, zeki1993vision — wildly wrong DOIs accepted
    # at score=1.0). To prevent this, cross-check the Crossref record's
    # `page` against the indexed PDF's `\pgmark{N}` page range when the
    # paper is already indexed. Wildly disjoint ranges → reject.
    existing_doi = (current_fields.get("doi") or "").strip()
    if existing_doi:
        doi_recs = _doi_lookup(existing_doi)
        if doi_recs:
            rec = doi_recs[0]
            title_sim = _ratio(seed_title, rec.get("title", ""))
            rec_title = rec.get("title", "")[:80]
            page_ok, page_reason = _doi_fast_path_pages_compatible(
                rec, library, citekey,
            )
            authors_ok, authors_reason = _record_authors_compatible(
                rec, library, citekey,
            )
            if page_ok and authors_ok:
                return _authenticated_from_record(
                    rec, current_fields, entry_type,
                    sources=["crossref-doi"],
                    score=max(title_sim, 0.95),
                    note=f"DOI fast-path: {existing_doi} verified via Crossref (title sim={title_sim:.2f}, record={rec_title!r})",
                    doi_verified=True,
                )
            reject_reason = page_reason or authors_reason
            # Page mismatch — fall through to title-search recovery.
            # Don't return failure outright; the title search may find
            # the correct record. But mark the prior DOI as suspect so
            # the caller can clear it before applying field changes.
            seed_title_for_search = seed_title  # keep going
            doi_rejection_note = (
                f"DOI fast-path REJECTED: {existing_doi} → "
                f"{rec_title!r} but {reject_reason}"
            )
        else:
            doi_rejection_note = ""
        time.sleep(0.2)
    else:
        doi_rejection_note = ""

    # P8: arXiv-ID fast-path. Some bibs bury the arXiv ID in `journal`
    # ("arXiv preprint arXiv:1810.04805"), `note`, `url`, or `eprint`.
    # Pull it out and hit the deterministic id_list endpoint — no fuzzy
    # title search, so it survives single-author abbreviated bibs and
    # missing-from-Crossref preprints.
    arxiv_id, arxiv_src_field = _extract_arxiv_id_from_fields(current_fields)
    if arxiv_id:
        arxiv_recs = _arxiv_id_lookup(arxiv_id)
        if arxiv_recs:
            rec = arxiv_recs[0]
            title_sim = _ratio(seed_title, rec.get("title", ""))
            if _authors_compatible(seed_authors, rec.get("authors", []), title_sim):
                rec_title = rec.get("title", "")[:80]
                return _authenticated_from_record(
                    rec, current_fields, entry_type,
                    sources=["arxiv-id"],
                    score=max(title_sim, 0.95),
                    note=(
                        f"arXiv ID {arxiv_id} (extracted from {arxiv_src_field!r}) "
                        f"verified via arXiv API (title sim={title_sim:.2f}, record={rec_title!r})"
                    ),
                    doi_verified=False,
                )
        time.sleep(0.2)

    # Main search.
    result = _authenticate_core(seed_title, seed_authors, current_fields,
                                entry_type=entry_type)
    if result.state == "authenticated":
        # Apply the same cross-checks used by the DOI fast-path: when
        # the bib's title was already corrupted by a prior fuzzy auth
        # (so the title-search re-confirms the same wrong record), we
        # still catch it via the printed-page mismatch OR the
        # author-count mismatch against the PDF's `\maketitle` line.
        # Downgrade to `unverified` so the operator can review rather
        # than re-stamping a wrong record as authenticated.
        if library and citekey and result.matched_record:
            page_ok, page_reason = _doi_fast_path_pages_compatible(
                result.matched_record, library, citekey,
            )
            authors_ok, authors_reason = _record_authors_compatible(
                result.matched_record, library, citekey,
            )
            if not page_ok or not authors_ok:
                reject = page_reason or authors_reason
                result.state = "unverified"
                # Clear the rejected match's field_changes — callers
                # shouldn't apply fields from a paper we just rejected
                # as the wrong record.
                result.field_changes = []
                result.matched_record = None
                result.note = (
                    f"cross-check rejected: {reject} "
                    f"Original match: {result.note}"
                )
                return result
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

    # P12b: ISBN-from-PDF recovery (Phase C). For book-typed entries
    # that the main search couldn't authenticate, scan the source PDF's
    # copyright page for ISBNs and use OpenLibrary's deterministic
    # ISBN endpoint. The check-digit validator in _extract_isbns_from_paper
    # filters out garbage matches before we burn an API call.
    if entry_type in ("book", "incollection", "inbook"):
        for isbn in _extract_isbns_from_paper(library, citekey):
            isbn_recs = _isbn_lookup(isbn)
            if not isbn_recs:
                time.sleep(0.2)
                continue
            rec = isbn_recs[0]
            # OpenLibrary's ISBN endpoint doesn't return authors (it
            # gives /authors/ keys we'd need to resolve), so we can't
            # require author overlap. Instead require a high title
            # similarity — the ISBN was extracted from THIS book's
            # copyright page, so the title page is a strong corroborator.
            title_sim = _ratio(seed_title, rec.get("title", ""))
            if title_sim >= 0.8:
                # Inject the ISBN we recovered so _build_field_changes
                # writes it back to the bib (self-heal).
                rec_with_isbn = dict(rec)
                rec_with_isbn["isbn"] = isbn
                return _authenticated_from_record(
                    rec_with_isbn, current_fields, entry_type,
                    sources=list(result.sources) + ["openlibrary-isbn-from-pdf"],
                    score=max(title_sim, 0.9),
                    note=(
                        f"ISBN {isbn} extracted from PDF copyright page; "
                        f"verified via OpenLibrary (title sim={title_sim:.2f})"
                    ),
                    doi_verified=False,
                )
            time.sleep(0.2)

    # P13: journal + author + year search (ignore junk title).
    #
    # @book entries don't have a `journal` field. If a book's bib has a
    # `journal` value, it was almost certainly inherited from a wrong
    # Crossref match on a prior pass — fitting the title here treats
    # the title as a journal name, which produces high-confidence false
    # matches (lewis1969convention case: title "Convention: A
    # Philosophical Study" was searched as a journal, returning a
    # 1969 spinel-crystal paper at score 0.9). Skip for @book entries.
    if entry_type == "book":
        journal = None
    else:
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
            # Cap the journal-recovery score at 0.6 (was 0.9). Recovery
            # that ignored the title is weakly authenticated at best —
            # let the caller decide whether to accept it, and don't
            # let it satisfy the ≥0.92 authentication threshold on its
            # own. (lewis memo.)
            return _authenticated_from_record(
                rec, current_fields, entry_type,
                sources=list(result.sources) + ["crossref-journal-author-year"],
                score=0.6,
                note=f"recovered via journal+author+year search (journal={journal!r}, year={year!r}); score capped at 0.6 (title was not used)",
                doi_verified=bool(rec.get("doi")),
            )

    # Phase D: canonical fallback. Only fires when the full search
    # chain returned NO matches at all (state=="failed", not
    # "unverified" — if any source matched we leave it as unverified
    # so the user can review the proposed field changes). For book-,
    # incollection-, or inbook-typed entries with year < 1980 and no
    # DOI/ISBN, promote to `canonical` — these are pre-digital works
    # (or modern translations of pre-digital works: Saussure 1959,
    # Plato 1968 trans. Grube, Frege 1879 in The Frege Reader) that no
    # external authority registry will ever index, and the red "failed"
    # pill is misleading. Modern works (Bordwell 2008, Pylyshyn 2003)
    # stay `failed` so the user still sees the action-needed signal.
    if result.state == "failed":
        year_str = str(current_fields.get("year", "")).strip()
        try:
            year_int = int(year_str)
        except (ValueError, TypeError):
            year_int = 0
        has_identifier = bool(
            (current_fields.get("doi") or "").strip()
            or (current_fields.get("isbn") or "").strip()
        )
        if (entry_type in ("book", "incollection", "inbook")
                and 0 < year_int < 1980
                and not has_identifier):
            return AuthResult(
                state="canonical",
                score=0.0,
                sources=result.sources,
                note=(
                    f"pre-digital work ({year_int}); exhausted external "
                    "authority sources without a match"
                ),
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
