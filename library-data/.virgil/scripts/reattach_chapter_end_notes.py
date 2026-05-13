"""Reattach chapter-end-notes blocks as inline \\footnote{}.

For endnote-style sources (humanities books and monographs) the notes
block lives at the END of each chapter as a numbered list:

  1. Note one body
  2. Note two body
  3. ...

This script:

1. Walks each \\section{} chapter.
2. Finds the chapter's last contiguous numbered-paragraph block.
3. Parses each numbered entry into (number, body).
4. Matches each note to an inline call site within the same chapter
   via six patterns (`.N`, `wordN`, `,N`, ` N`, `<close-punct>N`,
   `<digit>, N`).
5. Wraps the matched call site with `\\footnote{<body>}` and removes
   the notes block.

Expects 70–95% recovery before Tier 1.

Usage:
    python3 reattach_chapter_end_notes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


SECTION_RE = re.compile(r"^\\section\{([^}]+)\}", re.M)
REFS_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)


def find_notes_block(text: str, chapter_start: int, chapter_end: int) -> tuple[int, int, list[tuple[int, str]]] | None:
    """Find a numbered-notes block in the chapter. Returns
    (block_start, block_end, notes-list) or None."""
    chunk = text[chapter_start:chapter_end]
    # A notes block starts with a paragraph beginning "1." or "1 " and
    # is followed by consecutive numbered paragraphs.
    # Find the LAST occurrence of "1." or "1 " at a paragraph start in
    # the chapter — that's the most likely notes-block opener.
    matches = list(re.finditer(r"(?:\n\s*\n|\A)\s*1[.\s]+[A-Z\"“‘]", chunk))
    if not matches:
        return None
    for m in reversed(matches):
        block_start_chunk = m.start()
        # Walk forward, parsing numbered paragraphs in sequence.
        notes: list[tuple[int, str]] = []
        pos = block_start_chunk
        expected = 1
        while pos < len(chunk):
            para_m = re.match(
                r"\s*(\d{1,3})[.\s]+([\s\S]+?)(?=\n\s*\n\s*\d{1,3}[.\s]|\n\s*\n\s*$|\Z)",
                chunk[pos:],
            )
            if not para_m:
                break
            n = int(para_m.group(1))
            if n != expected:
                # Allow skip-ahead tolerance up to +5 (gaps from OCR).
                if expected < n <= expected + 5:
                    expected = n
                else:
                    break
            body = re.sub(r"\s+", " ", para_m.group(2).strip())
            notes.append((n, body))
            expected = n + 1
            pos += para_m.end()
        if len(notes) >= 3:
            return (
                chapter_start + block_start_chunk,
                chapter_start + pos,
                notes,
            )
    return None


def find_call_site_in_chapter(text: str, chapter_start: int,
                              chapter_end: int, number: int,
                              block_start: int) -> int | None:
    """Find call site for note `number` BEFORE the notes block."""
    search_chunk = text[chapter_start:block_start]
    patterns = [
        rf"\b(\w{{2,}})\.{number}(?!\d)",
        rf"\b([a-z]\w*){number}(?!\d)",
        rf"\b(\w{{2,}}),{number}(?!\d)",
        rf"\b(\w{{2,}}) {number}(?!\d)",
        rf"([\)\]\}}]){number}(?!\d)",
        rf"(\d),\s*{number}(?!\d)",
    ]
    for pat in patterns:
        ms = list(re.finditer(pat, search_chunk))
        if ms:
            return chapter_start + ms[-1].end()
    return None


def reattach(text: str) -> tuple[str, dict]:
    # Identify body chapters.
    sections = list(SECTION_RE.finditer(text))
    refs = REFS_RE.search(text)
    body_end = refs.start() if refs else len(text)

    chapters = []
    for i, m in enumerate(sections):
        if refs and m.start() >= refs.start():
            break
        start = m.start()
        end = sections[i + 1].start() if i + 1 < len(sections) else body_end
        chapters.append((start, end))

    if not chapters:
        return text, {"placed": 0, "unplaced": 0, "chapters": 0}

    insertions: list[tuple[int, str]] = []
    deletions: list[tuple[int, int]] = []
    placed = unplaced = 0
    chapters_processed = 0

    for cs, ce in chapters:
        found = find_notes_block(text, cs, ce)
        if not found:
            continue
        chapters_processed += 1
        block_start, block_end, notes = found
        for n, body in notes:
            site = find_call_site_in_chapter(text, cs, ce, n, block_start)
            if site is None:
                unplaced += 1
                continue
            safe = body.replace("{", "\\{").replace("}", "\\}")
            insertions.append((site, f"\\footnote{{{safe}}}"))
            placed += 1
        deletions.append((block_start, block_end))

    combined = sorted(
        [(p, "ins", t, len(t)) for p, t in insertions]
        + [(s, "del", "", e - s) for s, e in deletions],
        key=lambda x: -x[0],
    )
    new_text = text
    for pos, op, ins, length in combined:
        if op == "ins":
            new_text = new_text[:pos] + ins + new_text[pos:]
        else:
            new_text = new_text[:pos] + new_text[pos + length:]

    return new_text, {
        "placed": placed,
        "unplaced": unplaced,
        "chapters": chapters_processed,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: reattach_chapter_end_notes.py <main.tex> [--dry-run]",
              file=sys.stderr)
        return 2
    dry_run = "--dry-run" in argv[2:]
    path = Path(argv[1])
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, stats = reattach(text)
    if stats["placed"] == 0 and stats["chapters"] == 0:
        print(f"No chapter-end-notes blocks detected in {path}.")
        return 0
    suffix = " (dry run)" if dry_run else ""
    print(
        f"Reattached {stats['placed']} chapter-end-notes "
        f"({stats['unplaced']} unplaced) "
        f"across {stats['chapters']} chapters{suffix}."
    )
    if not dry_run and stats["placed"] > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
