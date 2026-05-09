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

# Regex patterns shared across detectors.
_DOI_RE = re.compile(r"\b10\.\d{4,9}/[^\s'\"<>]+")
_ISBN_RE = re.compile(r"\b(?:ISBN[-:]?\s*)?(97[89])?[-\s]?(\d[-\s]?){9,12}[\dXx]\b")
_SEP_RE = re.compile(r"plato\.stanford\.edu/(?:archives/[^/]+/)?entries/([a-z0-9-]+)")
_VARIANT_RE = re.compile(r"^(?P<base>.+?)\.(?P<n>\d+)\.(?P<ext>pdf|docx|tex)$", re.IGNORECASE)
_FILENAME_RE = re.compile(r"^(?P<year>\d{4})-(?P<lastname>[A-Za-z][A-Za-z'\-]*)\.(?P<ext>pdf|docx|tex)$")

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
    if not year_weights:
        return None
    ranked = sorted(year_weights.items(), key=lambda x: x[1], reverse=True)
    if (flags is not None and len(ranked) >= 2
            and abs(int(ranked[0][0]) - int(ranked[1][0])) > 5):
        flags.append("year-ambiguous")
    return ranked[0][0]


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
    if lastname and year:
        stem = re.sub(r"[^a-zA-Z]", "", lastname).lower()
        word = _first_significant_word(title)
        return stem + year + word
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
    fm = _FILENAME_RE.match(filename)
    filename_year = fm.group("year") if fm else ""
    filename_lastname = fm.group("lastname") if fm else ""

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
    content_lastname = ""
    if byline:
        # First non-empty token's last word as last-resort lastname.
        first_byline_words = byline[0].split()
        if first_byline_words:
            content_lastname = re.sub(r"[^A-Za-z]", "", first_byline_words[-1])
    chosen_lastname = content_lastname if filename_mismatch else (filename_lastname or content_lastname)

    fallback = filename.rsplit(".", 1)[0]
    proposed_citekey = _propose_citekey(chosen_lastname, chosen_year, proposed_fields.get("title", ""), fallback)
    if "sep" in flags:
        proposed_citekey += "sep"

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
    existing_keys: set[str] = set()
    for e in catalog.get("entries", []):
        ck = e.get("citekey")
        if ck:
            existing_keys.add(ck)
    existing_states: dict[str, str] = {}
    for e in catalog.get("entries", []):
        ck = e.get("citekey")
        if ck:
            existing_states[ck] = (e.get("bib") or {}).get("state", "")

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


def main() -> int:
    p = argparse.ArgumentParser(description="Batch-extract triage observables from unsorted/.")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--output", default="-",
                   help="Output JSONL path; '-' for stdout (default)")
    args = p.parse_args()

    library = Path(args.library).expanduser()
    unsorted_dir = library / "unsorted"
    if not unsorted_dir.exists():
        print(f"No unsorted/ at {unsorted_dir}", file=sys.stderr)
        return 1

    catalog = _read_catalog(library)

    rows: list[dict[str, Any]] = []
    for path in sorted(unsorted_dir.iterdir()):
        if path.is_dir():
            continue
        if path.name.startswith("_") or path.name.startswith("."):
            continue
        ext = path.suffix.lower()
        if ext not in (".pdf", ".docx", ".tex", ".bib"):
            continue
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

    output = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
    if args.output == "-":
        sys.stdout.write(output)
    else:
        Path(args.output).expanduser().write_text(output)
        print(f"Wrote {len(rows)} rows to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
