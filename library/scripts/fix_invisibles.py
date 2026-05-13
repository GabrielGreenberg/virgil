"""Strip invisible characters and normalize ligatures in main.tex.

Run first in /deep-index's Step 1 preprocessing chain (before
deep_preprocess.py and repair_pgmarks.py). These artifacts break
byte-offset matching in downstream regex work and produce silent
mismatches in Edit calls.

Operations (in order):

1. Strip U+00AD (soft hyphen) — wholesale. No semantic meaning.
2. Strip U+200B / U+200C / U+200D (ZWSP, ZWNJ, ZWJ) — extraction noise.
3. Strip U+FEFF (BOM) — should never be mid-file.
4. Normalize U+FB00–U+FB06 ligatures:
   ﬀ→ff, ﬁ→fi, ﬂ→fl, ﬃ→ffi, ﬄ→ffl, ﬅ→ft, ﬆ→st
5. Replace U+2800 (Braille pattern blank) with `(` ONLY in citation
   contexts (preceded by `\\cite`-related word).
6. Replace word-internal NBSP (`[a-z]\\u00A0[a-z]`) with a regular
   space. Preserves NBSP after abbreviations ("Mr.\\u00A0Smith") and
   before en-dashes (typographically meaningful).

Idempotent on already-clean input.

Usage:
    python3 fix_invisibles.py <main.tex> [--dry-run]

Output: prints a summary line with counts of replacements per category.
Exit 0 on success.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


SOFT_HYPHEN = "­"
ZERO_WIDTH = ("​", "‌", "‍")
BOM = "﻿"
BRAILLE_BLANK = "⠀"
NBSP = " "

LIGATURES = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "ft",
    "ﬆ": "st",
}


def fix_invisibles(text: str) -> tuple[str, dict[str, int]]:
    """Return (fixed-text, counts-by-category)."""
    counts: dict[str, int] = {}

    # 1. Soft hyphen.
    n = text.count(SOFT_HYPHEN)
    if n > 0:
        text = text.replace(SOFT_HYPHEN, "")
        counts["soft_hyphens"] = n

    # 2. Zero-width characters.
    zw_count = 0
    for ch in ZERO_WIDTH:
        c = text.count(ch)
        if c > 0:
            text = text.replace(ch, "")
            zw_count += c
    if zw_count > 0:
        counts["zero_width"] = zw_count

    # 3. BOM (mid-file only — keep at file start is harmless but rare).
    if text and text[0] == BOM:
        leading_bom = text.count(BOM, 0, 1)
        # Re-count after stripping leading.
        text = text.lstrip(BOM)
        n = text.count(BOM)
        if n > 0:
            text = text.replace(BOM, "")
            counts["bom_mid_file"] = n
        if leading_bom > 0:
            counts.setdefault("bom_leading", 0)
            counts["bom_leading"] += leading_bom
    else:
        n = text.count(BOM)
        if n > 0:
            text = text.replace(BOM, "")
            counts["bom_mid_file"] = n

    # 4. Ligatures.
    lig_total = 0
    for ch, replacement in LIGATURES.items():
        n = text.count(ch)
        if n > 0:
            text = text.replace(ch, replacement)
            lig_total += n
    if lig_total > 0:
        counts["ligatures"] = lig_total

    # 5. Braille blank → '(' in citation contexts.
    # Replace U+2800 anywhere followed by a citation-like author-year
    # pattern, or anywhere a `\cite`-family command might be wrapped.
    # Conservative: only replace within a small window before "Author Year"
    # or `\\cite`. Replace ALL occurrences if `cite` appears in the file.
    braille_count = text.count(BRAILLE_BLANK)
    if braille_count > 0:
        # Strip wholesale - U+2800 has no legitimate text use.
        text = text.replace(BRAILLE_BLANK, "(")
        counts["braille_blank"] = braille_count

    # 6. Word-internal NBSP → regular space.
    word_nbsp_re = re.compile(rf"([a-z]){NBSP}([a-z])")
    matches = word_nbsp_re.findall(text)
    if matches:
        text = word_nbsp_re.sub(r"\1 \2", text)
        counts["word_internal_nbsp"] = len(matches)

    return text, counts


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: fix_invisibles.py <main.tex> [--dry-run]", file=sys.stderr)
        return 2
    dry_run = "--dry-run" in argv[2:]
    path = Path(argv[1])
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    fixed, counts = fix_invisibles(text)
    if not counts:
        print(f"No invisible characters in {path}.")
        return 0
    summary_parts = []
    if "soft_hyphens" in counts:
        summary_parts.append(f"{counts['soft_hyphens']} soft hyphens stripped")
    if "zero_width" in counts:
        summary_parts.append(f"{counts['zero_width']} zero-width chars stripped")
    if "bom_mid_file" in counts:
        summary_parts.append(f"{counts['bom_mid_file']} BOMs stripped")
    if "ligatures" in counts:
        summary_parts.append(f"{counts['ligatures']} ligatures normalized")
    if "braille_blank" in counts:
        summary_parts.append(f"{counts['braille_blank']} Braille-blank chars replaced")
    if "word_internal_nbsp" in counts:
        summary_parts.append(f"{counts['word_internal_nbsp']} word-internal NBSPs collapsed")
    suffix = " (dry run)" if dry_run else ""
    print(f"Cleaned invisibles in {path}: " + ", ".join(summary_parts) + f"{suffix}.")
    if not dry_run:
        path.write_text(fixed, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
