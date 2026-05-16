"""Extract structural blocks from a PDF.

Two paths:

  1. Marker path (default): runs `marker-pdf` for layout-aware extraction.
     Produces stronger output for academic PDFs with multi-column
     layouts, equations, and footnote zones. Requires `/library/setup`
     to have run (installs marker-pdf + caches its ML weights inside
     the library at `.virgil/models/huggingface/`). When the marker
     package is missing the dispatcher raises with a clear pointer at
     the setup skill — no silent degradation.

  2. Pymupdf fallback (explicit only): heuristic font-size + position
     extraction. Reachable only via `prefer="pymupdf"` (e.g. for
     debugging a marker regression on a specific paper). Never
     selected automatically — pymupdf alone loses equations,
     footnote zones, drop caps, and most layout information, and
     downstream deep-index recovery scripts exist to compensate for
     exactly the gaps pymupdf produces.

Both paths emit the same block-list shape so tex_emit.py downstream
doesn't need to know which extractor ran.
"""

from __future__ import annotations

import json
import re
import subprocess
import os
import shutil
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from _tools import detect, ensure_model_env


# ── Block schema ────────────────────────────────────────────────────────
# Every extractor returns a list of these. tex_emit.py turns them into
# LaTeX commands.

@dataclass
class Block:
    kind: str  # text | heading | display_math | inline_math | caption | footnote | list_item | reference
    text: str = ""
    level: int = 0  # for heading: 1=section, 2=subsection, 3=subsubsection
    pdf_page: int = 1
    print_page: str = ""
    extra: dict = field(default_factory=dict)


def _classify_pdf(pdf_path: str) -> dict:
    """Detect scanned vs digital. Cheap, always runs first."""
    info: dict = {"scanned": False, "page_count": 0, "fonts": 0, "word_count": 0}

    if shutil.which("pdfinfo"):
        try:
            r = subprocess.run(
                ["pdfinfo", pdf_path], capture_output=True, text=True, timeout=30
            )
            for line in r.stdout.splitlines():
                if line.startswith("Pages:"):
                    info["page_count"] = int(line.split()[1])
        except Exception:
            pass

    if shutil.which("pdffonts"):
        try:
            r = subprocess.run(
                ["pdffonts", pdf_path], capture_output=True, text=True, timeout=30
            )
            # Header is 2 lines; each subsequent line is a font.
            lines = [l for l in r.stdout.splitlines() if l.strip()]
            info["fonts"] = max(0, len(lines) - 2)
        except Exception:
            pass

    if shutil.which("pdftotext"):
        try:
            r = subprocess.run(
                ["pdftotext", pdf_path, "-"], capture_output=True, text=True, timeout=60
            )
            info["word_count"] = len(r.stdout.split())
        except Exception:
            pass

    info["scanned"] = info["fonts"] == 0 and info["word_count"] < 50
    return info


def _ocr_if_needed(pdf_path: str, out_path: str) -> bool:
    """If OCR is needed and ocrmypdf is available, OCR pdf_path → out_path.
    Returns True if OCR ran (out_path is newly created), False if not.
    """
    cls = _classify_pdf(pdf_path)
    if not cls["scanned"]:
        return False
    if not shutil.which("ocrmypdf"):
        return False
    try:
        subprocess.run(
            ["ocrmypdf", "--rotate-pages", "--deskew", "--skip-text",
             "-l", "eng", pdf_path, out_path],
            check=True, timeout=600,
        )
        return True
    except Exception:
        return False


# ── Fast path: pymupdf heuristic ────────────────────────────────────────


