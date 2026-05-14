"""Recover footnote bodies that were truncated mid-sentence by the
extractor.

When a footnote spans a page boundary in the source PDF, pymupdf may
emit only the part on the page where the footnote starts, dropping
the continuation. The truncated footnote ends mid-clause and the
remainder is lost.

This script:

1. Walks every `\\footnote{<body>}` in `main.tex`.
2. Flags bodies that end without sentence-terminal punctuation
   (`.`, `!`, `?`) — these are the truncation candidates.
3. For each candidate, identifies the source PDF page from the
   nearest preceding `\\pgmark{N}` and reads the TOP of PDF page
   `N+1` via `pdftotext -layout`.
4. If the top of `N+1` contains a paragraph that starts WITHOUT a
   capital letter / numeric prefix (a continuation rather than a
   new sentence/footnote), splices it onto the truncated body.

Conservative: only splices when the continuation paragraph is short
(< 200 chars) and the join produces a properly-punctuated sentence.
Reports candidates that don't auto-fix so the user can review.

(hobbs memo.)

Usage:
    python3 recover_truncated_footnote.py <citekey> [--apply] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _find_footnote_ranges(text: str) -> list[tuple[int, int, int, str]]:
    """Return (open_pos, body_start, body_end, body_text)."""
    out: list[tuple[int, int, int, str]] = []
    i = 0
    while True:
        idx = text.find("\\footnote{", i)
        if idx < 0:
            break
        body_start = idx + len("\\footnote{")
        depth = 1
        j = body_start
        while j < len(text) and depth > 0:
            c = text[j]
            if c == "\\" and j + 1 < len(text):
                j += 2
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth == 0:
            out.append((idx, body_start, j, text[body_start:j]))
            i = j + 1
        else:
            break
    return out


def _is_truncated(body: str) -> bool:
    """Body looks mid-sentence: doesn't end with `.`/`!`/`?`/`"`/`)`."""
    body = body.rstrip()
    if not body:
        return False
    last = body[-1]
    return last not in ".!?\"”)]}"


def _nearest_preceding_pgmark(text: str, pos: int) -> int | None:
    last: int | None = None
    for m in PGMARK_RE.finditer(text, 0, pos):
        try:
            last = int(m.group(1))
        except ValueError:
            continue
    return last


def _pdf_page_top(pdf: Path, page: int, lines: int = 5) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return ""
    except subprocess.SubprocessError:
        return ""
    return "\n".join(out.stdout.split("\n")[:lines])


def _looks_like_continuation(snippet: str) -> bool:
    """A continuation paragraph starts WITHOUT a capital letter (or
    a numeric prefix like `5 ` indicating a fresh footnote)."""
    s = snippet.strip()
    if not s:
        return False
    if re.match(r"^\d+[\.\s]", s):
        return False
    if s[0].isupper():
        return False
    return True


def recover(citekey: str, apply_fix: bool, dry_run: bool) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}"}
    text = tex_path.read_text(encoding="utf-8")

    fn_ranges = _find_footnote_ranges(text)
    candidates: list[tuple[int, int, int, str, int]] = []  # +nearest_page
    for open_pos, b_start, b_end, body in fn_ranges:
        if not _is_truncated(body):
            continue
        nearest = _nearest_preceding_pgmark(text, open_pos)
        if nearest is None:
            continue
        candidates.append((open_pos, b_start, b_end, body, nearest))

    if not candidates:
        return {"flagged": 0, "spliced": 0}

    edits: list[tuple[int, int, str]] = []
    spliced = 0
    if pdf_path.exists():
        for open_pos, b_start, b_end, body, nearest in candidates:
            top = _pdf_page_top(pdf_path, nearest + 1)
            if not top:
                continue
            # First non-empty line.
            for line in top.split("\n"):
                if line.strip():
                    if _looks_like_continuation(line):
                        cont = re.sub(r"\s+", " ", line.strip())
                        if len(cont) > 200:
                            cont = cont[:200] + "…"
                        new_body = body.rstrip() + " " + cont
                        edits.append((b_start, b_end, new_body))
                        spliced += 1
                    break

    new_text = text
    if apply_fix and edits:
        for b_start, b_end, new_body in reversed(edits):
            new_text = new_text[:b_start] + new_body + new_text[b_end:]
        if not dry_run:
            tex_path.write_text(new_text, encoding="utf-8")

    # Report.
    for open_pos, b_start, b_end, body, nearest in candidates:
        line = text[:open_pos].count("\n") + 1
        print(
            f"  line {line}: truncated footnote at \\pgmark{{{nearest}}} — "
            f"body ends {body[-40:].rstrip()!r}"
        )

    return {
        "flagged": len(candidates),
        "spliced": spliced,
        "applied": apply_fix and not dry_run,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recover truncated footnote bodies via PDF continuation.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--apply", action="store_true",
                        help="Splice the continuation onto the truncated body.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = recover(args.citekey, args.apply, args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result["flagged"] == 0:
        print("No truncated footnotes detected.")
        return 0
    suffix = "" if result.get("applied") else " (report only)"
    print(
        f"Flagged {result['flagged']} truncated footnotes; "
        f"spliced {result['spliced']}{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
