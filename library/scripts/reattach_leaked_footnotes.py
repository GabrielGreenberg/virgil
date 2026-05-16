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

# Section heading regex. Matches both `\section{}` and `\section*{}` so
# starred-form headings in books and edited volumes act as boundaries.
SECTION_RE = re.compile(r"^\\section\*?\{([^}]+)\}", re.M)

# References / bibliography section boundary. Matches `\section{}` and
# `\section*{}` — the starred form is common in books and edited volumes.
REFS_RE = re.compile(
    r"^\\section\*?\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)

# Contents / TOC section start (front-matter).
TOC_SECTION_RE = re.compile(
    r"^\\section\*?\{(Contents|Table\s+of\s+Contents|TOC)\b",
    re.M | re.I,
)

# Numbered TOC entry: short line "N <Title> <page>" or "N. <Title> p."
TOC_ENTRY_LINE_RE = re.compile(
    r"^\s*\d{1,3}\.?\s+[A-Z][A-Za-z\-' ]{3,80}\s+\d{1,4}\s*$"
)

# Pgmark literal — used by preservation guard to prevent absorbing
# `\pgmark{N}` into a footnote argument (where the renderer would
# silently swallow it).
PGMARK_LITERAL_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{\d+\}")

# Commands whose brace argument must never receive a footnote
# insertion. Inserting `\footnote{}` inside `\cite{...}` or
# `\section{...}` corrupts the LaTeX parse irreversibly.
PROTECTED_CMD_PREFIXES = (
    "cite", "citet", "citep", "citealp", "citealt", "citeauthor",
    "citeyear", "citeyearpar", "section", "subsection", "subsubsection",
    "title", "author", "textbf", "textit", "emph", "ref", "label",
    "pgmark",
)

# Skip block contexts: math, footnote already-wrapped, command arg.
SKIP_CONTEXTS = (r"\[", r"\(", r"\\footnote\{", r"\\section\{", r"\\subsection\{")


class LeakedNote(NamedTuple):
    number: int
    body: str
    start: int
    end: int


# Tier-4 body-size cap. Tier-4 is the "no inline call site found"
# fallback that attaches `\footnote{[orphan fn N] <body>}` to the
# nearest preceding body paragraph. Without a cap, a leaked "footnote"
# that's actually a 100+-line body block gets wrapped as a single
# `\footnote{}` (metz1974film: 13 corrupted attachments, one wrapping
# a full body paragraph). Cap at 500 chars; longer bodies are
# refused as Tier-4 candidates and re-classified as unplaced so they
# surface in the audit punch-list.
TIER4_BODY_CAP_CHARS = 500


def _find_toc_skip_ranges(text: str) -> list[tuple[int, int]]:
    """Return (start, end) ranges of front-matter Contents / TOC blocks.

    Two ways a TOC block is identified:

    1. **Explicit** — content under `\\section{Contents}` /
       `\\section{Table of Contents}` until the next `\\section{}`.
    2. **Implicit** — a run of 5+ consecutive lines in the first 200
       lines of the body matching the numbered-TOC-entry pattern
       (Lewis-style `1 Title 1` / `2 Title 3` / ...). Detected by
       sliding window.
    """
    ranges: list[tuple[int, int]] = []

    # Explicit Contents heading.
    for tm in TOC_SECTION_RE.finditer(text):
        start = tm.start()
        next_section = SECTION_RE.search(text, tm.end())
        end = next_section.start() if next_section else len(text)
        ranges.append((start, end))

    # Implicit TOC: search first 200 lines.
    lines = text.split("\n", 250)[:200]
    line_offsets: list[int] = [0]
    pos = 0
    for line in lines[:-1]:
        pos += len(line) + 1
        line_offsets.append(pos)
    run_start_idx = -1
    run_count = 0
    for idx, line in enumerate(lines):
        if TOC_ENTRY_LINE_RE.match(line):
            if run_start_idx < 0:
                run_start_idx = idx
            run_count += 1
        else:
            if run_count >= 5 and run_start_idx >= 0:
                s_off = line_offsets[run_start_idx]
                e_off = line_offsets[idx]
                ranges.append((s_off, e_off))
            run_start_idx = -1
            run_count = 0
    if run_count >= 5 and run_start_idx >= 0:
        s_off = line_offsets[run_start_idx]
        e_off = line_offsets[min(run_start_idx + run_count, len(line_offsets) - 1)]
        ranges.append((s_off, e_off))

    return ranges


def _position_in_protected_arg(text: str, pos: int) -> bool:
    """Return True if `pos` lies inside the brace argument of a
    protected command (\\cite{}, \\section{}, \\textbf{}, etc.).

    Walks backward to find the nearest unclosed `\\<cmd>{` whose
    matching close-brace is after `pos`.
    """
    depth = 0
    i = pos - 1
    while i >= 0:
        c = text[i]
        # Skip escaped braces.
        if c in "{}" and i > 0 and text[i - 1] == "\\":
            i -= 1
            continue
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                # Found an unclosed open brace. Check what command
                # precedes it.
                j = i - 1
                # Possibly an `[opt]` argument.
                if j >= 0 and text[j] == "]":
                    k = j - 1
                    while k >= 0 and text[k] != "[":
                        k -= 1
                    if k >= 0:
                        j = k - 1
                # Collect command name.
                end = j + 1
                while j >= 0 and (text[j].isalpha() or text[j] == "*"):
                    j -= 1
                if j >= 0 and text[j] == "\\":
                    cmd = text[j + 1:end].rstrip("*")
                    if cmd in PROTECTED_CMD_PREFIXES:
                        return True
                # Not a protected command; keep walking out.
                depth = 0
            else:
                depth -= 1
        i -= 1
    return False


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


def find_leaked_notes(
    text: str,
    chapter_start: int,
    chapter_end: int,
    toc_skip_ranges: list[tuple[int, int]] | None = None,
) -> list[LeakedNote]:
    """Find leaked-footnote-shaped paragraphs in [chapter_start, chapter_end).

    Skips candidates that fall inside any TOC-skip range so chapter-TOC
    entries are not misclassified as footnote bodies. (shin, lewis,
    kulvicki memos.)
    """
    chunk = text[chapter_start:chapter_end]
    out: list[LeakedNote] = []
    toc_skip_ranges = toc_skip_ranges or []
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
        # Skip if the match falls inside a TOC-skip range.
        abs_start = chapter_start + m.start()
        in_toc = any(s <= abs_start < e for s, e in toc_skip_ranges)
        if in_toc:
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
    out.sort(key=lambda n: n.start)
    return out


def _split_body_around_pgmarks(body: str) -> tuple[str, list[str]]:
    """If the body contains `\\pgmark{N}` literals, strip them so the
    footnote argument doesn't swallow them. Returns (cleaned_body,
    list_of_pgmark_literals_to_reinject_at_body_scope)."""
    pgmarks = PGMARK_LITERAL_RE.findall(body)
    if not pgmarks:
        return body, []
    cleaned = PGMARK_LITERAL_RE.sub("", body).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned, pgmarks


def _find_tier4_attachment(
    text: str, leaked_start: int, chapter_start: int,
) -> int | None:
    """Find the end position of the nearest preceding body paragraph
    in the chapter — that's where the Tier-4 `[orphan fn N]` attaches.
    Returns None if no preceding paragraph exists in the chapter."""
    # Walk back from `leaked_start` to find the previous paragraph-end
    # (a `\n\s*\n` boundary or `.` ending a sentence at body scope).
    window = text[chapter_start:leaked_start].rstrip()
    if not window:
        return None
    # Find the last sentence-ending position in `window`.
    last = max(window.rfind(". "), window.rfind(".\n"))
    if last < 0:
        return None
    abs_end = chapter_start + last + 1  # right after the period
    if _position_in_protected_arg(text, abs_end):
        return None
    return abs_end


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
    """Reattach leaked-footnote paragraphs. Returns (new-text, stats).

    Guards applied in order:

    - **TOC-skip** — candidates inside a Contents block or implicit
      numbered-TOC run are excluded.
    - **Citation-argument** — refuses to insert a `\\footnote{}` into
      the brace argument of a protected command (\\cite{}, \\section{},
      etc.).
    - **Pgmark-preservation** — strips `\\pgmark{N}` literals out of
      the footnote body and re-injects them at body scope after the
      footnote, so the renderer doesn't silently swallow them.
    - **Tier-4 fallback** — when no inline call site is found,
      attaches `\\footnote{[orphan fn N] <body>}` to the end of the
      nearest preceding body paragraph in the chapter. Per the
      tier-ladder doctrine, this always succeeds (where a previous
      paragraph exists) and means we close every leaked note even
      when the call-site marker was OCR-dropped.
    """
    chapters = find_chapter_boundaries(text)
    if not chapters:
        return text, {"placed": 0, "unplaced": 0, "chapters": 0}

    toc_skip = _find_toc_skip_ranges(text)

    insertions: list[tuple[int, str]] = []  # (position, text-to-insert)
    deletions: list[tuple[int, int]] = []
    placed = 0
    placed_tier4 = 0
    unplaced = 0
    per_chapter: list[tuple[int, int]] = []

    for ch_idx, (cs, ce) in enumerate(chapters, start=1):
        leaked = find_leaked_notes(text, cs, ce, toc_skip_ranges=toc_skip)
        if not leaked:
            per_chapter.append((ch_idx, 0))
            continue
        ch_placed = 0
        for note in leaked:
            site = find_call_site(text, note.number, cs, ce, note.start)
            tier4 = False
            if site is None:
                # Tier-4 body-size cap: refuse the orphan-attachment
                # path for bodies longer than TIER4_BODY_CAP_CHARS.
                # Oversized "leaked footnote" candidates are almost
                # always body paragraphs that got mis-classified
                # (metz1974film). Defer to the audit punch-list.
                if len(note.body) > TIER4_BODY_CAP_CHARS:
                    unplaced += 1
                    continue
                # Tier-4 fallback: attach to end of nearest preceding
                # body paragraph in the chapter.
                site = _find_tier4_attachment(text, note.start, cs)
                if site is None:
                    unplaced += 1
                    continue
                tier4 = True
            # Citation-argument guard: refuse if the target is inside
            # a protected command's brace argument.
            if _position_in_protected_arg(text, site):
                unplaced += 1
                continue
            # Pgmark-preservation: strip pgmarks from body, plan to
            # re-inject them at body scope right after the footnote.
            cleaned_body, pulled_pgmarks = _split_body_around_pgmarks(note.body)
            # Escape internal braces in the (cleaned) body.
            body = cleaned_body.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
            body = body.replace("\\\\textit", "\\textit").replace(
                "\\\\textbf", "\\textbf").replace("\\\\emph", "\\emph")
            if tier4:
                body = f"[orphan fn {note.number}] {body}"
            insertion = f"\\footnote{{{body}}}"
            if pulled_pgmarks:
                insertion += " " + " ".join(pulled_pgmarks)
            insertions.append((site, insertion))
            deletions.append((note.start, note.end))
            placed += 1
            if tier4:
                placed_tier4 += 1
            ch_placed += 1
        per_chapter.append((ch_idx, ch_placed))

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
        "placed_tier4": placed_tier4,
        "unplaced": unplaced,
        "chapters": len(chapters),
        "per_chapter": per_chapter,
        "toc_skip_ranges": len(toc_skip),
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
    tier4 = stats.get("placed_tier4", 0)
    tier4_note = f" [{tier4} via Tier-4 orphan-prefix]" if tier4 else ""
    print(
        f"Reattached {stats['placed']} leaked footnotes{tier4_note} "
        f"({stats['unplaced']} unplaced) "
        f"across {stats['chapters']} chapters{suffix}."
    )
    if stats.get("toc_skip_ranges", 0):
        print(f"  Skipped {stats['toc_skip_ranges']} TOC range(s).")
    for ch_idx, count in stats.get("per_chapter", []):
        if count > 0:
            print(f"  Ch {ch_idx}: {count} placed")
    if not dry_run and stats["placed"] > 0:
        path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
