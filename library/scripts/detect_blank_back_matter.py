"""Detect blank back-matter pages in a PDF.

Many books and book-chapter PDFs have blank pages or "blank apart
from a running header" pages at the very end — sometimes labelled
"For Notes" or simply empty. The extractor produces correspondingly
empty pgmarks in `main.tex`, which the audit punch-list then flags
as low-confidence or out-of-range.

This script samples the last few PDF pages, identifies the
truly-blank tail, and emits a `source-missing: <range>` warning
candidate so `/library/di-validate` can register a clean
known-blank-pages exemption rather than chasing the warnings on
each pass.

(gombrich memo.)

Usage:
    python3 detect_blank_back_matter.py <citekey>
        [--check-last 10] [--blank-text-threshold 50]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _pdf_page_count(pdf: Path) -> int:
    if not shutil.which("pdfinfo"):
        return 0
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=15,
        )
        for line in out.stdout.split("\n"):
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError):
        pass
    return 0


def _page_body_chars(pdf: Path, page: int) -> int:
    """Return the count of non-running-header body chars on `page`."""
    if not shutil.which("pdftotext"):
        return -1
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return -1
    except subprocess.SubprocessError:
        return -1
    body_chars = 0
    for line in out.stdout.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.match(r"^\d+\s*$", s):
            continue
        if re.match(r"^\d+\s+[A-Z][A-Za-z\s]+$", s):
            continue
        if re.match(r"^[A-Z][A-Za-z\s]+\s+\d+$", s):
            continue
        body_chars += len(s)
    return body_chars


def detect(
    citekey: str, check_last: int = 10, threshold: int = 50,
) -> dict:
    library = _resolve_library_root()
    pdf_path = library / "papers" / citekey / f"{citekey}.pdf"
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}"}
    page_count = _pdf_page_count(pdf_path)
    if page_count == 0:
        return {"error": "pdfinfo failed"}
    # Walk backward from the last page until we hit a non-blank page.
    blank_pages: list[int] = []
    for page in range(page_count, max(0, page_count - check_last), -1):
        chars = _page_body_chars(pdf_path, page)
        if chars < 0:
            break
        if chars < threshold:
            blank_pages.append(page)
        else:
            break
    if not blank_pages:
        return {"blank_pages": []}
    blank_pages.sort()
    return {
        "blank_pages": blank_pages,
        "range_start": blank_pages[0],
        "range_end": blank_pages[-1],
        "page_count": page_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect blank back-matter pages in a PDF.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--check-last", type=int, default=10)
    parser.add_argument("--blank-text-threshold", type=int, default=50)
    args = parser.parse_args()
    result = detect(args.citekey, args.check_last, args.blank_text_threshold)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if not result["blank_pages"]:
        print("No blank back-matter pages detected.")
        return 0
    print(
        f"Detected {len(result['blank_pages'])} blank back-matter pages: "
        f"pp. {result['range_start']}-{result['range_end']} "
        f"(of {result['page_count']} total). "
        "Suggested catalog warning:"
    )
    print(
        f"  source-missing: pages {result['range_start']}-{result['range_end']} "
        f"verified blank back matter"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
