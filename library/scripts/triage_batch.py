"""Batch metadata extraction for files in unsorted/.

Walks every .pdf and .docx in `unsorted/` (skipping `_pending/`),
extracts triage observables, and emits one JSON line per file to stdout
(or to --output). Each row carries proposed values plus flags so the
caller can review the whole batch in one turn rather than invoking
/triage-pdf per-file.

Designed to feed `triage_apply.py` once the proposals have been
reviewed and (optionally) edited.

Usage:
  python3 triage_batch.py [--library ~/Virgil-Library] [--output triage.jsonl]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ── The flag vocabulary ───────────────────────────────────────────────────
#
# Every flag this script can put on a row, DECLARED once. It is an OPEN set —
# it grows whenever a detector is added — which is exactly why the skills must
# not carry a hand copy: `/library/triage-pending` step 2 groups rows BY FLAG,
# so a flag missing from a hand list reads to the agent as an anomaly rather
# than as a known state. Read it with `--print-flags`, never type it out.
#
# Held to the code by `library/lib/__tests__/triage-vocabulary.test.ts`, which
# discovers the emitted set from this file's own `flags.append("…")` /
# `"flags": [...]` sites and requires the two to be equal. A hand list can only
# ever be missing a name; a declared list with a census cannot.
TRIAGE_FLAGS: tuple[str, ...] = (
    # per-file observations
    "filename-mismatch",
    "long-title",
    "needs-title",
    "needs-metadata",
    "preprint",
    "sep",
    "unsupported-ext",
    "variant-copy",
    "whole-handbook",
    "year-ambiguous",
    "year-from-pdf-metadata",
    "year-scan-fallback",
    "error",
    # `.bib` rows (a row carrying `bib-only` switches triage_apply into its
    # per-entry bib path)
    "bib-only",
    "bib-manuscript",
    "bib-no-citekey",
    "bib-parse-failed",
    "citekey-exists",
)


# Regex patterns shared across detectors.
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s'\"<>]+")
_ISBN_RE = re.compile(r"\b(?:ISBN[-:]?\s*)?(97[89])?[-\s]?(\d[-\s]?){9,12}[\dXx]\b")
_SEP_RE = re.compile(r"plato\.stanford\.edu/(?:archives/[^/]+/)?entries/([a-z0-9-]+)")
_VARIANT_RE = re.compile(r"^(?P<base>.+?)\.(?P<n>\d+)\.(?P<ext>pdf|docx|tex)$", re.IGNORECASE)
# Two filename conventions are accepted:
#   "2003-Bordwell.pdf"                                  — legacy YYYY-Lastname
#   'bordwell 2008 "poetics of cinema".pdf'              — author + year (+ optional title)
#   'alikhani and stone 2018 "arrows are the verbs".pdf' — multi-author with "and"
#   'cumming, greenberg, and kelly 2017 "...".pdf'       — comma-separated authors
#   'decarlo et al 2003 "suggestive contours".pdf'       — "et al" form
# Only the FIRST author surname and the year are captured.
_FILENAME_RE_LEGACY = re.compile(
    r"^(?P<year>\d{4})-(?P<lastname>[A-Za-z][A-Za-z'\-]*)\.(?P<ext>pdf|docx|tex)$"
)
_FILENAME_RE_AUTHOR_YEAR = re.compile(
    r"^(?P<lastname>[A-Za-z][A-Za-z'\-]*)"
    r"[\s,]+"               # space or comma after first surname
    r"(?:[^0-9]*?\s+)?"     # optional middle: "and stone ", "et al ", ", greenberg, "
    r"(?P<year>\d{4})\b"
    r".*"                   # optional title / rest
    r"\.(?P<ext>pdf|docx|tex)$",
    re.IGNORECASE,
)


def _match_filename(filename: str):
    """Match against either filename convention. Returns the match or None."""
    return (
        _FILENAME_RE_LEGACY.match(filename)
        or _FILENAME_RE_AUTHOR_YEAR.match(filename)
    )


# Back-compat alias; older call sites may still reference the singular name.
_FILENAME_RE = _FILENAME_RE_LEGACY

_HANDBOOK_SIGNALS = (
    "cambridge handbook", "oxford handbook", "routledge handbook",
    "cambridge companion", "oxford companion", "routledge companion",
    "blackwell companion", "blackwell guide",
    "edited by", "series editor", "general editor",
)
_PREPRINT_SIGNALS = (
    "manuscript", "penultimate draft", "preprint", "pre-print",
    "forthcoming", "draft — please do not cite", "under review",
)
_COVER_SHEET_SIGNALS = (
    "accepted manuscript", "author manuscript", "accepted article",
    "proof copy", "galley proof", "journal pre-proof",
    "article in press", "working paper", "discussion paper",
    "this is an accepted",
)
_LINGBUZZ_RE = re.compile(r"lingbuzz/(\d+)", re.IGNORECASE)

_CITEKEY_STOPWORDS = frozenset({
    "the", "a", "an",
    "of", "in", "on", "for", "to", "from", "with", "by", "at", "as", "into", "through",
    "and", "or", "but", "nor",
    "is", "are", "was", "were",
})

# Stopword / publisher / topic words that should NOT become author
# stems. When `_propose_citekey` would otherwise mint a citekey like
# `press1980image` or `of2002classical` (extracted bylines: "Harvard
# University Press", "PHILOSOPHY OF"), reject the surname and return
# the empty-citekey sentinel so triage_apply can quarantine the row.
# See 2026-05-16-triage-no-name-pdfs.md.
_AUTHOR_STOPWORDS = frozenset({
    # Articles / prepositions / conjunctions accidentally captured as
    # "first author" from title-cased title fragments.
    "the", "a", "an",
    "of", "in", "on", "for", "to", "from", "with", "by", "at", "as",
    "into", "onto", "through", "between", "among",
    "and", "or", "but", "nor",
    "is", "are", "was", "were", "be", "being", "been",
    # Editorial role words.
    "editors", "edited", "editor", "ed", "eds",
    # Publisher / institution short forms.
    "press", "publishers", "publisher", "publishing", "publication",
    "publications", "university", "universities", "college", "school",
    "department", "institute", "society", "association", "academy",
    "books", "journal", "journals", "review", "reviews", "volume",
    "chapter", "preface", "introduction", "foreword", "epilogue",
    "abstract", "bibliography", "references", "appendix",
    # Common publishers (short forms).
    "blackwell", "wiley", "springer", "elsevier", "routledge",
    "academic", "pergamon", "kluwer", "reidel", "sage",
    "harvard", "oxford", "cambridge", "yale", "princeton", "mit",
    "stanford", "columbia", "cornell", "nyu", "ucla", "cuny",
    # Topic words that frequently get pulled from titles.
    "philosophy", "linguistics", "psychology", "physics",
    "consciousness", "language", "vision", "perception",
    "representation", "meaning", "knowledge", "reality",
    "mind", "brain", "cognition", "cognitive",
    "theory", "theories", "essay", "essays",
    # OCR / placeholder garbage that survived sanitization.
    "iii", "iiii", "iiiii", "iiiiii", "iiiiiii", "iiiiiiii",
    "xxx", "xxxx", "xxxxx",
    "untitled", "unnamed", "unknown",
})

# Fallback citekey patterns that signal "the heuristic failed and
# returned the filename stem". triage_apply should quarantine these
# rather than auto-import (which produces 560 `papers/unnamed-N/`
# directories on a placeholder-named backlog).
_DEGENERATE_FALLBACK_RE = re.compile(
    r"^(?:unnamed-?\d+|-+|untitled-?\d*|temp-?\d*|tmp-?\d*|scan\d*)$",
    re.IGNORECASE,
)


def _first_significant_word(title: str) -> str:
    for word in re.findall(r"[a-zA-Z]+", title):
        if word.lower() not in _CITEKEY_STOPWORDS:
            return word.lower()
    return ""


def _read_pdf_first_pages(pdf_path: Path, max_pages: int = 4) -> str:
    """Return text from pages 1..max_pages via pdftotext."""
    try:
        out = subprocess.run(
            ["pdftotext", "-f", "1", "-l", str(max_pages), str(pdf_path), "-"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        return out.stdout or ""
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def _marker_extract_first_pages(
    pdf_path: Path, library: Path, max_pages: int = 3,
) -> str:
    """Layout-aware extraction via marker-pdf for triage rescue.

    Returns markdown text from the first `max_pages` pages, or empty
    string if marker is unavailable or fails. Results are cached
    keyed by `sha256(pdf)` at `.virgil/extraction-cache/<sha>/triage.md`
    so repeated triage runs don't re-pay the marker cost.

    Marker is slow (~30s/PDF cold, ~1-5s warm with --skip_existing).
    Use as a RESCUE only — call only on rows where the heuristic
    citekey is empty / stopword / filename-stem. See
    2026-05-16-triage-no-name-pdfs.md for the layered design.
    """
    import hashlib
    try:
        sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    except OSError:
        return ""
    cache_dir = library / ".virgil" / "extraction-cache" / sha
    cache_path = cache_dir / "triage.md"
    if cache_path.exists():
        try:
            return cache_path.read_text(encoding="utf-8")
        except OSError:
            pass
    # Attempt marker. Imports are local so callers without marker
    # installed don't pay the import cost (~1s).
    try:
        from extract import marker_extract_first_pages  # type: ignore
    except Exception:
        return ""
    try:
        md = marker_extract_first_pages(pdf_path, max_pages=max_pages)
    except Exception:
        md = ""
    if md:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(md, encoding="utf-8")
        except OSError:
            pass
    return md


def _read_docx_meta(docx_path: Path) -> dict[str, Any]:
    """Return core properties + first paragraphs."""
    try:
        from extract_docx import core_properties
        return core_properties(str(docx_path))
    except Exception:
        return {"title": "", "author": "", "first_paragraphs": []}


# Strip TeX-style brace/escape noise from a single field value. Cheap;
# good enough for citekey / byline detection.
_TEX_BRACE_RE = re.compile(r"[{}]")


def _strip_tex(value: str) -> str:
    return _TEX_BRACE_RE.sub("", value).strip()


def _balanced_brace_arg(text: str, start: int) -> Optional[tuple[str, int]]:
    """If text[start] == '{', return (inner, index_after_close); else None."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 1
    i = start + 1
    while i < len(text) and depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    if depth != 0:
        return None
    return (text[start + 1:i - 1], i)


