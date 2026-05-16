"""Reattach a unified end-of-book Notes section with per-chapter
sub-dividers.

Humanities books (Dretske *Knowledge and the Flow of Information*,
many monographs) put all chapter endnotes in a single
`\\section{Notes}` block at the end of the document, with
`\\subsection{Chapter N}` (or plain-text `Chapter N` lines) marking
the chapter boundaries. Per-chapter footnote numbers restart at 1.

This script:

1. Parses the Notes section, splitting on `\\subsection{Chapter N}` or
   plain-text `^Chapter N$` lines to get per-chapter note lists.
2. For each chapter's notes, pre-strips any inline `\\pgmark{N}` from
   the note body so the body-scope re-injection doesn't pollute the
   footnote arg (which would swallow the marker).
3. Pre-converts OCR-mis-OCR'd `{` / `}` in note bodies to `(` / `)`
   so the resulting `\\footnote{…}` balances braces correctly.
4. For each note `N` in chapter `K`, scans the body of chapter `K`
   (between `\\section{Chapter K}` and the next chapter) for a
   call-site marker. Falls back to Tier-4 orphan-prefix attachment.
5. Removes the Notes section entirely once all notes are placed.

(dretske memo; dretske-addendum memo.)

Usage:
    python3 reattach_unified_chapter_notes.py <citekey> [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


NOTES_HEAD_RE = re.compile(
    r"^\\section\{(Notes|Endnotes)\b", re.M | re.I,
)
CHAPTER_DIVIDER_RE = re.compile(
    r"^(?:\\subsection\{Chapter\s+(\d+)[^}]*\}|Chapter\s+(\d+)\s*$)",
    re.M | re.I,
)
CHAPTER_SECTION_RE = re.compile(
    r"^\\section\*?\{(?:Chapter\s+)?(\d+)\b", re.M | re.I,
)
NOTE_LINE_RE = re.compile(
    r"^\s*(\d{1,3})[\.\s]+([^\n]+(?:\n(?!\s*\d{1,3}[\.\s])[^\n]*)*?)(?=\n\s*\d{1,3}[\.\s]|\n\s*\\subsection|\n\s*Chapter|\Z)",
    re.M,
)
PGMARK_LITERAL_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{\d+\}")
PROTECTED_CMDS = frozenset({
    "cite", "citet", "citep", "section", "subsection", "subsubsection",
    "title", "author", "textbf", "textit", "emph", "ref", "label",
    "pgmark", "footnote",
})


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _position_in_protected_arg(text: str, pos: int) -> bool:
    depth = 0
    i = pos - 1
    while i >= 0:
        c = text[i]
        if c in "{}" and i > 0 and text[i - 1] == "\\":
            i -= 2
            continue
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                j = i - 1
                if j >= 0 and text[j] == "]":
                    k = j - 1
                    while k >= 0 and text[k] != "[":
                        k -= 1
                    if k >= 0:
                        j = k - 1
                end = j + 1
                while j >= 0 and (text[j].isalpha() or text[j] == "*"):
                    j -= 1
                if j >= 0 and text[j] == "\\":
                    cmd = text[j + 1:end].rstrip("*")
                    if cmd in PROTECTED_CMDS:
                        return True
                depth = 0
            else:
                depth -= 1
        i -= 1
    return False


def _clean_note_body(body: str) -> tuple[str, list[str]]:
    """Return (cleaned_body, list_of_extracted_pgmarks).

    - Removes inline pgmarks (to re-inject at body scope after the
      footnote, not inside its argument).
    - Converts OCR-mis-OCR'd brace tokens to parens so footnote args
      balance braces.
    - Collapses whitespace.
    """
    pgmarks = PGMARK_LITERAL_RE.findall(body)
    body = PGMARK_LITERAL_RE.sub("", body)
    # OCR-mis-OCR'd brace tokens INSIDE the body: replace with parens
    # to keep brace balance. This is heuristic — only when an opening
    # `{` isn't preceded by a backslash command.
    body = re.sub(r"(?<!\\)\{", "(", body)
    body = re.sub(r"(?<!\\)\}", ")", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body, pgmarks


def _parse_notes_per_chapter(
    notes_section: str,
) -> dict[int, list[tuple[int, str, list[str]]]]:
    """Return {chapter_num: [(note_num, body, pgmarks), ...]}."""
    out: dict[int, list[tuple[int, str, list[str]]]] = {}
    # Split notes_section by chapter dividers.
    dividers = list(CHAPTER_DIVIDER_RE.finditer(notes_section))
    if not dividers:
        return out
    for i, div in enumerate(dividers):
        chap_num = int(div.group(1) or div.group(2))
        body_start = div.end()
        body_end = (
            dividers[i + 1].start() if i + 1 < len(dividers)
            else len(notes_section)
        )
        chapter_body = notes_section[body_start:body_end]
        notes_for_chap: list[tuple[int, str, list[str]]] = []
        for nm in NOTE_LINE_RE.finditer(chapter_body):
            try:
                num = int(nm.group(1))
            except ValueError:
                continue
            cleaned, pgmarks = _clean_note_body(nm.group(2).strip())
            if len(cleaned) < 5:
                continue
            notes_for_chap.append((num, cleaned, pgmarks))
        if notes_for_chap:
            out[chap_num] = notes_for_chap
    return out


def _chapter_body_range(
    text: str, chapter_num: int,
) -> tuple[int, int] | None:
    """Return (start, end) char range of the chapter's body."""
    starts: list[tuple[int, int]] = []
    for m in CHAPTER_SECTION_RE.finditer(text):
        try:
            n = int(m.group(1))
        except ValueError:
            continue
        starts.append((n, m.end()))
    if not starts:
        return None
    # Find the entry with chap_num.
    for i, (n, pos) in enumerate(starts):
        if n == chapter_num:
            end = starts[i + 1][1] if i + 1 < len(starts) else len(text)
            return pos, end
    return None


