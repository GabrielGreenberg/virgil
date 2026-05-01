"""Convert a block list (from extract.py) into a Virgil-compatible main.tex.

The output:
- starts with a small preamble (\\documentclass{article}, \\providecommand{\\pgmark}, etc.)
- emits \\title{…}, \\author{…}, \\date{…} based on metadata
- emits \\pgmark{N} at the top of every printed-page boundary, with
  optional [low] argument when the printed page label was extrapolated
  rather than directly detected
- when a paragraph crosses a page boundary, places the pgmark inline
  at the word boundary instead of between the fragments
- maps block kinds to LaTeX commands per the plan's translation table
"""

from __future__ import annotations

from typing import Iterable


# Terminal punctuation that signals end of a sentence/paragraph.
_TERMINAL_PUNCT = {".", "?", "!", ":", ";", '"', "'", ")", "]", "}", "”", "’"}


def _escape_latex(text: str) -> str:
    """Lightweight LaTeX escape — just enough to keep raw text from
    breaking the document. We deliberately do NOT escape `$`, `\\` or
    `{}` because the extractor sometimes emits these as part of math
    fragments embedded in plain text."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in "&%#_" and (i == 0 or text[i - 1] != "\\"):
            out.append("\\")
            out.append(ch)
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _heading_command(level: int) -> str:
    return {1: "section", 2: "subsection", 3: "subsubsection"}.get(level, "subsubsection")


def _pgmark_token(print_page: str, confidence: str) -> str:
    """Emit either `\\pgmark{N}` or `\\pgmark[low]{N}` based on confidence."""
    if confidence in ("low", "missing"):
        return f"\\pgmark[low]{{{print_page}}}"
    return f"\\pgmark{{{print_page}}}"


def _confidence_for(blk: dict, page_map: list[dict]) -> str:
    """Look up the confidence label for this block's print page."""
    pdf_page = blk.get("pdf_page")
    if pdf_page is None:
        return "high"
    for entry in page_map:
        if entry.get("pdf_page") == pdf_page:
            return entry.get("confidence", "high")
    return "high"


def _ends_mid_sentence(text: str) -> bool:
    """True if `text` looks like an unfinished sentence — no terminal
    punctuation, possibly ending in a hyphen continuation."""
    s = text.rstrip()
    if not s:
        return False
    last = s[-1]
    if last in _TERMINAL_PUNCT:
        return False
    return True


def _starts_continuation(text: str) -> bool:
    """True if `text` starts with a lowercase letter (or hyphen continuation)
    that suggests it's continuing a previous paragraph."""
    s = text.lstrip()
    if not s:
        return False
    first = s[0]
    return first.islower() or first == "-"


def _can_inline_merge(prev_blk: dict | None, next_blk: dict | None) -> bool:
    """Decide whether two text blocks (one ending page N-1, one starting
    page N) should be merged into a single paragraph with the pgmark
    inline at the boundary."""
    if not prev_blk or not next_blk:
        return False
    if prev_blk.get("kind") != "text" or next_blk.get("kind") != "text":
        return False
    prev_extra = prev_blk.get("extra") or {}
    next_extra = next_blk.get("extra") or {}
    if not prev_extra.get("last_on_pdf_page"):
        return False
    if not next_extra.get("first_on_pdf_page"):
        return False
    prev_y = prev_extra.get("y_pct")
    next_y = next_extra.get("y_pct")
    if prev_y is None or next_y is None:
        return False
    # Prev block must be near the bottom of its PDF page, next block near
    # the top of its PDF page.
    if prev_y < 0.55:
        return False
    if next_y > 0.30:
        return False
    if not _ends_mid_sentence(prev_blk.get("text", "")):
        return False
    if not _starts_continuation(next_blk.get("text", "")):
        return False
    return True


