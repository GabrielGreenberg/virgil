"""Detect printed page numbers in a PDF.

The PDF's page index is 1..N (just file order). The PRINTED page number is
what the publisher put on the page — often roman numerals for front matter,
then arabic for body, sometimes starting partway through. We need both, and
the printed page number is what the user wants in citation page references.

Approach (pure programmatic, no Claude tokens):

  1. Open the PDF with pymupdf.
  2. For each page, collect text spans that sit in the top 8% or bottom 8%
     of the mediabox, on the left/center/right of the header/footer band.
  3. Filter spans whose text matches a page-number-shaped regex (roman
     numerals, plain integers, "1a", "12-13", etc.).
  4. Build candidate (pdf_page → printed_page) pairs. Resolve ambiguities
     by: continuity with neighbors, expected sequence, repeated-region
     consistency (page numbers are usually in the same place across pages).
  5. Where a page has no candidate, extrapolate from neighbors.
  6. Where extrapolation also fails, fall back to the PDF page index and
     mark `printPageMissing: true`.

Output: a list of {pdf_page, print_page, confidence, missing} dicts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Optional


PAGE_RE = re.compile(
    r"^("
    r"[ivxlcdmIVXLCDM]{1,7}|"  # roman
    r"\d{1,4}|"  # arabic
    r"[A-Z]\d{1,3}|"  # appendix-style
    r"\d{1,3}[a-z]"  # 12a etc.
    r")$"
)

# Header/footer relative bands. Widened bottom band because some
# journals (e.g. Philosophical Review) put body text above a tall
# footer block, pushing the actual page number to ~13% from bottom
# rather than ~8%.
HEADER_FRAC = 0.10
FOOTER_FRAC = 0.15


@dataclass
class PageInfo:
    pdf_page: int
    print_page: Optional[str] = None
    confidence: str = "missing"  # high | low | missing
    missing: bool = False
    candidates: list[str] = field(default_factory=list)
    # Per-candidate band tag, parallel to candidates[]: "header" or "footer".
    # Used to determine the document's pagination layout convention.
    candidate_bands: list[str] = field(default_factory=list)
    # Which band the accepted candidate came from (after resolve()), or None
    # if extrapolated/missing. Only "header" or "footer".
    chosen_band: Optional[str] = None


def _is_page_number(text: str) -> bool:
    return bool(PAGE_RE.match(text.strip()))


def _band_of(y: float, page_h: float) -> Optional[str]:
    """Return 'header' if y is in the top band, 'footer' if bottom band,
    None otherwise."""
    if y <= page_h * HEADER_FRAC:
        return "header"
    if y >= page_h * (1 - FOOTER_FRAC):
        return "footer"
    return None


def _is_in_band(y: float, page_h: float) -> bool:
    return _band_of(y, page_h) is not None


def collect_candidates(pdf_path: str) -> list[PageInfo]:
    """First pass: every page gets a list of candidate page-number strings."""
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    pages: list[PageInfo] = []

    for i, page in enumerate(doc, start=1):
        page_h = page.rect.height
        candidates: list[str] = []

        try:
            text_dict = page.get_text("dict")
        except Exception:
            pages.append(PageInfo(pdf_page=i))
            continue

        bands: list[str] = []  # parallel to candidates
        for block in text_dict.get("blocks", []):
            if block.get("type", 0) != 0:
                continue
            for line in block.get("lines", []):
                # Use the bbox y midpoint as the band test.
                bbox = line.get("bbox", (0, 0, 0, 0))
                y_mid = (bbox[1] + bbox[3]) / 2
                band = _band_of(y_mid, page_h)
                if band is None:
                    continue
                full_text = "".join(
                    span.get("text", "") for span in line.get("spans", [])
                ).strip()
                if not full_text:
                    continue
                # Standalone candidate: short tight token.
                if len(full_text) <= 12 and " " not in full_text:
                    if _is_page_number(full_text):
                        candidates.append(full_text)
                        bands.append(band)
                    continue
                # Trailing-token candidate: page number is often the last
                # token of a longer header/footer line ("Journal Vol N pp
                # X--Y    525"). Accept the last whitespace-separated
                # token if it matches.
                last_token = full_text.split()[-1].strip().rstrip(".,;:")
                if last_token and _is_page_number(last_token):
                    candidates.append(last_token)
                    bands.append(band)

        pages.append(
            PageInfo(pdf_page=i, candidates=candidates, candidate_bands=bands),
        )

    doc.close()
    return pages


def _is_roman(s: str) -> bool:
    return bool(re.match(r"^[ivxlcdm]+$", s.lower())) and not s.isdigit()


def _roman_to_int(s: str) -> int:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    s = s.lower()
    result = 0
    prev = 0
    for ch in reversed(s):
        v = vals.get(ch, 0)
        if v < prev:
            result -= v
        else:
            result += v
        prev = v
    return result


def _int_to_roman(n: int) -> str:
    table = [
        (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
        (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
        (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
    ]
    out = []
    for v, s in table:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


def _longest_run_indices(values: list[int], max_delta: int = 5) -> set[int]:
    """Indices of the longest contiguous run where consecutive values
    don't decrease and don't jump by more than `max_delta`.

    A "run" is broken by either a value drop or a forward jump bigger
    than `max_delta`. This catches the false-leading-sequence pattern:
    when the OCR misreads front matter as '99, 101, 103, …, 109' before
    the real body starts at '2', the +94 jump (5→99) and the −107 drop
    (109→2) bracket a short false run. The body's monotonic 2-3-4-… run
    is much longer, so it wins. Ties are broken by keeping the *later*
    run: false-leading sequences are more common in practice than
    false-trailing ones, so when an OCR-mangled front matter happens to
    be the same length as the real body, prefer the body."""
    n = len(values)
    if n == 0:
        return set()
    best_start = 0
    best_end = 0
    start = 0
    for i in range(1, n):
        diff = values[i] - values[i - 1]
        if diff < 0 or diff > max_delta:
            if i - 1 - start >= best_end - best_start:
                best_start, best_end = start, i - 1
            start = i
    if n - 1 - start >= best_end - best_start:
        best_start, best_end = start, n - 1
    return set(range(best_start, best_end + 1))


def resolve(pages: list[PageInfo]) -> list[PageInfo]:
    """Second pass: resolve candidates into a coherent printed-page sequence.

    Strategy: detect a roman-numeral run at the start (front matter), then
    a monotonic arabic run (body). Any candidate that matches the expected
    next-in-sequence value gets accepted with `high` confidence; otherwise
    we extrapolate from neighbors with `low` confidence.

    First, a sanity pass: if the same candidate string appears on more
    than half the pages, it's almost certainly a placeholder header
    (e.g. some journals print "xxx" or the running title), not a real
    page number — strip those candidates.
    """

    from collections import Counter
    counts: Counter[str] = Counter()
    for p in pages:
        for c in p.candidates:
            counts[c] += 1
    half = max(2, len(pages) // 2)
    junk = {c for c, n in counts.items() if n >= half}
    if junk:
        for p in pages:
            keep_idx = [i for i, c in enumerate(p.candidates) if c not in junk]
            p.candidates = [p.candidates[i] for i in keep_idx]
            p.candidate_bands = [p.candidate_bands[i] for i in keep_idx]

    # Helper: find the band of candidate `text` on page index `i`.
    def _band_for(i: int, text: str) -> Optional[str]:
        try:
            idx = pages[i].candidates.index(text)
            return pages[i].candidate_bands[idx]
        except (ValueError, IndexError):
            return None

    # ── 1. classify each page's best candidate ──────────────────────────
    # For each page, pick the candidate that best fits its neighbors.
    n = len(pages)
    accepted: list[Optional[str]] = [None] * n

    # First, detect the start of the arabic run by finding the longest
    # monotonic arabic subsequence.
    arabic_indices: list[int] = []
    for i, p in enumerate(pages):
        for c in p.candidates:
            if c.isdigit():
                arabic_indices.append(i)
                break

    # Greedy: for each arabic-bearing page, pick the candidate that's
    # contiguous with the previous arabic value if available.
    last_arabic_val: Optional[int] = None
    last_arabic_pdf: Optional[int] = None
    for i in arabic_indices:
        digits = [int(c) for c in pages[i].candidates if c.isdigit()]
        if not digits:
            continue
        if last_arabic_val is None:
            # accept the smallest plausible digit
            chosen = min(digits)
        else:
            # expected = last + (this_pdf_idx - last_pdf_idx)
            expected = last_arabic_val + (i - last_arabic_pdf)
            chosen = min(digits, key=lambda d: abs(d - expected))
        accepted[i] = str(chosen)
        pages[i].chosen_band = _band_for(i, str(chosen))
        last_arabic_val = chosen
        last_arabic_pdf = i

    # ── 1.5. Drop false-leading arabic sequences ────────────────────────
    # The greedy walk above can lock onto a short early false sequence
    # (e.g. OCR misreads the front matter as page numbers 99-109) and
    # never recover. Find the longest contiguous run of non-decreasing,
    # small-step accepted values and discard everything else. The
    # extrapolation pass then re-fills from the surviving run.
    arabic_accepted = [(i, int(accepted[i])) for i in range(n)
                       if accepted[i] is not None and accepted[i].isdigit()]
    if len(arabic_accepted) >= 4:
        keep_pos = _longest_run_indices([v for _, v in arabic_accepted])
        for pos, (i, _) in enumerate(arabic_accepted):
            if pos not in keep_pos:
                accepted[i] = None
                pages[i].chosen_band = None

    # Roman numerals for any unaccepted page that has a roman candidate.
    last_roman_val: Optional[int] = None
    for i, p in enumerate(pages):
        if accepted[i] is not None:
            continue
        romans = [c for c in p.candidates if _is_roman(c)]
        if not romans:
            continue
        vals = [_roman_to_int(r) for r in romans]
        if last_roman_val is None:
            chosen = min(vals)
        else:
            expected = last_roman_val + 1
            chosen = min(vals, key=lambda v: abs(v - expected))
        roman = _int_to_roman(chosen)
        accepted[i] = roman
        # The original candidate string may differ in case from our
        # canonical lowercase form; look up by case-insensitive match.
        for j, c in enumerate(p.candidates):
            if _is_roman(c) and _roman_to_int(c) == chosen:
                p.chosen_band = p.candidate_bands[j]
                break
        last_roman_val = chosen

    # ── 2. extrapolate missing pages from neighbors ─────────────────────
    # Walk forward in the arabic run and fill gaps with prev+1.
    last_val: Optional[int] = None
    last_idx: Optional[int] = None
    for i in range(n):
        if accepted[i] and accepted[i].isdigit():
            last_val = int(accepted[i])
            last_idx = i
            pages[i].print_page = accepted[i]
            pages[i].confidence = "high"
        elif last_val is not None and last_idx is not None:
            # In the arabic run; extrapolate.
            extrapolated = last_val + (i - last_idx)
            pages[i].print_page = str(extrapolated)
            pages[i].confidence = "low"
        else:
            # Pre-arabic run: try roman candidates / accepted roman.
            if accepted[i] and _is_roman(accepted[i]):
                pages[i].print_page = accepted[i]
                pages[i].confidence = "high"

    # Backfill anything still missing (e.g. roman pages not classified).
    for i, p in enumerate(pages):
        if p.print_page:
            continue
        # Last resort: use the pdf page index, mark missing.
        p.print_page = str(p.pdf_page)
        p.confidence = "missing"
        p.missing = True

    # ── 3. Demote duplicate print_page labels ───────────────────────────
    # The missing-fallback above uses `str(pdf_page)` as a last-resort
    # label, which can collide with a real body label assigned to a
    # different pdf_page (e.g. front matter pdf_page 5 → "5" from
    # fallback, while body pdf_page 18 → "5" from greedy). Keep the
    # higher-confidence occurrence; demote the loser to print_page=None
    # so tex_emit.py skips the pgmark.
    _rank = {"high": 3, "low": 2, "missing": 1}
    winners: dict[str, int] = {}
    for i, p in enumerate(pages):
        if not p.print_page:
            continue
        prev = winners.get(p.print_page)
        if prev is None:
            winners[p.print_page] = i
        elif _rank.get(p.confidence, 0) > _rank.get(pages[prev].confidence, 0):
            pages[prev].print_page = None
            winners[p.print_page] = i
        else:
            p.print_page = None

    return pages


def detect_layout(pages: list[PageInfo]) -> str:
    """Determine the document's pagination layout convention from the
    bands that won during resolve(). Returns 'header' | 'footer' |
    'mixed' | 'unknown'.

    Rule: among pages with a high-confidence accepted candidate, count
    how many came from each band. If >=80% are from one band, that's
    the convention. Otherwise 'mixed' (front matter in one band, body
    in the other) or 'unknown' (no signal at all).
    """
    header_count = 0
    footer_count = 0
    for p in pages:
        if p.confidence != "high" or p.chosen_band is None:
            continue
        if p.chosen_band == "header":
            header_count += 1
        elif p.chosen_band == "footer":
            footer_count += 1

    total = header_count + footer_count
    if total == 0:
        return "unknown"
    if header_count / total >= 0.8:
        return "header"
    if footer_count / total >= 0.8:
        return "footer"
    return "mixed"


def detect_print_pages(pdf_path: str) -> tuple[list[dict], dict]:
    """Public entrypoint. Returns (page_map, layout_info).

    page_map: list of dicts (one per PDF page) with pdf_page,
    print_page, confidence, missing, candidates, chosen_band fields.

    layout_info: {"position": "header" | "footer" | "mixed" | "unknown"}
    indicating where this document prints its page numbers.
    """
    pages = collect_candidates(pdf_path)
    pages = resolve(pages)
    layout = detect_layout(pages)
    return [asdict(p) for p in pages], {"position": layout}


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) != 2:
        print("usage: python pgmark.py <pdf>")
        sys.exit(2)
    page_map, layout = detect_print_pages(sys.argv[1])
    print(json.dumps({"layout": layout, "pages": page_map}, indent=2))