def _read_tex_meta(tex_path: Path) -> dict[str, Any]:
    """Extract \\title{}, \\author{}, \\date{}, plus the first ~2000 chars.

    Strips comment lines (% prefix) before scanning so commented-out
    \\title{...} stubs in the preamble don't trip us up.
    """
    try:
        text = tex_path.read_text(errors="replace")
    except Exception:
        return {"title": "", "author": "", "date": "", "first_paragraphs": []}

    lines: list[str] = []
    for raw in text.splitlines():
        stripped = raw.lstrip()
        if stripped.startswith("%"):
            continue
        lines.append(raw)
    cleaned = "\n".join(lines)

    def _grab(cmd: str) -> str:
        m = re.search(r"\\" + cmd + r"\s*\{", cleaned)
        if not m:
            return ""
        arg = _balanced_brace_arg(cleaned, m.end() - 1)
        return _strip_tex(arg[0]) if arg else ""

    title = _grab("title")
    author = _grab("author")
    date = _grab("date")

    # First ~2000 chars of the body for downstream regex (DOI, ISBN, year).
    return {
        "title": title,
        "author": author,
        "date": date,
        "first_paragraphs": [cleaned[:2000]],
    }


def _parse_bib_file(bib_path: Path) -> list[dict[str, Any]]:
    """Parse a .bib file dropped into unsorted/ — one dict per entry."""
    try:
        from _bib_parse import read_bib_file
        return read_bib_file(bib_path)
    except Exception as e:
        return [{
            "_parse_error": str(e),
            "raw": "",
        }]


