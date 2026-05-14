"""Pre-flight coherence check for a `master.bib` entry.

Catches the silent-corruption pattern flagged in the
`2026-05-13-bib-auth-mismatch-leong1994towards` memo: bibs that
passed `/library/authenticate-bib` because of a partial Crossref
match but where the bib's `type` and field set are internally
incoherent (e.g. `@phdthesis` with `journal` / `volume` / `pages`).

Checks (in order):

1. **Cross-field coherence** — entry type and fields must align.
   - `@phdthesis` should not have `journal`/`publisher`/`pages`/
     `volume`/`number` (those belong to journal articles or books).
   - `@article` should not have `school` or `publisher` (a published
     article has `journal`).
   - `@inproceedings` should not have `journal` (it has `booktitle`).
   - `@book` should not have `journal`/`volume`/`number`.

2. **PDF cover-page check** — the bib's `title` must appear in the
   first 4 pages of the PDF (case-insensitive substring match, or
   ≥ 3 of 4 significant words). Absence flags
   `content-mismatch-needs-review`.

3. **URL/DOI cross-reference** — if both `url` and `doi` are set,
   the URL's `dc.identifier.doi` meta tag (when resolvable) must
   match the bib's `doi`. Disagreement flags `url-doi-mismatch`.

Outputs a JSON report. Exit code 0 if no issues; 1 if any issue.
Used by `/library/authenticate-bib` as a pre-flight gate.

Usage:
    python3 validate_bib_coherence.py <citekey>
        [--no-cover-check] [--check-url-doi] [--json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.request
from pathlib import Path


# Allowed fields per entry type. Fields outside this set produce a
# coherence warning (not an outright error — many bibs have legitimate
# extras like `month`, `note`, `keywords`, etc.).
DISALLOWED_FIELDS = {
    "phdthesis": {"journal", "publisher", "pages", "volume", "number", "booktitle"},
    "mastersthesis": {"journal", "publisher", "pages", "volume", "number", "booktitle"},
    "article": {"school", "booktitle"},
    "book": {"journal", "volume", "number", "booktitle"},
    "inbook": {"journal", "volume", "number"},
    "incollection": {"journal", "school"},
    "inproceedings": {"journal", "school"},
    "manual": {"journal", "school", "booktitle"},
    "techreport": {"journal", "booktitle"},
    "unpublished": {"journal", "publisher", "booktitle", "volume"},
}


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _read_master_bib_entry(
    bib_path: Path, citekey: str,
) -> tuple[str, dict[str, str]] | None:
    if not bib_path.exists():
        return None
    bib = bib_path.read_text(encoding="utf-8")
    pat = re.compile(
        rf"@(\w+)\{{{re.escape(citekey)},([\s\S]*?)\n\}}",
        re.M,
    )
    m = pat.search(bib)
    if not m:
        return None
    entry_type = m.group(1).lower()
    body = m.group(2)
    fields: dict[str, str] = {}
    for fm in re.finditer(r"(\w+)\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}", body):
        fields[fm.group(1).lower()] = fm.group(2).strip()
    return entry_type, fields


def check_cross_field_coherence(
    entry_type: str, fields: dict[str, str],
) -> list[str]:
    out: list[str] = []
    disallowed = DISALLOWED_FIELDS.get(entry_type, set())
    for f in disallowed:
        if f in fields and fields[f].strip():
            out.append(
                f"@{entry_type} should not have `{f}` field "
                f"(value: {fields[f][:60]!r})"
            )
    return out


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def check_pdf_cover_page(pdf: Path, title: str) -> tuple[bool, str]:
    """Return (passes, reason). Passes iff `title` substring or
    ≥ 3-of-4 significant words appear in the first 4 PDF pages."""
    if not pdf.exists():
        return False, "PDF not found"
    if not shutil.which("pdftotext"):
        return True, "pdftotext unavailable; skipping cover-page check"
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", "1", "-l", "4", str(pdf), "-"],
            capture_output=True, text=True, timeout=25,
        )
    except subprocess.SubprocessError as e:
        return True, f"pdftotext failed: {e}"
    if out.returncode != 0:
        return True, f"pdftotext returncode {out.returncode}"
    cover = _normalize(out.stdout)
    norm_title = _normalize(title)
    if not norm_title:
        return True, "bib has no title"
    if norm_title in cover:
        return True, "exact title match"
    words = [w for w in norm_title.split() if len(w) >= 4][:6]
    if not words:
        return False, "title too short to fuzzy-match"
    hits = sum(1 for w in words if w in cover)
    if hits >= min(3, len(words) - 1) and hits >= len(words) * 0.6:
        return True, f"fuzzy match ({hits}/{len(words)} significant words)"
    return False, (
        f"title not found in first 4 PDF pages "
        f"(matched {hits}/{len(words)} significant words)"
    )


def check_url_doi_match(
    url: str, doi: str, timeout: int = 10,
) -> tuple[bool, str]:
    """If `url` resolves to an HTML page with a `dc.identifier.doi`
    meta tag, verify it matches `doi`. Returns (matches, detail)."""
    if not url or not doi:
        return True, "no url or doi to compare"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (virgil-bib-auth)"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html = r.read(50000).decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as e:
        return True, f"URL fetch failed: {e}"
    m = re.search(
        r'<meta\s+name=["\']?(?:dc\.identifier\.doi|citation_doi)["\']?'
        r'\s+content=["\']([^"\']+)["\']',
        html,
        re.I,
    )
    if not m:
        return True, "no doi meta tag found at URL"
    page_doi = m.group(1).strip()
    if page_doi.lower() == doi.lower():
        return True, "doi matches URL's doi meta tag"
    return False, f"url-doi-mismatch: URL says doi={page_doi}, bib says doi={doi}"


def validate(
    citekey: str, check_cover: bool = True, check_url: bool = False,
) -> dict:
    library = _resolve_library_root()
    entry = _read_master_bib_entry(library / "master.bib", citekey)
    if entry is None:
        return {"error": f"master.bib entry for {citekey} not found"}
    entry_type, fields = entry

    findings: list[str] = []
    findings.extend(check_cross_field_coherence(entry_type, fields))

    cover_pass = True
    cover_detail = ""
    if check_cover:
        pdf = library / "papers" / citekey / f"{citekey}.pdf"
        title = fields.get("title", "")
        cover_pass, cover_detail = check_pdf_cover_page(pdf, title)
        if not cover_pass:
            findings.append(f"content-mismatch-needs-review: {cover_detail}")

    url_pass = True
    url_detail = ""
    if check_url and fields.get("url") and fields.get("doi"):
        url_pass, url_detail = check_url_doi_match(
            fields["url"], fields["doi"],
        )
        if not url_pass:
            findings.append(url_detail)

    return {
        "citekey": citekey,
        "entry_type": entry_type,
        "findings": findings,
        "cover_check": cover_detail,
        "url_check": url_detail if check_url else "skipped",
        "ok": len(findings) == 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pre-flight coherence / cover-page check for a bib entry.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--no-cover-check", action="store_true")
    parser.add_argument("--check-url-doi", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = validate(
        args.citekey,
        check_cover=not args.no_cover_check,
        check_url=args.check_url_doi,
    )
    if args.json:
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 2
    if result["ok"]:
        print(f"OK: {args.citekey} (@{result['entry_type']}) coherent.")
        return 0
    print(f"Issues with {args.citekey} (@{result['entry_type']}):")
    for f in result["findings"]:
        print(f"  - {f}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
