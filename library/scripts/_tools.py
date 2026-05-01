"""Detect which extraction tools are available on this machine.

The indexing pipeline degrades gracefully:
- digital-native PDFs only need pymupdf + poppler (always required)
- scanned PDFs need ocrmypdf (optional)
- layout-heavy PDFs benefit from marker (optional)
"""

from __future__ import annotations

import shutil
import importlib.util
from dataclasses import dataclass


@dataclass
class Tools:
    pdfinfo: bool
    pdftotext: bool
    pdffonts: bool
    pymupdf: bool
    marker: bool
    ocrmypdf: bool
    tesseract: bool
    python_docx: bool

    def missing_required(self) -> list[str]:
        missing = []
        if not self.pdfinfo:
            missing.append("pdfinfo (brew install poppler)")
        if not self.pdftotext:
            missing.append("pdftotext (brew install poppler)")
        if not self.pdffonts:
            missing.append("pdffonts (brew install poppler)")
        if not self.pymupdf:
            missing.append("PyMuPDF (pip install PyMuPDF)")
        return missing

    def summary(self) -> str:
        rows = [
            f"  poppler:    pdfinfo={self.pdfinfo}, pdftotext={self.pdftotext}, pdffonts={self.pdffonts}",
            f"  pymupdf:    {self.pymupdf}",
            f"  marker:     {self.marker}  (optional, layout-aware extraction)",
            f"  ocrmypdf:   {self.ocrmypdf}  (optional, scanned-PDF preprocess)",
            f"  tesseract:  {self.tesseract}  (optional, ocrmypdf backend)",
            f"  python-docx:{self.python_docx}  (required only when indexing .docx sources)",
        ]
        return "\n".join(rows)


def detect() -> Tools:
    return Tools(
        pdfinfo=shutil.which("pdfinfo") is not None,
        pdftotext=shutil.which("pdftotext") is not None,
        pdffonts=shutil.which("pdffonts") is not None,
        pymupdf=importlib.util.find_spec("fitz") is not None,
        marker=importlib.util.find_spec("marker") is not None,
        ocrmypdf=shutil.which("ocrmypdf") is not None,
        tesseract=shutil.which("tesseract") is not None,
        python_docx=importlib.util.find_spec("docx") is not None,
    )
