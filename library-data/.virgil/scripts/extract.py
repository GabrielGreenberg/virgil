"""Extract structural blocks from a PDF.

Two paths:

  1. Fast path (always available): pymupdf-based heuristic extraction.
     Reads text spans with positions, infers paragraphs from line gaps,
     detects headings from font-size ratios. Good for digital-native
     papers; loses some structure on multi-column or math-heavy pages.

  2. Marker path (optional): runs `marker` for layout-aware extraction.
     Produces stronger output for academic PDFs with multi-column layouts,
     equations, and footnote zones. Only used if marker is importable.

Both paths emit the same block-list shape so tex_emit.py downstream
doesn't need to know which extractor ran.
"""

from __future__ import annotations

import json
import subprocess
import os
import shutil
import tempfile
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from _tools import detect


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


def _extract_marker(pdf_path: str, page_map: list[dict]) -> list[Block]:
    """Marker path. Returns [] if marker isn't available so caller can fall
    back to pymupdf without exception noise."""
    try:
        from marker.converters.pdf import PdfConverter  # type: ignore
        from marker.models import create_model_dict  # type: ignore
    except Exception:
        return []

    converter = PdfConverter(artifact_dict=create_model_dict())
    rendered = converter(pdf_path)

    # Marker's rendered output is a Markdown-ish object; we walk its
    # blocks and re-classify into our schema. Falling back to plain text
    # extraction from `rendered.markdown` if the structured walker isn't
    # available in this marker version.
    blocks: list[Block] = []
    md = getattr(rendered, "markdown", None)
    if md is None:
        return []

    # Cheap MD parser: split by blank lines, detect # headings.
    page_idx = 0
    print_page = (page_map[0]["print_page"] or "") if page_map else "1"
    paragraphs = md.split("\n\n")
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if para.startswith("# "):
            blocks.append(
                Block(kind="heading", level=1, text=para[2:].strip(),
                      pdf_page=page_idx + 1, print_page=print_page)
            )
        elif para.startswith("## "):
            blocks.append(
                Block(kind="heading", level=2, text=para[3:].strip(),
                      pdf_page=page_idx + 1, print_page=print_page)
            )
        elif para.startswith("### "):
            blocks.append(
                Block(kind="heading", level=3, text=para[4:].strip(),
                      pdf_page=page_idx + 1, print_page=print_page)
            )
        elif para.startswith("$$") and para.endswith("$$"):
            blocks.append(
                Block(kind="display_math", text=para[2:-2].strip(),
                      pdf_page=page_idx + 1, print_page=print_page)
            )
        else:
            blocks.append(
                Block(kind="text", text=para, pdf_page=page_idx + 1, print_page=print_page)
            )
    return blocks


# ── Public entrypoint ───────────────────────────────────────────────────


def extract(
    pdf_path: str,
    page_map: list[dict],
    prefer: str = "auto",
    layout: str = "unknown",
) -> tuple[list[Block], str]:
    """Extract blocks. `prefer` is "marker" | "pymupdf" | "auto".
    `layout` is "header" | "footer" | "mixed" | "unknown" — affects
    asymmetric margin stripping in the pymupdf path.

    Returns (blocks, extractor_name).
    """
    tools = detect()
    if prefer in ("marker", "auto") and tools.marker:
        blocks = _extract_marker(pdf_path, page_map)
        if blocks:
            return blocks, "marker"
    return _extract_pymupdf(pdf_path, page_map, layout=layout), "pymupdf"


def extract_to_json(pdf_path: str, page_map: list[dict], layout: str = "unknown") -> dict:
    blocks, extractor = extract(pdf_path, page_map, layout=layout)
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
