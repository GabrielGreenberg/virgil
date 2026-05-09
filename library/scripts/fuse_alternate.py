"""Fuse \\pgmark{N} pagination from a PDF alternate into an already-indexed
paper's main.tex.

Use case: a paper has a clean DOCX (or .tex) primary source AND a paginated
PDF alternate. The DOCX/.tex extraction produces a clean main.tex with no
pgmark anchors. This script reads the PDF alternate, extracts its printed-
page anchors via the existing `pgmark.detect_print_pages` helper, walks each
page's first body block to get a prose anchor, fuzzy-matches that anchor
against the (possibly deep-indexed) main.tex body via difflib, and splices
`\\pgmark{N}` lines at body scope. The post-write `pgmark_validate.validate`
check is the safety gate.

Fusion is *additive*: it never re-emits main.tex from blocks, never modifies
citations / examples / footnotes / bibliography, only adds `\\pgmark{N}`
lines on their own blank-padded lines.

Idempotent: a re-run with the same alternate is a no-op.

Designed to be runnable directly OR called from /library/fuse-alternate or
the auto-step in index_paper.py.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pgmark import detect_print_pages, HEADER_FRAC, FOOTER_FRAC
from pgmark_validate import (
    validate as pgmark_validate,
    PGMARK_RE,
    ScopeWalker,
    ValidationReport,
)


# ── Tunables ────────────────────────────────────────────────────────────

PRIMARY_THRESHOLD = 0.78        # SequenceMatcher.ratio() threshold
SUBSTRING_THRESHOLD = 0.85      # find_longest_match fraction-of-target
SUBSTRING_MIN_CHARS = 40        # minimum substring match length
WINDOW_LINES = 200              # how many lines forward to scan per anchor
BODY_HEAD_CHARS = 200           # comparison window per line / anchor
ANCHOR_PROSE_CHARS = 250        # chars to take from each PDF page's first prose
MIN_ALIGNED_FRACTION = 0.50     # below this, abort run
LOG_TAG_FUSED = "fused"


# ── Data shapes ─────────────────────────────────────────────────────────


@dataclass
class PageAnchor:
    pdf_page: int
    print_page: str        # what becomes \pgmark{N}
    confidence: str        # "high" | "low" | "missing"
    first_prose: str       # first ~250 chars of first body block on this page


@dataclass
class AlignmentResult:
    anchor: PageAnchor
    target_line: Optional[int]   # 0-based body_lines index where pgmark goes ABOVE
    similarity: float
    matched_against: str
    aborted_reason: Optional[str]


@dataclass
class FuseResult:
    success: bool
    pgmarks_inserted: int
    page_count: int
    aligned_count: int
    pgmark_source_filename: str
    pgmark_position: str
    validation_report: Optional[ValidationReport]
    aborted_reason: Optional[str] = None
    diagnostics: list[str] = field(default_factory=list)


# ── Anchor extraction (PDF → list[PageAnchor]) ──────────────────────────


def extract_page_anchors(
    pdf_path: Path,
) -> tuple[list[PageAnchor], dict]:
    """Return (anchors, layout_info). One PageAnchor per PDF page."""
    page_map, layout_info = detect_print_pages(str(pdf_path))
    if not page_map:
        return [], layout_info or {"position": "unknown"}

    anchors: list[PageAnchor] = []
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        raise RuntimeError(
            "PyMuPDF (fitz) is required for fuse_alternate. "
            "Install: pip install pymupdf"
        ) from e

    doc = fitz.open(str(pdf_path))
    try:
        for entry in page_map:
            pdf_page = int(entry["pdf_page"])
            print_page = str(entry.get("print_page") or pdf_page)
            confidence = str(entry.get("confidence") or "missing")
            page_idx = pdf_page - 1
            if not (0 <= page_idx < len(doc)):
                anchors.append(
                    PageAnchor(pdf_page, print_page, confidence, "")
                )
                continue
            page = doc[page_idx]
            page_h = page.rect.height
            prose = _first_body_prose(page, page_h)
            anchors.append(
                PageAnchor(pdf_page, print_page, confidence, prose)
            )
    finally:
        doc.close()

    return anchors, (layout_info or {"position": "unknown"})


def _first_body_prose(page, page_h: float) -> str:
    """Walk a PDF page's text blocks in y-order; concatenate the first
    body-band block's prose up to ANCHOR_PROSE_CHARS. Skip blocks whose
    midpoint sits in the header (top HEADER_FRAC) or footer (bottom
    FOOTER_FRAC) bands — those carry running headers/footers and page
    numbers, not anchor prose."""
    try:
        text_dict = page.get_text("dict")
    except Exception:
        return ""

    body_blocks: list[tuple[float, str]] = []
    for block in text_dict.get("blocks", []):
        if block.get("type", 0) != 0:  # type=1 is image
            continue
        bbox = block.get("bbox", (0, 0, 0, 0))
        y_mid = (bbox[1] + bbox[3]) / 2
        if y_mid <= page_h * HEADER_FRAC:
            continue
        if y_mid >= page_h * (1 - FOOTER_FRAC):
            continue
        text_parts: list[str] = []
        for line in block.get("lines", []):
            line_text = "".join(
                span.get("text", "") for span in line.get("spans", [])
            )
            if line_text.strip():
                text_parts.append(line_text)
        text = " ".join(t.strip() for t in text_parts).strip()
        if text:
            body_blocks.append((bbox[1], text))

    if not body_blocks:
        return ""
    body_blocks.sort(key=lambda x: x[0])
    # Take the first body block, plus continue accreting prose until we
    # hit ANCHOR_PROSE_CHARS so short opening lines (a heading + first
    # paragraph start) still produce a usable anchor.
    out: list[str] = []
    total = 0
    for _, txt in body_blocks:
        out.append(txt)
        total += len(txt) + 1
        if total >= ANCHOR_PROSE_CHARS:
            break
    return " ".join(out)[:ANCHOR_PROSE_CHARS]


# ── strip-for-similarity transform ──────────────────────────────────────


_CITE_RE = re.compile(
    r"\\(?:cite|citet|citep|citealp|citealt|citeauthor|citeyear|citeyearpar)"
    r"(?:\[[^\]]*\])?\{[^}]*\}"
)
_FOOTNOTE_RE = re.compile(r"\\footnote\{[^}]*\}")
_PGMARK_STRIP_RE = re.compile(r"\\pgmark(?:\[[a-zA-Z]+\])?\{[^}]*\}")
_VEXID_RE = re.compile(r"\\vexid\{[^}]*\}")
# Example-envelope and gloss commands that should be blanked when the line
# is (rarely) used as a similarity target, e.g. `\vexid{...}\ex[exno=3]` —
# upstream _SKIP_LINE_PATTERNS already marks those lines as skip-target,
# but stripping them here defends against any line shape that combines
# envelope commands with body prose.
_ENVELOPE_RE = re.compile(
    r"\\(?:ex|pex|xe|begingl|endgl|gla|glb|glc|glft|glpreamble)"
    r"(?:\[[^\]]*\])?"
)
_BOLD_ITAL_RE = re.compile(r"\\(?:textbf|textit|emph)\{([^}]*)\}")
_HEADING_RE = re.compile(r"^\s*\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}\s*$")
_SKIP_LINE_PATTERNS = [
    # Bare envelope/gloss commands at line start
    re.compile(r"^\s*\\(?:ex|pex|xe|begingl|endgl)(?:\[|\b|$)"),
    re.compile(r"^\s*\\a(?:\b|$)"),
    re.compile(r"^\s*\\(?:gla|glb|glc|glft|glpreamble)(?:\b|$)"),
    # Canonical "\vexid{<uuid>}\ex|pex" first line of an example envelope
    re.compile(r"^\s*\\vexid\{[^}]*\}\\(?:ex|pex)(?:\[|\b|$)"),
    re.compile(r"^\s*\\(?:begin|end)\{(?:xlist|equation\*?|align\*?|gather\*?|multline\*?|displaymath|eqnarray\*?)\}"),
    re.compile(r"^\s*\\\["),
    re.compile(r"^\s*\\\]"),
    re.compile(r"^\s*%"),
    re.compile(r"^\s*$"),
]
_SKIP_TARGET_SENTINEL = "_SKIP_TARGET_"


def _strip_for_match(line: str) -> str:
    """Strip cite/footnote/vexid/pgmark/envelope commands and unwrap
    textbf/textit/emph so similarity matching against PDF page-prose
    works on a deep-indexed main.tex. Heading lines keep their content
    but are returned via _SKIP_TARGET_ sentinel by the caller."""
    s = _CITE_RE.sub("", line)
    s = _FOOTNOTE_RE.sub("", s)
    s = _PGMARK_STRIP_RE.sub("", s)
    s = _VEXID_RE.sub("", s)
    s = _ENVELOPE_RE.sub("", s)
    s = _BOLD_ITAL_RE.sub(lambda m: m.group(1), s)
    return s


def _build_cmp_lines(body_lines: list[str]) -> list[str]:
    """Parallel to body_lines. Each entry is either:
      * the strip-for-match transform of the body line, OR
      * the _SKIP_TARGET_ sentinel — these lines stay in body_lines for
        position arithmetic but are never the alignment target.
    """
    cmp_lines: list[str] = []
    for raw in body_lines:
        # Lines that are themselves structural and never a body-anchor target
        if any(p.match(raw) for p in _SKIP_LINE_PATTERNS):
            cmp_lines.append(_SKIP_TARGET_SENTINEL)
            continue
        if _HEADING_RE.match(raw):
            # Heading content might match a page that begins on a heading,
            # but pgmark must go ABOVE the heading anyway; mark skip.
            cmp_lines.append(_SKIP_TARGET_SENTINEL)
            continue
        stripped = _strip_for_match(raw).strip()
        if not stripped:
            cmp_lines.append(_SKIP_TARGET_SENTINEL)
            continue
        cmp_lines.append(stripped)
    return cmp_lines


# ── Alignment ────────────────────────────────────────────────────────────


def align_anchor_to_body(
    anchor: PageAnchor,
    cmp_lines: list[str],
    start_idx: int,
    *,
    threshold: float,
) -> AlignmentResult:
    """Fuzzy-match anchor.first_prose to the best line in
    cmp_lines[start_idx:start_idx+WINDOW_LINES]. Two passes: ratio-based,
    then substring fallback for DOCX-joined paragraphs."""
    target = anchor.first_prose[:BODY_HEAD_CHARS]
    if not target:
        return AlignmentResult(anchor, None, 0.0, "", "no-prose")
    end = min(start_idx + WINDOW_LINES, len(cmp_lines))
    best: tuple[float, int, str] = (-1.0, -1, "")

    # Pass 1: ratio across the head of each candidate.
    for i in range(start_idx, end):
        cand = cmp_lines[i]
        if cand == _SKIP_TARGET_SENTINEL or not cand:
            continue
        sim = SequenceMatcher(None, target, cand[:BODY_HEAD_CHARS]).ratio()
        if sim > best[0]:
            best = (sim, i, cand)
        if sim >= 0.95:
            break
    if best[0] >= threshold:
        return AlignmentResult(anchor, best[1], best[0], best[2], None)

    # Pass 2: substring fallback. Handles DOCX-joined paragraphs that
    # contain the page's first prose somewhere inside.
    for i in range(start_idx, end):
        cand = cmp_lines[i]
        if cand == _SKIP_TARGET_SENTINEL or not cand:
            continue
        sm = SequenceMatcher(None, target, cand)
        match = sm.find_longest_match(0, len(target), 0, len(cand))
        if match.size >= SUBSTRING_MIN_CHARS:
            frac = match.size / max(1, len(target))
            if frac >= SUBSTRING_THRESHOLD:
                return AlignmentResult(anchor, i, frac, cand, None)
    return AlignmentResult(
        anchor,
        None,
        best[0],
        best[2],
        "below-threshold",
    )


# ── Injection ────────────────────────────────────────────────────────────


def _pgmark_token(print_page: str, confidence: str) -> str:
    if confidence in ("low", "missing"):
        return f"\\pgmark[low]{{{print_page}}}"
    return f"\\pgmark{{{print_page}}}"


def _walk_up_to_body_scope(
    walker: ScopeWalker,
    target_line_1based: int,
    body_start_1based: int,
) -> int:
    """Return a 1-based line number ≤ target_line where inserting a fresh
    line would land at body scope, or -1 if no such line exists between
    body_start and target_line."""
    for ln in range(target_line_1based, body_start_1based - 1, -1):
        if walker.is_body_scope_at_line(ln):
            return ln
    return -1


def inject_pgmark_at_body_scope(
    body_lines: list[str],
    line_idx: int,
    print_page: str,
    confidence: str,
    *,
    body_start_1based: int,
    walker: ScopeWalker,
    floor_1based: int,
) -> tuple[list[str], int, Optional[str]]:
    """Splice `\\pgmark{N}` on its own blank-padded line ABOVE
    body_lines[line_idx]. Walks up via ScopeWalker to find the lowest body-
    scope line ≥ floor_1based. Returns (new_lines, inserted_line_idx,
    failure_reason)."""
    target_line_1based = line_idx + 1
    body_scope_line = _walk_up_to_body_scope(
        walker, target_line_1based, body_start_1based
    )
    if body_scope_line < 0:
        return body_lines, -1, "no-body-scope-window"
    if body_scope_line < floor_1based:
        return body_lines, -1, "would-reorder"
    insert_idx = body_scope_line - 1  # 0-based

    pgmark_line = _pgmark_token(print_page, confidence)
    insertion: list[str] = []
    # Add a blank line before unless prev line is already blank
    if insert_idx > 0 and body_lines[insert_idx - 1].strip() != "":
        insertion.append("")
    insertion.append(pgmark_line)
    if insert_idx < len(body_lines) and body_lines[insert_idx].strip() != "":
        insertion.append("")

    new_lines = body_lines[:insert_idx] + insertion + body_lines[insert_idx:]
    return new_lines, insert_idx, None


# ── Main fusion entry point ──────────────────────────────────────────────


_BEGIN_DOC_RE = re.compile(r"\\begin\{document\}")
_END_DOC_RE = re.compile(r"\\end\{document\}")
_MAKETITLE_RE = re.compile(r"\\maketitle\b")


def _find_body_bounds(lines: list[str]) -> tuple[int, int]:
    """Return (body_start_1based, body_end_1based). body_start is the line
    AFTER \\begin{document} and \\maketitle (whichever comes later); body_end
    is the line of \\end{document}, or len(lines)+1 if absent."""
    begin_doc_line = -1
    maketitle_line = -1
    end_doc_line = -1
    for i, raw in enumerate(lines):
        if begin_doc_line < 0 and _BEGIN_DOC_RE.search(raw):
            begin_doc_line = i + 1
        if _MAKETITLE_RE.search(raw):
            maketitle_line = i + 1
        if _END_DOC_RE.search(raw):
            end_doc_line = i + 1
            break
    body_start = max(begin_doc_line, maketitle_line) + 1
    if body_start <= 0:
        body_start = 1
    if end_doc_line < 0:
        end_doc_line = len(lines) + 1
    return body_start, end_doc_line


def _read_catalog_entry(library: Path, citekey: str) -> Optional[dict]:
    cat = library / ".virgil" / "catalog.json"
    if not cat.exists():
        return None
    try:
        c = json.loads(cat.read_text())
    except Exception:
        return None
    for e in c.get("entries", []):
        if e.get("citekey") == citekey:
            return e
    return None


def _count_body_pgmarks(tex: str) -> tuple[int, set[str]]:
    """Count and collect distinct values of `\\pgmark{N}` occurrences at
    body scope, excluding comments and preamble. Returns (count, page_values)."""
    from pgmark_validate import _strip_comments
    walker = ScopeWalker(tex)
    count = 0
    pages: set[str] = set()
    for ln_idx, raw in enumerate(tex.split("\n"), start=1):
        # Strip line comments so a `% \pgmark{N}` example doesn't count.
        line = _strip_comments(raw)
        if not walker.state_at_line(ln_idx).is_body_scope():
            continue
        for m in PGMARK_RE.finditer(line):
            count += 1
            pages.add(m.group(2))
    return count, pages


def _idempotency_skip(
    catalog_entry: Optional[dict],
    main_tex: str,
    pdf_filename: str,
    new_anchors: list[PageAnchor],
) -> bool:
    """Idempotent no-op when:
      • catalog records this PDF as the pgmarkSource,
      • catalog's pgmarkCount > 0,
      • the in-file body-scope pgmark count matches the catalog count,
      • every body-scope pgmark page value also appears in the PDF's
        current page_map (defends against pgmarks for a different PDF).

    We do NOT require every PDF page to be present in the file — alignment
    is lossy by design, so a partial fusion (16 of 26) is the steady-state
    that we want re-runs to detect as a no-op."""
    if not catalog_entry:
        return False
    indexed = catalog_entry.get("indexed") or {}
    if indexed.get("pgmarkSource") != pdf_filename:
        return False
    if indexed.get("pgmarkCount") in (None, 0):
        return False
    body_count, in_file_pages = _count_body_pgmarks(main_tex)
    if indexed["pgmarkCount"] != body_count:
        return False
    pdf_pages = set(a.print_page for a in new_anchors)
    if not in_file_pages.issubset(pdf_pages):
        return False
    return True


def fuse_pgmarks_into(
    main_tex_path: Path,
    alternate_pdf_path: Path,
    *,
    similarity_threshold: float = PRIMARY_THRESHOLD,
    min_aligned_fraction: float = MIN_ALIGNED_FRACTION,
    dry_run: bool = False,
    log_fn=print,
) -> FuseResult:
    """Top-level fusion: extract page anchors from PDF, align to main.tex,
    inject \\pgmark{N}, validate. See module docstring."""
    if not main_tex_path.exists():
        return FuseResult(
            success=False, pgmarks_inserted=0, page_count=0, aligned_count=0,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position="unknown",
            validation_report=None,
            aborted_reason="main-tex-missing",
        )
    if not alternate_pdf_path.exists():
        return FuseResult(
            success=False, pgmarks_inserted=0, page_count=0, aligned_count=0,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position="unknown",
            validation_report=None,
            aborted_reason="alternate-pdf-missing",
        )

    paper_dir = main_tex_path.parent
    citekey = paper_dir.name
    library = paper_dir.parent.parent
    catalog_entry = _read_catalog_entry(library, citekey)

    main_tex = main_tex_path.read_text()
    body_lines = main_tex.split("\n")

    # Step 1: extract anchors from PDF
    anchors, layout = extract_page_anchors(alternate_pdf_path)
    page_count = len(anchors)
    if page_count == 0:
        return FuseResult(
            success=False, pgmarks_inserted=0, page_count=0, aligned_count=0,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position=str(layout.get("position", "unknown")),
            validation_report=None,
            aborted_reason="no-pages",
        )

    # Step 2: idempotency gate
    if _idempotency_skip(catalog_entry, main_tex, alternate_pdf_path.name, anchors):
        log_fn(
            f"  Already fused from {alternate_pdf_path.name}; in-file pgmark "
            f"count and pages match. No-op."
        )
        return FuseResult(
            success=True, pgmarks_inserted=0, page_count=page_count,
            aligned_count=page_count,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position=str(layout.get("position", "unknown")),
            validation_report=None,
            aborted_reason="already-fused",
        )

    # Step 3: refuse if hand-authored body-scope pgmarks exist with no
    # recorded source. Comments and the `\providecommand` declaration
    # don't count — only body-scope `\pgmark{N}` markers do.
    body_count, _ = _count_body_pgmarks(main_tex)
    if body_count > 0 and (
        not catalog_entry
        or not (catalog_entry.get("indexed") or {}).get("pgmarkSource")
    ):
        # Tolerate the case where pgmarks came from this PDF being the
        # PRIMARY source (catalog records pdf.format=pdf and no separate
        # pgmarkSource because pgmarks came from the primary itself).
        primary_format = (catalog_entry or {}).get("pdf", {}).get("format")
        if primary_format != "pdf":
            return FuseResult(
                success=False, pgmarks_inserted=0, page_count=page_count,
                aligned_count=0,
                pgmark_source_filename=alternate_pdf_path.name,
                pgmark_position=str(layout.get("position", "unknown")),
                validation_report=None,
                aborted_reason="already-has-pgmarks-no-source",
            )

    # Step 4: build comparison lines
    cmp_lines = _build_cmp_lines(body_lines)
    body_start_1based, body_end_1based = _find_body_bounds(body_lines)

    # Step 5: per-anchor alignment
    aligned: list[AlignmentResult] = []
    diagnostics: list[str] = []
    cursor = body_start_1based - 1  # 0-based index into body_lines
    for anchor in anchors:
        # Skip anchors that fall off the body window
        if cursor >= body_end_1based - 1:
            diagnostics.append(
                f"page {anchor.print_page} (pdf {anchor.pdf_page}) SKIPPED "
                f"(past-end at body cursor {cursor})"
            )
            continue
        result = align_anchor_to_body(
            anchor, cmp_lines, cursor, threshold=similarity_threshold,
        )
        if result.target_line is not None:
            aligned.append(result)
            cursor = result.target_line + 1
            diagnostics.append(
                f"page {anchor.print_page} (pdf {anchor.pdf_page}) → "
                f"line {result.target_line + 1} (sim {result.similarity:.2f})"
            )
        else:
            diagnostics.append(
                f"page {anchor.print_page} (pdf {anchor.pdf_page}) SKIPPED "
                f"({result.aborted_reason}, best_sim {result.similarity:.2f})"
            )

    # Step 6: sanity gate
    aligned_count = len(aligned)
    if aligned_count < min_aligned_fraction * page_count:
        for d in diagnostics:
            log_fn(f"    {d}")
        return FuseResult(
            success=False, pgmarks_inserted=0, page_count=page_count,
            aligned_count=aligned_count,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position=str(layout.get("position", "unknown")),
            validation_report=None,
            aborted_reason=f"low-alignment {aligned_count}/{page_count}",
            diagnostics=diagnostics,
        )

    # Step 7: inject in reverse
    walker = ScopeWalker(main_tex)
    new_lines = list(body_lines)
    floor_1based = body_start_1based
    last_inserted_idx: Optional[int] = None
    pgmarks_inserted = 0
    inj_diagnostics: list[str] = []
    # Sort aligned by target_line desc so earlier insertions don't shift later indices.
    for result in sorted(
        aligned, key=lambda r: r.target_line or -1, reverse=True
    ):
        # The walker is built against the ORIGINAL main_tex; line numbers
        # in `result.target_line` index into the original body_lines.
        # Since we insert in reverse, those indices remain stable in the
        # accumulating new_lines for already-inserted (later) anchors.
        new_lines, inserted_idx, reason = inject_pgmark_at_body_scope(
            new_lines,
            result.target_line,
            result.anchor.print_page,
            result.anchor.confidence,
            body_start_1based=body_start_1based,
            walker=walker,
            floor_1based=floor_1based,
        )
        if inserted_idx >= 0:
            pgmarks_inserted += 1
        else:
            inj_diagnostics.append(
                f"page {result.anchor.print_page} INJECT-SKIP ({reason})"
            )
    diagnostics.extend(inj_diagnostics)

    new_tex = "\n".join(new_lines)

    # Step 8: validate
    report = pgmark_validate(new_tex)
    if report.scope_violations:
        for d in diagnostics:
            log_fn(f"    {d}")
        return FuseResult(
            success=False, pgmarks_inserted=pgmarks_inserted,
            page_count=page_count, aligned_count=aligned_count,
            pgmark_source_filename=alternate_pdf_path.name,
            pgmark_position=str(layout.get("position", "unknown")),
            validation_report=report,
            aborted_reason="scope-violation",
            diagnostics=diagnostics,
        )

    # Step 9: atomic write
    if not dry_run:
        tmp = main_tex_path.with_suffix(".tex.tmp")
        tmp.write_text(new_tex)
        os.replace(tmp, main_tex_path)

    return FuseResult(
        success=True, pgmarks_inserted=pgmarks_inserted,
        page_count=page_count, aligned_count=aligned_count,
        pgmark_source_filename=alternate_pdf_path.name,
        pgmark_position=str(layout.get("position", "unknown")),
        validation_report=report,
        aborted_reason=None,
        diagnostics=diagnostics,
    )


# ── Catalog write (skill / standalone) ───────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def update_catalog_for_fusion(
    library: Path,
    citekey: str,
    result: FuseResult,
) -> None:
    """Write catalog updates for a successful fuse-alternate skill run.
    Auto-step inside index_paper.py uses its own catalog-write path; this
    helper is for standalone /library/fuse-alternate invocations."""
    cat = library / ".virgil" / "catalog.json"
    if not cat.exists():
        raise FileNotFoundError(cat)
    catalog = json.loads(cat.read_text())
    found = False
    for entry in catalog.get("entries", []):
        if entry.get("citekey") != citekey:
            continue
        found = True
        indexed = entry.setdefault("indexed", {})
        # Compute body-pgmark count from main.tex directly (source of truth).
        main_tex_path = library / "papers" / citekey / "main.tex"
        if main_tex_path.exists():
            tex = main_tex_path.read_text()
            body_count, _ = _count_body_pgmarks(tex)
            indexed["pgmarkCount"] = body_count
        indexed["pgmarkPosition"] = result.pgmark_position or "unknown"
        indexed["pgmarkSource"] = result.pgmark_source_filename
        indexed["lastIndexedAt"] = _now_iso()
        # Recompute pgmark-fusion-* prefix warnings
        existing = [
            w for w in (indexed.get("warnings") or [])
            if not (isinstance(w, str) and w.startswith("pgmark-fusion-"))
        ]
        new_warnings: list[str] = []
        skipped = result.page_count - result.aligned_count
        if skipped > 0:
            new_warnings.append(
                f"pgmark-fusion-low-alignment-skipped: {skipped} of "
                f"{result.page_count} PDF pages did not align above threshold"
            )
        if result.validation_report and result.validation_report.continuity_findings:
            for f in result.validation_report.continuity_findings:
                new_warnings.append(f"pgmark-fusion-{f.kind}: {f.detail}")
        indexed["warnings"] = existing + new_warnings
        entry["updatedAt"] = _now_iso()
        break
    if not found:
        raise KeyError(f"{citekey} not in catalog")
    cat.write_text(json.dumps(catalog, indent=2) + "\n")
    _bump_version(library)


def _bump_version(library: Path) -> None:
    vpath = library / ".virgil" / "catalog-version.txt"
    try:
        v = int((vpath.read_text() or "0").strip())
    except Exception:
        v = 0
    vpath.write_text(str(v + 1) + "\n")


def _append_notification(
    library: Path,
    citekey: str,
    result: FuseResult,
) -> None:
    npath = library / ".virgil" / "notifications" / "inbox.json"
    npath.parent.mkdir(parents=True, exist_ok=True)
    if npath.exists():
        try:
            inbox = json.loads(npath.read_text())
        except Exception:
            inbox = {"items": []}
    else:
        inbox = {"items": []}
    inbox.setdefault("items", []).append({
        "kind": LOG_TAG_FUSED,
        "citekey": citekey,
        "at": _now_iso(),
        "summary": (
            f"Fused {result.pgmarks_inserted} pgmarks from "
            f"{result.pgmark_source_filename}"
        ),
    })
    npath.write_text(json.dumps(inbox, indent=2) + "\n")


def _write_log(
    library: Path,
    citekey: str,
    result: FuseResult,
) -> Path:
    log_dir = library / ".virgil" / "logs" / citekey
    log_dir.mkdir(parents=True, exist_ok=True)
    slug = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    log_path = log_dir / f"{slug}-fuse.summary.md"
    lines = [
        f"# Fuse-alternate summary: {citekey}",
        "",
        f"**Date:** {_now_iso()}",
        f"**Source:** {result.pgmark_source_filename} ({result.page_count} pages)",
        f"**Pgmarks injected:** {result.pgmarks_inserted}",
        f"**Aligned:** {result.aligned_count}/{result.page_count} at threshold {PRIMARY_THRESHOLD}",
        f"**Layout:** {result.pgmark_position}",
        f"**Validator:** "
        + (
            "clean"
            if result.validation_report and not result.validation_report.continuity_findings
            else (
                f"{len(result.validation_report.continuity_findings)} continuity finding(s)"
                if result.validation_report else "n/a"
            )
        ),
        "",
        "## Per-page alignment",
        "",
    ]
    lines.extend(f"- {d}" for d in result.diagnostics)
    log_path.write_text("\n".join(lines) + "\n")
    return log_path


# ── CLI ──────────────────────────────────────────────────────────────────


def _resolve_alternate(library: Path, citekey: str, override: Optional[str]) -> Path:
    """Pick the PDF alternate for fusion. If `override` is given, use it.
    Otherwise read catalog and pick the largest .pdf in pdf.alternates."""
    paper_dir = library / "papers" / citekey
    if override:
        p = paper_dir / override
        if not p.exists():
            raise FileNotFoundError(p)
        return p
    entry = _read_catalog_entry(library, citekey)
    if not entry:
        raise KeyError(f"{citekey} not in catalog")
    pdf = entry.get("pdf", {})
    if pdf.get("format") == "pdf":
        raise RuntimeError(
            f"{citekey}'s primary source is already a PDF — pgmarks should "
            f"already be present from the original index. "
            f"Run /library/index-paper to re-derive if needed."
        )
    alts = [a for a in (pdf.get("alternates") or []) if a.lower().endswith(".pdf")]
    if not alts:
        raise RuntimeError(
            f"{citekey} has no PDF alternate. The .docx/.tex source is the "
            f"only available pagination evidence — there's nothing to fuse."
        )
    if len(alts) == 1:
        return paper_dir / alts[0]
    # Pick largest by page count
    def _pages(name: str) -> int:
        try:
            import fitz
            d = fitz.open(str(paper_dir / name))
            n = len(d)
            d.close()
            return n
        except Exception:
            return 0
    alts.sort(key=_pages, reverse=True)
    return paper_dir / alts[0]


def main() -> int:
    p = argparse.ArgumentParser(
        description="Fuse pgmarks from a PDF alternate into an indexed paper's main.tex."
    )
    p.add_argument("citekey")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--alternate",
                   help="Override the alternate PDF filename (default: pick "
                        "largest from catalog pdf.alternates)")
    p.add_argument("--similarity-threshold", type=float, default=PRIMARY_THRESHOLD,
                   help=f"SequenceMatcher.ratio() threshold (default {PRIMARY_THRESHOLD})")
    p.add_argument("--dry-run", action="store_true",
                   help="Compute alignment but do not write main.tex or catalog")
    p.add_argument("--no-catalog", action="store_true",
                   help="Write main.tex but skip catalog/notification/log updates")
    args = p.parse_args()

    library = Path(args.library).expanduser()
    citekey = args.citekey
    paper_dir = library / "papers" / citekey
    main_tex_path = paper_dir / "main.tex"

    try:
        alt_path = _resolve_alternate(library, citekey, args.alternate)
    except (FileNotFoundError, KeyError, RuntimeError) as e:
        print(f"fuse-alternate: {e}", file=sys.stderr)
        return 0  # informational, not an error

    print(f"Fusing {alt_path.name} → papers/{citekey}/main.tex")
    result = fuse_pgmarks_into(
        main_tex_path,
        alt_path,
        similarity_threshold=args.similarity_threshold,
        dry_run=args.dry_run,
    )

    for d in result.diagnostics:
        print(f"  {d}")

    if result.aborted_reason == "already-fused":
        print(
            f"  already fused from {alt_path.name} — no-op "
            f"(pgmarkCount={(_read_catalog_entry(library, citekey) or {}).get('indexed', {}).get('pgmarkCount')})"
        )
        return 0
    if not result.success:
        print(
            f"  fusion FAILED: {result.aborted_reason}",
            file=sys.stderr,
        )
        if result.validation_report and result.validation_report.scope_violations:
            print(result.validation_report.to_markdown(), file=sys.stderr)
        return 1

    print(
        f"  Fused {result.pgmarks_inserted}/{result.page_count} pgmarks "
        f"from {alt_path.name} (aligned {result.aligned_count})"
    )

    if not args.no_catalog and not args.dry_run:
        update_catalog_for_fusion(library, citekey, result)
        _append_notification(library, citekey, result)
        log_path = _write_log(library, citekey, result)
        print(f"  Log: {log_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(2)
