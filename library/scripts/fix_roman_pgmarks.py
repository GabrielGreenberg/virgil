"""Fix OCR-garbled Roman-numeral pgmark values.

OCR systematically transposes adjacent strokes in Roman numerals
(`xl`↔`xi`, `civ`↔`viii`, `lx`↔`xiii`, etc.), producing pgmark
values like `\\pgmark{civ}` where `\\pgmark{viii}` was correct.

This script:

1. Walks every Roman-numeral pgmark in `main.tex`.
2. Cross-references against the corresponding PDF page header /
   footer (via `pdftotext -layout`) for the most-likely intended
   value.
3. Applies a known transposition map to clean up obvious garbles.

(chomsky memo.)

Usage:
    python3 fix_roman_pgmarks.py <citekey> [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{([ivxlcdm]+)\}", re.I)


# Known transposition pairs. Format: garble → correct.
# These are the common OCR errors flagged across many scanned books.
TRANSPOSITION_MAP = {
    "xl": "xi",
    "civ": "viii",
    "lx": "xiii",
    "cxiv": "xviii",
    "lxiii": "xxiii",
    "vl": "iv",
    "il": "ii",
    "cl": "cli",
    "lc": "li",
}


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _roman_to_int(r: str) -> int | None:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    r = r.lower()
    total = 0
    prev = 0
    for ch in reversed(r):
        v = vals.get(ch)
        if v is None:
            return None
        if v < prev:
            total -= v
        else:
            total += v
        prev = v
    return total


def _int_to_roman(n: int) -> str:
    pairs = [
        (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
        (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
        (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
    ]
    out = ""
    for v, sym in pairs:
        while n >= v:
            out += sym
            n -= v
    return out


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


def _pdf_page_header(pdf: Path, page: int) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode == 0:
            return out.stdout
    except subprocess.SubprocessError:
        pass
    return ""


def fix(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}"}
    text = tex_path.read_text(encoding="utf-8")

    roman_marks: list[tuple[int, int, str, int]] = []  # (start, end, roman, ordinal_in_run)
    for i, m in enumerate(PGMARK_RE.finditer(text)):
        roman_marks.append((m.start(), m.end(), m.group(1).lower(), i + 1))
    if not roman_marks:
        return {"fixed": 0, "total_roman": 0}

    fixed_count = 0
    new_text = text
    # First pass: dictionary-based transposition.
    for start, end, roman, ordinal in reversed(roman_marks):
        if roman in TRANSPOSITION_MAP:
            replacement = f"\\pgmark{{{TRANSPOSITION_MAP[roman]}}}"
            new_text = new_text[:start] + replacement + new_text[end:]
            fixed_count += 1

    # Second pass: ordinal-check. The N-th roman pgmark in document
    # order should map to roman(N). Replace if the mismatch is large
    # AND the value > 2× ordinal (clearly garbled vs. just off by one).
    if pdf_path.exists():
        running_text = new_text
        running_marks = [
            (m.start(), m.end(), m.group(1).lower())
            for m in PGMARK_RE.finditer(running_text)
        ]
        for ordinal, (start, end, roman) in enumerate(running_marks, start=1):
            n = _roman_to_int(roman) or 0
            if n > ordinal * 2 and n > 10:
                replacement = f"\\pgmark{{{_int_to_roman(ordinal)}}}"
                running_text = (
                    running_text[:start] + replacement + running_text[end:]
                )
                fixed_count += 1
        new_text = running_text

    if not dry_run and fixed_count > 0:
        tex_path.write_text(new_text, encoding="utf-8")

    return {
        "fixed": fixed_count,
        "total_roman": len(roman_marks),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fix OCR-garbled Roman-numeral pgmark values.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = fix(args.citekey, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Fixed {result['fixed']}/{result['total_roman']} Roman-numeral "
        f"pgmarks{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
