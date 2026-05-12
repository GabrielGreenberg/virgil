"""Extract per-chapter footnote bodies from a PDF via `pdftotext -layout`.

Auto-detects chapter boundaries by scanning `main.tex` for top-level
`\\section{...}` headings (excluding front-matter / references / indices),
then maps each section to its starting printed page via the nearest
following `\\pgmark{N}`. Walks each chapter's PDF pages and parses
footnote bodies from the footer zone.

A footnote body has the shape:
    N                          <- marker line (just the number)
        <indented body>...     <- body continuation (4+ space indent)

The marker must be alone on its line; the following non-empty line must
be heavily indented (≥4 spaces). Filters: keep only the trailing run of
consecutive ascending integers (footnote numbers ascend within a page).

Output: a JSON map `{chapter_idx: {fn_num: body, ...}}` keyed by 1-based
chapter index. Use with `reattach_footnotes.py` to place them at call
sites.

Usage:
    python3 extract_pdf_footnotes.py papers/<citekey>/<citekey>.pdf papers/<citekey>/main.tex <out.json>

Limitations:
- Column-format footnotes (multiple `N body N body N body` on one line)
  are not detected by the vertical-layout heuristic. Fall back to
  manual Tier-1 lookup or `reattach_footnotes.py`'s leaked-body parser.
- The PDF-page → printed-page offset is auto-detected from the nearest
  existing `\\pgmark{N}` anchor.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


# Section names that mark non-body chapters (front-matter, references,
# indices). Comparison is case-insensitive on the section heading text.
NON_BODY_SECTION_PATTERNS = [
    r"^contents$", r"^preface$", r"^introduction$",
    r"^series and front matter$",
    r"^references$", r"^bibliography$", r"^works cited$",
    r"^index of names$", r"^index of subjects$", r"^index$",
    r"^notes$", r"^acknowledgements$", r"^acknowledgments$",
]


def get_page_text(pdf_path: Path, pdf_page: int) -> str:
    res = subprocess.run(
        ["pdftotext", "-layout", "-f", str(pdf_page), "-l", str(pdf_page),
         str(pdf_path), "-"],
        capture_output=True, text=True, check=True,
    )
    return res.stdout


def detect_offset(pdf_path: Path, target_printed: int, search_range: int = 30) -> int | None:
    for pdf_page in range(max(1, target_printed), target_printed + search_range):
        try:
            text = get_page_text(pdf_path, pdf_page)
        except subprocess.CalledProcessError:
            return None
        for line in text.split("\n"):
            if line.strip() == str(target_printed):
                return pdf_page
    return None


def find_chapter_boundaries(tex: str) -> list[tuple[int, str, int]]:
    """Find body-chapter boundaries.

    Returns list of (chapter_idx, title, starting_printed_page).
    chapter_idx is 1-based.
    """
    lines = tex.split("\n")
    section_positions = []
    for i, line in enumerate(lines):
        m = re.match(r"^\\section\{(.+?)\}", line)
        if m:
            title = m.group(1).strip()
            # Skip non-body sections
            title_lower = title.lower()
            if any(re.search(p, title_lower) for p in NON_BODY_SECTION_PATTERNS):
                continue
            section_positions.append((i, title))

    # For each body section, find the FIRST \pgmark{N} after it.
    body_chapters = []
    for ch_idx, (line_idx, title) in enumerate(section_positions, start=1):
        printed_page = None
        for k in range(line_idx + 1, min(line_idx + 40, len(lines))):
            m = re.search(r"\\pgmark(?:\[[a-zA-Z]+\])?\{(\d+)\}", lines[k])
            if m:
                printed_page = int(m.group(1))
                break
        if printed_page is not None:
            body_chapters.append((ch_idx, title, printed_page))
    return body_chapters


def parse_footnotes_from_page_text(text: str) -> list[tuple[int, str]]:
    """Vertical-layout parser: marker alone on line + indented body below."""
    lines = text.split("\n")

    def _is_indented_body(line: str) -> bool:
        if not line.strip():
            return False
        return len(line) - len(line.lstrip()) >= 4

    markers = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not re.fullmatch(r"\d{1,3}", stripped):
            continue
        n = int(stripped)
        if not (1 <= n <= 200):
            continue
        next_line = None
        for j in range(i + 1, min(i + 4, len(lines))):
            if lines[j].strip():
                next_line = lines[j]
                break
        if next_line is None or not _is_indented_body(next_line):
            continue
        markers.append((i, n))

    if not markers:
        return []

    # Keep trailing run of consecutive ascending integers
    result_markers = []
    last_n = None
    for line_idx, n in reversed(markers):
        if last_n is None:
            result_markers.append((line_idx, n))
            last_n = n
        elif n == last_n - 1:
            result_markers.append((line_idx, n))
            last_n = n
        else:
            break
    result_markers.reverse()

    bodies = []
    for i, (line_idx, n) in enumerate(result_markers):
        next_idx = result_markers[i + 1][0] if i + 1 < len(result_markers) else len(lines)
        body_lines = lines[line_idx + 1:next_idx]
        body_parts = []
        for bl in body_lines:
            stripped = bl.strip()
            if not stripped:
                continue
            if not _is_indented_body(bl) and body_parts:
                break
            body_parts.append(stripped)
        body = " ".join(body_parts).strip()
        body = re.sub(r"([a-zA-Z])-\s+([a-z])", r"\1\2", body)
        if body:
            bodies.append((n, body))
    return bodies


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: extract_pdf_footnotes.py <pdf> <main.tex> <out.json>", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    tex_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3])

    tex = tex_path.read_text(encoding="utf-8")
    chapters = find_chapter_boundaries(tex)
    if not chapters:
        print("ERROR: no body chapters detected", file=sys.stderr)
        return 1

    # Auto-detect offset from the first chapter's printed page
    anchor_printed = chapters[0][2]
    pdf_page_of_anchor = detect_offset(pdf_path, anchor_printed)
    if pdf_page_of_anchor is None:
        print(f"ERROR: can't pin offset (no PDF footer for printed page {anchor_printed})", file=sys.stderr)
        return 1
    offset = pdf_page_of_anchor - anchor_printed

    by_chapter: dict[int, dict[int, str]] = {}
    for i, (ch_idx, title, start_printed) in enumerate(chapters):
        end_printed = chapters[i + 1][2] - 1 if i + 1 < len(chapters) else start_printed + 50
        by_chapter.setdefault(ch_idx, {})
        for printed in range(start_printed, end_printed + 1):
            pdf_page = printed + offset
            try:
                text = get_page_text(pdf_path, pdf_page)
            except subprocess.CalledProcessError:
                continue
            for n, body in parse_footnotes_from_page_text(text):
                existing = by_chapter[ch_idx].get(n)
                if existing and len(existing) > len(body):
                    continue
                by_chapter[ch_idx][n] = body

    out_path.write_text(
        json.dumps({str(k): v for k, v in by_chapter.items()}, indent=2),
        encoding="utf-8",
    )
    total = sum(len(v) for v in by_chapter.values())
    print(f"Extracted {total} footnote bodies across {len(by_chapter)} chapters.")
    for ch in sorted(by_chapter):
        nums = sorted(by_chapter[ch].keys())
        if nums:
            print(f"  Ch {ch}: fn {nums[0]}..{nums[-1]} ({len(nums)} fns)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