def _extract_pymupdf(
    pdf_path: str,
    page_map: list[dict],
    layout: str = "unknown",
) -> list[Block]:
    """Extract blocks via pymupdf heuristics.

    `layout` is one of "header" | "footer" | "mixed" | "unknown" — the
    pagination convention of the document. Used to choose asymmetric
    margin strips: strip the number-bearing band more aggressively while
    leaving the other band tighter to preserve body content.
    """
    import fitz

    # Asymmetric strip ratios. Both bands need to be wide enough to
    # catch running titles / running headers (~6–10% from the edge).
    # The number-bearing band gets an extra-wide strip to catch page
    # numbers that sit a bit further from the edge (e.g. Philosophical
    # Review's footer page number at y_pct ~0.87).
    if layout == "header":
        strip_top = 0.15
        strip_bottom = 0.10
    elif layout == "footer":
        strip_top = 0.10
        strip_bottom = 0.15
    else:  # mixed | unknown
        strip_top = 0.10
        strip_bottom = 0.10

    blocks: list[Block] = []
    doc = fitz.open(pdf_path)

    # Compute median font size across the whole document to set a heading
    # threshold.
    font_sizes: list[float] = []
    for page in doc:
        td = page.get_text("dict")
        for blk in td.get("blocks", []):
            if blk.get("type", 0) != 0:
                continue
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    if span.get("text", "").strip():
                        font_sizes.append(span.get("size", 0))
    if font_sizes:
        font_sizes.sort()
        body_size = font_sizes[len(font_sizes) // 2]
    else:
        body_size = 10.0

    HEAD1 = body_size * 1.4
    HEAD2 = body_size * 1.18
    HEAD3 = body_size * 1.05

    for i, page in enumerate(doc, start=1):
        page_h = page.rect.height
        td = page.get_text("dict")
        page_print = (
            (page_map[i - 1]["print_page"] or "")
            if i - 1 < len(page_map) else str(i)
        )

        # Per-page sub-list so we can tag first/last block on this PDF page.
        page_blocks: list[Block] = []

        for blk in td.get("blocks", []):
            if blk.get("type", 0) != 0:
                continue
            bbox = blk.get("bbox", (0, 0, 0, 0))
            y_mid = (bbox[1] + bbox[3]) / 2
            if y_mid < page_h * strip_top or y_mid > page_h * (1 - strip_bottom):
                continue

            # Collapse all line spans into one paragraph; collect max font
            # size for heading classification.
            paragraph_lines: list[str] = []
            max_size = 0.0
            for line in blk.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", []))
                if not line_text.strip():
                    continue
                paragraph_lines.append(line_text.strip())
                for s in line.get("spans", []):
                    size = s.get("size", 0)
                    if size > max_size:
                        max_size = size

            text = " ".join(paragraph_lines).strip()
            if not text:
                continue

            y_pct = y_mid / page_h if page_h else 0.5
            extra = {"y_pct": round(y_pct, 4)}

            # Classify
            if max_size >= HEAD1 and len(text) < 200:
                page_blocks.append(
                    Block(kind="heading", level=1, text=text,
                          pdf_page=i, print_page=page_print, extra=extra)
                )
            elif max_size >= HEAD2 and len(text) < 200:
                page_blocks.append(
                    Block(kind="heading", level=2, text=text,
                          pdf_page=i, print_page=page_print, extra=extra)
                )
            elif max_size >= HEAD3 and len(text) < 120:
                page_blocks.append(
                    Block(kind="heading", level=3, text=text,
                          pdf_page=i, print_page=page_print, extra=extra)
                )
            else:
                low = text.lstrip().lower()
                if (
                    (low.startswith("figure") or low.startswith("table"))
                    and len(text) < 400
                ):
                    page_blocks.append(
                        Block(kind="caption", text=text,
                              pdf_page=i, print_page=page_print, extra=extra)
                    )
                else:
                    page_blocks.append(
                        Block(kind="text", text=text,
                              pdf_page=i, print_page=page_print, extra=extra)
                    )

        # Tag first/last on PDF page for the inline-pgmark logic in tex_emit.
        if page_blocks:
            page_blocks[0].extra["first_on_pdf_page"] = True
            page_blocks[-1].extra["last_on_pdf_page"] = True
        blocks.extend(page_blocks)

    doc.close()
    return blocks


# ── Marker path (optional) ──────────────────────────────────────────────


def _extract_marker(
    pdf_path: str,
    page_map: list[dict],
    *,
    library: Optional[Path] = None,
) -> list[Block]:
    """Marker path — uses marker's structured JSON renderer to preserve
    layout/equation/footnote-zone metadata, then maps each marker block
    type onto our Block schema.

    Raises RuntimeError if marker isn't available — the caller can degrade
    by passing `prefer="pymupdf"` explicitly, but `auto` no longer falls
    back silently.

    `library` points the model cache at `<library>/.virgil/models/huggingface/`
    via HF_HOME. Falls back to CWD when None (skills bootstrap into the
    library root before running, so CWD is correct in normal use).
    """
    if library is None:
        library = Path.cwd()
    # Point huggingface_hub at the library-local cache BEFORE marker imports
    # huggingface_hub. Otherwise marker re-downloads its ~1 GB of weights
    # into the user's global cache on every invocation in a fresh process.
    ensure_model_env(library)
    try:
        from marker.converters.pdf import PdfConverter  # type: ignore
        from marker.models import create_model_dict  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            f"marker-pdf is not installed in this environment ({e}).\n"
            f"Fix: run /library/setup  (installs marker-pdf + caches its "
            f"ML weights in {library}/.virgil/models/).\n"
            f"To skip marker for this one paper, re-run with --extractor pymupdf."
        )

    # Use marker's JSON renderer to get structured block trees with bbox,
    # block_type, and section_hierarchy preserved. Markdown renderer's
    # output is a flattened string that loses everything except heading
    # depth — the previous integration used that and threw away most of
    # marker's signal.
    converter = PdfConverter(
        artifact_dict=create_model_dict(),
        renderer="marker.renderers.json.JSONRenderer",
    )
    rendered = converter(pdf_path)

    # Structured walk. Falls back to markdown-regex parsing if the JSON
    # tree isn't shaped as expected (e.g., older marker version).
    pages = getattr(rendered, "children", None)
    if pages is None:
        # Defensive — should not happen with current marker versions.
        return _parse_marker_markdown(rendered, page_map)

    blocks: list[Block] = []
    for pdf_page_idx, page in enumerate(pages):
        print_page = _print_page_for(pdf_page_idx, page_map)
        page_blocks: list[Block] = []
        page_children = getattr(page, "children", None) or []
        for raw in page_children:
            converted = _convert_marker_block(
                raw, pdf_page=pdf_page_idx + 1, print_page=print_page,
            )
            page_blocks.extend(converted)
        if page_blocks:
            page_blocks[0].extra["first_on_pdf_page"] = True
            page_blocks[-1].extra["last_on_pdf_page"] = True
        blocks.extend(page_blocks)
    return blocks


