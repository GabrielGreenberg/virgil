"""Clean common OCR artifacts in `\\section{Index of names}` and
`\\section{Index of subjects}` regions.

Operates only on lines inside those two index sections to avoid touching
real body prose. Fixes the recurring artifacts that PDF extraction
produces in indices:

- `Word, X ,` (extra space before comma)         -> `Word, X.,`
- `WordX.` (uppercase initial fused to surname)  -> `Word, X.`
- `Word,X` (no space after comma)                -> `Word, X`
- `Word,28` (no space between text and digit)    -> `Word, 28`
- `X.Y.` (two initials glued without space)      -> `X. Y.`
- `., iNN` (digit prefixed with OCR 'i')         -> `., 1NN`
- `145- 7` (broken page range)                   -> `145-7`
- `27—8` (em-dash between digits)                -> `27--8`
- Double spaces collapsed

Usage:
    python3 clean_index_ocr.py papers/<citekey>/main.tex
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def clean_index_line(line: str) -> str:
    s = line

    # "Name, X ," (uppercase + period dropped before comma)
    s = re.sub(r"(\b[A-Z]),\s+,", r"\1.,", s)
    # "WordX." (uppercase initial fused to surname-end)
    s = re.sub(r"\b([A-Z][a-z]+)([A-Z])\.", r"\1, \2.", s)
    # "Word,X" (uppercase initial after comma without space)
    s = re.sub(r"(\b[A-Z][a-z]+),([A-Z])\b", r"\1, \2", s)
    # "X.Y." (initials glued)
    s = re.sub(r"\b([A-Z])\.([A-Z])\.", r"\1. \2.", s)
    # ",N" (digit after comma without space)
    s = re.sub(r"(,)(\d{1,3})\b", r"\1 \2", s)
    # ", iNN" or ".,iNN" (OCR 'i' for '1')
    s = re.sub(r"(\.,?\s*)i(\d{2,3})\b", r"\1 1\2", s)
    # "145- 7" (broken page range)
    s = re.sub(r"(\d)-\s+(\d)", r"\1-\2", s)
    # em-/en-dash between digits
    s = re.sub(r"(\d)[—–](\d)", r"\1--\2", s)
    # "C ," -> "C.,"
    s = re.sub(r"\b([A-Z])\s+,\s+", r"\1., ", s)
    # Collapse double spaces
    s = re.sub(r"  +", " ", s)

    return s


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: clean_index_ocr.py <main.tex>", file=sys.stderr)
        return 2
    tex_path = Path(sys.argv[1])
    text = tex_path.read_text(encoding="utf-8")
    lines = text.split("\n")

    in_index = False
    out = []
    count = 0
    for line in lines:
        # Enter index section on either heading
        if (line.startswith(r"\section{Index of names}")
                or line.startswith(r"\section{Index of subjects}")):
            in_index = True
            out.append(line)
            continue
        # Leave index section at end-of-document
        if line.startswith(r"\end{document}"):
            in_index = False
        # Also leave if we hit a NEW \section that isn't an index
        if (in_index and line.startswith(r"\section{")
                and "Index of" not in line):
            in_index = False

        if in_index and line.startswith(r"\item "):
            new = clean_index_line(line)
            if new != line:
                count += 1
            out.append(new)
        else:
            out.append(line)

    if count:
        tex_path.write_text("\n".join(out), encoding="utf-8")
    print(f"Cleaned {count} index lines.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