def _extract_byline(first_page: str) -> list[str]:
    """Heuristic: lines near the top that look like author bylines."""
    out: list[str] = []
    for line in first_page.splitlines()[:30]:
        line = line.strip()
        if not line or len(line) > 200:
            continue
        # Author-like: capitalized tokens, possibly with commas/and/&
        if re.match(r"^([A-Z][a-zA-Z'\-]+(\s+[A-Z][a-zA-Z'\-\.]+)+)([,&]|\s+and\s+)?", line):
            out.append(line)
        if len(out) >= 5:
            break
    return out


_FOOTNOTE_MARKERS_RE = re.compile(
    r"[\*†‡§¶]"
    r"|[¹²³⁰-⁹]"
    r"|[ⁱⁿ]"
)


def _sanitize_byline(raw: str) -> str:
    s = raw.strip()
    if s.lower().startswith("by "):
        s = s[3:].strip()
    s = _FOOTNOTE_MARKERS_RE.sub("", s)
    s = re.sub(r"\s{2,}", " ", s)
    s = s.rstrip(",").strip()
    return s


def _first_byline_surname(line: str) -> str:
    """Return the first author's surname from a Western-order byline line.

    Strips 'et al' / 'et al.', splits on the first author boundary
    (',' | '&' | '\\&' | ' and '), and returns the last whitespace word
    of the first chunk with non-letter chars removed.
    """
    s = line.strip()
    if not s:
        return ""
    # Drop ' et al' / ' et al.' (case-insensitive) — trailing form first
    # so 'Doug DeCarlo et al.' collapses to 'Doug DeCarlo'.
    s = re.sub(r"[,\s]*\bet\s+al\.?\s*$", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"\s+et\s+al\.?\s+", " ", s, flags=re.IGNORECASE).strip()
    # ' and ' takes priority over ',' so 'Edvard I. Moser, Emilio Kropff
    # and May-Britt Moser' yields 'Edvard I. Moser' as the first chunk.
    first = re.split(
        r"\s*(?:,\s*and\s+|,\s+|\s+and\s+|\s+&\s+|\s+\\&\s+)",
        s,
        maxsplit=1,
    )[0]
    toks = first.split()
    if not toks:
        return ""
    return re.sub(r"[^A-Za-z]", "", toks[-1])


_TITLE_DENYLIST_RE = re.compile(
    r"\bVol\.\s*\d"
    r"|\bpp\.\s*\d"
    r"|\(\d{4}\)"
    r"|\bAdvance Access\b"
    r"|\bORIGINAL\s+RESEARCH\b"
    r"|\bcontributed\s+articles?\b"
    r"|\bDraft of\b"
    r"|\bdownloaded by\b"
    r"|\bThis article was\b"
    r"|\bdoi:\s*10\."
    r"|\b\d{4}-\d{3}[\dXx]\b"
    r"|^\d+$"
    r"|^https?://"
    r"|\bAll rights reserved\b"
    r"|\bPublished by\b"
    r"|\bReceived\b.*\bAccepted\b"
    r"|\bElsevier\b"
    r"|\bSpringer\b"
    r"|\bWiley\b"
    r"|^[a-z]+\d{4}-\d+"
    r"|^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d"
    r"|^xxx\b",
    re.IGNORECASE,
)

