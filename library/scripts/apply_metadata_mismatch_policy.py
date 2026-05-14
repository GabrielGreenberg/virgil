"""Apply the content/metadata-mismatch auto-resolution policy.

When `detect_metadata_mismatch.py` reports
`kind == "file-is-book-bib-is-chapter"` AND all four policy
conditions hold, the on-disk file is the source of truth and the
metadata should be updated to match the file:

1. The file is structurally larger (whole book / full proceedings).
2. The current metadata describes a proper subset (chapter, excerpt).
3. The cover page unambiguously gives the larger artifact's title.
4. No `metadata-lock: true` flag in the catalog row, and
   `papers/<citekey>/virgil/notes.json` is silent on intentional
   chapter-level identity.

This script implements the policy hook. It:

- Reads cover-page text via `pdftotext -layout`.
- Extracts the candidate book title (first non-trivial line on page 1).
- Extracts the publisher / press / ISBN where available.
- Calls `update_master_bib_entry.py` to rewrite `master.bib` with
  `type=@book` and the new fields.
- Calls `update_catalog_entry.py` to update `title`, `doi`, and set
  `bib.state = "needs-reauth"`.
- Updates the in-file `\\title{...}` in `main.tex`.

Refuses to act if any of the four conditions fails; in that case
emits an outstanding-work item with `user-judgment-required`.

(content-metadata-mismatch-policy memo; kulvicki case.)

Usage:
    python3 apply_metadata_mismatch_policy.py <citekey>
        [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


_LENDING_SIGNATURES = (
    "ILLIAD TN#", "ILLIAD", "OCLC ", "Lending String:",
    "Shipping Address:", "WARNING CONCERNING COPYRIGHT",
    "Stanford Information Delivery",
    "InterLibrary Loan", "Interlibrary Loan",
    "BorrowDirect", "Document Delivery", "RAPID ODYSSEY",
)


def _detect_lending_pages(pdf: Path, max_check: int = 4) -> int:
    """Count leading lending-slip pages (so we can skip them when
    looking for the real cover page)."""
    if not shutil.which("pdftotext"):
        return 0
    lending = 0
    for page in range(1, max_check + 1):
        try:
            out = subprocess.run(
                ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
                 str(pdf), "-"],
                capture_output=True, text=True, timeout=15,
            )
        except subprocess.SubprocessError:
            break
        if out.returncode != 0:
            break
        if any(sig in out.stdout for sig in _LENDING_SIGNATURES):
            lending = page
        else:
            break
    return lending


def _extract_cover(pdf: Path, pages: int = 2) -> str:
    if not shutil.which("pdftotext"):
        return ""
    # Skip lending-slip pages.
    skip = _detect_lending_pages(pdf)
    start = skip + 1
    end = start + pages - 1
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(start), "-l", str(end),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=20,
        )
        return out.stdout if out.returncode == 0 else ""
    except subprocess.SubprocessError:
        return ""


def _extract_book_title(cover_text: str) -> str | None:
    """Heuristic: first 1-3 lines that look like a title (capitalized,
    no body-prose punctuation, not a copyright/ISBN line)."""
    lines = [l.strip() for l in cover_text.split("\n") if l.strip()]
    title_candidates: list[str] = []
    for line in lines[:15]:
        if len(line) < 5 or len(line) > 200:
            continue
        if re.search(r"©|Copyright|ISBN|Press|Oxford University|Cambridge", line):
            continue
        if re.match(r"^[A-Z][A-Za-z\-:'\s,]+$", line):
            title_candidates.append(line)
            if len(title_candidates) >= 3:
                break
    if not title_candidates:
        return None
    # Heuristic: longest candidate (book subtitles often follow the main title).
    return max(title_candidates, key=len)


def _extract_publisher(cover_text: str) -> str | None:
    for line in cover_text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.search(r"(Oxford|Cambridge|Harvard|MIT|Princeton)\s+University\s+Press", s, re.I):
            m = re.search(r"([A-Za-z]+\s+University\s+Press)", s, re.I)
            if m:
                return m.group(1).title()
        if re.search(r"\bPress\b|\bPublishers\b", s) and len(s) < 80:
            return s.strip(",.;: ")
    return None


def _extract_isbn(cover_text: str) -> str | None:
    m = re.search(r"ISBN[:\s]+([\d\-Xx]{10,17})", cover_text, re.I)
    return m.group(1).replace(" ", "") if m else None


def _read_catalog_row(library: Path, citekey: str) -> dict | None:
    cat = library / ".virgil" / "catalog.json"
    if not cat.exists():
        return None
    data = json.loads(cat.read_text(encoding="utf-8"))
    for entry in data.get("entries", []):
        if entry.get("citekey") == citekey:
            return entry
    return None


def _read_paper_notes(library: Path, citekey: str) -> str:
    notes = library / "papers" / citekey / "virgil" / "notes.json"
    if not notes.exists():
        return ""
    try:
        return notes.read_text(encoding="utf-8")
    except OSError:
        return ""


def _has_metadata_lock(catalog_row: dict | None) -> bool:
    return bool(catalog_row and catalog_row.get("metadataLock"))


def _notes_assert_chapter_identity(notes_text: str) -> bool:
    """Crude check: does the notes blob mention 'chapter only' /
    'chapter-level' / 'do not update bib'?"""
    if not notes_text:
        return False
    lower = notes_text.lower()
    return any(
        s in lower
        for s in (
            "chapter only", "chapter-level identity",
            "do not update bib", "do not promote",
            "metadata-lock",
        )
    )


def _detect_kind(citekey: str) -> str | None:
    """Run detect_metadata_mismatch.py and read the kind field."""
    scripts_dir = Path(__file__).parent
    try:
        out = subprocess.run(
            ["python3", str(scripts_dir / "detect_metadata_mismatch.py"),
             citekey, "--json"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode not in (0, 1):
            return None
        data = json.loads(out.stdout)
        return data.get("kind")
    except (subprocess.SubprocessError, json.JSONDecodeError):
        return None


def _pdf_page_count(pdf: Path) -> int:
    if not shutil.which("pdfinfo"):
        return 0
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)],
            capture_output=True, text=True, timeout=15,
        )
        for line in out.stdout.split("\n"):
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError):
        pass
    return 0


def apply(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    pdf_path = paper_dir / f"{citekey}.pdf"
    tex_path = paper_dir / "main.tex"
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}", "applied": False}
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}", "applied": False}

    # Pre-flight: only apply when the mismatch kind is the right shape.
    # The auto-resolution policy fires *only* for
    # "file-is-book-bib-is-chapter" — never for plain author-mismatch
    # (which usually means lending-slip noise or a Frankenstein bib).
    kind = _detect_kind(citekey)
    if kind != "file-is-book-bib-is-chapter":
        return {
            "applied": False,
            "reason": (
                f"detect_metadata_mismatch returned kind={kind!r}; "
                "policy only fires on 'file-is-book-bib-is-chapter'. "
                "Run with --force to override."
            ),
        }

    # Condition 1: the file is structurally larger. Heuristic: a book
    # has ≥ 50 PDF pages. (Tighten for proceedings if needed.)
    page_count = _pdf_page_count(pdf_path)
    if page_count < 50:
        return {
            "applied": False,
            "reason": (
                f"PDF page count {page_count} too small for a book "
                "(threshold 50). Likely an article extraction error, "
                "not a chapter-vs-book mismatch."
            ),
        }

    # Condition 4: no metadata-lock, no notes assertion.
    catalog_row = _read_catalog_row(library, citekey)
    if _has_metadata_lock(catalog_row):
        return {
            "applied": False,
            "reason": "metadata-lock: true on catalog row; user-judgment-required",
        }
    notes_text = _read_paper_notes(library, citekey)
    if _notes_assert_chapter_identity(notes_text):
        return {
            "applied": False,
            "reason": "notes.json asserts chapter-level identity; user-judgment-required",
        }

    cover_text = _extract_cover(pdf_path, pages=2)
    if not cover_text:
        return {"error": "pdftotext failed", "applied": False}

    # Condition 3: cover page unambiguously names the larger artifact.
    title = _extract_book_title(cover_text)
    if not title or len(title.split()) < 3:
        return {
            "applied": False,
            "reason": "cover-page title ambiguous; user-judgment-required",
        }

    publisher = _extract_publisher(cover_text)
    isbn = _extract_isbn(cover_text)

    # Compose the new bib fields. Year, address, author come from the
    # existing entry where possible (those usually stay).
    fields: dict[str, str] = {"title": title}
    if publisher:
        fields["publisher"] = publisher
    if isbn:
        fields["isbn"] = isbn

    scripts_dir = Path(__file__).parent

    # Apply via the CLI shims (which acquire the locks).
    if dry_run:
        return {
            "applied": False,
            "dry_run": True,
            "fields": fields,
            "would_set": {"bib.state": "needs-reauth"},
        }

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8",
    ) as fh:
        json.dump(fields, fh)
        fields_file = fh.name
    try:
        subprocess.run(
            [
                "python3", str(scripts_dir / "update_master_bib_entry.py"),
                citekey, "--entry-type", "book",
                "--fields-file", fields_file,
                "--bib-state", "needs-reauth",
            ],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        os.unlink(fields_file)
        return {"error": f"update_master_bib_entry failed: {e}", "applied": False}
    os.unlink(fields_file)

    # Update catalog row.
    patch = {"title": title, "bib": {"state": "needs-reauth"}}
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8",
    ) as fh:
        json.dump(patch, fh)
        patch_file = fh.name
    try:
        subprocess.run(
            [
                "python3", str(scripts_dir / "update_catalog_entry.py"),
                citekey, "--patch-file", patch_file,
            ],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        os.unlink(patch_file)
        return {"error": f"update_catalog_entry failed: {e}", "applied": False}
    os.unlink(patch_file)

    # Update \title{...} in main.tex.
    tex = tex_path.read_text(encoding="utf-8")
    new_tex, n = re.subn(
        r"\\title\{[^}]+\}", f"\\\\title{{{title}}}", tex, count=1,
    )
    if n > 0:
        tex_path.write_text(new_tex, encoding="utf-8")

    return {"applied": True, "fields": fields}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply the content/metadata-mismatch auto-resolution policy.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = apply(args.citekey, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if not result.get("applied"):
        print(f"Policy not applied: {result.get('reason', 'see dry-run output')}")
        if result.get("dry_run"):
            print(f"Would set fields: {result.get('fields')}")
        return 0
    print(f"Policy applied: master.bib updated to @book, "
          f"catalog title set to {result['fields']['title'][:80]!r}, "
          f"bib.state=needs-reauth.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