def _find_call_site(
    text: str, num: int, chap_start: int, chap_end: int,
) -> int | None:
    """Search for the inline call-site marker for footnote `num` in
    the chapter body."""
    # Patterns: `.N`, `,N`, `wordN`, `word N`, `)N`.
    patterns = [
        rf"([\w])\.{num}(?!\d)",
        rf"([\w]+){num}(?!\d)",
        rf"([\w]+),{num}(?!\d)",
        rf"([\w]+)\s+{num}(?!\d)",
        rf"([\)\]\}}]){num}(?!\d)",
    ]
    search = text[chap_start:chap_end]
    for pat in patterns:
        for m in re.finditer(pat, search):
            abs_pos = chap_start + m.end()
            if _position_in_protected_arg(text, abs_pos):
                continue
            return abs_pos
    return None


def reattach(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}", "placed": 0}
    text = tex_path.read_text(encoding="utf-8")

    notes_m = NOTES_HEAD_RE.search(text)
    if not notes_m:
        return {"error": "no Notes section found", "placed": 0}
    notes_start = notes_m.start()
    next_section = re.search(r"^\\section\{", text[notes_m.end():], re.M)
    notes_end = (
        notes_m.end() + next_section.start() if next_section else len(text)
    )
    notes_section = text[notes_start:notes_end]

    per_chap = _parse_notes_per_chapter(notes_section)
    if not per_chap:
        return {"error": "no chapter dividers in Notes section", "placed": 0}

    edits: list[tuple[int, str]] = []
    placed = 0
    tier4 = 0
    for chap_num, notes in per_chap.items():
        rng = _chapter_body_range(text, chap_num)
        if rng is None:
            # No matching body chapter; Tier-4 every note at notes_start.
            for num, body, pgmarks in notes:
                edits.append((
                    notes_start,
                    f"\\footnote{{[orphan fn ch{chap_num}-{num}] {body}}}"
                    + (" " + " ".join(pgmarks) if pgmarks else ""),
                ))
                tier4 += 1
                placed += 1
            continue
        cs, ce = rng
        for num, body, pgmarks in notes:
            site = _find_call_site(text, num, cs, ce)
            if site is None:
                # Tier-4: attach near the end of the chapter.
                fallback_pos = ce - 1
                edits.append((
                    fallback_pos,
                    f"\\footnote{{[orphan fn ch{chap_num}-{num}] {body}}}"
                    + (" " + " ".join(pgmarks) if pgmarks else ""),
                ))
                tier4 += 1
                placed += 1
                continue
            footnote = (
                f"\\footnote{{{body}}}"
                + (" " + " ".join(pgmarks) if pgmarks else "")
            )
            edits.append((site, footnote))
            placed += 1

    # Apply in reverse position order.
    edits.sort(key=lambda e: -e[0])
    new_text = text
    for pos, ins in edits:
        new_text = new_text[:pos] + ins + new_text[pos:]

    # Strip the Notes section now that all notes are placed (it would
    # otherwise duplicate the content).
    new_notes_start = new_text.find(notes_section[:50])
    if new_notes_start >= 0:
        section_text = new_text[new_notes_start:new_notes_start + len(notes_section)]
        # Don't strip if the section content has shifted significantly.
        if section_text.startswith(notes_section[:50]):
            new_text = (
                new_text[:new_notes_start]
                + new_text[new_notes_start + len(notes_section):]
            )

    if not dry_run and placed > 0:
        tex_path.write_text(new_text, encoding="utf-8")

    return {"placed": placed, "tier4": tier4, "chapters": len(per_chap)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reattach unified end-of-book Notes with chapter dividers.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = reattach(args.citekey, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Reattached {result['placed']} notes across "
        f"{result['chapters']} chapters "
        f"({result['tier4']} via Tier-4){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