_BYLINE_RE = re.compile(
    r"^([A-Z][a-zA-Z'\-]+(\s+[A-Z][a-zA-Z'\-\.]+)+)([,&]|\s+and\s+)?"
)

_ALL_CAPS_LINE_RE = re.compile(r"^[A-Z\s&,\-:]+$")


def _read_pdf_title_metadata(pdf_path: Path) -> str:
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            capture_output=True, text=True, timeout=10, check=False,
        )
        for line in (out.stdout or "").splitlines():
            if line.startswith("Title:"):
                title = line[6:].strip()
                if not title or len(title) < 5:
                    return ""
                low = title.lower()
                if any(s in low for s in ("untitled", "microsoft word", ".doc", ".pdf")):
                    return ""
                stem = pdf_path.stem.replace("-", " ").replace("_", " ").lower()
                if title.lower().replace(" ", "") == stem.replace(" ", ""):
                    return ""
                return title
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return ""


def _extract_title_candidate(first_pages_text: str, pdf_path: Optional[Path] = None) -> str:
    if pdf_path:
        meta_title = _read_pdf_title_metadata(pdf_path)
        if meta_title and not _TITLE_DENYLIST_RE.search(meta_title):
            return meta_title

    lines = first_pages_text.splitlines()
    candidate_parts: list[str] = []

    # Skip cover-sheet boilerplate by starting scan later.
    start_line = 0
    header_text = first_pages_text[:500].lower()
    if any(sig in header_text for sig in _COVER_SHEET_SIGNALS):
        start_line = 10

    for i, raw_line in enumerate(lines[start_line:start_line + 40], start=start_line):
        line = raw_line.strip()
        if not line or len(line) < 10 or len(line) > 300:
            continue
        if _TITLE_DENYLIST_RE.search(line):
            continue
        if _BYLINE_RE.match(line):
            continue
        if _ALL_CAPS_LINE_RE.match(line) and len(line) < 60:
            continue

        candidate_parts.append(line)
        for j in range(i + 1, min(i + 3, len(lines))):
            next_line = lines[j].strip()
            if not next_line:
                continue
            if next_line[0].islower() or next_line[0].isdigit():
                break
            if _TITLE_DENYLIST_RE.search(next_line):
                break
            if _BYLINE_RE.match(next_line):
                break
            if len(next_line) > 200:
                break
            candidate_parts.append(next_line)
        break

    if not candidate_parts:
        return ""
    return " ".join(candidate_parts)


def _looks_like_author_in_byline(lastname: str, byline_text: str) -> bool:
    if not lastname:
        return True
    return lastname.lower() in byline_text.lower()


def _detect_year_in_text(text: str, flags: Optional[list[str]] = None) -> Optional[str]:
    """Look for explicit pub-year markers. Collects all candidates and
    returns the one with the highest cumulative weight."""
    weighted_patterns = [
        (r"©\s*(\d{4})", 5),
        (r"copyright\s*(?:©\s*)?(\d{4})", 5),
        (r"first\s+published\s+(?:in\s+)?(\d{4})", 4),
        (r"published\s+(?:online\s+|in\s+)?(\d{4})", 3),
        (r"vol(?:ume)?\.?\s*\d+\s*\((\d{4})\)", 2),
        (r"received[:\s]+\S+\s+\d+,?\s+(\d{4})", 1),
    ]
    year_weights: dict[str, int] = {}
    for pat, weight in weighted_patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            year = m.group(1)
            if 1800 <= int(year) <= 2100:
                year_weights[year] = year_weights.get(year, 0) + weight
    if year_weights:
        ranked = sorted(year_weights.items(), key=lambda x: x[1], reverse=True)
        if (flags is not None and len(ranked) >= 2
                and abs(int(ranked[0][0]) - int(ranked[1][0])) > 5):
            flags.append("year-ambiguous")
        return ranked[0][0]
    # Broader fallback (2026-05-16-triage-no-name-pdfs.md): scan the
    # whole text for any plausible 1850..current_year and take the
    # earliest. Most published works mention their year somewhere
    # in the first few pages — bib entries, acknowledgements, footers.
    import datetime
    current_year = datetime.datetime.now().year
    plausible = [
        int(m.group(0)) for m in re.finditer(r"\b(?:18|19|20)\d{2}\b", text)
        if 1850 <= int(m.group(0)) <= current_year
    ]
    if plausible:
        if flags is not None:
            flags.append("year-scan-fallback")
        return str(min(plausible))
    return None