def emit(
    blocks: Iterable[dict],
    title: str = "",
    authors: str = "",
    year: str = "",
    page_map: list[dict] | None = None,
) -> str:
    """Produce the .tex source. blocks is a list of dicts as emitted by
    extract.py (Block.asdict). page_map is the pgmark.py output (used to
    look up per-page confidence labels)."""
    blocks = list(blocks)
    page_map = page_map or []

    lines: list[str] = []
    lines.append("\\documentclass{article}")
    lines.append("\\usepackage[utf8]{inputenc}")
    lines.append("\\usepackage{amsmath, amssymb}")
    lines.append("% \\pgmark{N} marks the start of printed page N. The optional")
    lines.append("% [low] argument flags page boundaries where the printed page")
    lines.append("% label was extrapolated rather than directly detected.")
    lines.append("% Virgil renders these as margin chips; under plain LaTeX they")
    lines.append("% are no-ops. \\providecommand declares the optional-arg form.")
    lines.append("\\providecommand{\\pgmark}[2][high]{}")
    lines.append("")
    if title:
        lines.append(f"\\title{{{_escape_latex(title)}}}")
    if authors:
        lines.append(f"\\author{{{_escape_latex(authors)}}}")
    if year:
        lines.append(f"\\date{{{_escape_latex(year)}}}")
    lines.append("")
    lines.append("\\begin{document}")
    lines.append("")
    if title:
        lines.append("\\maketitle")
        lines.append("")

    last_print = ""
    n = len(blocks)
    i = 0
    while i < n:
        blk = blocks[i]
        print_page = str(blk.get("print_page") or blk.get("pdf_page") or "")
        confidence = _confidence_for(blk, page_map)

        # Detect page boundary (this block starts a new printed page).
        page_boundary = print_page and print_page != last_print and last_print != ""
        first_emission = print_page and not last_print

        # Inline-merge case: page boundary, prev block was text ending
        # mid-sentence, this block is text starting lowercase.
        if page_boundary:
            prev_blk = blocks[i - 1] if i > 0 else None
            if _can_inline_merge(prev_blk, blk):
                # The previous block has already been emitted as a paragraph.
                # Pop the trailing blank line and the previous paragraph,
                # rebuild it with the pgmark spliced in at the boundary.
                # Find the previous text paragraph in `lines`.
                # Strategy: walk backwards skipping blank lines, the
                # previous non-blank line is the paragraph to splice.
                splice_idx = len(lines) - 1
                while splice_idx >= 0 and lines[splice_idx].strip() == "":
                    splice_idx -= 1
                if splice_idx >= 0:
                    prev_text = lines[splice_idx]
                    next_text = blk.get("text", "").strip()
                    pgmark = _pgmark_token(print_page, confidence)
                    merged = (
                        prev_text.rstrip() + " " + pgmark + " "
                        + _escape_latex(next_text)
                    )
                    lines[splice_idx] = merged
                    # Drop everything after splice_idx (the blank line(s))
                    # and re-append a single trailing blank line.
                    lines = lines[: splice_idx + 1]
                    lines.append("")
                    last_print = print_page
                    i += 1
                    continue

        # Standard case: emit pgmark on its own line before the block.
        if print_page and (page_boundary or first_emission):
            pgmark = _pgmark_token(print_page, confidence)
            # Suspicious-block annotation: this block reports starting
            # printed page N, but its bbox y_pct suggests it isn't near
            # the top of its PDF page.
            extra = blk.get("extra") or {}
            y_pct = extra.get("y_pct")
            if y_pct is not None and y_pct > 0.5 and confidence == "high":
                lines.append(f"% pgmark-suspicious: next block at y_pct={y_pct:.2f}")
                # Demote to low confidence in the emitted mark.
                pgmark = _pgmark_token(print_page, "low")
            lines.append(pgmark)
            last_print = print_page

        kind = blk.get("kind", "text")
        text = blk.get("text", "").strip()
        if not text:
            i += 1
            continue

        if kind == "heading":
            cmd = _heading_command(int(blk.get("level", 1)))
            lines.append(f"\\{cmd}{{{_escape_latex(text)}}}")
            lines.append("")
        elif kind == "display_math":
            lines.append("\\[")
            lines.append(text)
            lines.append("\\]")
            lines.append("")
        elif kind == "caption":
            lines.append("\\begin{quote}\\textit{" + _escape_latex(text) + "}\\end{quote}")
            lines.append("")
        elif kind == "footnote":
            lines.append("% orphan footnote (could not re-attach):")
            lines.append("% " + text.replace("\n", "\n% "))
            lines.append("")
        elif kind == "list_item":
            lines.append("\\item " + _escape_latex(text))
        elif kind == "reference":
            i += 1
            continue
        else:  # text
            lines.append(_escape_latex(text))
            lines.append("")

        i += 1

    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("usage: python tex_emit.py <extracted.json> [<meta.json>] [<pgmark.json>]")
        sys.exit(2)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    meta = {}
    if len(sys.argv) >= 3:
        with open(sys.argv[2]) as f:
            meta = json.load(f)
    page_map: list[dict] = []
    if len(sys.argv) >= 4:
        with open(sys.argv[3]) as f:
            pgmark_data = json.load(f)
        # Accept either a raw page list or the {layout, pages} envelope.
        if isinstance(pgmark_data, dict) and "pages" in pgmark_data:
            page_map = pgmark_data["pages"]
        elif isinstance(pgmark_data, list):
            page_map = pgmark_data
    blocks = data.get("blocks", [])
    out = emit(
        blocks,
        title=meta.get("title", ""),
        authors=meta.get("authors", ""),
        year=str(meta.get("year", "")),
        page_map=page_map,
    )
    print(out)
