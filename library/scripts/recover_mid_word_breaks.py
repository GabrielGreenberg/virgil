"""Recover non-hyphenated mid-word page breaks.

`recover_page_break_fragments.py` already handles the case where a
word is split with a hyphen at a page break (`recover-\\nery`).
Sometimes the source PDF breaks mid-word *without* a hyphen — page
N ends with `psychological` and page N+1 begins with `investigation.
Thus…` — and pymupdf joins them with a space, leaving
`psychological investigation. Thus…` which is correct as is.

But when the extraction loses the bridge text entirely (one line
dropped), the body ends up with `psychological. Thus…` — a
sentence-ending period from page N's last sentence, followed by
material that starts mid-clause on page N+1.

This script:

1. For each `\\pgmark{N}` in `main.tex`, extract the first ~20 chars
   of body text on PDF page N via `pdftotext -layout`.
2. Check that those words appear in `main.tex` within ±200 chars of
   the pgmark.
3. If not, surface the missing bridge text from the PDF with a
   suggested patch (printed to stdout; the script doesn't modify
   `main.tex` automatically — manual review is safer).

(neander memo.)

Usage:
    python3 recover_mid_word_breaks.py <citekey> [--apply]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _pdf_page_count(pdf: Path) -> int | None:
    if not shutil.which("pdfinfo"):
        return None
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
    return None


def _pdf_first_body_chars(pdf: Path, page: int, char_limit: int = 30) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return ""
    except subprocess.SubprocessError:
        return ""
    # Take the first content line (skip headers / page numbers / blank).
    for raw in out.stdout.split("\n"):
        s = raw.strip()
        if not s:
            continue
        if re.match(r"^\d+\s*$", s):
            continue
        if re.match(r"^\d+\s+[A-Z]", s) or re.match(r"^[A-Z][A-Za-z\s]+\s+\d+$", s):
            continue
        return s[:char_limit]
    return ""


def scan(citekey: str, apply_fix: bool = False) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists() or not pdf_path.exists():
        return {"error": "main.tex or PDF not found"}
    text = tex_path.read_text(encoding="utf-8")
    pdf_pages = _pdf_page_count(pdf_path) or 0
    if pdf_pages == 0:
        return {"error": "pdfinfo failed"}

    findings: list[tuple[int, int, str]] = []  # (pgmark_pos, page, bridge)
    for m in PGMARK_RE.finditer(text):
        try:
            page = int(m.group(1))
        except ValueError:
            continue
        if not (1 <= page <= pdf_pages + 30):
            continue
        bridge = _pdf_first_body_chars(pdf_path, page)
        if not bridge:
            continue
        # Take 2-3 distinctive words.
        words = [w for w in re.findall(r"\b\w+\b", bridge) if len(w) >= 4][:3]
        if not words:
            continue
        window_lo = max(0, m.end() - 100)
        window_hi = min(len(text), m.end() + 300)
        window = text[window_lo:window_hi]
        if all(w in window for w in words):
            continue
        findings.append((m.end(), page, bridge))

    if not findings:
        return {"missing": 0}

    # Report; auto-apply is risky because we can't be sure where the
    # bridge text belongs. Print suggested patches.
    for pos, page, bridge in findings:
        line = text[:pos].count("\n") + 1
        print(
            f"  page {page} (line {line}): missing bridge text starting "
            f"with {bridge!r}"
        )

    return {"missing": len(findings)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect non-hyphenated mid-word page breaks.",
    )
    parser.add_argument("citekey")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="(reserved; auto-fix not yet supported)",
    )
    args = parser.parse_args()
    result = scan(args.citekey, args.apply)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result["missing"] == 0:
        print("No mid-word page-break gaps detected.")
    else:
        print(f"Detected {result['missing']} likely mid-word-break gaps.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