def _detect_year_in_pdf_metadata(pdf_path: Path) -> Optional[str]:
    """Last-resort year fallback: PDF creationDate / modDate. Pulls
    `D:YYYY...` from pdfinfo. Not as good as content-derived years
    but better than nothing for placeholder-named files.
    """
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            capture_output=True, text=True, timeout=10, check=False,
        )
        for line in (out.stdout or "").splitlines():
            if line.startswith("CreationDate:") or line.startswith("ModDate:"):
                m = re.search(r"\b(19|20)(\d{2})\b", line)
                if m:
                    yr = int(m.group(1) + m.group(2))
                    if 1980 <= yr <= 2100:
                        return str(yr)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def _detect_isbn(text: str) -> str:
    for m in _ISBN_RE.finditer(text):
        candidate = re.sub(r"[-\s]", "", m.group(0).replace("ISBN", "").replace("isbn", "").replace(":", ""))
        candidate = re.sub(r"^[A-Za-z]+", "", candidate)
        if len(candidate) in (10, 13) and candidate[:-1].isdigit():
            return candidate
    return ""


def _detect_handbook(text: str) -> Optional[str]:
    text_lower = text.lower()
    if not any(sig in text_lower for sig in _HANDBOOK_SIGNALS):
        return None
    if "edited by" not in text_lower and "series editor" not in text_lower and "general editor" not in text_lower:
        # Just a handbook-name mention; not necessarily a whole-handbook PDF.
        # Require at least one editor signal too.
        return None
    # Try to extract the handbook title.
    for line in text.splitlines()[:50]:
        if any(sig in line.lower() for sig in ("handbook", "companion", "guide")):
            return line.strip()[:200]
    return "edited volume"


def _detect_preprint(text: str) -> Optional[str]:
    text_lower = text.lower()
    for sig in _PREPRINT_SIGNALS:
        if sig in text_lower:
            return sig
    if _LINGBUZZ_RE.search(text):
        return "lingbuzz"
    return None


def _read_catalog(library: Path) -> dict:
    p = library / ".virgil" / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"entries": []}


def _find_citekey_for_filename(catalog: dict, filename: str) -> str:
    for e in catalog.get("entries", []):
        pdf = e.get("pdf") or {}
        if pdf.get("filename") == filename:
            return e.get("citekey", "")
        for alt in pdf.get("alternates", []) or []:
            if alt == filename:
                return e.get("citekey", "")
    return ""


def _propose_citekey(lastname: str, year: str, title: str, fallback: str) -> str:
    """Propose a citekey from heuristic-extracted (lastname, year, title).

    Returns an empty string when the heuristic produced a stopword
    lastname or a degenerate filename fallback — callers (triage_apply)
    quarantine empty citekeys to `unsorted/_needs-metadata/` rather
    than minting `papers/unnamed-N/` directories. See 2026-05-16-
    triage-no-name-pdfs.md.
    """
    stem = re.sub(r"[^a-zA-Z]", "", lastname).lower() if lastname else ""
    if (
        stem
        and year
        and stem not in _AUTHOR_STOPWORDS
        and len(stem) >= 2
    ):
        word = _first_significant_word(title)
        return stem + year + word
    # No usable author-year; refuse to return a degenerate filename
    # fallback. The empty-string sentinel routes to quarantine.
    if not fallback or _DEGENERATE_FALLBACK_RE.match(fallback):
        return ""
    # Real filename-stem fallback: keep it but mark via the surrounding
    # row's flags (`needs-metadata`) downstream.
    return fallback


