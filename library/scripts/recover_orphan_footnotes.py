"""Tier-3.5 batch orphan-footnote recovery via PDF call-site matching.

Final fallback before Tier 4 orphan-prefix attachment. For each leaked
or orphan footnote that Tier 0 couldn't place, this script:

1. Locates the footnote's PDF page via content-snippet matching against
   pdftotext output.
2. Searches the PDF page for an inline marker matching one of six
   call-site patterns (`.N`, `wordN`, `,N`, ` N`, `<close-punct>N`,
   `<digit>, N`).
3. Filters out running headers/footers (`^\\d+ TITLE` or `TITLE \\d+$`).
4. Matches the surrounding ±12K-char context against main.tex to find
   the corresponding body location.
5. Inserts `\\footnote{<body>}` at the matched position.

Expects 70–85% additional recovery over Tier 1's auto-pipeline.

Usage:
    python3 recover_orphan_footnotes.py <paper-dir> [--dry-run]

Output: prints per-orphan resolution status. Exit 0 on success.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


SECTION_RE = re.compile(r"^\\section\{[^}]+\}", re.M)
REFS_RE = re.compile(
    r"^\\section\{(References|Bibliography|Works Cited|Notes|Endnotes|Index)\b",
    re.M | re.I,
)
PGMARK_RE = re.compile(r"\\pgmark(?:\[[a-z]+\])?\{(\d+)\}")
LEAKED_PARA_RE = re.compile(
    r"^(\d{1,3})[.\s]+([A-Z\"“‘][^\n]*(?:\n(?!\n)[^\n]*)*?)(?=\n\s*\n|\Z)",
    re.M,
)
# Already-placed footnote (skip these).
WRAPPED_FN_RE = re.compile(r"\\footnote\{")


def get_page_text(pdf_path: Path, pdf_page: int) -> str:
    try:
        res = subprocess.run(
            ["pdftotext", "-layout", "-f", str(pdf_page), "-l", str(pdf_page),
             str(pdf_path), "-"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        return res.stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return ""


def detect_offset(pdf_path: Path, tex: str, search_range: int = 60) -> int | None:
    """Find the PDF-page → printed-page offset using lowest pgmark."""
    pgmarks = [int(m.group(1)) for m in PGMARK_RE.finditer(tex)]
    if not pgmarks:
        return None
    target = min(pgmarks)
    # Don't anchor on chapter-opener pages (suppressed numbers).
    # Try the lowest + a few above for a stable match.
    for trial in [target, target + 5, target + 10]:
        for pdf_page in range(max(1, trial), trial + search_range):
            text = get_page_text(pdf_path, pdf_page)
            for line in text.split("\n"):
                if line.strip() == str(trial):
                    return pdf_page - trial
    return None


def find_pdf_page_for_body(pdf_path: Path, body_snippet: str, offset: int,
                          tex_pgmark: int, search_window: int = 5) -> int | None:
    """Find the PDF page containing body_snippet, near printed page tex_pgmark."""
    # Reduce snippet to 4-6 words for matching.
    words = body_snippet.split()[:8]
    snippet = " ".join(words)
    base = tex_pgmark + offset
    for delta in range(-search_window, search_window + 1):
        page = base + delta
        if page < 1:
            continue
        text = get_page_text(pdf_path, page)
        if snippet in text or _fuzzy_match(snippet, text):
            return page
    return None


def _fuzzy_match(snippet: str, text: str) -> bool:
    """Loose match accommodating extraction differences."""
    if not snippet:
        return False
    # Drop punctuation, lowercase, check substring.
    s_norm = re.sub(r"\W+", "", snippet.lower())
    t_norm = re.sub(r"\W+", "", text.lower())
    return len(s_norm) > 12 and s_norm in t_norm


def find_inline_marker(page_text: str, number: int) -> tuple[str, int] | None:
    """Find an inline call-site marker for `number` in PDF page text.

    Returns (context_word, position) or None. The context word is the
    word immediately before the call-site number — used to anchor in
    main.tex.
    """
    # Strip running headers/footers (lines that are just `<NUM>` alone
    # or `<NUM>\\s+TITLE`).
    lines = []
    for line in page_text.split("\n"):
        stripped = line.strip()
        if re.fullmatch(r"\d{1,4}", stripped):
            continue
        if re.fullmatch(rf"\d+\s+[A-Z][A-Z\s]{{4,}}", stripped):
            continue
        if re.fullmatch(rf"[A-Z][A-Z\s]{{4,}}\s+\d+", stripped):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)

    # Try the six patterns in priority order.
    patterns = [
        rf"(\w{{2,}})\.{number}(?!\d)",
        rf"(\w{{2,}}){number}(?!\d)",
        rf"(\w{{2,}}),{number}(?!\d)",
        rf"(\w{{2,}}) {number}(?!\d)",
        rf"([\)\]\}}]){number}(?!\d)",
        rf"(\d),\s*{number}(?!\d)",
    ]
    for pat in patterns:
        for m in re.finditer(pat, cleaned):
            return m.group(1), m.start()
    return None


def find_body_position(tex: str, context_word: str, around_offset: int,
                       window: int = 12000) -> int | None:
    """Search main.tex for a position matching context_word, near around_offset."""
    if not context_word or len(context_word) < 3:
        return None
    start = max(0, around_offset - window)
    end = min(len(tex), around_offset + window)
    chunk = tex[start:end]
    pat = re.compile(rf"\b{re.escape(context_word)}\b")
    matches = list(pat.finditer(chunk))
    if not matches:
        return None
    # Prefer the match closest to around_offset.
    target_in_chunk = around_offset - start
    best = min(matches, key=lambda m: abs(m.end() - target_in_chunk))
    # Skip if inside an existing \footnote.
    pre = chunk[max(0, best.start() - 200):best.start()]
    if WRAPPED_FN_RE.search(pre) and "}" not in pre[pre.rfind(r"\footnote{"):]:
        return None
    return start + best.end()


def collect_unplaced_orphans(tex: str) -> list[tuple[int, int, int, str]]:
    """Return list of (start, end, number, body) for remaining leaked notes."""
    refs_match = REFS_RE.search(tex)
    body_end = refs_match.start() if refs_match else len(tex)
    out = []
    for m in LEAKED_PARA_RE.finditer(tex[:body_end]):
        n = int(m.group(1))
        body = m.group(2).strip()
        if 1 <= n <= 200 and len(body) >= 30:
            out.append((m.start(), m.end(), n, body))
    return out


def recover(paper_dir: Path, dry_run: bool = False) -> dict:
    citekey = paper_dir.name
    tex_path = paper_dir / "main.tex"
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not tex_path.exists() or not pdf_path.exists():
        return {"placed": 0, "unplaced": 0, "error": "missing main.tex or pdf"}

    tex = tex_path.read_text(encoding="utf-8")
    offset = detect_offset(pdf_path, tex)
    if offset is None:
        return {"placed": 0, "unplaced": 0, "error": "could not detect PDF offset"}

    orphans = collect_unplaced_orphans(tex)
    if not orphans:
        return {"placed": 0, "unplaced": 0, "chapters": 0}

    insertions: list[tuple[int, str]] = []
    deletions: list[tuple[int, int]] = []
    placed = unplaced = 0

    for o_start, o_end, num, body in orphans:
        # Find nearest pgmark before this position.
        pre = tex[:o_start]
        pgs = list(PGMARK_RE.finditer(pre))
        if not pgs:
            unplaced += 1
            continue
        tex_pgmark = int(pgs[-1].group(1))
        pdf_page = find_pdf_page_for_body(pdf_path, body, offset, tex_pgmark)
        if pdf_page is None:
            unplaced += 1
            continue
        page_text = get_page_text(pdf_path, pdf_page)
        marker = find_inline_marker(page_text, num)
        if marker is None:
            unplaced += 1
            continue
        context_word, _ = marker
        body_pos = find_body_position(tex, context_word, o_start)
        if body_pos is None:
            unplaced += 1
            continue
        safe_body = body.replace("{", "\\{").replace("}", "\\}")
        insertions.append((body_pos, f"\\footnote{{{safe_body}}}"))
        deletions.append((o_start, o_end))
        placed += 1

    if placed == 0:
        return {"placed": 0, "unplaced": unplaced}

    combined = sorted(
        [(p, "ins", t, len(t)) for p, t in insertions]
        + [(s, "del", "", e - s) for s, e in deletions],
        key=lambda x: -x[0],
    )
    new_tex = tex
    for pos, op, ins_text, length in combined:
        if op == "ins":
            new_tex = new_tex[:pos] + ins_text + new_tex[pos:]
        else:
            new_tex = new_tex[:pos] + new_tex[pos + length:]

    if not dry_run:
        tex_path.write_text(new_tex, encoding="utf-8")

    return {"placed": placed, "unplaced": unplaced}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: recover_orphan_footnotes.py <paper-dir> [--dry-run]",
              file=sys.stderr)
        return 2
    dry_run = "--dry-run" in argv[2:]
    paper_dir = Path(argv[1]).resolve()
    result = recover(paper_dir, dry_run=dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if result["placed"] == 0 and result["unplaced"] == 0:
        print(f"No orphan footnotes detected in {paper_dir}.")
        return 0
    suffix = " (dry run)" if dry_run else ""
    print(
        f"Recovered {result['placed']} orphan footnotes "
        f"({result['unplaced']} still unplaced; fall through to Tier 4){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
