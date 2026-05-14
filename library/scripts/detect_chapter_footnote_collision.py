"""Detect when low-N pgmarks are actually chapter-footnote numbers
(not printed page numbers).

In some scanned books, the extractor mistakes footnote numbers
(`¹`, `²`, … rendered as `1`, `2`) for page numbers and emits them
as `\\pgmark{1}`, `\\pgmark{2}`, etc. The result: the pgmark sequence
has spurious duplicates of low values, each chapter producing its
own `\\pgmark{1}` and `\\pgmark{2}` series.

This script detects the pattern by:

1. Counting how many times each pgmark value appears.
2. Flagging values in range 1-50 that appear ≥ N times (default 3),
   *and* whose positions are clustered (each pair separated by
   substantial body content suggesting they live in different
   chapters).
3. Optionally stripping them when `--strip-collisions` is passed.

(fodor memo.)

Usage:
    python3 detect_chapter_footnote_collision.py <main.tex>
        [--threshold 3] [--strip-collisions] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def detect(
    text: str, threshold: int = 3, strip: bool = False,
) -> tuple[str, list[tuple[int, list[int]]]]:
    """Returns (new_text, collisions) where collisions is a list of
    (page_value, [marker_positions])."""
    positions_by_page: dict[int, list[tuple[int, int]]] = {}
    for m in PGMARK_RE.finditer(text):
        try:
            v = int(m.group(1))
        except ValueError:
            continue
        positions_by_page.setdefault(v, []).append((m.start(), m.end()))

    collisions: list[tuple[int, list[tuple[int, int]]]] = []
    for v, posns in positions_by_page.items():
        if not (1 <= v <= 50):
            continue
        if len(posns) < threshold:
            continue
        # Each pair of consecutive positions should be well-separated
        # (the pgmarks belong to different chapters, not adjacent
        # extraction-noise repeats).
        gaps_ok = all(
            posns[i + 1][0] - posns[i][1] > 500
            for i in range(len(posns) - 1)
        )
        if not gaps_ok:
            continue
        collisions.append((v, posns))

    new_text = text
    if strip and collisions:
        all_ranges: list[tuple[int, int]] = []
        for _, posns in collisions:
            all_ranges.extend(posns)
        all_ranges.sort()
        for start, end in reversed(all_ranges):
            new_text = new_text[:start] + new_text[end:]
        new_text = re.sub(r"\n{3,}", "\n\n", new_text)

    # Return only the (value, position) tuples, not the byte ranges.
    summary = [(v, [s for s, _ in posns]) for v, posns in collisions]
    return new_text, summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect chapter-footnote-number collisions in pgmarks.",
    )
    parser.add_argument("tex")
    parser.add_argument("--threshold", type=int, default=3)
    parser.add_argument("--strip-collisions", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, collisions = detect(
        text, args.threshold, args.strip_collisions,
    )
    if not collisions:
        print(f"No chapter-footnote-collision pattern detected in {p}.")
        return 0
    for v, posns in collisions:
        print(f"  value {v}: {len(posns)} occurrences (positions: "
              f"{posns[:5]}{'...' if len(posns) > 5 else ''})")
    if args.strip_collisions and not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
        print(f"Stripped {sum(len(p) for _, p in collisions)} pgmarks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
