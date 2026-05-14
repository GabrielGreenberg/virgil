"""Reattach page-hint endnotes (popular-science / monograph style).

Many trade-press non-fiction books use an endnote format with no
inline call-site markers in the body. The back-of-book Notes section
lists notes keyed by `<PageNum>\\t<hint phrase>: <citation>.` —
e.g.:

    23   the dorsal-stream pathway: McKee et al., *Vision Research*, 1990.
    23   gain controls in V1: Carandini & Heeger, 2012.
    24   "binding by synchrony": Singer & Gray, 1995.

For each note: locate the page in body via the corresponding
`\\pgmark{PageNum}` anchor; walk forward in body within that page to
find the hint phrase; insert `\\footnote{<citation>}` at the matched
location. Falls back to Tier-4 orphan-prefix attachment for unplaced
notes (`[orphan fn pN-i] <citation>`).

Expected recovery rate: 80-95% on books that use the format
faithfully; remainder are paraphrased hints or hints that wrap
across pages.

(schwarzlose memo.)

Usage:
    python3 reattach_page_hint_endnotes.py <main.tex> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


NOTES_HEAD_RE = re.compile(
    r"^\\section\{(Notes|Endnotes)\b", re.M | re.I,
)
PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
# Endnote line: `<page>\t<hint>: <citation>.` or `<page>  <hint>: <citation>`.
ENDNOTE_LINE_RE = re.compile(
    r"^\s*(\d{1,4})[\s\t]+([^:\n]+?):\s+([^\n]+)$",
    re.M,
)
PROTECTED_CMDS = frozenset({
    "cite", "citet", "citep", "section", "title", "author", "textbf",
    "textit", "emph", "ref", "label", "pgmark", "footnote",
})


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


def _parse_notes(notes_section: str) -> list[tuple[int, str, str]]:
    """Return list of (page_num, hint, citation) tuples."""
    out: list[tuple[int, str, str]] = []
    for m in ENDNOTE_LINE_RE.finditer(notes_section):
        try:
            page = int(m.group(1))
        except ValueError:
            continue
        hint = m.group(2).strip().strip("\"'“”‘’")
        citation = m.group(3).strip().rstrip(".")
        if not hint or len(hint) < 3:
            continue
        out.append((page, hint, citation))
    return out


def _pgmark_index(text: str) -> dict[int, int]:
    """Map printed-page number → char position of the pgmark literal."""
    out: dict[int, int] = {}
    for m in PGMARK_RE.finditer(text):
        try:
            n = int(m.group(1))
        except ValueError:
            continue
        out.setdefault(n, m.end())
    return out


def _find_hint_in_page(
    text: str, page_start: int, page_end: int, hint: str,
) -> int | None:
    """Locate `hint` in body[page_start:page_end]. Tries:

    - exact case-insensitive substring
    - then fuzzy on the first 3-5 significant words

    Returns char position (after the matched span) for the
    `\\footnote{}` insertion, or None.
    """
    chunk = text[page_start:page_end]
    lower = chunk.lower()
    hl = hint.lower()
    idx = lower.find(hl)
    if idx >= 0:
        return page_start + idx + len(hint)
    # Fuzzy: first 3 significant content words.
    words = [w for w in re.findall(r"\b\w+\b", hint) if len(w) >= 3][:3]
    if not words:
        return None
    fuzzy = re.compile(
        r"\b" + r"\W+".join(re.escape(w) for w in words) + r"\b",
        re.I,
    )
    fm = fuzzy.search(chunk)
    if fm:
        return page_start + fm.end()
    return None


def reattach(text: str, dry_run: bool = False) -> dict:
    notes_m = NOTES_HEAD_RE.search(text)
    if not notes_m:
        return {"error": "no Notes/Endnotes section found", "placed": 0}
    notes_start = notes_m.start()
    next_section = re.search(r"^\\section\{", text[notes_m.end():], re.M)
    notes_end = (
        notes_m.end() + next_section.start() if next_section else len(text)
    )
    notes_section = text[notes_start:notes_end]
    notes = _parse_notes(notes_section)
    if not notes:
        return {"error": "no parsable page-hint notes", "placed": 0}

    body = text[:notes_start]
    body_end_in_text = notes_start
    pgmark_pos = _pgmark_index(body)
    placed = 0
    tier4 = 0
    unplaced = 0

    # Sort notes by descending page so insertions don't shift earlier
    # positions.
    by_page: dict[int, list[tuple[str, str, int]]] = {}
    for idx, (page, hint, citation) in enumerate(notes):
        by_page.setdefault(page, []).append((hint, citation, idx))

    edits: list[tuple[int, str]] = []  # (insert_pos, footnote_text)
    for page in sorted(by_page.keys(), reverse=True):
        if page not in pgmark_pos:
            for _, citation, idx in by_page[page]:
                unplaced += 1
            continue
        start = pgmark_pos[page]
        # End is the next pgmark or the body end.
        next_page_positions = [
            p for n, p in pgmark_pos.items() if n > page and p > start
        ]
        end = min(next_page_positions) if next_page_positions else body_end_in_text

        for hint, citation, idx in by_page[page]:
            hint_end = _find_hint_in_page(body, start, end, hint)
            if hint_end is None:
                # Tier-4: attach at the start of the page.
                edits.append(
                    (start, f"\\footnote{{[orphan fn p{page}] {citation}}}")
                )
                tier4 += 1
                placed += 1
                continue
            if _position_in_protected_arg(body, hint_end):
                # Fall back to Tier-4.
                edits.append(
                    (start, f"\\footnote{{[orphan fn p{page}] {citation}}}")
                )
                tier4 += 1
                placed += 1
                continue
            edits.append((hint_end, f"\\footnote{{{citation}}}"))
            placed += 1

    # Apply in reverse position order.
    edits.sort(key=lambda e: -e[0])
    new_text = text
    for pos, ins in edits:
        new_text = new_text[:pos] + ins + new_text[pos:]

    if not dry_run and placed > 0:
        # Caller may want to keep the Notes section visible; we leave it.
        pass

    return {
        "placed": placed,
        "tier4": tier4,
        "unplaced": unplaced,
        "new_text": new_text,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reattach page-hint endnotes to body via pgmark anchors.",
    )
    parser.add_argument("tex")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    result = reattach(text, dry_run=args.dry_run)
    if "error" in result:
        print(f"{result['error']}", file=sys.stderr)
        return 1
    if result["placed"] == 0:
        print(f"No page-hint notes reattached in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(result["new_text"], encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Reattached {result['placed']} page-hint notes "
        f"({result['tier4']} via Tier-4, {result['unplaced']} unplaced)"
        f"{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
