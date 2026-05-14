"""Strip OCR-garbled instances of running headers / footers from
body text in `main.tex`.

Many OCR'd books have running headers like `THE STRUCTURE OF SCIENCE
142` (recto) or `142 PRINCIPLES OF VISION` (verso) that the
extractor failed to scrub. They end up interleaved in the body
prose, sometimes garbled (`T H E S T R U C T U R E`).

This script takes a list of phrase candidates (the book's title and
each chapter title) and strips OCR-garbled instances from body
prose. The match is whitespace-tolerant — `\\s*` between every two
letters — so the OCR-spaced or OCR-broken forms still match.

Phrases come from:

- `--phrases <comma-sep>` flag (explicit).
- `--from-toc` to read the document's `\\section{}` titles.
- `--from-master-bib` to read `master.bib`'s `title` field.

Usage:
    python3 strip_ocr_running_headers.py <main.tex>
        [--phrases "Foo Bar,Baz Qux"]
        [--from-toc] [--from-master-bib <path>]
        [--dry-run]

(haugeland, block, gombrich memos.)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SECTION_RE = re.compile(r"\\section\{([^}]+)\}", re.M)
MASTER_BIB_TITLE_RE = re.compile(r"title\s*=\s*\{([^}]+)\}", re.I)


def _phrase_regex(phrase: str) -> re.Pattern:
    """Build a whitespace-tolerant regex from a phrase. Each letter is
    separated by `\\s*` in the search pattern."""
    # Strip non-letter chars (commas, etc.) and lowercase.
    letters_only = "".join(c for c in phrase if c.isalpha() or c.isspace())
    letters_only = re.sub(r"\s+", " ", letters_only).strip()
    if not letters_only:
        return re.compile("(?!.*)")  # never matches
    pattern_parts: list[str] = []
    for ch in letters_only:
        if ch == " ":
            pattern_parts.append(r"\s+")
        else:
            pattern_parts.append(r"\s*" + re.escape(ch))
    # Optional trailing page number.
    return re.compile(
        r"\b" + "".join(pattern_parts) + r"(?:\s+\d{1,4})?\b",
        re.IGNORECASE,
    )


def strip(
    text: str, phrases: list[str],
) -> tuple[str, dict]:
    """Returns (new_text, count_by_phrase)."""
    counts: dict[str, int] = {}
    new_text = text
    for phrase in phrases:
        if not phrase or len(phrase) < 6:
            continue
        pat = _phrase_regex(phrase)
        new_text, n = pat.subn(" ", new_text)
        if n > 0:
            counts[phrase] = n
    # Collapse multiple spaces / blank-line runs introduced.
    new_text = re.sub(r"[ \t]{2,}", " ", new_text)
    new_text = re.sub(r"\n{3,}", "\n\n", new_text)
    return new_text, counts


def _read_toc_titles(text: str) -> list[str]:
    return [m.group(1) for m in SECTION_RE.finditer(text)]


def _read_master_bib_title(bib_path: Path, citekey: str) -> str | None:
    if not bib_path.exists():
        return None
    bib = bib_path.read_text(encoding="utf-8")
    # Find the entry with citekey.
    pat = re.compile(
        rf"@\w+\{{{re.escape(citekey)},[\s\S]*?\n\}}",
        re.M,
    )
    m = pat.search(bib)
    if not m:
        return None
    title_m = MASTER_BIB_TITLE_RE.search(m.group(0))
    return title_m.group(1) if title_m else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip OCR-garbled running headers from body text.",
    )
    parser.add_argument("tex")
    parser.add_argument("--phrases", default="")
    parser.add_argument("--from-toc", action="store_true")
    parser.add_argument("--from-master-bib", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    phrases: list[str] = []
    if args.phrases:
        phrases.extend(t.strip() for t in args.phrases.split(",") if t.strip())
    if args.from_toc:
        phrases.extend(_read_toc_titles(text))
    if args.from_master_bib:
        citekey = p.parent.name
        title = _read_master_bib_title(Path(args.from_master_bib), citekey)
        if title:
            phrases.insert(0, title)
    if not phrases:
        print("No phrases provided (use --phrases / --from-toc / --from-master-bib).",
              file=sys.stderr)
        return 2
    new_text, counts = strip(text, phrases)
    total = sum(counts.values())
    if total == 0:
        print(f"No OCR running-header instances stripped from {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Stripped {total} OCR running-header instances{suffix}:")
    for phrase, n in sorted(counts.items(), key=lambda x: -x[1])[:10]:
        print(f"  {n}× {phrase[:60]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