def triage_one(path: Path, library: Path, catalog: dict) -> dict[str, Any]:
    filename = path.name
    ext = path.suffix.lower().lstrip(".")
    flags: list[str] = []
    notes: list[str] = []
    proposed_fields: dict[str, str] = {}

    # ── Variant-copy detection ────────────────────────────────────────
    vm = _VARIANT_RE.match(filename)
    if vm:
        base_stem = vm.group("base")
        base_letters = re.sub(r"[^A-Za-z]", "", base_stem)
        # Degenerate-base safeguard: refuse to treat `-.<N>.pdf`,
        # `<digits>.<N>.pdf`, or single-letter-base files as variants.
        # A real citekey has letters; without them the variant heuristic
        # collapses 600+ unrelated placeholder-named PDFs into one
        # ghost-parent cluster (2026-05-16-triage-no-name-pdfs.md).
        if len(base_letters) < 2:
            vm = None
    if vm:
        base_stem = vm.group("base")
        base_ext = vm.group("ext").lower()
        base_filename = f"{base_stem}.{base_ext}"
        # Sibling lives either as a still-untriaged file in unsorted/ or
        # already triaged as papers/<base_stem>/<base_stem>.<ext>.
        sibling_unsorted = library / "unsorted" / base_filename
        sibling_paper = library / "papers" / base_stem / base_filename
        if sibling_unsorted.exists() or sibling_paper.exists():
            existing = _find_citekey_for_filename(catalog, base_filename)
            return {
                "filename": filename,
                "extension": ext,
                "flags": ["variant-copy"],
                "existingCitekey": existing,
                "siblingFilename": base_filename,
                "notes": [
                    f"Looks like variant of {base_filename!r}"
                    + (f" (citekey={existing!r})" if existing else " (no catalog entry yet)")
                ],
            }

    # ── Read content ──────────────────────────────────────────────────
    if ext == "pdf":
        first_pages_text = _read_pdf_first_pages(path, max_pages=4)
    elif ext == "docx":
        meta = _read_docx_meta(path)
        first_pages_text = "\n".join(meta.get("first_paragraphs", []))
        if meta.get("title"):
            proposed_fields["title"] = meta["title"]
        if meta.get("author"):
            proposed_fields["author"] = meta["author"]
    elif ext == "tex":
        meta = _read_tex_meta(path)
        first_pages_text = "\n".join(meta.get("first_paragraphs", []))
        if meta.get("title"):
            proposed_fields["title"] = meta["title"]
        if meta.get("author"):
            proposed_fields["author"] = meta["author"]
        # \date{...} can be a 4-digit year, a free-form date, or empty.
        if meta.get("date"):
            year_m = re.search(r"\b(\d{4})\b", meta["date"])
            if year_m and 1800 <= int(year_m.group(1)) <= 2100:
                proposed_fields.setdefault("year", year_m.group(1))
    else:
        return {"filename": filename, "extension": ext, "flags": ["unsupported-ext"], "notes": []}

    # Truncate text in the report for review.
    text_preview = first_pages_text[:2000]

    # ── Title candidate (PDF only) ───────────────────────────────────
    if ext == "pdf" and "title" not in proposed_fields:
        title_candidate = _extract_title_candidate(first_pages_text, pdf_path=path)
        if title_candidate:
            proposed_fields["title"] = title_candidate
            word_count = len(title_candidate.split())
            if word_count > 30:
                flags.append("long-title")
                notes.append(f"Extracted title is {word_count} words (>30); may include preamble")
        else:
            flags.append("needs-title")
            notes.append("No title candidate extracted; needs manual title entry")

    # ── Filename pattern ──────────────────────────────────────────────
    fm = _match_filename(filename)
    filename_year = fm.group("year") if fm else ""
    filename_lastname = fm.group("lastname").lower() if fm else ""

    # ── Filename-vs-content author ────────────────────────────────────
    byline = [_sanitize_byline(b) for b in _extract_byline(first_pages_text)]
    byline_text = " ".join(byline)
    filename_mismatch = False
    if filename_lastname and byline_text and not _looks_like_author_in_byline(filename_lastname, byline_text):
        filename_mismatch = True
        flags.append("filename-mismatch")
        notes.append(f"Filename author {filename_lastname!r} not in byline {byline_text[:120]!r}")

    # ── Year sanity check ─────────────────────────────────────────────
    content_year = _detect_year_in_text(first_pages_text, flags)
    if filename_year and content_year and filename_year != content_year:
        notes.append(f"Filename year {filename_year} != content year {content_year}; using content year")
    chosen_year = content_year or filename_year or ""
    # Final fallback: PDF metadata creation/modification date. Lower
    # signal quality than content-derived years, so only used when
    # nothing else fired (2026-05-16-triage-no-name-pdfs.md).
    if not chosen_year and ext == "pdf":
        meta_year = _detect_year_in_pdf_metadata(path)
        if meta_year:
            chosen_year = meta_year
            flags.append("year-from-pdf-metadata")

    # ── DOI / ISBN / SEP detection ────────────────────────────────────
    doi_match = _DOI_RE.search(first_pages_text)
    if doi_match:
        proposed_fields["doi"] = doi_match.group(0)

    isbn = _detect_isbn(first_pages_text)
    if isbn:
        proposed_fields["isbn"] = isbn

    sep_match = _SEP_RE.search(first_pages_text)
    if sep_match:
        flags.append("sep")
        slug = sep_match.group(1)
        proposed_fields.setdefault("url", f"https://plato.stanford.edu/entries/{slug}/")
        proposed_fields.setdefault("booktitle", "The Stanford Encyclopedia of Philosophy")
        proposed_fields.setdefault("editor", "Edward N. Zalta and Uri Nodelman")
        proposed_fields.setdefault("publisher", "Metaphysics Research Lab, Stanford University")

    # ── Whole-handbook detection ──────────────────────────────────────
    handbook_title = _detect_handbook(first_pages_text)
    if handbook_title and filename_mismatch:
        flags.append("whole-handbook")
        notes.append(f"Looks like a whole edited volume ({handbook_title!r}); needs chapter info")

    # ── Preprint detection ────────────────────────────────────────────
    preprint_signal = _detect_preprint(first_pages_text)
    if preprint_signal:
        flags.append("preprint")
        proposed_fields.setdefault("note", f"Preprint ({preprint_signal})")

    # ── Choose entry type ─────────────────────────────────────────────
    if "preprint" in flags:
        proposed_type = "unpublished"
    elif "sep" in flags:
        proposed_type = "incollection"
    elif isbn and "edited by" in first_pages_text.lower():
        proposed_type = "incollection"
    elif isbn:
        proposed_type = "book"
    elif ext == "tex" and not proposed_fields.get("doi"):
        # A .tex source without a DOI is treated as a manuscript by default.
        proposed_type = "unpublished"
    else:
        proposed_type = "article"

    # ── Citekey proposal ──────────────────────────────────────────────
    content_lastname = _first_byline_surname(byline[0]) if byline else ""
    chosen_lastname = content_lastname if filename_mismatch else (filename_lastname or content_lastname)

    fallback = filename.rsplit(".", 1)[0]
    proposed_citekey = _propose_citekey(chosen_lastname, chosen_year, proposed_fields.get("title", ""), fallback)
    if "sep" in flags:
        if proposed_citekey:
            proposed_citekey += "sep"
    # Empty citekey signals the heuristic failed (degenerate fallback
    # OR stopword lastname). Flag so triage_apply can quarantine the
    # row to unsorted/_needs-metadata/ instead of minting a garbage
    # papers/ directory.
    if not proposed_citekey:
        flags.append("needs-metadata")
        notes.append(
            "Heuristic could not derive a citekey from filename / extracted "
            "byline. Quarantine to unsorted/_needs-metadata/ for manual "
            "review or --llm-rescue pass."
        )

    # ── Assemble row ──────────────────────────────────────────────────
    row: dict[str, Any] = {
        "filename": filename,
        "extension": ext,
        "proposedCitekey": proposed_citekey,
        "proposedType": proposed_type,
        "flags": flags,
        "proposedFields": proposed_fields,
        "filenameAuthor": filename_lastname,
        "filenameYear": filename_year,
        "contentAuthor": content_lastname,
        "contentYear": content_year or "",
        "byline": byline[:3],
        "textPreview": text_preview,
        "notes": notes,
    }
    return row


