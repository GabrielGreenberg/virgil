"""Pull `\\pgmark{N}` literals out of `\\footnote{...}` bodies.

A `\\pgmark{N}` inside a `\\footnote{}` argument is silently swallowed
by the Virgil renderer — the margin chip never appears, and the
catalog's pgmark continuity check can't see the marker. When a
footnote body spans a page boundary (the call site is on page N and
the body continues onto page N+1), the leaked-prose reattacher may
absorb the inline `\\pgmark{N+1}` into the footnote argument.

This script walks every `\\footnote{...}` body, extracts any
`\\pgmark{N}` literals, and re-inserts them at body scope right after
the footnote's closing `}`. Idempotent: clean input is a no-op.

(shin memo: promoted from `/tmp/<paper>/fix_pgmark_in_footnotes.py`.)

Usage:
    python3 fix_pgmark_in_footnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FOOTNOTE_OPEN_RE = re.compile(r"\\footnote\{")
PGMARK_LITERAL_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{\d+\}")


def _find_footnote_ranges(text: str) -> list[tuple[int, int, int]]:
    """Return (open_brace_pos, body_start, body_end_exclusive) for
    each `\\footnote{...}`. body_end_exclusive is the position of
    the closing `}` (not included)."""
    ranges: list[tuple[int, int, int]] = []
    for m in FOOTNOTE_OPEN_RE.finditer(text):
        body_start = m.end()
        depth = 1
        i = body_start
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "\\" and i + 1 < len(text):
                i += 2
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    ranges.append((m.start(), body_start, i))
                    break
            i += 1
    return ranges


def repair(text: str) -> tuple[str, int]:
    """Pull pgmarks from every footnote body to body scope. Returns
    (new_text, count_pgmarks_moved)."""
    ranges = _find_footnote_ranges(text)
    if not ranges:
        return text, 0
    # Apply in reverse to keep offsets valid.
    new_text = text
    moved = 0
    for fn_start, body_start, body_end in reversed(ranges):
        body = new_text[body_start:body_end]
        pgmarks = PGMARK_LITERAL_RE.findall(body)
        if not pgmarks:
            continue
        cleaned_body = PGMARK_LITERAL_RE.sub("", body)
        cleaned_body = re.sub(r"\s{2,}", " ", cleaned_body).strip()
        # Replace the body and append the pgmarks after the footnote's
        # closing brace.
        close_pos = body_end + 1  # position right after `}`
        injection = "".join(" " + p for p in pgmarks)
        new_text = (
            new_text[:body_start]
            + cleaned_body
            + new_text[body_end:close_pos]
            + injection
            + new_text[close_pos:]
        )
        moved += len(pgmarks)
    return new_text, moved


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lift \\pgmark{} out of \\footnote{} bodies.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, moved = repair(text)
    if moved == 0:
        print(f"No pgmarks inside footnotes in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Moved {moved} pgmark(s) out of footnote bodies{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
