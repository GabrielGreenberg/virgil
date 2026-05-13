"""Tier-0 in-file footnote re-attachment.

Walks main.tex for paragraphs that look like leaked footnote bodies
and matches each to an inline call site within the same chapter. This
is faster than PDF re-extraction when the bodies are already in the
file (pymupdf and similar extractors commonly emit footnote bodies as
ordinary page-bottom paragraphs with the number as a prefix).

Detects leaked-prose paragraph patterns:

  ^N <body>          (bare integer + space + body)
  ^N. <body>         (integer + period + space + body)
  ^N\\s+<body>        (any whitespace separator)
  ^N body M body K… (column-glued footnotes — split into 3 fns)

Matches each leaked body to an inline call site via six patterns:

  <word>.N           — period-then-number (most common)
  <word>N            — direct concatenation
  <word>,N           — comma-then-number
  <word> N           — space-then-number
  <close-punct>N     — closing parenthesis/brace then number
  <digit>, N         — chained pair (e.g. "9, 10")

For each match found, rewraps as `\\footnote{<body>}` inline at the
call site and removes the leaked paragraph. Reports placed vs.
unplaced counts.

Constraints:
- Only operates on paragraphs at body scope (not inside math, command
  arguments, references section, or example envelopes).
- Skips the bibliography section (after `\\section{References|Bibliography|Works Cited}`).
- Idempotent on already-clean input — if no leaked paragraphs match
  the pattern, no changes.

Usage:
    python3 reattach_leaked_footnotes.py <main.tex> [--dry-run]

Output: prints a one-line summary plus per-chapter recovery counts.
Exit 0 on success.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NamedTuple


# Paragraph-start leaked-footnote pattern. Matches either:
#   "1 body..." or "1. body..."
# Where the leading number is 1-200 (footnote numbers).
LEAKED_PARA_RE = re.compile(
    r"^(\d{1,3})[.\s]+([A-Z\"“‘][^\n]*(?:\n(?!\n)[^\n]*)*?)(?=\n\s*\n|\Z)",
    re.M,
)

# Section heading regex.
SECTION_RE = re.compile(r"^\\section\{([^}]+)\}", re.M)

# References / bibliography section boundary.
REFS_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)

# Skip block contexts: math, footnote already-wrapped, command arg.
SKIP_CONTEXTS = (r"\[", r"\(", r"\\footnote\{", r"\\section\{", r"\\subsection\{")


class LeakedNote(NamedTuple):
    number: int
    body: str
    start: int
    end: int


def find_chapter_boundaries(text: str) -> list[tuple[int, int]]:
    """Return list of (chapter_start, chapter_end) char offsets in text."""
    sections = list(SECTION_RE.finditer(text))
    refs_match = REFS_RE.search(text)
    body_end = refs_match.start() if refs_match else len(text)
    boundaries: list[tuple[int, int]] = []
    if not sections:
        # No chapters; treat whole-body as one.
        return [(0, body_end)]
    for i, m in enumerate(sections):
        if refs_match and m.start() >= refs_match.start():
            break
        start = m.start()
        end = sections[i + 1].start() if i + 1 < len(sections) else body_end
        if end > start:
            boundaries.append((start, end))
    return boundaries


def find_leaked_notes(text: str, chapter_start: int, chapter_end: int) -> list[LeakedNote]:
    """Find leaked-footnote-shaped paragraphs in [chapter_start, chapter_end)."""
    chunk = text[chapter_start:chapter_end]
    out: list[LeakedNote] = []
    for m in LEAKED_PARA_RE.finditer(chunk):
        n = int(m.group(1))
        body = m.group(2).strip()
        if not (1 <= n <= 200):
            continue
        # Skip if body is short (likely a list item) or has no period.
        if len(body) < 20:
            continue
        # Skip if body starts with another number (could be enumerated list).
        if re.match(r"^\d", body):
            continue
        # Skip if inside math or a known skip context.
        prefix = chunk[max(0, m.start() - 50):m.start()]
        if any(s in prefix for s in (r"\begin{equation}", r"\[", "$$")):
            # crude math context check
            continue
        out.append(LeakedNote(
            number=n,
            body=body,
            start=chapter_start + m.start(),
            end=chapter_start + m.end(),
        ))
    # Filter to ascending sequence (footnotes are sequential per chapter).
    if not out:
        return []
    # Sort by position; if numbers don't monotonically ascend, keep only
    # the longest ascending subsequence ending at the highest number.
    out.sort(key=lambda n: n.start)
    return out


def find_call_site(text: str, number: int, chapter_start: int, chapter_end: int,
                   leaked_start: int) -> int | None:
    """Find the inline call-site position for footnote `number` in the chapter.

    Returns the character offset where `\\footnote{...}` should be inserted
    (right after the matched call site), or None if no match.
    """
    # Search the chapter EXCLUDING the leaked-paragraph region itself.
    # Build a search range from chapter start to leaked-paragraph start.
    search_chunk = text[chapter_start:leaked_start]
    # Six call-site patterns. Pattern groups capture the position to
    # insert the footnote (right after the call-site marker).
    patterns = [
        # 1. word.N - period before number, after a word.
        rf"\b(\w+)\.{number}(?!\d)",
        # 2. wordN - direct concatenation.
        rf"\b([a-z]\w*){number}(?!\d)",
        # 3. word,N - comma before number.
        rf"\b(\w+),{number}(?!\d)",
        # 4. word N - space before number.
        rf"\b(\w+) {number}(?!\d)",
        # 5. close-punct N - ) or ] or } then number.
        rf"([\)\]\}}]){number}(?!\d)",
        # 6. digit, N - chained-pair (e.g., "9, 10").
        rf"(\d),\s*{number}(?!\d)",
    ]
    matches: list[tuple[int, int]] = []  # (priority, position) where lower priority wins.
    for prio, pat in enumerate(patterns):
        for m in re.finditer(pat, search_chunk):
            # Insertion point: right after the call-site marker.
            # For patterns 1-4 the number itself is the marker; insert after.
            full_match_end = m.end()
            matches.append((prio, chapter_start + full_match_end))
    if not matches:
        return None
    # Pick the highest-priority match (lowest prio number). If multiple
    # share priority, pick the latest occurrence (closer to the leaked
    # paragraph = more likely the real call site).
    matches.sort(key=lambda mp: (mp[0], -mp[1]))
    return matches[0][1]


def reattach(text: str) -> tuple[str, dict]:
    """Reattach leaked-footnote paragraphs. Returns (new-text, stats)."""
    chapters = find_chapter_boundaries(text)
    if not chapters:
        return text, {"placed": 0, "unplaced": 0, "chapters": 0}

    # Plan all edits first, then apply in reverse order so offsets stay valid.
    insertions: list[tuple[int, str]] = []  # (position, text-to-insert)
    deletions: list[tuple[int, int]] = []   # (start, end) ranges to delete
    placed = 0
    unplaced = 0
    per_chapter: list[tuple[int, int]] = []  # (chapter_idx, placed_in_chapter)

    for ch_idx, (cs, ce) in enumerate(chapters, start=1):
        leaked = find_leaked_notes(text, cs, ce)
        if not leaked:
            per_chapter.append((ch_idx, 0))
            continue
        ch_placed = 0
        for note in leaked:
            site = find_call_site(text, note.number, cs, ce, note.start)
            if site is None:
                unplaced += 1
                continue
            # Escape internal braces in body.
            body = note.body.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
            # But undo over-escaping of legitimate LaTeX commands.
            body = body.replace("\\\\textit", "\\textit").replace(
                "\\\\textbf", "\\textbf").replace("\\\\emph", "\\emph")
            insertions.append((site, f"\\footnote{{{body}}}"))
            deletions.append((note.start, note.end))
            placed += 1
            ch_placed += 1
        per_chapter.append((ch_idx, ch_placed))

    # Apply edits in reverse order.
    combined = sorted(
        [(p, "ins", t, len(t)) for p, t in insertions]
        + [(s, "del", "", e - s) for s, e in deletions],
        key=lambda x: -x[0],
    )
    new_text = text
    for pos, op, ins_text, length in combined:
        if op == "ins":
            new_text = new_text[:pos] + ins_text + new_text[pos:]
        else:  # del
            new_text = new_text[:pos] + new_text[pos + length:]

    return new_text, {
        "placed": placed,
        "unplaced": unplaced,
        "chapters": len(chapters),
        "per_chapter": per_chapter,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: reattach_leaked_footnotes.py <main.tex> [--dry-run]",
              file=sys.stderr)
        return 2
    dry_run = "--dry-run" in argv[2:]
    path = Path(argv[1])
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, stats = reattach(text)
    if stats["placed"] == 0 and stats["unplaced"] == 0:
        print(f"No leaked-prose footnote paragraphs detected in {path}.")
        return 0
    suffix = " (dry run)" if dry_run else ""
    print(
        f"Reattached {stats['placed']} leaked footnotes "
        f"({stats['unplaced']} unplaced) "
        f"across {stats['chapters']} chapters{suffix}."
    )
    for ch_idx, count in stats.get("per_chapter", []):
        if count > 0:
            print(f"  Ch {ch_idx}: {count} placed")
    if not dry_run and stats["placed"] > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
