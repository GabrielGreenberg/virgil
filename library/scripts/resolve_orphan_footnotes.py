"""PDF call-site recovery for orphan-tagged footnotes.

The leaked-prose reattacher leaves footnotes whose inline call site
couldn't be located as `\\footnote{[orphan fn N] <body>}` attached
to the end of a preceding body paragraph. This script attempts to
recover the *exact* call site by going back to the source PDF.

Algorithm (per burge2022perception memo's 6-pattern matcher):

1. For each `\\footnote{[orphan fn N] <body>}`, derive a search
   snippet from the body's first 3-4 non-`\\cite{}` words. Fallback:
   citekey-derived snippet (first surname + first significant title
   word, from `wandell2011imagining` → `Wandell Imagining`).

2. Locate the PDF page containing footnote N's body via `pdftotext
   -layout` on pages near the nearest preceding `\\pgmark{}`. Require
   the page to have `^\\s*<N>\\s+[A-Z\"']` (a real footnote-zone
   marker), not just the snippet (snippet-only matches produce too
   many false positives).

3. Find the inline call-site via six patterns: `<word>.<N>`,
   `<word><N>` (fused superscript), `<word>,<N>`, `<word> <N>`,
   `<closing-punct><N>`, `<digit>, <N>` (chained pair). All with
   `(?!\\d)` after `<N>`.

4. Filter running headers from the PDF body before extracting
   context (skip "OUP CORRECTED PROOF" / bare numbers / running
   headers with page-number).

5. Take ~80 chars of context before the marker; find the matching
   span in `main.tex` within ±12,000 chars of the orphan's current
   position. Move the footnote there.

6. Iterate in **reverse document order** so earlier orphans' offsets
   stay valid.

Expected resolution rate: 70-85% on papers with intact PDF text
layers. Remaining orphans had call-site sentences lost in
extraction and need /index-paper re-extraction to recover.

(burge2022perception memo.)

Usage:
    python3 resolve_orphan_footnotes.py <citekey> [--dry-run]

Where `<citekey>` is the Library citekey; the script reads
`papers/<citekey>/main.tex` and `papers/<citekey>/<citekey>.pdf`.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ORPHAN_FN_RE = re.compile(
    r"\\footnote\{\[orphan fn (\d{1,3})\]\s+([^}]+(?:\}[^}]*\}[^}]*)*)\}"
)
PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
CITE_INSIDE_RE = re.compile(r"\\cite[a-zA-Z]*(?:\[[^\]]*\])?\{[^}]+\}")


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _extract_pdf_page(pdf: Path, page: int) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page), "-l", str(page),
             str(pdf), "-"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if out.returncode != 0:
            return ""
        return out.stdout
    except subprocess.SubprocessError:
        return ""


def _filter_running_headers(pdf_text: str) -> str:
    """Drop lines that look like running headers / footers /
    page-number-only / "OUP CORRECTED PROOF" / etc."""
    out_lines: list[str] = []
    for line in pdf_text.split("\n"):
        s = line.strip()
        if not s:
            out_lines.append("")
            continue
        if re.match(r"^\d+\s*$", s):
            continue
        if re.match(r"^OUP CORRECTED PROOF\b", s):
            continue
        if re.match(r"^\d+\s+[A-Z][A-Za-z\s]+$", s):
            continue
        if re.match(r"^[A-Z][A-Za-z\s]+\s+\d+$", s):
            continue
        out_lines.append(line)
    return "\n".join(out_lines)


def _snippet_from_body(body: str) -> str:
    """First 3-4 non-`\\cite{}` words from the body."""
    cleaned = CITE_INSIDE_RE.sub("", body)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    words = [w for w in re.findall(r"\b\w+\b", cleaned) if len(w) >= 3][:4]
    return " ".join(words)


def _snippet_from_cite(body: str) -> str | None:
    """If body is mostly `\\cite{}`, derive snippet from the first
    citekey: `wandell2011imagining` → `Wandell Imagining`."""
    m = re.search(r"\\cite[a-zA-Z]*\{([^,}]+)", body)
    if not m:
        return None
    ck = m.group(1).strip()
    surname_m = re.match(r"^([a-z]+)\d{4}", ck)
    title_m = re.search(r"\d{4}([a-z]+)$", ck)
    if not surname_m:
        return None
    surname = surname_m.group(1).capitalize()
    if title_m:
        return f"{surname} {title_m.group(1).capitalize()}"
    return surname


def _find_pdf_page_for_footnote(
    pdf: Path,
    pdf_page_total: int,
    fn_num: int,
    snippet: str,
    nearest_pgmark_page: int | None,
) -> int | None:
    """Search PDF pages near `nearest_pgmark_page` (±15) for one that
    contains both:
      - a `^\\s*<N>\\s+[A-Z]` footnote-zone marker, AND
      - the snippet (case-insensitive substring or word-overlap).
    """
    if nearest_pgmark_page is None:
        candidates = range(1, pdf_page_total + 1)
    else:
        lo = max(1, nearest_pgmark_page - 15)
        hi = min(pdf_page_total, nearest_pgmark_page + 15)
        candidates = range(lo, hi + 1)
    snippet_l = snippet.lower()
    snippet_words = [w for w in snippet_l.split() if len(w) >= 3]

    for page in candidates:
        raw = _extract_pdf_page(pdf, page)
        if not raw:
            continue
        cleaned = _filter_running_headers(raw)
        if not re.search(rf"^\s*{fn_num}\s+[A-Z\"'“‘]", cleaned, re.M):
            continue
        cl = cleaned.lower()
        if snippet_l and snippet_l in cl:
            return page
        if snippet_words and all(w in cl for w in snippet_words):
            return page
    return None


def _find_call_site_in_page(
    pdf_page_text: str, fn_num: int,
) -> tuple[str, str] | None:
    """Find the call-site marker on the PDF page. Returns
    (context, marker_text) — context = ~80 chars before the marker."""
    text = _filter_running_headers(pdf_page_text)
    # Skip the footnote-zone marker itself.
    fn_zone = re.search(rf"^\s*{fn_num}\s+[A-Z\"'“‘]", text, re.M)
    search_end = fn_zone.start() if fn_zone else len(text)
    body_text = text[:search_end]

    patterns = [
        rf"(\w+)\.({fn_num})(?!\d)",
        rf"(\w+)({fn_num})(?!\d)",
        rf"(\w+),({fn_num})(?!\d)",
        rf"(\w+)\s+({fn_num})(?!\d)",
        rf"([\)\]\}}])({fn_num})(?!\d)",
        rf"(\d)+,\s*({fn_num})(?!\d)",
    ]
    candidates: list[tuple[int, str]] = []
    for pat in patterns:
        for m in re.finditer(pat, body_text):
            ctx_start = max(0, m.start() - 80)
            ctx = body_text[ctx_start:m.start()]
            ctx = re.sub(r"\s+", " ", ctx).strip()
            # Strip any chain-marker `\d+,\s*$` artifact.
            ctx = re.sub(r"\d+,\s*$", "", ctx).strip()
            if ctx:
                candidates.append((m.start(), ctx))
    if not candidates:
        return None
    # Rightmost candidate first (closest to footnote-zone = most
    # likely the real call site).
    candidates.sort(key=lambda c: -c[0])
    return candidates[0][1], str(fn_num)


def _find_context_in_tex(
    tex: str, context: str, orphan_pos: int,
) -> int | None:
    """Find the context string in `tex` within ±12,000 chars of
    `orphan_pos`. Try shrinking target length 80→60→40→30→20."""
    window_lo = max(0, orphan_pos - 12000)
    window_hi = min(len(tex), orphan_pos + 12000)
    window = tex[window_lo:window_hi]
    for length in (80, 60, 40, 30, 20):
        target = context[-length:].strip()
        if len(target) < 10:
            continue
        # Whitespace-tolerant exact match.
        pattern = re.escape(target).replace(r"\ ", r"\s+")
        m = re.search(pattern, window)
        if m:
            return window_lo + m.end()
    return None


def _nearest_preceding_pgmark(text: str, pos: int) -> int | None:
    """Return the page number of the nearest `\\pgmark{N}` before
    `pos`, or None."""
    last_page: int | None = None
    for m in PGMARK_RE.finditer(text, 0, pos):
        try:
            last_page = int(m.group(1))
        except ValueError:
            continue
    return last_page


def _pdf_page_count(pdf: Path) -> int | None:
    if not shutil.which("pdfinfo"):
        return None
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return None
        for line in out.stdout.split("\n"):
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError):
        pass
    return None


def resolve(citekey: str, dry_run: bool = False) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists():
        return {"error": f"main.tex not found at {tex_path}", "placed": 0}
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}", "placed": 0}

    tex = tex_path.read_text(encoding="utf-8")
    pdf_page_total = _pdf_page_count(pdf_path) or 0
    if pdf_page_total == 0:
        return {"error": "pdfinfo failed or PDF empty", "placed": 0}

    orphans: list[tuple[int, int, int, str]] = []  # (fn_start, fn_end, num, body)
    for m in ORPHAN_FN_RE.finditer(tex):
        try:
            num = int(m.group(1))
        except ValueError:
            continue
        body = m.group(2).strip()
        orphans.append((m.start(), m.end(), num, body))

    if not orphans:
        return {"placed": 0, "total_orphans": 0}

    # Process in reverse document order so earlier orphans' positions
    # stay valid as later ones get moved.
    new_text = tex
    placed = 0
    unplaced = 0
    for fn_start, fn_end, num, body in reversed(orphans):
        snippet = _snippet_from_body(body)
        if not snippet:
            snippet = _snippet_from_cite(body) or ""
        if not snippet:
            unplaced += 1
            continue
        nearest_page = _nearest_preceding_pgmark(new_text, fn_start)
        pdf_page = _find_pdf_page_for_footnote(
            pdf_path, pdf_page_total, num, snippet, nearest_page,
        )
        if pdf_page is None:
            unplaced += 1
            continue
        page_text = _extract_pdf_page(pdf_path, pdf_page)
        call_site = _find_call_site_in_page(page_text, num)
        if call_site is None:
            unplaced += 1
            continue
        context, _ = call_site
        new_pos = _find_context_in_tex(new_text, context, fn_start)
        if new_pos is None:
            unplaced += 1
            continue
        # Strip the orphan prefix from the footnote body.
        footnote_text = re.sub(
            r"\[orphan fn \d+\]\s+", "",
            new_text[fn_start:fn_end],
        )
        # Move: insert at new_pos, then remove the old orphan.
        # Apply in reverse: delete first (higher pos), then insert
        # (lower pos).
        if new_pos > fn_end:
            new_text = (
                new_text[:fn_start]
                + new_text[fn_end:new_pos]
                + footnote_text
                + new_text[new_pos:]
            )
        elif new_pos < fn_start:
            new_text = (
                new_text[:new_pos]
                + footnote_text
                + new_text[new_pos:fn_start]
                + new_text[fn_end:]
            )
        else:
            unplaced += 1
            continue
        placed += 1

    if not dry_run and placed > 0:
        tex_path.write_text(new_text, encoding="utf-8")

    return {
        "placed": placed,
        "unplaced": unplaced,
        "total_orphans": len(orphans),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Resolve [orphan fn N] markers to exact PDF call sites.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = resolve(args.citekey, dry_run=args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Resolved {result['placed']}/{result['total_orphans']} "
        f"orphan footnotes ({result['unplaced']} unplaced){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