def triage_bib(path: Path, library: Path, catalog: dict) -> list[dict[str, Any]]:
    """Fan a multi-entry .bib file into one triage row per entry.

    Each row carries flags=["bib-only"] so triage_apply switches into
    the bib-only branch (no source file move; queue authenticate).
    """
    filename = path.name
    parsed = _parse_bib_file(path)

    # Top-level parse failure → return a single row flagged for parking.
    if len(parsed) == 1 and "_parse_error" in parsed[0]:
        return [{
            "filename": filename,
            "extension": "bib",
            "flags": ["bib-only", "bib-parse-failed"],
            "notes": [f"bib parse failed: {parsed[0]['_parse_error']}"],
        }]
    if not parsed:
        return [{
            "filename": filename,
            "extension": "bib",
            "flags": ["bib-only", "bib-parse-failed"],
            "notes": ["no @-entries found"],
        }]

    # Build a fast lookup of existing citekeys for collision flags.
    #
    # The key set is catalog rows UNION master.bib entries, and the state comes
    # from the F#4 door (`% bib.state` first, catalog row as fallback). Asking
    # the catalog alone — the pre-442 shape — left every FILELESS reference
    # unflagged: the reviewer saw a brand-new entry where the library already
    # held an authenticated one, and the apply step then overwrote it.
    from _tools import (
        catalog_row_bib_state,
        master_bib_state_map,
        normalize_citekey,
        read_master_bib,
    )

    master_path = library / "master.bib"
    master_text = master_path.read_text() if master_path.exists() else ""
    master_states = master_bib_state_map(master_text)
    master_keys = set(read_master_bib(master_path, text=master_text))

    existing_keys: set[str] = set(master_keys)
    existing_states: dict[str, str] = {}
    for e in catalog.get("entries", []):
        ck = e.get("citekey")
        if ck:
            existing_keys.add(ck)
            state = catalog_row_bib_state(e)
            if state:
                existing_states[ck] = state
    # master wins a disagreement (the F#4 read order).
    for ck in existing_keys:
        state = master_states.get(normalize_citekey(ck))
        if state:
            existing_states[ck] = state

    rows: list[dict[str, Any]] = []
    for entry in parsed:
        citekey = (entry.get("citekey") or "").strip()
        entry_type = (entry.get("type") or "misc").strip().lower()
        fields = {k: _strip_tex(v) for k, v in (entry.get("fields") or {}).items()}
        raw = entry.get("raw") or ""
        flags = ["bib-only"]
        notes: list[str] = []

        if not citekey:
            flags.append("bib-no-citekey")
            notes.append("entry missing citekey; will be skipped on apply")
        if citekey and citekey in existing_keys:
            flags.append("citekey-exists")
            notes.append(f"existing entry: bib.state={existing_states.get(citekey, 'unknown')!r}")
        # Manuscript hint: @unpublished is terminal.
        if entry_type == "unpublished":
            flags.append("bib-manuscript")

        rows.append({
            "filename": filename,
            "extension": "bib",
            "bibEntryRaw": raw,
            "proposedCitekey": citekey,
            "proposedType": entry_type,
            "proposedFields": fields,
            "proposedBibState": "manuscript" if entry_type == "unpublished" else "unverified",
            "flags": flags,
            "notes": notes,
        })
    return rows


def _needs_marker_rescue(row: dict[str, Any]) -> bool:
    """A row is a marker-rescue candidate when the heuristic citekey
    is empty (stopword/degenerate) OR the row carries `needs-metadata`
    / `needs-title` flags. Avoids marker on rows the cheap heuristic
    already nailed."""
    if row.get("extension") != "pdf":
        return False
    if not row.get("proposedCitekey"):
        return True
    flags = row.get("flags") or []
    return "needs-metadata" in flags or "needs-title" in flags


