"""Normalize whitespace in main.tex before any pass that splits on `\\n`.

Step 0 of the deep-index preprocessing chain (runs before
`fix_invisibles.py` and `deep_preprocess.py`). Operations:

1. CR-only / CRLF → LF. Classic-Mac CR-only input through
   `deep_preprocess.join_broken_paragraphs` exploded a 216-line file
   into 6206 one-word lines (abusch2013applying memo).
2. Tab → single space. Tabs in extracted .tex are extraction noise
   (PyMuPDF / marker emit them between column reflows) and break
   indentation-sensitive regex.
3. Bulk NBSP normalization. When NBSP-density >= 50% of total
   whitespace, the file was extracted with NBSP as inter-word filler;
   replace all NBSPs with regular spaces. `fix_invisibles.py` does
   the narrow word-internal-NBSP fix; this script catches the bulk
   case.

Idempotent on already-normalized input. Safe to run before or after
fix_invisibles — both are wholesale character substitutions.

Usage:
    python3 normalize_whitespace.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


NBSP = " "
NBSP_BULK_THRESHOLD = 0.5


def normalize(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}

    # 1. Line endings.
    crlf = text.count("\r\n")
    cr_only = text.count("\r") - crlf
    if crlf or cr_only:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        counts["line_endings_normalized"] = crlf + cr_only

    # 2. Tabs.
    tabs = text.count("\t")
    if tabs:
        text = text.replace("\t", " ")
        counts["tabs_normalized"] = tabs

    # 3. Bulk NBSP.
    nbsp_count = text.count(NBSP)
    total_ws = (
        text.count(" ") + text.count("\n") + nbsp_count
    )
    if total_ws > 0 and nbsp_count / total_ws >= NBSP_BULK_THRESHOLD:
        text = text.replace(NBSP, " ")
        counts["bulk_nbsp_normalized"] = nbsp_count

    return text, counts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("texfile")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = Path(args.texfile)
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, counts = normalize(text)
    if not counts:
        print(f"{path}: already clean.")
        return 0
    parts = [f"{v} {k.replace('_', ' ')}" for k, v in counts.items()]
    suffix = " (dry run)" if args.dry_run else ""
    print(f"{path}: " + ", ".join(parts) + suffix + ".")
    if not args.dry_run:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
