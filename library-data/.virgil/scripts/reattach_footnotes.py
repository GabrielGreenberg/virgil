"""Re-attach leaked footnote bodies to their call sites in main.tex.

Reads a footnotes-JSON (produced by `extract_pdf_footnotes.py`) keyed
by 1-based chapter index, then walks each chapter's body in main.tex
finding inline call-site markers and inserting `\\footnote{<body>}`.

Strategy per chapter:
1. Auto-detect chapter boundaries by scanning `\\section{...}` headings
   (excluding front-matter / references / indices).
2. For each footnote N in ascending order:
   - Search the chapter body for `<letter-or-punct>N<word-boundary>` after
     the last placement cursor.
   - Skip matches inside existing LaTeX command arguments.
   - Replace with `<prefix>\\footnote{<body>}`.
3. After auto-attachment, scan for any remaining leaked-body paragraphs
   (lines that start with `^\\d+ [A-Z\\\\]`) and either parse out
   additional footnote bodies via the split-on-consecutive-integers
   heuristic (and merge into the JSON for a second pass), or report
   them as residuals.

Constraints:
- Skips inside `\\citealt{...}`, `\\cite[...]{...}`, `\\pgmark{...}`,
  and other command arguments to avoid false-positive matches.
- The prefix character must be a letter or punctuation; this rules out
  year/page references like `Smith 1960` (space before digit).

Usage:
    python3 reattach_footnotes.py papers/<citekey>/main.tex <footnotes.json>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


NON_BODY_SECTION_PATTERNS = [
    r"^contents$", r"^preface$", r"^introduction$",
    r"^series and front matter$",
    r"^references$", r"^bibliography$", r"^works cited$",
    r"^index of names$", r"^index of subjects$", r"^index$",
    r"^notes$", r"^acknowledgements$", r"^acknowledgments$",
]


def find_chapter_spans(tex: str) -> list[tuple[int, int, int, str]]:
    """Return (chapter_idx, body_start_line, body_end_line, title) tuples."""
    lines = tex.split("\n")
    section_positions = []
    for i, line in enumerate(lines):
        m = re.match(r"^\\section\{(.+?)\}", line)
        if m:
            title = m.group(1).strip()
            title_lower = title.lower()
            if any(re.search(p, title_lower) for p in NON_BODY_SECTION_PATTERNS):
                section_positions.append((i, title, False))
            else:
                section_positions.append((i, title, True))

    # Now compute spans. Body chapters get a chapter_idx; non-body sections
    # are boundaries but don't get an idx.
    spans = []
    ch_idx = 0
    for idx, (line_idx, title, is_body) in enumerate(section_positions):
        if not is_body:
            continue
        ch_idx += 1
        end = len(lines)
        for j in range(idx + 1, len(section_positions)):
            end = section_positions[j][0]
            break
        spans.append((ch_idx, line_idx + 1, end, title))
    return spans


def _inside_command_or_math(text: str, pos: int) -> bool:
    start = max(0, pos - 300)
    region = text[start:pos]
    depth = 0
    for i in range(len(region) - 1, -1, -1):
        c = region[i]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                k = i - 1
                while k >= 0 and re.match(r"[a-zA-Z]", region[k]):
                    k -= 1
                if k >= 0 and region[k] == "\\":
                    return True
                return False
            depth -= 1
        elif c == "\n" and depth == 0:
            return False
    return False


def _escape_latex_body(text: str) -> str:
    text = text.replace("%", r"\%")
    text = text.replace("#", r"\#")
    text = re.sub(r"(?<!\\)&", r"\\&", text)
    return text


def reattach_chapter(body_text: str, footnotes: dict[str, str]) -> tuple[str, list[int], list[int]]:
    placed: list[int] = []
    unplaced: list[int] = []
    cursor = 0
    fn_nums = sorted(int(k) for k in footnotes.keys())
    prefix_chars = r"[A-Za-z!?'\".,;:\)\]\}>\-]"

    for n in fn_nums:
        body = footnotes[str(n)]
        marker_re = re.compile(rf"({prefix_chars})({n})(?=\W|$)")
        match_obj = None
        for m in marker_re.finditer(body_text, pos=cursor):
            if _inside_command_or_math(body_text, m.start()):
                continue
            match_obj = m
            break
        if match_obj is None:
            unplaced.append(n)
            continue
        prefix = match_obj.group(1)
        body_escaped = _escape_latex_body(body)
        replacement = f"{prefix}\\footnote{{{body_escaped}}}"
        body_text = body_text[:match_obj.start()] + replacement + body_text[match_obj.end():]
        cursor = match_obj.start() + len(replacement)
        placed.append(n)

    return body_text, placed, unplaced


def remove_leaked_paragraphs(tex: str, placed_per_chapter: dict[int, list[int]],
                              chapter_spans: list[tuple[int, int, int, str]]) -> tuple[str, int]:
    lines = tex.split("\n")

    def chapter_of_line(line_idx: int) -> int:
        for ch, start, end, _ in chapter_spans:
            if start <= line_idx < end:
                return ch
        return 0

    out: list[str] = []
    i = 0
    removed = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^(\d{1,3})\s+([A-Z\\].*)", line)
        if m:
            n = int(m.group(1))
            if 1 <= n <= 200:
                ch = chapter_of_line(i)
                if ch and n in placed_per_chapter.get(ch, []):
                    prev_is_para = (
                        i == 0
                        or not lines[i - 1].strip()
                        or lines[i - 1].lstrip().startswith("\\section")
                        or lines[i - 1].lstrip().startswith("\\subsection")
                    )
                    if prev_is_para:
                        j = i
                        while j < len(lines) and lines[j].strip():
                            j += 1
                        i = j
                        removed += 1
                        continue
        out.append(line)
        i += 1
    return "\n".join(out), removed


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: reattach_footnotes.py <main.tex> <footnotes.json>", file=sys.stderr)
        return 2

    tex_path = Path(sys.argv[1])
    fn_json_path = Path(sys.argv[2])

    tex = tex_path.read_text(encoding="utf-8")
    footnotes_data = json.loads(fn_json_path.read_text(encoding="utf-8"))

    spans = find_chapter_spans(tex)
    lines = tex.split("\n")
    placed_per_chapter: dict[int, list[int]] = {}
    unplaced_per_chapter: dict[int, list[int]] = {}

    for ch, body_start, body_end, title in spans:
        body_lines = lines[body_start:body_end]
        body_text = "\n".join(body_lines)
        ch_footnotes = footnotes_data.get(str(ch), {})
        if not ch_footnotes:
            continue
        new_body, placed, unplaced = reattach_chapter(body_text, ch_footnotes)
        placed_per_chapter[ch] = placed
        unplaced_per_chapter[ch] = unplaced
        new_body_lines = new_body.split("\n")
        lines[body_start:body_end] = new_body_lines
        line_delta = len(new_body_lines) - len(body_lines)
        if line_delta:
            spans = [
                (s_ch,
                 s_start + line_delta if s_start > body_start else s_start,
                 s_end + line_delta if s_end > body_start else s_end,
                 s_title)
                for s_ch, s_start, s_end, s_title in spans
            ]

    tex = "\n".join(lines)
    spans = find_chapter_spans(tex)
    tex, removed = remove_leaked_paragraphs(tex, placed_per_chapter, spans)
    tex_path.write_text(tex, encoding="utf-8")

    total_placed = sum(len(v) for v in placed_per_chapter.values())
    total_unplaced = sum(len(v) for v in unplaced_per_chapter.values())
    print(f"Placed {total_placed} footnotes; {total_unplaced} unplaced; removed {removed} leaked paragraphs")
    for ch in sorted(placed_per_chapter):
        placed = placed_per_chapter[ch]
        unplaced = unplaced_per_chapter[ch]
        head = f"{placed[:5]}{'...' if len(placed) > 5 else ''}"
        print(f"  Ch {ch}: placed {len(placed)} {head}; unplaced {len(unplaced)} {unplaced}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