def _marker_rescue_row(
    row: dict[str, Any], path: Path, library: Path, catalog: dict,
) -> dict[str, Any]:
    """Re-run triage on one row using marker-extracted first pages
    instead of pdftotext. Idempotent — if marker fails, returns the
    original row unchanged.
    """
    md = _marker_extract_first_pages(path, library, max_pages=3)
    if not md:
        return row
    # Reuse triage_one's per-row logic by stuffing a synthetic
    # `_marker_text_preview` into the row's notes and re-running. The
    # cheapest path is to splice the markdown into the byline/title
    # detectors directly. For now we recompute title + byline + year
    # from the markdown and overlay.
    title = _extract_title_from_markdown(md)
    bylines = _extract_byline_from_markdown(md)
    year = _detect_year_in_text(md)
    flags = list(row.get("flags") or [])
    notes = list(row.get("notes") or [])
    fields = dict(row.get("proposedFields") or {})
    if title:
        fields["title"] = title
        if "needs-title" in flags:
            flags.remove("needs-title")
    if bylines:
        row["byline"] = bylines[:3]
    surname = _first_byline_surname(bylines[0]) if bylines else ""
    chosen_year = year or row.get("contentYear") or row.get("filenameYear") or ""
    fallback = path.stem
    new_ck = _propose_citekey(surname, chosen_year, fields.get("title", ""), fallback)
    if new_ck:
        row["proposedCitekey"] = new_ck
        if "needs-metadata" in flags:
            flags.remove("needs-metadata")
        notes.append(f"marker-rescue: citekey {new_ck!r} from {path.name}")
    else:
        notes.append(
            "marker-rescue: still no usable citekey "
            "(consider --llm-rescue)"
        )
    row["flags"] = flags
    row["notes"] = notes
    row["proposedFields"] = fields
    return row


# Lightweight markdown helpers — only used for marker rescue rows.
def _extract_title_from_markdown(md: str) -> str:
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("# "):
            cand = s.lstrip("# ").strip()
            if cand and not _TITLE_DENYLIST_RE.search(cand):
                return cand
    return ""


def _extract_byline_from_markdown(md: str) -> list[str]:
    out: list[str] = []
    after_title = False
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("# "):
            after_title = True
            continue
        if not after_title or not s:
            continue
        if s.startswith("#"):  # subheading or section, byline window closed
            break
        cleaned = re.sub(r"[*_`]", "", s)
        if _BYLINE_RE.match(cleaned):
            out.append(cleaned)
        if len(out) >= 5:
            break
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Batch-extract triage observables from unsorted/.")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--output", default="-",
                   help="Output JSONL path; '-' for stdout (default)")
    p.add_argument("--marker-rescue", action="store_true",
                   help=(
                       "After the cheap heuristic pass, re-run rows whose "
                       "citekey is empty / stopword / filename-stem through "
                       "marker-pdf for layout-aware extraction. Slow per row "
                       "but only fires on heuristic-failed rows (typically "
                       "10-30%% of a placeholder-named backlog). Results "
                       "cached at .virgil/extraction-cache/<sha256>/."
                   ))
    p.add_argument("--print-flags", action="store_true",
                   help=(
                       "Print the flag vocabulary (one per line) and exit. "
                       "The DOOR for any reader that needs the set — a skill "
                       "must run this rather than carry a hand copy."
                   ))
    args = p.parse_args()

    if args.print_flags:
        for flag in TRIAGE_FLAGS:
            print(flag)
        return 0

    library = Path(args.library).expanduser()
    unsorted_dir = library / "unsorted"
    if not unsorted_dir.exists():
        print(f"No unsorted/ at {unsorted_dir}", file=sys.stderr)
        return 1

    catalog = _read_catalog(library)

    rows: list[dict[str, Any]] = []
    path_by_filename: dict[str, Path] = {}
    for path in sorted(unsorted_dir.iterdir()):
        if path.is_dir():
            continue
        if path.name.startswith("_") or path.name.startswith("."):
            continue
        ext = path.suffix.lower()
        if ext not in (".pdf", ".docx", ".tex", ".bib"):
            continue
        path_by_filename[path.name] = path
        try:
            if ext == ".bib":
                rows.extend(triage_bib(path, library, catalog))
            else:
                rows.append(triage_one(path, library, catalog))
        except Exception as e:
            rows.append({
                "filename": path.name,
                "extension": ext.lstrip("."),
                "flags": ["error"],
                "notes": [f"triage failed: {e}"],
            })

    if args.marker_rescue:
        rescued = 0
        for row in rows:
            if not _needs_marker_rescue(row):
                continue
            path = path_by_filename.get(row.get("filename", ""))
            if not path:
                continue
            _marker_rescue_row(row, path, library, catalog)
            rescued += 1
        print(f"marker-rescue: ran on {rescued} rows", file=sys.stderr)

    output = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
    if args.output == "-":
        sys.stdout.write(output)
    else:
        Path(args.output).expanduser().write_text(output)
        print(f"Wrote {len(rows)} rows to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
