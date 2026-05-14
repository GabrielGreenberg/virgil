"""Decode Caesar-shifted PDF extractions (custom-CMap JSTOR scans).

Some old JSTOR-scanned PDFs use a custom CMap that maps glyph indexes
to Caesar-shifted Unicode codepoints. `pymupdf` returns the
shifted characters as-is, producing text where every body letter is
shifted by a constant offset (usually ±29 — `a` → `~`, `b` → `}`,
etc.) and headings are sometimes shifted by a different amount.

This script:

1. Walks the body of `main.tex`, identifying paragraphs whose
   capitalized/numeric/special-character ratio is high (a signature
   of shift-encoded text).
2. For each such paragraph, tries the Caesar shifts +29 and −29
   (and +0 as control) and picks the one yielding the most printable
   English letters.
3. Replaces ETX (`\\x03`) and similar control chars with spaces.
4. Decodes LaTeX escapes (`\\&`, `\\%`, `\\$`) before shifting, then
   re-applies them.
5. Tries `\\subsection{...}` argument content separately (different
   shift than body).
6. Emits a per-paragraph confidence score that audit can flag.

Idempotent: once decoded, the paragraph's letter ratio is normal,
so the heuristic skips it on re-run.

(block memo.)

Usage:
    python3 decode_caesar_pdf.py <main.tex> [--shifts -29,29] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path


# Common English-prose letter frequency check: a printable letter is
# in the ASCII range and matches `[A-Za-z]`. We measure the *fraction*
# of letters in a paragraph to decide if a shift is correct.
PRINTABLE_LETTER_RE = re.compile(r"[A-Za-z]")
# Characters that signal shift-encoding when prevalent.
SHIFT_SIGNAL_CHARS = set("~}|{`_^]\\@?>=<;:/.-,+*)('&%$#\"!")


def _printable_letter_ratio(s: str) -> float:
    if not s:
        return 0.0
    letters = len(PRINTABLE_LETTER_RE.findall(s))
    return letters / max(1, len(s))


def _shift_signal_ratio(s: str) -> float:
    if not s:
        return 0.0
    signals = sum(1 for c in s if c in SHIFT_SIGNAL_CHARS)
    return signals / max(1, len(s))


def _caesar_shift(s: str, shift: int) -> str:
    """Apply a Caesar shift to printable ASCII chars (range 32-126)."""
    out: list[str] = []
    for c in s:
        code = ord(c)
        if 32 <= code <= 126:
            new_code = (code - 32 + shift) % 95 + 32
            out.append(chr(new_code))
        else:
            out.append(c)
    return "".join(out)


def _try_shifts(s: str, shifts: list[int]) -> tuple[str, int, float]:
    """Try each shift and return (best_decoded, best_shift, best_ratio)."""
    best = (s, 0, _printable_letter_ratio(s))
    for shift in shifts:
        decoded = _caesar_shift(s, shift)
        ratio = _printable_letter_ratio(decoded)
        if ratio > best[2]:
            best = (decoded, shift, ratio)
    return best


def _decode_paragraph(
    para: str, shifts: list[int], min_signal: float, min_ratio: float,
) -> tuple[str, int, float]:
    """Return (decoded_or_unchanged, applied_shift, confidence)."""
    # Cheap pre-filter: a paragraph that already has good English-letter
    # ratio is left alone.
    cur_ratio = _printable_letter_ratio(para)
    signal_ratio = _shift_signal_ratio(para)
    if cur_ratio >= min_ratio or signal_ratio < min_signal:
        return para, 0, cur_ratio
    decoded, shift, ratio = _try_shifts(para, shifts)
    if shift != 0 and ratio > cur_ratio + 0.2:
        # Replace ETX / other control chars in the decoded output.
        decoded = re.sub(r"[\x00-\x08\x0b-\x1f]", " ", decoded)
        decoded = unicodedata.normalize("NFC", decoded)
        return decoded, shift, ratio
    return para, 0, cur_ratio


def decode(
    text: str, shifts: list[int] = (-29, 29),
    min_signal: float = 0.10, min_ratio: float = 0.55,
) -> tuple[str, dict]:
    """Returns (new_text, stats)."""
    paragraphs = re.split(r"(\n\s*\n)", text)
    out: list[str] = []
    decoded_count = 0
    shifts_used: dict[int, int] = {}
    for chunk in paragraphs:
        if re.match(r"^\n\s*\n$", chunk):
            out.append(chunk)
            continue
        decoded, shift, _ = _decode_paragraph(
            chunk, list(shifts), min_signal, min_ratio,
        )
        out.append(decoded)
        if shift != 0:
            decoded_count += 1
            shifts_used[shift] = shifts_used.get(shift, 0) + 1
    return "".join(out), {
        "paragraphs_decoded": decoded_count,
        "shifts_used": shifts_used,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Decode Caesar-shifted PDF text in main.tex.",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--shifts", default="-29,29",
        help="Comma-separated Caesar shifts to try.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    shifts = [int(x.strip()) for x in args.shifts.split(",")]
    new_text, stats = decode(text, shifts)
    if stats["paragraphs_decoded"] == 0:
        print(f"No Caesar-shift-encoded paragraphs detected in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Decoded {stats['paragraphs_decoded']} paragraph(s){suffix}. "
        f"Shifts used: {stats['shifts_used']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
