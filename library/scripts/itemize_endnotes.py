"""Itemize a unified Notes section for humanities books.

Many humanities books use a unified `\\section{Notes}` that serves both
as endnote bodies and as bibliography. The standard §3e itemizer
(author-leading entries) doesn't fit — these are numbered notes, not
bibliographic entries.

This script:

1. Locates `\\section{Notes}` (or `Endnotes`, `Chapter Notes`).
2. Identifies per-chapter subdivisions: subsection headings like
   `\\subsection{Chapter 1}` or `\\subsection{Notes to Chapter 1}`,
   OR (if no subsections present) detects chapter resets via note
   numbering jumping backward.
3. Inside each chapter, itemizes numbered paragraphs into
   `\\item <body>` entries within an `\\begin{itemize}` block.
4. Sequence-validates with skip-ahead tolerance up to +5; flags chains
   that reset (backward number jumps with no chapter subdivision).

Idempotent — if the Notes section is already itemized with
\\begin{itemize}, no changes.

Usage:
    python3 itemize_endnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


NOTES_SECTION_RE = re.compile(
    r"^\\section\{(Notes|Endnotes|Chapter Notes)\}", re.M | re.I,
)
NEXT_SECTION_RE = re.compile(r"^\\section\{", re.M)
SUBSECTION_RE = re.compile(r"^\\subsection\{([^}]+)\}", re.M)
NUMBERED_PARA_RE = re.compile(
    r"(?:\n\s*\n|\A)\s*(\d{1,3})[.\s]+([\s\S]+?)(?=\n\s*\n\s*\d{1,3}[.\s]|\n\s*\n\s*\\(?:section|subsection)\{|\n\s*\n\s*\Z|\Z)",
    re.M,
)


def already_itemized(notes_chunk: str) -> bool:
    """Check if the notes section is already shaped as itemize."""
    if r"\begin{itemize}" not in notes_chunk:
        return False
    # Count \item lines vs total numbered paragraphs.
    items = len(re.findall(r"\\item\b", notes_chunk))
    return items >= 3


def split_into_chapter_blocks(notes_chunk: str) -> list[tuple[str, str]]:
    """Return list of (chapter_label, chapter_body) tuples.

    If subsections are present, splits on them. Otherwise treats the
    whole notes section as one chapter (label "All").
    """
    subs = list(SUBSECTION_RE.finditer(notes_chunk))
    if not subs:
        # Detect chapter resets via backward number jumps.
        chapters = _split_by_number_reset(notes_chunk)
        return chapters
    out = []
    for i, m in enumerate(subs):
        start = m.end()
        end = subs[i + 1].start() if i + 1 < len(subs) else len(notes_chunk)
        out.append((m.group(1), notes_chunk[start:end]))
    return out


def _split_by_number_reset(notes_chunk: str) -> list[tuple[str, str]]:
    """Detect chapter boundaries via backward number jumps."""
    paras = list(NUMBERED_PARA_RE.finditer(notes_chunk))
    if not paras:
        return []
    boundaries = [0]
    prev_n = 0
    for p in paras:
        n = int(p.group(1))
        if n < prev_n and n <= 2:  # reset to 1 or 2
            boundaries.append(p.start())
        prev_n = n
    boundaries.append(len(notes_chunk))
    out = []
    for i in range(len(boundaries) - 1):
        out.append((f"Chapter {i + 1}", notes_chunk[boundaries[i]:boundaries[i + 1]]))
    return out


def itemize_chapter(chapter_body: str) -> tuple[str, int, int]:
    """Itemize a chapter's notes block. Returns (output, placed, unplaced)."""
    paras = list(NUMBERED_PARA_RE.finditer(chapter_body))
    if not paras:
        return chapter_body, 0, 0
    items: list[str] = ["\\begin{itemize}"]
    expected = 1
    placed = unplaced = 0
    for p in paras:
        n = int(p.group(1))
        body = re.sub(r"\s+", " ", p.group(2).strip())
        if n != expected:
            if expected < n <= expected + 5:
                # Tolerate small skip-ahead.
                pass
            else:
                unplaced += 1
                continue
        items.append(f"\\item \\textbf{{{n}.}} {body}")
        expected = n + 1
        placed += 1
    items.append("\\end{itemize}")
    return "\n".join(items), placed, unplaced


def itemize_notes(text: str) -> tuple[str, dict]:
    notes_match = NOTES_SECTION_RE.search(text)
    if not notes_match:
        return text, {"placed": 0, "chapters": 0, "reason": "no notes section"}
    notes_start = notes_match.end()
    # Find end of notes section (next \section or EOF).
    after = text[notes_start:]
    next_section = NEXT_SECTION_RE.search(after)
    notes_end = notes_start + (next_section.start() if next_section else len(after))
    notes_chunk = text[notes_start:notes_end]

    if already_itemized(notes_chunk):
        return text, {"placed": 0, "chapters": 0, "reason": "already itemized"}

    chapters = split_into_chapter_blocks(notes_chunk)
    if not chapters:
        return text, {"placed": 0, "chapters": 0, "reason": "no chapter structure"}

    out_parts: list[str] = []
    total_placed = total_unplaced = 0
    for label, body in chapters:
        itemized, p, u = itemize_chapter(body)
        out_parts.append(f"\\subsection{{{label}}}\n\n{itemized}\n")
        total_placed += p
        total_unplaced += u
    new_chunk = "\n" + "\n".join(out_parts) + "\n"
    new_text = text[:notes_start] + new_chunk + text[notes_end:]
    return new_text, {
        "placed": total_placed,
        "unplaced": total_unplaced,
        "chapters": len(chapters),
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: itemize_endnotes.py <main.tex> [--dry-run]", file=sys.stderr)
        return 2
    dry_run = "--dry-run" in argv[2:]
    path = Path(argv[1])
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, stats = itemize_notes(text)
    if stats.get("reason"):
        print(f"Skipped {path}: {stats['reason']}.")
        return 0
    suffix = " (dry run)" if dry_run else ""
    print(
        f"Itemized {stats['placed']} notes ({stats.get('unplaced', 0)} skipped) "
        f"across {stats['chapters']} chapters in {path}{suffix}."
    )
    if not dry_run and stats["placed"] > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
