"""Reattach a document-end Notes section that has no per-chapter
sub-dividers.

Some books and chapter reprints (haugeland1991representational) put
all endnotes in a single block at the end of the document with no
per-chapter sub-headings — just a single sequence of numbered notes
1, 2, 3, ... that span the whole body.

This script:

1. Locates `\\section{Notes}` / `\\section{Endnotes}`.
2. Parses the notes as a single numbered sequence.
3. For each note `N`, scans the entire document body for an inline
   call-site marker (`.N`, `,N`, `wordN`, `word N`, `)N`).
4. Tier-4 fallback to the document-end position when no call site
   matches.

Differs from `reattach_unified_chapter_notes.py`:

- No chapter-divider parsing.
- Search range is the entire body (not per-chapter scope).
- Doesn't strip the Notes section automatically — the user may
  want to keep it as an itemized list and disable the standalone
  pass via a flag.

(haugeland memo; dretske memo.)

Usage:
    python3 reattach_document_end_notes.py <citekey>
        [--keep-notes-section] [--dry-run]
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
NOTE_LINE_RE = re.compile(
    r"^\s*(\d{1,3})[\.\s]+([^\n]+(?:\n(?!\s*\d{1,3}[\.\s])[^\n]*)*?)(?=\n\s*\d{1,3}[\.\s]|\Z)",
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
    pgmarks = PGMARK_LITERAL_RE.findall(body)
    body = PGMARK_LITERAL_RE.sub("", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body, pgmarks


def _find_call_site(text: str, num: int, body_end: int) -> int | None:
    """Search the document body (up to `body_end`) for inline marker."""
    patterns = [
        rf"(\w)\.{num}(?!\d)",
        rf"(\w+){num}(?!\d)",
        rf"(\w+),{num}(?!\d)",
        rf"(\w+)\s+{num}(?!\d)",
        rf"([\)\]\}}]){num}(?!\d)",
    ]
    search = text[:body_end]
    for pat in patterns:
        # Take the LAST match (likely closer to body, since extraction
        # noise tends to surface earlier on the page).
        last: int | None = None
        for m in re.finditer(pat, search):
            abs_pos = m.end()
            if _position_in_protected_arg(text, abs_pos):
                continue
            last = abs_pos
        if last is not None:
            return last
    return None


def reattach(
    citekey: str, keep_notes: bool = False, dry_run: bool = False,
) -> dict:
    library = _resolve_library_root()
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}", "placed": 0}
    text = tex_path.read_text(encoding="utf-8")

    notes_m = NOTES_HEAD_RE.search(text)
    if not notes_m:
        return {"error": "no Notes/Endnotes section found", "placed": 0}
    notes_start = notes_m.start()
    next_section = re.search(r"^\\section\{", text[notes_m.end():], re.M)
    notes_end = (
        notes_m.end() + next_section.start() if next_section else len(text)
    )
    notes_section = text[notes_start:notes_end]

    parsed: list[tuple[int, str, list[str]]] = []
    for nm in NOTE_LINE_RE.finditer(notes_section):
        try:
            num = int(nm.group(1))
        except ValueError:
            continue
        body, pgmarks = _clean_note_body(nm.group(2).strip())
        if len(body) < 5:
            continue
        parsed.append((num, body, pgmarks))

    if not parsed:
        return {"error": "no notes parsed", "placed": 0}

    edits: list[tuple[int, str]] = []
    placed = 0
    tier4 = 0
    for num, body, pgmarks in parsed:
        site = _find_call_site(text, num, notes_start)
        if site is None:
            # Tier-4: attach to nearest preceding body paragraph end.
            fallback_pos = max(0, notes_start - 1)
            edits.append((
                fallback_pos,
                f"\\footnote{{[orphan fn {num}] {body}}}"
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

    edits.sort(key=lambda e: -e[0])
    new_text = text
    for pos, ins in edits:
        new_text = new_text[:pos] + ins + new_text[pos:]

    if not keep_notes and placed > 0:
        new_notes_start = new_text.find(notes_section[:50])
        if new_notes_start >= 0:
            new_text = (
                new_text[:new_notes_start]
                + new_text[new_notes_start + len(notes_section):]
            )

    if not dry_run and placed > 0:
        tex_path.write_text(new_text, encoding="utf-8")

    return {"placed": placed, "tier4": tier4, "total": len(parsed)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reattach document-end Notes (no chapter dividers).",
    )
    parser.add_argument("citekey")
    parser.add_argument("--keep-notes-section", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = reattach(args.citekey, args.keep_notes_section, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Reattached {result['placed']}/{result['total']} document-end notes "
        f"({result['tier4']} via Tier-4){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
