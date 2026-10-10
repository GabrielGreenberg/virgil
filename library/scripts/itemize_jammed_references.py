"""Itemize a wall-of-text references section using year-anchors.

When `format_references_section.py` yields fewer than ~5% of the
expected entry count (e.g., a 142-entry single-paragraph
bibliography that the standard parser misclassifies as 8 entries),
this script is the fallback: it locates every 4-digit year inside
the References section and walks backward from each year to the
preceding period to find the entry's start.

Used by /library/clean-bibliography as the year-anchor itemizer.
(lucking2024iconic case from batch-streamlining memo; willats /
carey wall-of-text cases.)

Usage:
    python3 itemize_jammed_references.py <paper-dir> [--dry-run]
    python3 itemize_jammed_references.py <paper-dir> --restore

Every write stashes the raw section it replaces (`_refs_preimage.py`,
task 1039); `--restore` (here or on format_references_section.py — one
stash) puts it back.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from _refs_preimage import has_preimage, restore_section, write_itemized_section
from _refs_section import references_span


ALREADY_ITEMIZED_RE = re.compile(r"\\begin\{itemize\}[\s\S]*?\\textbf\{")
YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2})([a-c]?)\b")


def _walk_back_to_period(text: str, year_pos: int, floor: int) -> int:
    """From a year position, walk backward to the most recent
    period-space-Capital boundary. That's the entry-start. Floor at
    the previous year's position to prevent crossing entries."""
    # Search the last 500 chars before year_pos for `.\s+[A-Z]`.
    start = max(floor, year_pos - 500)
    chunk = text[start:year_pos]
    # Find the LAST period+space+Capital in the chunk.
    last = -1
    for m in re.finditer(r"[\.\]]\s+([A-Z])", chunk):
        last = m.start(1)
    if last < 0:
        return start
    return start + last


def itemize_jammed(refs_section: str) -> list[str]:
    text = refs_section
    year_positions = [
        (m.start(), m.end(), m.group(0))
        for m in YEAR_RE.finditer(text)
    ]
    if not year_positions:
        return []

    starts: list[int] = []
    prev_year_pos = 0
    for ys, ye, _ in year_positions:
        entry_start = _walk_back_to_period(text, ys, prev_year_pos)
        starts.append(entry_start)
        prev_year_pos = ye

    # De-duplicate.
    cleaned: list[int] = []
    for s in starts:
        if not cleaned or s > cleaned[-1]:
            cleaned.append(s)

    if cleaned and cleaned[0] > 50:
        cleaned = [0] + cleaned

    entries: list[str] = []
    for i, start in enumerate(cleaned):
        end = cleaned[i + 1] if i + 1 < len(cleaned) else len(text)
        entry = re.sub(r"\s+", " ", text[start:end]).strip()
        if not entry:
            continue
        # Skip plausibly-junk fragments (no surname-like prefix).
        if not re.match(r"^[A-Z][a-zA-Z\-']", entry):
            continue
        entries.append(entry)
    return entries


def _shape_item(entry: str) -> str:
    """Wrap an entry as `\\item \\textbf{<authors-and-year>} <rest>`."""
    # Bold span: through the first sentence-final period that follows
    # a 4-digit year.
    ym = YEAR_RE.search(entry)
    if not ym:
        return f"\\item {entry}"
    head_end = ym.end()
    if head_end < len(entry) and entry[head_end] == ".":
        head_end += 1
    head = entry[:head_end].strip()
    rest = entry[head_end:].strip()
    # Normalize page-range hyphens.
    rest = re.sub(r"(\d)[–—\-](\d)", r"\1--\2", rest)
    return f"\\item \\textbf{{{head}}} {rest}".rstrip()


def itemize_paper(paper_dir: Path, dry_run: bool = False) -> dict:
    tex_path = paper_dir / "main.tex"
    if not tex_path.exists():
        return {"error": "main.tex not found"}
    text = tex_path.read_text(encoding="utf-8")
    span = references_span(text)
    if not span:
        return {"error": "no References section found"}
    refs_start, refs_end = span.body_start, span.end
    refs_section = text[refs_start:refs_end]

    if ALREADY_ITEMIZED_RE.search(refs_section):
        reason = "already itemized"
        if has_preimage(paper_dir):
            reason += " (run with --restore to recover the raw section, then retry)"
        return {"entries": 0, "reason": reason}

    entries = itemize_jammed(refs_section)
    if not entries:
        return {"entries": 0, "reason": "no year anchors found"}

    items = ["\\begin{itemize}"]
    for e in entries:
        items.append(_shape_item(e))
    items.append("\\end{itemize}")
    new_refs = "\n\n" + "\n".join(items) + "\n"

    if not dry_run:
        write_itemized_section(paper_dir, text, refs_start, refs_end, new_refs)

    return {"entries": len(entries)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Year-anchor fallback itemizer for wall-of-text bibliographies.",
    )
    parser.add_argument("paper_dir")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--restore", action="store_true",
        help="put back the raw References section the last itemization replaced",
    )
    args = parser.parse_args()
    paper_dir = Path(args.paper_dir).resolve()
    if args.restore:
        restored = restore_section(paper_dir)
        if "error" in restored:
            print(f"error: {restored['error']}", file=sys.stderr)
            return 1
        print(f"Restored the raw References section in {paper_dir}.")
        return 0
    result = itemize_paper(paper_dir, dry_run=args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result.get("reason"):
        print(f"Skipped: {result['reason']}.")
        return 0
    suffix = " (dry run)" if args.dry_run else ""
    print(f"Itemized {result['entries']} entries via year-anchor fallback{suffix}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
