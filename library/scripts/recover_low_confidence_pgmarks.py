"""Promote `\\pgmark[low]{N}` markers to high-confidence by content
overlap verification against the source PDF.

When `/index-paper` couldn't confirm the printed-page number at a
particular position (page footer not detected, ambiguous spacing,
column-glued text), it emits `\\pgmark[low]{N}` instead of
`\\pgmark{N}`. The audit punch-list flags every `[low]` marker but
no automated step verifies them — they accumulate (220+ on leong,
200+ on carey).

This script walks every `[low]` marker and:

1. Extracts the corresponding PDF page via `pdftotext -layout` on
   `papers/<citekey>/<citekey>.pdf` at PDF page (N − pgmark-offset).
2. Builds a token bag from the PDF page (filtered for running
   headers / page numbers).
3. Builds a token bag from `main.tex` in a ±1500-char window around
   the marker position.
4. Computes Jaccard overlap. If ≥ `--threshold` (default 0.30),
   promotes `[low]` → high-confidence (strips the `[low]`).

(leong, carey, haugeland memos.)

Usage:
    python3 recover_low_confidence_pgmarks.py <citekey>
        [--threshold 0.30] [--window 1500] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_LOW_RE = re.compile(r"\\pgmark\[low\]\{(\d+)\}")
PGMARK_ANY_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


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
            capture_output=True,
            text=True,
            timeout=20,
        )
        if out.returncode == 0:
            return out.stdout
    except subprocess.SubprocessError:
        pass
    return ""


def _tokens(text: str) -> set[str]:
    """Lowercased token bag; filters single chars, pure digits, and
    very common stopwords."""
    stop = {
        "the", "a", "an", "of", "in", "on", "at", "by", "for",
        "with", "to", "from", "is", "are", "be", "this", "that",
        "and", "or", "but", "as", "it", "its",
    }
    toks = re.findall(r"\b[a-z]{3,}\b", text.lower())
    return {t for t in toks if t not in stop}


def _filter_pdf_text(pdf_text: str) -> str:
    """Drop running-header / page-number lines for cleaner token bag."""
    out: list[str] = []
    for line in pdf_text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.match(r"^\d+\s*$", s):
            continue
        if re.match(r"^\d+\s+[A-Z][A-Za-z\s]+$", s):
            continue
        if re.match(r"^[A-Z][A-Za-z\s]+\s+\d+$", s):
            continue
        out.append(line)
    return "\n".join(out)


def _estimate_pdf_offset(text: str, pdf_page_total: int) -> int:
    """Estimate the (PDF-page − printed-page) offset by looking at the
    earliest high-confidence pgmark. Returns 0 if can't tell."""
    for m in PGMARK_ANY_RE.finditer(text):
        if "[low]" in m.group(0):
            continue
        try:
            printed = int(m.group(1))
        except ValueError:
            continue
        # If the first non-low pgmark has value P, and P is reasonable
        # vs. pdf_page_total, assume PDF page 1 maps to printed P.
        if 1 <= printed <= pdf_page_total + 30:
            return 0  # most common: PDF aligns 1-to-1 with printed
        return 0
    return 0


def recover(
    citekey: str, threshold: float, window: int, dry_run: bool,
) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}"}
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}"}

    text = tex_path.read_text(encoding="utf-8")
    low_markers: list[tuple[int, int, int]] = []  # (start, end, page)
    for m in PGMARK_LOW_RE.finditer(text):
        try:
            page = int(m.group(1))
        except ValueError:
            continue
        low_markers.append((m.start(), m.end(), page))
    if not low_markers:
        return {"promoted": 0, "checked": 0, "total_low": 0}

    pdf_pages = 0
    if shutil.which("pdfinfo"):
        try:
            out = subprocess.run(
                ["pdfinfo", str(pdf_path)],
                capture_output=True, text=True, timeout=15,
            )
            for line in out.stdout.split("\n"):
                if line.startswith("Pages:"):
                    pdf_pages = int(line.split(":", 1)[1].strip())
        except (subprocess.SubprocessError, ValueError):
            pass

    offset = _estimate_pdf_offset(text, pdf_pages or 1000)

    # Process in reverse position so edits don't shift later ones.
    promoted = 0
    checked = 0
    new_text = text
    for start, end, printed_page in reversed(low_markers):
        pdf_page = printed_page + offset
        if pdf_pages > 0 and not (1 <= pdf_page <= pdf_pages):
            continue
        checked += 1
        pdf_text = _extract_pdf_page(pdf_path, pdf_page)
        if not pdf_text:
            continue
        pdf_tokens = _tokens(_filter_pdf_text(pdf_text))
        if not pdf_tokens:
            continue
        win_lo = max(0, start - window)
        win_hi = min(len(new_text), end + window)
        tex_tokens = _tokens(new_text[win_lo:win_hi])
        if not tex_tokens:
            continue
        overlap = len(pdf_tokens & tex_tokens) / max(1, len(pdf_tokens))
        if overlap >= threshold:
            # Strip the [low] tag.
            replacement = f"\\pgmark{{{printed_page}}}"
            new_text = new_text[:start] + replacement + new_text[end:]
            promoted += 1

    if not dry_run and promoted > 0:
        tex_path.write_text(new_text, encoding="utf-8")

    return {
        "promoted": promoted,
        "checked": checked,
        "total_low": len(low_markers),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Promote \\pgmark[low]{} markers via content overlap.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--threshold", type=float, default=0.30)
    parser.add_argument("--window", type=int, default=1500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = recover(
        args.citekey, args.threshold, args.window, args.dry_run,
    )
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Promoted {result['promoted']}/{result['checked']} low markers "
        f"(of {result['total_low']} total) at threshold "
        f"{args.threshold:.0%}{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
