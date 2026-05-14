"""Detect prepended library lending-slip / interlibrary-loan front
matter in a PDF or in `main.tex`.

Institutional PDFs sourced via interlibrary loan commonly include
ILLIAD routing pages, OCLC headers, shipping addresses, and
"WARNING CONCERNING COPYRIGHT" notices on the first 1-3 pages
before the article content begins. These pages mess up pgmark
offset detection and bleed garbage text into the body extraction.

This script:

1. Scans the first 4 pages of the PDF (via `pdftotext -layout`) for
   lending-slip signatures (ILLIAD TN#, OCLC, "Lending String:",
   "Shipping Address:", "WARNING CONCERNING COPYRIGHT", "Stanford
   Information Delivery", "InterLibrary Loan").
2. Returns the page count of the prepended lending matter so
   `/library/index-paper` can skip those pages when computing pgmark
   offsets and extracting body text.
3. Optionally strips the corresponding span from `main.tex` if
   `--strip-from-tex` is passed.

(kunene memo.)

Usage:
    python3 detect_lending_slip.py <citekey>
        [--strip-from-tex] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


SIGNATURES = (
    "ILLIAD TN#", "ILLIAD", "OCLC ", "Lending String:",
    "Shipping Address:", "WARNING CONCERNING COPYRIGHT",
    "Stanford Information Delivery",
    "InterLibrary Loan", "Interlibrary Loan",
    "BorrowDirect", "Document Delivery",
    "Article Exchange", "RAPID ODYSSEY",
)


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _extract_pdf_page(pdf: Path, page: int) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=20,
        )
        if out.returncode == 0:
            return out.stdout
    except subprocess.SubprocessError:
        pass
    return ""


def _looks_like_slip(text: str) -> bool:
    return any(sig in text for sig in SIGNATURES)


def detect(citekey: str) -> dict:
    library = _resolve_library_root()
    pdf_path = library / "papers" / citekey / f"{citekey}.pdf"
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}", "lending_pages": 0}
    lending = 0
    for page in (1, 2, 3, 4):
        page_text = _extract_pdf_page(pdf_path, page)
        if _looks_like_slip(page_text):
            lending = page
        else:
            break
    return {"lending_pages": lending}


def strip_from_tex(citekey: str, lending_pages: int, dry_run: bool) -> int:
    if lending_pages == 0:
        return 0
    library = _resolve_library_root()
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return 0
    text = tex_path.read_text(encoding="utf-8")
    # Strip body content from \maketitle (or \begin{document}) up to
    # the first \pgmark whose value is > lending_pages.
    body_start_m = re.search(r"\\maketitle|\\begin\{document\}", text)
    if not body_start_m:
        return 0
    body_start = body_start_m.end()
    pg_re = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
    for m in pg_re.finditer(text, body_start):
        try:
            v = int(m.group(1))
        except ValueError:
            continue
        if v > lending_pages:
            # Strip [body_start, m.start()).
            new_text = text[:body_start] + "\n\n" + text[m.start():]
            if not dry_run:
                tex_path.write_text(new_text, encoding="utf-8")
            return m.start() - body_start
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect prepended lending-slip pages.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--strip-from-tex", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = detect(args.citekey)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    lp = result["lending_pages"]
    if lp == 0:
        print("No lending-slip front matter detected.")
        return 0
    print(f"Detected {lp} lending-slip pages prepended to PDF.")
    if args.strip_from_tex:
        n_chars = strip_from_tex(args.citekey, lp, args.dry_run)
        suffix = " (dry run)" if args.dry_run else ""
        if n_chars > 0:
            print(f"Stripped {n_chars} chars of lending-slip text from main.tex{suffix}.")
        else:
            print("No corresponding text found in main.tex to strip.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
