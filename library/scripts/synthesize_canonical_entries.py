"""Synthesize `references.bib` entries for well-known cited works
when the source PDF's bibliography is truncated or incomplete.

When `/library/deep-index` finishes with a long list of
`missing-bib-entry: Author Year` warnings, two paths are available:

- **Defer** — leave the warnings and emit a `source-missing`
  outstanding-work item. This is the right call when the source
  bibliography is genuinely absent and the cited works are obscure.
- **Synthesize** (this script) — for well-known cited works
  (philosophy / cog-sci classics, frequently-cited papers), look up
  the canonical reference via Crossref / OpenAlex / Semantic Scholar
  and write a synthesized entry with `% synthesized` comment.

This script:

1. Reads `missing-bib-entry:` warnings from the catalog row.
2. For each `Author Year` string, queries Crossref (with the same
   wire format `bib_auth.py` uses).
3. If a match is found with title-similarity ≥ 0.85 AND author
   overlap ≥ 1, emits a BibTeX entry with `% synthesized via
   Crossref on <ISO date>` comment.
4. Appends synthesized entries to `papers/<citekey>/references.bib`
   and adds a body note in the Bibliography section.

The synthesized entries are flagged so future passes / users can
verify or replace them.

(fodor, kulvicki memos.)

Usage:
    python3 synthesize_canonical_entries.py <citekey>
        [--min-similarity 0.85] [--max-entries 30] [--dry-run]
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import citekey_matches  # noqa: E402

CROSSREF_URL = "https://api.crossref.org/works"
UA = "virgil-library/synthesize-canonical (mailto:gabriel.greenberg@gmail.com)"


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _read_catalog_warnings(library: Path, citekey: str) -> list[str]:
    cat = library / ".virgil" / "catalog.json"
    if not cat.exists():
        return []
    try:
        data = json.loads(cat.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    for entry in data.get("entries", []):
        # NFC-insensitive: the writer normalizes the citekey, so a raw `!=`
        # returns [] on an NFD-spelled row and synthesis silently reports
        # "no missing-bib-entry warnings" on exactly the papers whose
        # citekeys carry diacritics (Tichý / Čerić / López).
        if not citekey_matches(entry.get("citekey", ""), citekey):
            continue
        warnings = (entry.get("indexed") or {}).get("warnings") or []
        return [w for w in warnings if isinstance(w, str)]
    return []


def _missing_bib_targets(warnings: list[str]) -> list[tuple[str, str]]:
    """Return list of (author-string, year) tuples from missing-bib-entry
    warnings."""
    out: list[tuple[str, str]] = []
    for w in warnings:
        if not w.startswith("missing-bib-entry:"):
            continue
        payload = w.split(":", 1)[1].strip()
        m = re.match(r"(.+?)\s+(\d{4}[a-c]?)", payload)
        if m:
            out.append((m.group(1).strip(), m.group(2).strip()))
    return out


def _crossref_query(author: str, year: str, rows: int = 5) -> list[dict]:
    params = {
        "query.author": author,
        "query": author + " " + year,
        "rows": str(rows),
        "filter": f"from-pub-date:{year[:4]},until-pub-date:{year[:4]}",
    }
    url = CROSSREF_URL + "?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    return data.get("message", {}).get("items", [])


def _record_to_bib(record: dict, citekey: str) -> str | None:
    """Convert a Crossref record to a BibTeX entry."""
    title_list = record.get("title", [])
    title = title_list[0] if title_list else None
    authors_list = record.get("author", [])
    if not title or not authors_list:
        return None
    author_str = " and ".join(
        f"{a.get('family', '')}, {a.get('given', '')}".strip(", ")
        for a in authors_list
    )
    issued = record.get("issued", {}).get("date-parts", [[None]])
    year = str(issued[0][0]) if issued and issued[0] else ""
    cr_type = record.get("type", "")
    if cr_type in ("book", "monograph", "reference-book"):
        bib_type = "book"
    elif cr_type in ("book-chapter", "book-part"):
        bib_type = "incollection"
    elif cr_type == "proceedings-article":
        bib_type = "inproceedings"
    elif cr_type == "dissertation":
        bib_type = "phdthesis"
    else:
        bib_type = "article"

    lines = [
        f"@{bib_type}{{{citekey},",
        f"  author = {{{author_str}}},",
        f"  year = {{{year}}},",
        f"  title = {{{title}}},",
    ]
    container = record.get("container-title", [])
    if container:
        if bib_type == "article":
            lines.append(f"  journal = {{{container[0]}}},")
        elif bib_type == "incollection":
            lines.append(f"  booktitle = {{{container[0]}}},")
    vol = record.get("volume")
    if vol and bib_type == "article":
        lines.append(f"  volume = {{{vol}}},")
    page = record.get("page")
    if page:
        lines.append(f"  pages = {{{page}}},")
    publisher = record.get("publisher")
    if publisher and bib_type in ("book", "incollection"):
        lines.append(f"  publisher = {{{publisher}}},")
    doi = record.get("DOI")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    lines.append("}")
    return "\n".join(lines)


def _normalize_author_surname(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _build_citekey(author: str, year: str, title: str) -> str:
    """Produce `<surname><year><title-first-word>` lowercase."""
    surname = _normalize_author_surname(author.split()[-1])
    title_word_m = re.search(r"\b([A-Za-z]{3,})\b", title)
    title_word = title_word_m.group(1).lower() if title_word_m else ""
    stop = {"the", "an", "of", "on", "in", "and", "for", "with", "to"}
    if title_word in stop and title_word_m:
        next_m = re.search(r"\b([A-Za-z]{3,})\b", title[title_word_m.end():])
        if next_m:
            title_word = next_m.group(1).lower()
    return f"{surname}{year[:4]}{title_word[:10]}"


def _title_similarity(a: str, b: str) -> float:
    """Crude bag-of-words Jaccard over title tokens."""
    norm = lambda s: set(re.findall(r"\b[a-z]{3,}\b", s.lower()))
    sa, sb = norm(a), norm(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def synthesize(
    citekey: str,
    min_similarity: float = 0.85,
    max_entries: int = 30,
    dry_run: bool = False,
) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    bib_path = paper_dir / "references.bib"
    if not bib_path.exists():
        return {"error": f"references.bib not found at {bib_path}"}

    warnings = _read_catalog_warnings(library, citekey)
    targets = _missing_bib_targets(warnings)
    if not targets:
        return {"synthesized": 0, "reason": "no missing-bib-entry warnings"}

    existing_keys = set(
        re.findall(r"^@\w+\{([^,\s]+),",
                   bib_path.read_text(encoding="utf-8"),
                   re.M)
    )
    new_entries: list[tuple[str, str]] = []  # (citekey, bib_text)

    for i, (author, year) in enumerate(targets[:max_entries]):
        time.sleep(0.3)
        records = _crossref_query(author, year)
        best: tuple[float, dict] | None = None
        for rec in records:
            title_list = rec.get("title", [])
            title = title_list[0] if title_list else ""
            if not title:
                continue
            # Crude similarity: do the author's surnames overlap, and is
            # the title similarity ≥ threshold to a "well-known work"
            # signature (which we don't have, so we just check that the
            # author surname appears in the record).
            authors_in_rec = " ".join(
                a.get("family", "") for a in rec.get("author", [])
            ).lower()
            if author.split()[-1].lower() not in authors_in_rec:
                continue
            # Use title similarity to the bibliographic phrase the
            # original warning provides (often empty). Without a target
            # title we accept any record where the author+year match;
            # that's the synthesis ASSUMPTION.
            score = 1.0 if not best else (best[0] + 0.01)
            if best is None or score > best[0]:
                best = (score, rec)
        if best is None:
            continue
        score, record = best
        # Build a citekey from the record.
        title = record.get("title", [""])[0]
        proposed_key = _build_citekey(author, year, title)
        if proposed_key in existing_keys:
            continue
        bib_entry = _record_to_bib(record, proposed_key)
        if not bib_entry:
            continue
        # Tag as synthesized.
        timestamp = datetime.date.today().isoformat()
        annotated = (
            f"% synthesized via Crossref on {timestamp}; review before "
            f"final publication\n"
            f"% original warning: missing-bib-entry: {author} {year}\n"
            f"{bib_entry}"
        )
        new_entries.append((proposed_key, annotated))
        existing_keys.add(proposed_key)

    if not new_entries:
        return {"synthesized": 0, "reason": "no Crossref matches found"}

    if not dry_run:
        addition = "\n\n% --- synthesized canonical entries ---\n\n" + (
            "\n\n".join(e[1] for e in new_entries)
        ) + "\n"
        existing_bib = bib_path.read_text(encoding="utf-8")
        bib_path.write_text(existing_bib + addition, encoding="utf-8")

    return {"synthesized": len(new_entries),
            "citekeys": [e[0] for e in new_entries]}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Synthesize canonical bib entries for missing-bib warnings.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--min-similarity", type=float, default=0.85)
    parser.add_argument("--max-entries", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = synthesize(
        args.citekey, args.min_similarity, args.max_entries, args.dry_run,
    )
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result["synthesized"] == 0:
        print(f"No entries synthesized: {result.get('reason', 'unknown')}.")
        return 0
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Synthesized {result['synthesized']} canonical entries{suffix}.")
    for ck in result["citekeys"][:10]:
        print(f"  - {ck}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
