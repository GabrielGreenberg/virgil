#!/usr/bin/env python3
"""Match every entry in a paper's references.bib against the library's
master.bib.

Used by `/editor/sync-bib-to-library` to decide, per paper-entry,
whether to swap in a library version, queue for triage, or surface for
manual review.

Match cascade (first hit wins; we deliberately stay conservative —
external authentication against Crossref / OpenAlex / arXiv / etc. is
the library's job, not ours):

  1. Exact citekey present in master.bib → `matched (source: citekey)`.
  2. Normalized DOI match → `matched (source: doi)`.
  3. Normalized first-author surname + year (±1) + normalized title →
     `matched` if uniquely resolved; `ambiguous` if multiple library
     candidates collide on the looser signal.
  4. Otherwise → `missing`.

Output is JSONL on stdout (or `--output PATH`), one row per paper
entry, in file order.

  {
    "paper_citekey":         "smith2020",
    "status":                "matched|missing|ambiguous",
    "library_citekey":       "Smith2020a",       # populated on matched
    "match_source":          "citekey|doi|title-author",
    "ambiguous_candidates":  ["Smith2020", "Smith2020a"],
    "paper_fields":          {"title": "...", ...},   # for downstream
    "notes":                 ["citekey already aligned", ...]
  }

CLI:

  python3 bib_match_library.py <docPath> --library <abs-path>
  python3 bib_match_library.py <docPath>/references.bib --library <abs-path>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Optional

# Make `library/scripts/_bib_parse.py` importable. The editor scripts run
# from the repo root, so we anchor on this file's parents.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "library" / "scripts"))

from _bib_parse import parse_bib_text  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import die, find_bib_file, resolve_doc  # noqa: E402


# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------


def _normalize_doi(s: str) -> str:
    s = s.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s.strip(" .;,")


def _strip_braces(s: str) -> str:
    return s.replace("{", "").replace("}", "").strip()


def _normalize_title(s: str) -> str:
    s = _strip_braces(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_surname(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"(jr|sr|iii)$", "", s)
    return s


def _first_author_surname(author_field: str) -> str:
    """Pull the first author's surname from a BibTeX `author` field.

    Handles both `Last, First` and `First Last` orderings, and stops at
    the first `and` separator. Tolerates braces and accents.
    """
    raw = _strip_braces(author_field).strip()
    if not raw:
        return ""
    first = re.split(r"\band\b", raw, maxsplit=1, flags=re.IGNORECASE)[0].strip()
    if "," in first:
        surname = first.split(",", 1)[0].strip()
    else:
        parts = first.split()
        surname = parts[-1] if parts else ""
    return _normalize_surname(surname)


def _year(year_field: str) -> Optional[int]:
    m = re.search(r"\b(\d{4})\b", year_field or "")
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# Index building
# ---------------------------------------------------------------------------


def _build_library_index(master_text: str) -> dict[str, Any]:
    """Return {citekey, by_doi, by_signature} for master.bib."""
    by_citekey: dict[str, dict] = {}
    by_doi: dict[str, str] = {}
    by_signature: dict[tuple[str, int, str], list[str]] = {}

    for entry in parse_bib_text(master_text):
        ck = entry["citekey"]
        by_citekey[ck] = entry

        fields = entry["fields"]
        doi = fields.get("doi", "")
        if doi:
            n = _normalize_doi(doi)
            if n and n not in by_doi:
                by_doi[n] = ck

        surname = _first_author_surname(fields.get("author") or fields.get("editor") or "")
        year = _year(fields.get("year") or "")
        title = _normalize_title(fields.get("title") or "")
        if surname and year and title:
            key = (surname, year, title)
            by_signature.setdefault(key, []).append(ck)

    return {
        "by_citekey": by_citekey,
        "by_doi": by_doi,
        "by_signature": by_signature,
    }


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def _signature_match(
    surname: str, year: Optional[int], title: str, by_signature: dict
) -> list[str]:
    """Return library citekeys that match on (surname, year ±1, title)."""
    if not surname or year is None or not title:
        return []
    hits: list[str] = []
    for y in (year, year - 1, year + 1):
        for ck in by_signature.get((surname, y, title), []):
            if ck not in hits:
                hits.append(ck)
    return hits


def match_entry(entry: dict, index: dict) -> dict:
    """Classify a single paper entry against the library index."""
    paper_citekey = entry["citekey"]
    fields = entry["fields"]
    notes: list[str] = []
    out: dict[str, Any] = {
        "paper_citekey": paper_citekey,
        "paper_type": entry["type"],
        "paper_fields": fields,
        "status": "missing",
        "library_citekey": None,
        "match_source": None,
        "ambiguous_candidates": [],
        "notes": notes,
    }

    # 1) Citekey.
    if paper_citekey in index["by_citekey"]:
        out["status"] = "matched"
        out["library_citekey"] = paper_citekey
        out["match_source"] = "citekey"
        return out

    # 2) DOI.
    doi = fields.get("doi", "")
    if doi:
        n = _normalize_doi(doi)
        if n in index["by_doi"]:
            out["status"] = "matched"
            out["library_citekey"] = index["by_doi"][n]
            out["match_source"] = "doi"
            return out

    # 3) Signature (surname + year ±1 + title).
    surname = _first_author_surname(fields.get("author") or fields.get("editor") or "")
    year = _year(fields.get("year") or "")
    title = _normalize_title(fields.get("title") or "")
    candidates = _signature_match(surname, year, title, index["by_signature"])
    if len(candidates) == 1:
        out["status"] = "matched"
        out["library_citekey"] = candidates[0]
        out["match_source"] = "title-author"
        return out
    if len(candidates) > 1:
        out["status"] = "ambiguous"
        out["ambiguous_candidates"] = candidates
        notes.append(
            f"signature ({surname}, {year}, {title!r}) matches "
            f"{len(candidates)} library entries"
        )
        return out

    return out  # missing


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _resolve_paper_bib(arg: str) -> Path:
    p = Path(arg).expanduser().resolve()
    if p.is_file() and p.suffix == ".bib":
        return p
    if p.is_dir():
        doc = resolve_doc(arg)
        bib = find_bib_file(doc)
        if bib is None:
            die(f"no references.bib found in {doc}")
        return bib
    die(f"docPath or .bib not found: {p}")


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("docPath", help="paper folder or path to references.bib")
    ap.add_argument(
        "--library", required=True,
        help="absolute path to the Virgil Library root (use editor/scripts/library_path.py --get)"
    )
    ap.add_argument(
        "--output", help="write JSONL here instead of stdout"
    )
    args = ap.parse_args(argv)

    paper_bib = _resolve_paper_bib(args.docPath)
    library_root = Path(args.library).expanduser().resolve()
    master = library_root / "master.bib"
    if not master.exists():
        die(f"library has no master.bib: {master}")

    paper_entries = parse_bib_text(paper_bib.read_text(encoding="utf-8"))
    index = _build_library_index(master.read_text(encoding="utf-8"))

    rows = [match_entry(e, index) for e in paper_entries]

    sink = sys.stdout
    if args.output:
        sink = open(args.output, "w", encoding="utf-8")
    try:
        for r in rows:
            sink.write(json.dumps(r, ensure_ascii=False) + "\n")
    finally:
        if args.output:
            sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