def _print_page_for(pdf_page_idx: int, page_map: list[dict]) -> str:
    """Look up the printed-page label for `pdf_page_idx` (0-based) from
    the pgmark detector's page map. Falls back to the PDF page number."""
    if pdf_page_idx < len(page_map):
        return page_map[pdf_page_idx].get("print_page") or str(pdf_page_idx + 1)
    return str(pdf_page_idx + 1)


# Marker block types that are pure chrome and never carry content we want.
# (`BlockTypes.__str__` returns the enum name, e.g. "PageHeader".)
_MARKER_CHROME_TYPES = frozenset({
    "PageHeader",
    "PageFooter",
    "Line",   # Line/Span/Char are intra-paragraph leaves we never want as top-level blocks
    "Span",
    "Char",
})

# Group/wrapper block types whose own html is empty — recurse into children.
_MARKER_GROUP_TYPES = frozenset({
    "ListGroup", "TableGroup", "FigureGroup", "PictureGroup",
    "Document", "Page", "ComplexRegion",
})


def _convert_marker_block(
    raw: Any, *, pdf_page: int, print_page: str,
) -> list[Block]:
    """Map one marker JSONBlockOutput into 0..N of our Block records.

    Returns a list so group blocks can fan out into their structured
    children (e.g., a TableGroup may contribute a caption + a table-text
    block). Chrome blocks (PageHeader/PageFooter) and empty blocks
    return [].
    """
    btype = getattr(raw, "block_type", None) or ""
    btype_s = str(btype)

    if btype_s in _MARKER_CHROME_TYPES:
        return []
    if btype_s in _MARKER_GROUP_TYPES:
        # Recurse into children for grouped wrappers (esp. ListGroup,
        # TableGroup) — their own .html is a container wrapper, the real
        # content lives in children.
        out: list[Block] = []
        for child in getattr(raw, "children", None) or []:
            out.extend(_convert_marker_block(
                child, pdf_page=pdf_page, print_page=print_page,
            ))
        return out

    text = _marker_block_text(raw)
    if not text.strip():
        return []

    extra = _marker_block_extra(raw)

    if btype_s == "SectionHeader":
        level = _marker_heading_level(raw)
        return [Block(kind="heading", level=level, text=text,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s == "Equation":
        # Strip outer $$ / \[ \] delimiters if marker included them; tex_emit
        # wraps the body in \[ \] itself.
        body = _strip_math_delimiters(text)
        return [Block(kind="display_math", text=body,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s == "Caption":
        return [Block(kind="caption", text=text,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s == "Footnote":
        return [Block(kind="footnote", text=text,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s == "ListItem":
        return [Block(kind="list_item", text=text,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s == "Reference":
        return [Block(kind="reference", text=text,
                      pdf_page=pdf_page, print_page=print_page, extra=extra)]
    if btype_s in ("Table", "Form", "TableCell"):
        # Tables fall through as text for now — the markdown rendering of
        # a marker Table is itself a markdown table, which downstream
        # deep-index can convert to LaTeX tabular. Tag in extra so a
        # future pass can find it.
        return [Block(kind="text", text=text,
                      pdf_page=pdf_page, print_page=print_page,
                      extra={**extra, "marker_block_type": btype_s})]
    if btype_s in ("Figure", "Picture", "Code", "Handwriting", "TableOfContents"):
        # Carry through as text with a tag so deep-index can decide what
        # to do (e.g., drop standalone figures, convert ToC to outline).
        return [Block(kind="text", text=text,
                      pdf_page=pdf_page, print_page=print_page,
                      extra={**extra, "marker_block_type": btype_s})]
    # Default: Text, TextInlineMath, anything unrecognized.
    return [Block(kind="text", text=text,
                  pdf_page=pdf_page, print_page=print_page,
                  extra={**extra, **({"marker_block_type": btype_s} if btype_s and btype_s != "Text" else {})})]


def _marker_block_text(raw: Any) -> str:
    """Extract clean text from a marker JSONBlockOutput.

    Marker's `html` field is the authoritative content surface; we
    convert it to LaTeX-friendly plain text, preserving inline math
    by mapping `<math>...</math>` → `$...$`. For group blocks where
    `html` is empty, falls through to walking children.
    """
    html = getattr(raw, "html", None)
    if isinstance(html, str) and html.strip():
        return _html_to_latex_text(html)
    # Group/Document/Page — recurse and concatenate.
    parts: list[str] = []
    for child in getattr(raw, "children", None) or []:
        t = _marker_block_text(child)
        if t.strip():
            parts.append(t)
    return " ".join(parts)


# Inline-math wrapper detection. Marker's HTML emits inline math as
# <math display="inline">...</math> (KaTeX-style LaTeX inside) and display
# math as a separate Equation block — but the body of Equation blocks may
# still arrive wrapped in `<math display="block">...</math>`.
_HTML_MATH_RE = re.compile(r"<math[^>]*>(.*?)</math>", re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_ENTITY = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
}


def _html_to_latex_text(html: str) -> str:
    """Cheap HTML→text converter that preserves inline math fragments.

    Sufficient for downstream tex_emit, which doesn't escape `$` (so
    `$x^2$` survives unmolested). NOT a full HTML parser — we rely on
    marker emitting well-formed snippets without nested math.
    """
    s = _HTML_MATH_RE.sub(lambda m: f"${m.group(1).strip()}$", html)
    s = _HTML_TAG_RE.sub("", s)
    for ent, ch in _HTML_ENTITY.items():
        s = s.replace(ent, ch)
    return s.strip()


def _strip_math_delimiters(text: str) -> str:
    """Remove outer `$$..$$`, `\\[..\\]`, or `$..$` wrappers around a
    display-math body so tex_emit can re-wrap with `\\[..\\]`."""
    s = text.strip()
    for opener, closer in (("$$", "$$"), ("\\[", "\\]"), ("$", "$")):
        if s.startswith(opener) and s.endswith(closer) and len(s) > len(opener) + len(closer):
            return s[len(opener):-len(closer)].strip()
    return s


def _marker_block_extra(raw: Any) -> dict:
    """Persist marker's bbox/polygon for downstream pgmark + footnote-zone
    consumers. y_pct is computed against an assumed unit-page (marker's
    bbox is in PDF points; we don't know page height from JSONBlockOutput
    alone, so we leave y_pct out — pymupdf's path still emits it)."""
    extra: dict = {}
    bbox = getattr(raw, "bbox", None)
    if bbox and len(bbox) >= 4:
        extra["bbox"] = list(bbox)
    polygon = getattr(raw, "polygon", None)
    if polygon:
        extra["polygon"] = list(polygon)
    return extra


def _marker_heading_level(raw: Any) -> int:
    """Derive a heading depth (1/2/3) from marker's section_hierarchy.

    `section_hierarchy` is `Dict[int, str]` mapping nesting level →
    section identifier; the deepest level reached at this block is the
    block's own heading level. Clamped to [1, 3] to match tex_emit's
    section/subsection/subsubsection options.
    """
    hier = getattr(raw, "section_hierarchy", None)
    if isinstance(hier, dict) and hier:
        try:
            keys = [int(k) for k in hier.keys()]
            if keys:
                return max(1, min(3, max(keys)))
        except (ValueError, TypeError):
            pass
    return 1


# ── Public helpers for deep-index PDF re-reads ────────────────────────
#
# Deep-index's footnote-recovery Tier 1 historically uses `pdftotext
# -layout` + a vertical-layout heuristic to find footnote bodies in
# the footer zone. That heuristic is fragile (fails on multi-column
# footers, graphical separators, two-column footnote arrays). Now that
# marker is mandatory at index time, its Footnote-typed blocks are a
# more reliable signal — and the model cache is already warm in the
# library, so calling marker again at deep-index time costs ~30-90s
# of inference but no new download.


def marker_footnote_zones_by_page(
    pdf_path: str,
    *,
    library: Optional[Path] = None,
) -> dict[int, list[tuple[int, str]]]:
    """Run marker and return footnote bodies grouped by 1-based PDF page.

    Each value is a list of `(footnote_number, body_text)` pairs as
    inferred from marker's Footnote blocks (leading 1-3 digits are
    taken as the number, rest as the body). Empty list for pages
    where marker found no Footnote blocks.

    Used by deep-index's footnote-recovery Tier 1 as a structured
    replacement for the pdftotext + indent heuristic. Falls through
    cleanly when marker isn't installed (returns {}) so callers can
    chain the heuristic path as a fallback.
    """
    try:
        blocks = _extract_marker(pdf_path, page_map=[], library=library)
    except RuntimeError:
        # marker unavailable — return empty so caller falls back to
        # the pdftotext heuristic.
        return {}
    by_page: dict[int, list[tuple[int, str]]] = {}
    for b in blocks:
        if b.kind != "footnote":
            continue
        num, body = _split_footnote_number(b.text)
        if num is None or not body:
            continue
        by_page.setdefault(b.pdf_page, []).append((num, body))
    return by_page


_FOOTNOTE_NUMBER_PREFIX = re.compile(r"^\s*(\d{1,3})\b[\s.):]*(.*)$", re.DOTALL)


def _split_footnote_number(text: str) -> tuple[Optional[int], str]:
    """Pull a leading footnote number off a footnote body.

    Matches patterns like `12 body`, `12. body`, `12) body`, `12: body`
    — the punctuation between the number and the body is optional and
    sometimes stripped already by marker's text rendering. Returns
    `(None, body)` when no leading number is found, leaving the caller
    to skip or store the body unkeyed.
    """
    m = _FOOTNOTE_NUMBER_PREFIX.match(text)
    if not m:
        return None, text.strip()
    try:
        n = int(m.group(1))
    except ValueError:
        return None, text.strip()
    if not 1 <= n <= 999:
        return None, text.strip()
    return n, m.group(2).strip()


def _parse_marker_markdown(rendered: Any, page_map: list[dict]) -> list[Block]:
    """Markdown-regex fallback used only when the structured JSON walk
    can't be performed (marker version older than the JSON renderer's
    JSONOutput.children shape). Lossy — kept around as a safety net so
    a marker upgrade quirk can't strand the whole pipeline.
    """
    md = getattr(rendered, "markdown", None)
    if md is None:
        return []
    blocks: list[Block] = []
    page_idx = 0
    print_page = _print_page_for(0, page_map)
    for para in md.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        if para.startswith("# "):
            blocks.append(Block(kind="heading", level=1, text=para[2:].strip(),
                                pdf_page=page_idx + 1, print_page=print_page))
        elif para.startswith("## "):
            blocks.append(Block(kind="heading", level=2, text=para[3:].strip(),
                                pdf_page=page_idx + 1, print_page=print_page))
        elif para.startswith("### "):
            blocks.append(Block(kind="heading", level=3, text=para[4:].strip(),
                                pdf_page=page_idx + 1, print_page=print_page))
        elif para.startswith("$$") and para.endswith("$$"):
            blocks.append(Block(kind="display_math", text=para[2:-2].strip(),
                                pdf_page=page_idx + 1, print_page=print_page))
        else:
            blocks.append(Block(kind="text", text=para,
                                pdf_page=page_idx + 1, print_page=print_page))
    return blocks


# ── Public entrypoint ───────────────────────────────────────────────────


def extract(
    pdf_path: str,
    page_map: list[dict],
    prefer: str = "auto",
    layout: str = "unknown",
    *,
    library: Optional[Path] = None,
) -> tuple[list[Block], str]:
    """Extract blocks. `prefer` is "marker" | "pymupdf" | "auto".

    - `auto` (default) is marker; raises RuntimeError if marker is
      missing, pointing at /library/setup.
    - `marker` is identical to `auto`.
    - `pymupdf` is the explicit-fallback path (debugging / known
      marker-broken papers). Never selected automatically; using it
      means losing equations, footnote zones, drop caps, and most
      layout information.

    `layout` is "header" | "footer" | "mixed" | "unknown" — affects
    asymmetric margin stripping in the pymupdf path only.

    `library` is the library root for resolving the model cache (HF_HOME).
    Defaults to CWD; skill bootstraps cd into the library so CWD is correct.

    Returns (blocks, extractor_name).
    """
    if prefer == "pymupdf":
        return _extract_pymupdf(pdf_path, page_map, layout=layout), "pymupdf"
    # auto | marker — marker is the only path. No silent fallback.
    blocks = _extract_marker(pdf_path, page_map, library=library)
    return blocks, "marker"


def extract_to_json(
    pdf_path: str,
    page_map: list[dict],
    layout: str = "unknown",
    *,
    prefer: str = "auto",
    library: Optional[Path] = None,
) -> dict:
    blocks, extractor = extract(
        pdf_path, page_map, prefer=prefer, layout=layout, library=library,
    )
    return {
        "extractor": extractor,
        "blocks": [asdict(b) for b in blocks],
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: python extract.py <pdf> [<pgmark.json>]")
        sys.exit(2)
    pdf = sys.argv[1]
    page_map: list[dict] = []
    if len(sys.argv) >= 3:
        with open(sys.argv[2]) as f:
            page_map = json.load(f)
    out = extract_to_json(pdf, page_map)
    print(json.dumps(out, indent=2))
