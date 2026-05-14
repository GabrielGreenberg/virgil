"""Orchestrate empty-body recovery via ocrmypdf.

When `/library/index-paper` produces an empty body (the PDF has no
text layer, or the extracted text is unusably garbled), the
recovery path is:

1. Detect that the source PDF needs OCR (cheap text-density check
   via `pdftotext` sample).
2. Install `ocrmypdf` + tesseract if missing (with explicit user
   authorization — this pulls down ~200 MB of language data).
3. Run `ocrmypdf --skip-text -O 1 --jobs 4` on the source PDF with
   no timeout cap. Books take 3-15 minutes; the prior 600-second
   timeout in `index_paper.py` silently mis-fires.
4. Archive the original PDF as
   `papers/<citekey>/variants/<citekey>.original-no-ocr.pdf`.
5. Replace the source PDF with the OCRed version.
6. Re-run `/library/index-paper` on the cleaned source.

This script handles steps 3-5. Step 6 is left to the caller (the
deep-index orchestrator calls /library/index-paper after).

Triggered from `/library/di-preflight` when the body is empty
AND the user has authorized recovery (the deep-index orchestrator
should ask before running this).

(dretske memo.)

Usage:
    python3 recover_ocr_pipeline.py <citekey>
        [--check-only] [--force-install] [--language eng]
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _has_text_layer(pdf: Path) -> bool:
    """Sample first 3 pages for text density."""
    if not shutil.which("pdftotext"):
        return True  # assume yes; we can't verify
    try:
        out = subprocess.run(
            ["pdftotext", "-f", "1", "-l", "3", str(pdf), "-"],
            capture_output=True, text=True, timeout=20,
        )
        return len(out.stdout.strip()) > 200
    except subprocess.SubprocessError:
        return True


def _check_ocrmypdf_installed() -> bool:
    return shutil.which("ocrmypdf") is not None


def _install_ocrmypdf() -> bool:
    """Best-effort install via brew + pip. Returns True on success."""
    if not shutil.which("brew"):
        return False
    try:
        subprocess.run(["brew", "install", "tesseract"], check=True, timeout=600)
        subprocess.run(
            ["pip3", "install", "--user", "--break-system-packages", "ocrmypdf"],
            check=True, timeout=300,
        )
    except (subprocess.SubprocessError, subprocess.TimeoutExpired):
        return False
    return _check_ocrmypdf_installed()


def recover(
    citekey: str,
    check_only: bool = False,
    force_install: bool = False,
    language: str = "eng",
) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    pdf_path = paper_dir / f"{citekey}.pdf"
    if not pdf_path.exists():
        return {"error": f"PDF not found at {pdf_path}"}

    if _has_text_layer(pdf_path):
        return {"needs_ocr": False}

    if check_only:
        return {"needs_ocr": True, "would_run_ocrmypdf": True}

    if not _check_ocrmypdf_installed():
        if force_install:
            if not _install_ocrmypdf():
                return {"error": "ocrmypdf install failed; see brew/pip output"}
        else:
            return {
                "error": (
                    "ocrmypdf not installed. Re-run with --force-install "
                    "to attempt brew + pip install, or run manually: "
                    "`brew install tesseract && pip3 install --user ocrmypdf`."
                )
            }

    variants_dir = paper_dir / "variants"
    variants_dir.mkdir(exist_ok=True)
    archive_path = variants_dir / f"{citekey}.original-no-ocr.pdf"
    if not archive_path.exists():
        shutil.copy2(pdf_path, archive_path)

    # Run ocrmypdf with no timeout (books can take 10+ minutes).
    out_pdf = paper_dir / f"{citekey}.ocred.pdf"
    cmd = [
        "ocrmypdf",
        "--skip-text",
        "-O", "1",
        "--jobs", "4",
        "-l", language,
        str(pdf_path),
        str(out_pdf),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=None)
    except subprocess.SubprocessError as e:
        return {"error": f"ocrmypdf failed: {e}"}
    if result.returncode != 0:
        return {
            "error": f"ocrmypdf returned {result.returncode}: "
                     f"{result.stderr[-500:]}",
            "archived_original": str(archive_path),
        }

    # Swap in the OCRed PDF.
    shutil.move(str(out_pdf), str(pdf_path))
    return {
        "needs_ocr": True,
        "ocred": True,
        "archived_original": str(archive_path),
        "rerun_index_paper": f"/library/index-paper {citekey}",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Empty-body recovery via ocrmypdf.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--force-install", action="store_true")
    parser.add_argument("--language", default="eng")
    args = parser.parse_args()
    result = recover(
        args.citekey, args.check_only, args.force_install, args.language,
    )
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    if not result["needs_ocr"]:
        print("PDF already has text layer; no OCR needed.")
        return 0
    if args.check_only:
        print("PDF needs OCR. Re-run without --check-only to apply.")
        return 0
    print(
        f"OCR applied. Original archived to {result['archived_original']}. "
        f"Next step: {result['rerun_index_paper']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
