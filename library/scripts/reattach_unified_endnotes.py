"""Reattach footnotes for a monograph with a single end-of-book Notes
section divided by `Notes to Chapter N` sub-headers.

Sibling of `reattach_unified_chapter_notes.py`. The difference:

- `reattach_unified_chapter_notes.py` handles the pattern
  `\\section{Notes}` + per-chapter `\\subsection{Chapter K}` dividers.
- This script handles the pattern
  `\\section{Notes}` + per-chapter `Notes to Chapter K` *sub-headers*
  (not separate subsection commands — bold or italicized free-form
  lines like `Notes to Chapter 3` inside one big paragraph stream).

Common in 1980s–1990s philosophy monographs (Chalmers, Dennett,
Searle, Hofstadter pattern). Recovery rate ~99% on chalmersramsey-class
documents per the deepindex streamlining memos.

Tier 0.5 of the recover-footnotes ladder; dispatched only when:

1. Genre is `book` AND
2. Exactly one `\\section{Notes}` (or `\\section*{Notes}`) exists, AND
3. That section contains at least 2 `Notes to Chapter \\d+` sub-headers
   (free-form, not LaTeX command form).

Usage:
    python3 reattach_unified_endnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


NOTES_SECTION_RE = re.compile(
    r"^\\section\*?\{Notes\b[^}]*\}\s*$", re.M | re.I,
)
SECTION_BOUNDARY_RE = re.compile(r"^\\section\*?\{", re.M)
CHAPTER_DIVIDER_RE = re.compile(
    r"^\s*(?:\\textbf\{|\\textit\{|)?\s*Notes\s+to\s+Chapter\s+(\d+)\b",
    re.M | re.I,
)
CHAPTER_SECTION_RE = re.compile(
    r"^\\section\*?\{(?:Chapter\s+)?(\d+)\b", re.M | re.I,
)
# Numbered note body: `1. <body>` or `12. <body>`, captured until the
# next note number or chapter-divider boundary.
NOTE_LINE_RE = re.compile(
    r"^\s*(\d{1,3})\.\s+([^\n]+(?:\n(?!\s*\d{1,3}\.\s|\s*Notes\s+to\s+Chapter\b)[^\n]*)*)",
    re.M | re.I,
)
PGMARK_LITERAL_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{\d+\}")
PROTECTED_CMDS = frozenset({
    "cite", "citet", "citep", "section", "subsection", "subsubsection",
    "title", "author", "textbf", "textit", "emph", "ref", "label",
    "pgmark", "footnote",
})

# Cap on per-note body size. Mirrors reattach_leaked_footnotes.py
# TIER4_BODY_CAP_CHARS — keeps a runaway parse from wrapping a body
# paragraph as a footnote (metz1974film failure mode).
NOTE_BODY_CAP_CHARS = 2000


def _find_notes_section(text: str) -> tuple[int, int] | None:
    m = NOTES_SECTION_RE.search(text)
    if not m:
        return None
    start = m.end()
    nxt = SECTION_BOUNDARY_RE.search(text, m.end())
    end = nxt.start() if nxt else len(text)
    return (start, end)


def _split_chapter_divider_regions(
    section_start: int, section_end: int, text: str,
) -> list[tuple[int, int, int]]:
    """Split the Notes section into (chapter_num, region_start,
    region_end) tuples — one per `Notes to Chapter N` sub-header.
    """
    section = text[section_start:section_end]
    matches = list(CHAPTER_DIVIDER_RE.finditer(section))
    if not matches:
        return []
    regions: list[tuple[int, int, int]] = []
    for i, m in enumerate(matches):
        chapter = int(m.group(1))
        local_start = m.end()
        local_end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
        regions.append((chapter, section_start + local_start, section_start + local_end))
    return regions


def _find_chapter_body_bounds(text: str, chapter_num: int) -> tuple[int, int] | None:
    """Return (start, end) of the body region for chapter `chapter_num`
    in the main document. Falls back to (0, len(text)) when chapter
    sectioning isn't found.
    """
    matches = list(CHAPTER_SECTION_RE.finditer(text))
    for i, m in enumerate(matches):
        try:
            num = int(m.group(1))
        except ValueError:
            continue
        if num != chapter_num:
            continue
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        return (start, end)
    return None


def _position_in_protected_arg(text: str, pos: int) -> bool:
    """True if `pos` is inside the brace argument of a protected command."""
    head = text[max(0, pos - 400):pos]
    # Walk back from pos looking for `\<cmd>{` with un-closed depth.
    depth = 0
    i = len(head) - 1
    while i >= 0:
        if head[i] == "}":
            depth += 1
        elif head[i] == "{":
            depth -= 1
            if depth < 0:
                # Found an unmatched `{` — scan back for the command name.
                j = i - 1
                while j >= 0 and head[j].isalpha():
                    j -= 1
                if j >= 0 and head[j] == "\\":
                    cmd = head[j + 1:i]
                    if cmd in PROTECTED_CMDS:
                        return True
                return False
        i -= 1
    return False


def _strip_body_pgmarks(body: str) -> tuple[str, list[str]]:
    pgmarks = PGMARK_LITERAL_RE.findall(body)
    if not pgmarks:
        return body, []
    cleaned = PGMARK_LITERAL_RE.sub("", body).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned, pgmarks


def _find_call_site(text: str, chapter_start: int, chapter_end: int, number: int) -> int | None:
    """Find an inline call-site for note `number` in the chapter body.

    Six patterns, mirrored from reattach_leaked_footnotes.py — same
    call-site shapes generalize across reattachers.
    """
    chunk = text[chapter_start:chapter_end]
    patterns = [
        rf"\b(\w+)\.{number}(?!\d)",
        rf"\b([a-z]\w*){number}(?!\d)",
        rf"\b(\w+),{number}(?!\d)",
        rf"\b(\w+) {number}(?!\d)",
        rf"([\)\]\}}]){number}(?!\d)",
        rf"(\d),\s*{number}(?!\d)",
    ]
    candidates: list[tuple[int, int]] = []
    for prio, pat in enumerate(patterns):
        for m in re.finditer(pat, chunk):
            candidates.append((prio, chapter_start + m.end()))
    if not candidates:
        return None
    candidates.sort(key=lambda mp: (mp[0], -mp[1]))
    return candidates[0][1]


def reattach(text: str) -> tuple[str, dict]:
    """Reattach unified-endnotes-style footnotes. Returns (new-text, stats)."""
    section_bounds = _find_notes_section(text)
    if section_bounds is None:
        return text, {"placed": 0, "unplaced": 0, "chapters": 0, "skipped": "no Notes section"}
    chapter_regions = _split_chapter_divider_regions(*section_bounds, text)
    if len(chapter_regions) < 2:
        return text, {"placed": 0, "unplaced": 0, "chapters": 0, "skipped": "fewer than 2 chapter dividers"}

    insertions: list[tuple[int, str]] = []
    deletions: list[tuple[int, int]] = []
    placed = 0
    unplaced = 0
    per_chapter: list[tuple[int, int]] = []

    for chapter_num, region_start, region_end in chapter_regions:
        body_bounds = _find_chapter_body_bounds(text, chapter_num)
        if body_bounds is None:
            unplaced += 1
            per_chapter.append((chapter_num, 0))
            continue
        body_start, body_end = body_bounds
        notes_text = text[region_start:region_end]
        ch_placed = 0
        for note_m in NOTE_LINE_RE.finditer(notes_text):
            number = int(note_m.group(1))
            body = note_m.group(2).strip()
            if len(body) > NOTE_BODY_CAP_CHARS:
                unplaced += 1
                continue
            site = _find_call_site(text, body_start, body_end, number)
            if site is None:
                unplaced += 1
                continue
            if _position_in_protected_arg(text, site):
                unplaced += 1
                continue
            cleaned, pulled = _strip_body_pgmarks(body)
            escaped = (
                cleaned
                .replace("\\", "\\\\")
                .replace("{", "\\{")
                .replace("}", "\\}")
                .replace("\\\\textit", "\\textit")
                .replace("\\\\textbf", "\\textbf")
                .replace("\\\\emph", "\\emph")
            )
            insertion = f"\\footnote{{{escaped}}}"
            if pulled:
                insertion += " " + " ".join(pulled)
            insertions.append((site, insertion))
            note_abs_start = region_start + note_m.start()
            note_abs_end = region_start + note_m.end()
            deletions.append((note_abs_start, note_abs_end))
            placed += 1
            ch_placed += 1
        per_chapter.append((chapter_num, ch_placed))

    combined = sorted(
        [(p, "ins", t, len(t)) for p, t in insertions]
        + [(s, "del", "", e - s) for s, e in deletions],
        key=lambda x: -x[0],
    )
    new_text = text
    for pos, op, ins_text, length in combined:
        if op == "ins":
            new_text = new_text[:pos] + ins_text + new_text[pos:]
        else:
            new_text = new_text[:pos] + new_text[pos + length:]

    return new_text, {
        "placed": placed,
        "unplaced": unplaced,
        "chapters": len(chapter_regions),
        "per_chapter": per_chapter,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("texfile")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = Path(args.texfile)
    if not path.exists():
        print(f"not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    new_text, stats = reattach(text)
    skipped = stats.get("skipped")
    if skipped:
        print(f"{path}: {skipped}")
        return 0
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"{path}: reattached {stats['placed']} note(s) across "
        f"{stats['chapters']} chapter(s), {stats['unplaced']} unplaced{suffix}."
    )
    if not args.dry_run and stats["placed"] > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
