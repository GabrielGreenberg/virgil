"""Tier 3.7 — semantic relocation of orphan-tagged footnotes.

Strictly less precise than Tier 3 (visual PDF rasterization) but
strictly more precise than Tier 4 (orphan-prefix to nearest
preceding paragraph). Picks up the long tail of orphans where the
PDF call-site recovery failed but the footnote body contains a
distinctive term that appears once in its enclosing chapter.

Two-pass design:

1. **Compute pass** — for each `\\footnote{[orphan fn N] <body>}`:
   - Extract distinctive terms from the body (quality-scored:
     quoted titles > capitalized noun phrases > author surnames >
     significant words).
   - Search the enclosing chapter for the highest-quality term
     that appears exactly once in the chapter body (and not at
     body-scope-bad positions like inside a command argument).
   - Record (orphan_position, insert_position, new_body) tuples.
2. **Apply pass** — apply edits in reverse document order so
   offsets stay valid.

Expected recovery: 15-25% of orphans in academic-reference papers.
Doesn't compete with Tier 3 (PDF call-site recovery) — runs AFTER
that pass on whatever Tier 3 couldn't resolve.

(dretske-cleanup memo.)

Usage:
    python3 relocate_orphan_footnotes.py <citekey> [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


ORPHAN_FN_RE = re.compile(
    r"\\footnote\{\[orphan fn (\d{1,3})\]\s+([^}]+(?:\}[^}]*\}[^}]*)*)\}"
)
SECTION_RE = re.compile(r"^\\section\{([^}]+)\}", re.M)
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


def _chapter_boundaries(text: str) -> list[tuple[int, int]]:
    sections = list(SECTION_RE.finditer(text))
    if not sections:
        return [(0, len(text))]
    boundaries: list[tuple[int, int]] = []
    for i, m in enumerate(sections):
        start = m.start()
        end = sections[i + 1].start() if i + 1 < len(sections) else len(text)
        boundaries.append((start, end))
    return boundaries


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


def _extract_terms(body: str) -> list[tuple[int, str]]:
    """Return (quality_score, term) tuples, highest first.

    Quality tiers (descending):
      4 — quoted title (`"X"` or `“X”` or `\\textit{X}`)
      3 — multi-word capitalized noun phrase (3+ words)
      2 — multi-word capitalized noun phrase (2 words)
      1 — single capitalized noun (≥5 letters)
    """
    out: list[tuple[int, str]] = []
    # Quoted titles.
    for m in re.finditer(r'["“]([^"”]{5,80})["”]', body):
        out.append((4, m.group(1).strip()))
    for m in re.finditer(r"\\textit\{([^}]{5,80})\}", body):
        out.append((4, m.group(1).strip()))
    # Multi-word capitalized noun phrases.
    for m in re.finditer(
        r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,5})\b", body,
    ):
        out.append((3, m.group(1)))
    for m in re.finditer(
        r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b", body,
    ):
        out.append((2, m.group(1)))
    # Single capitalized nouns.
    for m in re.finditer(r"\b([A-Z][a-z]{4,})\b", body):
        out.append((1, m.group(1)))
    # Deduplicate (preserve quality of first occurrence).
    seen: set[str] = set()
    dedup: list[tuple[int, str]] = []
    for q, t in sorted(out, key=lambda x: -x[0]):
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        dedup.append((q, t))
    return dedup


def _find_unique_occurrence(
    text: str, term: str, chapter_start: int, chapter_end: int,
    exclude_range: tuple[int, int] | None = None,
) -> int | None:
    """Return the position of the unique occurrence of `term` in
    [chapter_start, chapter_end), or None if 0 or >1 matches.
    Excludes any match overlapping `exclude_range`."""
    chunk = text[chapter_start:chapter_end]
    pattern = re.compile(r"\b" + re.escape(term) + r"\b")
    matches: list[int] = []
    for m in pattern.finditer(chunk):
        abs_pos = chapter_start + m.start()
        if exclude_range and exclude_range[0] <= abs_pos <= exclude_range[1]:
            continue
        if _position_in_protected_arg(text, abs_pos):
            continue
        matches.append(abs_pos + len(term))
    if len(matches) != 1:
        return None
    return matches[0]


def relocate(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    tex_path = library / "papers" / citekey / "main.tex"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}", "placed": 0}
    text = tex_path.read_text(encoding="utf-8")
    chapters = _chapter_boundaries(text)

    # Pass 1: compute edits.
    edits: list[tuple[int, int, int, str]] = []  # (fn_start, fn_end, insert_pos, new_body)
    for m in ORPHAN_FN_RE.finditer(text):
        fn_start, fn_end = m.start(), m.end()
        try:
            num = int(m.group(1))
        except ValueError:
            continue
        body = m.group(2).strip()
        # Find enclosing chapter.
        chap = next(
            (c for c in chapters if c[0] <= fn_start < c[1]),
            None,
        )
        if chap is None:
            continue
        cs, ce = chap
        terms = _extract_terms(body)
        if not terms:
            continue
        insert_pos: int | None = None
        for _q, term in terms[:8]:
            pos = _find_unique_occurrence(text, term, cs, ce,
                                          exclude_range=(fn_start, fn_end))
            if pos is not None:
                insert_pos = pos
                break
        if insert_pos is None:
            continue
        # Strip the orphan prefix from the body.
        new_footnote = "\\footnote{" + re.sub(
            r"^\[orphan fn \d+\]\s+", "", body,
        ) + "}"
        edits.append((fn_start, fn_end, insert_pos, new_footnote))

    if not edits:
        return {"placed": 0, "total_orphans": len(ORPHAN_FN_RE.findall(text))}

    # Pass 2: apply in reverse document order. For each edit, we
    # need to delete the orphan position AND insert at `insert_pos`.
    # Sort by max(fn_end, insert_pos) descending so both endpoints
    # remain valid as later edits get applied.
    edits.sort(key=lambda e: -max(e[1], e[2]))
    new_text = text
    placed = 0
    for fn_start, fn_end, insert_pos, new_footnote in edits:
        if insert_pos > fn_end:
            new_text = (
                new_text[:fn_start]
                + new_text[fn_end:insert_pos]
                + new_footnote
                + new_text[insert_pos:]
            )
        elif insert_pos < fn_start:
            new_text = (
                new_text[:insert_pos]
                + new_footnote
                + new_text[insert_pos:fn_start]
                + new_text[fn_end:]
            )
        else:
            continue
        placed += 1

    if not dry_run and placed > 0:
        tex_path.write_text(new_text, encoding="utf-8")
    return {
        "placed": placed,
        "total_orphans": len(ORPHAN_FN_RE.findall(text)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Semantic relocation of orphan-tagged footnotes (Tier 3.7).",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = relocate(args.citekey, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Semantic-relocated {result['placed']}/{result['total_orphans']} "
        f"orphan footnotes{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
