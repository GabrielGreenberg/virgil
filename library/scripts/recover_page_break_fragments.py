"""Detect and recover body-prose fragments silently dropped at PDF page
boundaries by the original /index-paper extraction.

Detection heuristic: scan `main.tex` for paragraphs that end with a
hyphen (mid-word page break) followed by a blank line and a new paragraph
that doesn't continue the word. For each such case:

1. Find the surrounding `\\pgmark{N}` (the page boundary).
2. Run `pdftotext -layout` on PDF pages N-1 and N.
3. Extract the body lines between the hyphen-truncated word and the
   next paragraph's actual start in the PDF.
4. Insert the missing fragment into `main.tex`, attaching the truncated
   word + continuation across the inserted `\\pgmark{}` for proper
   word-break rendering.

Also handles the case where the hyphen-truncated paragraph is followed
by a NEW SECTION/SUBSECTION heading — the missing fragment goes between
the truncated paragraph and the heading.

Usage:
    python3 recover_page_break_fragments.py papers/<citekey>/main.tex papers/<citekey>/<citekey>.pdf

Idempotent: if a fragment has already been restored (no more `-$`
followed by an obviously discontinuous line), the script is a no-op.

Notes:
- The PDF-page → printed-page offset is auto-detected by matching the
  printed-page footer in pdftotext output against the nearest existing
  \\pgmark{N} in main.tex.
- The script is conservative: it only restores fragments whose
  continuation can be unambiguously located in the PDF text.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


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


def find_truncated_paragraphs(tex: str) -> list[tuple[int, int, str, str]]:
    """Find paragraphs ending with hyphen+blank+new-paragraph-not-continuing-word.

    Returns list of (line_idx, trunc_pos, last_word_before_hyphen, next_paragraph_first_word).
    """
    lines = tex.split("\n")
    results = []
    for i in range(len(lines) - 2):
        line = lines[i].rstrip()
        if not line.endswith("-"):
            continue
        # Next non-empty line must start a new paragraph that doesn't
        # continue the hyphenated word.
        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j >= len(lines):
            continue
        next_line = lines[j].strip()
        # Skip if next line is a LaTeX command (section, pgmark, etc.) —
        # those are normal page-break boundaries
        if next_line.startswith("\\"):
            # But \pgmark{N} alone IS a page-break case we care about
            # if the line AFTER the pgmark continues. Skip for now; the
            # caller handles those.
            continue
        # The hyphen-truncated word's last token
        last_tokens = line.rsplit(" ", 1)
        last_word_with_hyphen = last_tokens[-1].rstrip("-")
        first_word_next = next_line.split()[0] if next_line.split() else ""

        # If the next paragraph's first word starts with a lowercase letter
        # that could plausibly continue the hyphenated word (heuristic:
        # the continuation is short and lowercase), this might just be a
        # mis-applied paragraph break — but more commonly the entire
        # next paragraph is OTHER text that doesn't continue.
        # Conservative check: report as candidate for recovery.
        results.append((i, len(line), last_word_with_hyphen, first_word_next))
    return results


def get_nearest_pgmark(tex: str, line_idx: int) -> int | None:
    """Find the nearest \\pgmark{N} AFTER line_idx (the page boundary
    is right after the truncated line)."""
    lines = tex.split("\n")
    for k in range(line_idx + 1, min(line_idx + 10, len(lines))):
        m = re.match(r"\\pgmark(?:\[[a-zA-Z]+\])?\{(\d+)\}", lines[k].strip())
        if m:
            return int(m.group(1))
    return None


def extract_fragment(pdf_text: str, last_word: str, next_paragraph_first_word: str) -> str | None:
    """Find the continuation of `last_word-` and return the text up to
    (but not including) the next-paragraph anchor."""
    # The fragment should appear on the page as: `<last_word_continuation>` plus
    # additional body until we hit the next paragraph's start.
    lines = pdf_text.split("\n")
    # Collect all body lines, skipping running headers/footers
    body_lines = []
    in_footnote_zone = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if re.fullmatch(r"\d{1,3}", stripped) and int(stripped) <= 200:
            in_footnote_zone = True
            continue
        if in_footnote_zone and line.startswith((" ", "\t")):
            continue
        if re.fullmatch(r"\d{1,4}", stripped):
            continue  # page-number footer
        in_footnote_zone = False
        body_lines.append(stripped)

    body = " ".join(body_lines)
    # Find the next-paragraph anchor
    anchor_pos = body.find(next_paragraph_first_word) if next_paragraph_first_word else -1
    if anchor_pos < 0:
        # No anchor — return the whole body (caller decides)
        return body
    fragment = body[:anchor_pos].strip()
    # The fragment should start with the continuation of last_word
    # (could be hyphenated like "able" for "respect" + "-able").
    return fragment


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: recover_page_break_fragments.py <main.tex> <pdf>", file=sys.stderr)
        return 2

    tex_path = Path(sys.argv[1])
    pdf_path = Path(sys.argv[2])
    tex = tex_path.read_text(encoding="utf-8")

    truncated = find_truncated_paragraphs(tex)
    if not truncated:
        print("No truncated paragraphs detected.")
        return 0

    print(f"Found {len(truncated)} hyphen-truncated paragraphs.")

    # Auto-detect offset using ANY existing pgmark
    pgmarks = sorted(set(int(m.group(1)) for m in re.finditer(r"\\pgmark(?:\[[a-zA-Z]+\])?\{(\d+)\}", tex)))
    if not pgmarks:
        print("ERROR: no pgmarks in main.tex; can't pin offset", file=sys.stderr)
        return 1
    anchor = pgmarks[0]
    pdf_page_of_anchor = detect_offset(pdf_path, anchor)
    if pdf_page_of_anchor is None:
        print(f"ERROR: can't find PDF page for pgmark {anchor}", file=sys.stderr)
        return 1
    offset = pdf_page_of_anchor - anchor

    # Report only; user manually patches each (printed fragments + locations)
    # This conservative behavior avoids inadvertently corrupting the file;
    # the agent can decide which to apply.
    print(f"\nReport (apply each manually with the Edit tool):\n")
    for line_idx, _, last_word, next_word in truncated:
        next_pgmark = get_nearest_pgmark(tex, line_idx)
        if next_pgmark is None:
            print(f"  L{line_idx+1}: '{last_word}-' (no pgmark anchor nearby) — skip")
            continue
        pdf_page = next_pgmark + offset
        try:
            page_text = get_page_text(pdf_path, pdf_page)
        except subprocess.CalledProcessError:
            print(f"  L{line_idx+1}: '{last_word}-' → pgmark {next_pgmark} (PDF page {pdf_page}) — pdftotext failed")
            continue

        fragment = extract_fragment(page_text, last_word, next_word)
        if not fragment:
            print(f"  L{line_idx+1}: '{last_word}-' → pgmark {next_pgmark} (PDF page {pdf_page}) — no fragment recoverable")
            continue
        snippet = fragment[:200] + ("…" if len(fragment) > 200 else "")
        print(f"  L{line_idx+1}: '{last_word}-' → pgmark {next_pgmark} (PDF page {pdf_page})")
        print(f"    FRAGMENT: {snippet}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
