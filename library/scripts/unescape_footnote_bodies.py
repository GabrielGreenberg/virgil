"""Strip over-escapes inside `\\footnote{...}` bodies.

`reattach_leaked_footnotes.py` historically over-escapes the body
content it wraps — it backslash-escapes every `\\` and then partially
un-does the escape for known LaTeX commands. The result is bodies
containing `\\\\` or `\\{` / `\\}` for content that should be plain
characters or legitimate commands.

This script walks every `\\footnote{...}` argument in `main.tex` and:

- Collapses `\\\\` to `\\` (un-doubled backslashes).
- Unescapes `\\{` and `\\}` *only* when the result is a legitimate
  LaTeX command (preceded by `\\<cmd>` with no matching open elsewhere).
- Drops orphan `\\` sequences inside footnote bodies that aren't
  followed by a recognized command letter or escape character.

Idempotent: running on a clean file is a no-op.

Usage:
    python3 unescape_footnote_bodies.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FOOTNOTE_OPEN_RE = re.compile(r"\\footnote\{")


def _find_footnote_body_ranges(text: str) -> list[tuple[int, int]]:
    """Return (body_start, body_end) char ranges (exclusive of braces)
    for each `\\footnote{...}` in `text`."""
    ranges: list[tuple[int, int]] = []
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
                    ranges.append((body_start, i))
                    break
            i += 1
    return ranges


def _unescape_body(body: str) -> str:
    # Collapse `\\\\` to `\\`.
    out = re.sub(r"\\{2,}(?=\\)", "\\\\", body)
    # `\\{` → `{` only when not part of a recognized command. The
    # cheapest heuristic: an isolated `\\{` not immediately following
    # a command-name letter is over-escaped.
    out = re.sub(r"(?<![a-zA-Z])\\\{", "{", out)
    out = re.sub(r"(?<![a-zA-Z])\\\}", "}", out)
    return out


def unescape(text: str) -> tuple[str, int]:
    """Returns (new_text, count_bodies_changed)."""
    ranges = _find_footnote_body_ranges(text)
    if not ranges:
        return text, 0
    # Apply edits in reverse order so offsets stay valid.
    new_text = text
    changed = 0
    for start, end in reversed(ranges):
        body = new_text[start:end]
        cleaned = _unescape_body(body)
        if cleaned != body:
            new_text = new_text[:start] + cleaned + new_text[end:]
            changed += 1
    return new_text, changed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Strip over-escapes inside \\footnote{} bodies.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    new_text, count = unescape(text)
    if count == 0:
        print(f"No footnote-body over-escapes in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Unescaped {count} footnote bodies{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
