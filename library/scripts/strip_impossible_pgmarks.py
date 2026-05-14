"""Remove `\\pgmark{N}` markers whose value is clearly impossible
relative to the source PDF's page count.

`repair_pgmarks.py` has a >50% removal safeguard that aborts when too
many pgmarks would be stripped. That's the right policy in general
but it can leave unambiguously-bad markers in place. For example, a
stray `\\pgmark{385}` in a 222-page book, or a stray `\\pgmark{1979}`
in a 30-page paper, is OCR pagination garbage and stripping it
never harms anything.

This script strips only those clear outliers — values that exceed
the PDF page count × 1.5 (configurable via `--ratio`). It bypasses
the safeguard because each marker is independently impossible. The
catalog warning emitted by the validator will mention it.

(lewis memo.)

Usage:
    python3 strip_impossible_pgmarks.py <main.tex>
        [--pdf-pages N] [--ratio 1.5] [--dry-run]

When `--pdf-pages` is omitted, the script reads from `pdfinfo` on
the sibling `<citekey>.pdf` (using the standard Library layout).
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def _detect_pdf_pages(tex_path: Path) -> int | None:
    if not shutil.which("pdfinfo"):
        return None
    citekey = tex_path.parent.name
    pdf = tex_path.parent / f"{citekey}.pdf"
    if not pdf.exists():
        return None
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=15,
        )
        for line in out.stdout.split("\n"):
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError):
        pass
    return None


def strip_impossible(
    text: str, pdf_pages: int, ratio: float = 1.5,
) -> tuple[str, list[int]]:
    """Returns (new_text, stripped_values).

    Strips a pgmark `\\pgmark{N}` only when BOTH:

    - `N > pdf_pages × ratio` (much higher than the PDF can plausibly contain), AND
    - the value falls outside the dominant monotonic run of the pgmark
      sequence (so we don't strip an outlier that's actually part of a
      journal-offset reprint span like pp. 19–39 in a 23-page PDF).

    This is conservative: it only strips clear outliers like a stray
    `\\pgmark{385}` in a 222-page book or `\\pgmark{1979}` in a
    30-page paper.
    """
    threshold = pdf_pages * ratio
    if threshold < 1:
        return text, []
    # Gather all numeric pgmark values to find the dominant run's max.
    all_values: list[int] = []
    candidates: list[tuple[int, int, int]] = []
    for m in PGMARK_RE.finditer(text):
        try:
            v = int(m.group(1))
        except ValueError:
            continue
        all_values.append(v)
        if v > threshold:
            candidates.append((m.start(), m.end(), v))
    if not candidates or not all_values:
        return text, []

    # The "dominant run" is the range of typical pgmark values. Use
    # median ± 3×IQR as a robust envelope. If a candidate is inside the
    # envelope, it's a legitimate journal-offset pgmark — don't strip.
    sorted_vals = sorted(all_values)
    n = len(sorted_vals)
    q1 = sorted_vals[n // 4] if n >= 4 else sorted_vals[0]
    q3 = sorted_vals[(3 * n) // 4] if n >= 4 else sorted_vals[-1]
    iqr = q3 - q1
    envelope_max = q3 + 3 * max(iqr, 1)

    real_removals: list[tuple[int, int, int]] = []
    for start, end, v in candidates:
        if v > envelope_max:
            real_removals.append((start, end, v))
    if not real_removals:
        return text, []

    new_text = text
    stripped_values: list[int] = []
    for start, end, v in reversed(real_removals):
        new_text = new_text[:start] + new_text[end:]
        stripped_values.append(v)
    new_text = re.sub(r"\n{3,}", "\n\n", new_text)
    return new_text, stripped_values


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip pgmarks whose value exceeds pdf_pages × ratio.",
    )
    parser.add_argument("tex")
    parser.add_argument("--pdf-pages", type=int, default=None)
    parser.add_argument("--ratio", type=float, default=1.5)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    pdf_pages = args.pdf_pages or _detect_pdf_pages(p)
    if pdf_pages is None:
        print("error: PDF page count unavailable; pass --pdf-pages",
              file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, stripped = strip_impossible(text, pdf_pages, args.ratio)
    if not stripped:
        print(f"No impossible pgmarks in {p} "
              f"(threshold {int(pdf_pages * args.ratio)}).")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    sample = ", ".join(str(v) for v in stripped[:5])
    extra = f", ... ({len(stripped) - 5} more)" if len(stripped) > 5 else ""
    print(
        f"Stripped {len(stripped)} pgmarks (values: {sample}{extra}){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
