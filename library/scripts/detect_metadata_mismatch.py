"""Detect content/metadata mismatch between the on-disk PDF and
`master.bib` for a Library citekey.

Cross-checks the PDF's cover page (first 2 pages via `pdftotext
-layout`) against `master.bib`'s `title` and `author` fields via
fuzzy substring match. When both diverge sharply, surfaces a
one-line warning so `/library/deep-index`'s preflight can resolve
the mismatch immediately instead of mid-pass.

Output `mismatch.kind` values:

- `"none"` — title and author both appear on the cover page.
- `"title-only-missing"` — author matches, title doesn't (likely
  the file is a chapter of the book described in master.bib, or
  the cover-page title is abbreviated).
- `"author-only-missing"` — title matches, author doesn't (rare,
  often a multi-author work indexed under the wrong author).
- `"both-missing"` — neither matches. The file may be entirely
  unrelated to master.bib's entry (Frankenstein-bib case).
- `"file-is-book-bib-is-chapter"` — heuristic: title doesn't match,
  but a stronger title-line on the cover page is present, AND the
  cover page indicates a full book (`publisher` keyword, "Press",
  "Oxford", etc.).

Used by `/library/di-preflight` for Step 0/0.5 metadata-mismatch
detection. The auto-resolution policy (when all four conditions
hold) is applied separately by the orchestrator.

(zeki, lewis, leong memos; content-metadata-mismatch-policy memo.)

Usage:
    python3 detect_metadata_mismatch.py <citekey> [--json]
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
from pathlib import Path


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _extract_cover_text(pdf: Path, pages: int = 2) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", "1", "-l", str(pages),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=20,
        )
        if out.returncode == 0:
            return out.stdout
    except subprocess.SubprocessError:
        pass
    return ""


def _read_master_bib_fields(
    bib_path: Path, citekey: str,
) -> dict[str, str]:
    if not bib_path.exists():
        return {}
    bib = bib_path.read_text(encoding="utf-8")
    pat = re.compile(
        rf"@(\w+)\{{{re.escape(citekey)},([\s\S]*?)\n\}}",
        re.M,
    )
    m = pat.search(bib)
    if not m:
        return {}
    entry_type = m.group(1)
    body = m.group(2)
    out: dict[str, str] = {"_type": entry_type}
    for field_m in re.finditer(r"(\w+)\s*=\s*\{([^}]+)\}", body):
        out[field_m.group(1).lower()] = field_m.group(2).strip()
    return out


def _title_appears_in(text: str, title: str) -> bool:
    nt = _normalize(text)
    nq = _normalize(title)
    if not nq:
        return False
    if nq in nt:
        return True
    # Fuzzy: first 4 significant words.
    words = [w for w in nq.split() if len(w) >= 4][:4]
    if not words:
        return False
    return all(w in nt for w in words)


def _author_appears_in(text: str, author: str) -> bool:
    nt = _normalize(text)
    for chunk in re.split(r"\s+and\s+|,", author):
        chunk = chunk.strip()
        if not chunk:
            continue
        # Pick the surname (longest word, or last if comma-form).
        if "," in chunk:
            surname = chunk.split(",")[0].strip()
        else:
            words = chunk.split()
            surname = max(words, key=len) if words else ""
        ns = _normalize(surname)
        if ns and ns in nt:
            return True
    return False


def detect(citekey: str) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    pdf_path = paper_dir / f"{citekey}.pdf"
    bib_path = library / "master.bib"

    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}", "kind": "unknown"}
    fields = _read_master_bib_fields(bib_path, citekey)
    if not fields:
        return {"error": "master.bib entry not found", "kind": "unknown"}

    cover_text = _extract_cover_text(pdf_path, pages=2)
    if not cover_text:
        return {"error": "pdftotext failed", "kind": "unknown"}

    title = fields.get("title", "")
    author = fields.get("author", "") or fields.get("editor", "")
    title_match = _title_appears_in(cover_text, title) if title else True
    author_match = _author_appears_in(cover_text, author) if author else True

    if title_match and author_match:
        kind = "none"
    elif title_match and not author_match:
        kind = "author-only-missing"
    elif not title_match and author_match:
        kind = "title-only-missing"
    else:
        kind = "both-missing"

    # Refinement: if title-only-missing, check whether the cover page
    # looks like a book cover (publisher / press / press-y phrases).
    if kind == "title-only-missing":
        book_signals = (
            "press", "publisher", "publication", "oxford", "cambridge",
            "harvard", "mit press", "blackwell", "wiley", "routledge",
            "ed.", "edited by", "isbn",
        )
        cl = cover_text.lower()
        if any(s in cl for s in book_signals):
            kind = "file-is-book-bib-is-chapter"

    return {
        "kind": kind,
        "title_match": title_match,
        "author_match": author_match,
        "bib_title": title,
        "bib_author": author,
        "bib_type": fields.get("_type", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect content/metadata mismatch via cover-page check.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = detect(args.citekey)
    if args.json:
        print(json.dumps(result, indent=2))
        return 0
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result["kind"] == "none":
        print("No content/metadata mismatch detected.")
        return 0
    print(f"Mismatch kind: {result['kind']}")
    print(f"  title match:  {result['title_match']}")
    print(f"  author match: {result['author_match']}")
    print(f"  bib title:    {result['bib_title'][:80]}")
    print(f"  bib author:   {result['bib_author'][:80]}")
    print(f"  bib type:     {result['bib_type']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
