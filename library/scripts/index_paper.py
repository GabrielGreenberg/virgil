"""End-to-end indexer for a single source (PDF or DOCX) in the Virgil Library.

Usage:
  python index_paper.py <citekey> [--library ~/Virgil-Library] [--re-extract]

A main.tex that holds deep-index work is never overwritten without
`--re-extract` (task 800 — see `check_main_tex_clobber`).

Reads `papers/<citekey>/<citekey>.pdf` or `papers/<citekey>/<citekey>.docx`,
runs the pipeline, writes:
  papers/<citekey>/main.tex
  papers/<citekey>/references.bib   (this paper's master.bib row, UPSERTED —
                                     on a first index that yields the familiar
                                     single-entry mirror; on a re-index of a
                                     deep-indexed paper the cited works that
                                     /library/clean-bibliography wrote there
                                     survive untouched. See
                                     `write_paper_bib_entry`.)
  papers/<citekey>/virgil/{virgil,notes,footnotes}.json   (initialized empty)
  logs/<citekey>/<ISO>-index.log
  logs/<citekey>/<ISO>-index.summary.md

Then updates catalog.json and bumps catalog-version.txt and appends a
notification to notifications/inbox.json.

DOCX sources skip OCR and printed-page detection — Word's paragraph styles
already carry the structure that the PDF pipeline reverse-engineers.

Designed to be runnable directly OR called from the /index-paper skill.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Make sibling scripts importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (
    paper_folder,
    SOURCE_FORMAT_PRIORITY,
    admit_catalog_row,
    append_inbox_item,
    bump_catalog_version,
    citekey_matches,
    deep_index_baseline_path,
    detect,
    lock_catalog,
    StateFileUnreadable,
    read_catalog,
    is_terminal_bib_state,
    master_entry_for,
    resolve_paper_source,
    settle_catalog_bib,
    settle_master_bib_state,
    update_master_bib_entry,
    upsert_catalog_entry,
    write_catalog,
    write_paper_bib_entry,
)
from _bib_parse import BibSpliceRefused
from pgmark import detect_print_pages
from pgmark_validate import validate as pgmark_validate
from extract import extract_to_json, _ocr_if_needed, _classify_pdf
import extract_docx
from tex_emit import emit
from bib_auth import authenticate, assert_title_clean
from fuse_alternate import fuse_pgmarks_into, FuseResult, FUSION_FAILED_HEAD


# Source-format priority. Spelled ONCE, on the stdlib-only leaf
# (`_tools.SOURCE_FORMAT_PRIORITY`), because the cheap local consumers —
# `validate_bib_coherence.py`'s cover-page leg, `paper_has_holdings` — cannot
# import THIS module: it pulls in marker / pymupdf / the whole extraction
# stack. The two names below are the historical spellings, kept so existing
# readers don't move.
FORMAT_PRIORITY = SOURCE_FORMAT_PRIORITY
SUPPORTED_EXTS = FORMAT_PRIORITY


def _alternate_sources(library: Path, citekey: str, primary_ext: str) -> list[str]:
    """Return filenames of any same-citekey sources of *lower* priority
    than `primary_ext`. They sit on disk as archives — recorded in the
    catalog so the frontend can surface "also available as PDF/DOCX"."""
    alts: list[str] = []
    for ext in FORMAT_PRIORITY:
        if ext == primary_ext:
            continue
        p = paper_folder(library, citekey) / f"{citekey}.{ext}"
        if p.exists():
            alts.append(p.name)
    return alts


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")


# ── The main.tex clobber door (task 800) ────────────────────────────────
#
# Step 5 writes `papers/<citekey>/main.tex` from a fresh extraction. On a
# paper deep-index has worked on, that file is no longer an extraction — it
# carries every prose / footnote / bibliography / example repair the
# convergence loop made — and a plain re-run of this script used to replace
# it silently. The door: past plain `indexed`, an existing main.tex is
# overwritten ONLY under an explicit `--re-extract`, which first retires the
# prior text (and the deep-index baseline taken from it) to a timestamped
# backup. Asked BEFORE extraction, so a refusal costs nothing.

#: Catalog `indexed.state` values whose main.tex is post-extraction work.
#: `richIndexed` is the legacy spelling of `deepIndexed` (catalog.ts).
POST_EXTRACTION_STATES = frozenset({"deepIndexed", "richIndexed"})


class ReExtractRequired(RuntimeError):
    """Refusal: main.tex holds deep-index work and `--re-extract` was not asked."""


def _catalog_row(library: Path, citekey: str) -> Optional[dict]:
    try:
        catalog = read_catalog(library)
    except StateFileUnreadable:
        # Never "no row" — that would wave a re-extract over deep-index work.
        raise
    except Exception:
        return None
    return next((e for e in catalog.get("entries", [])
                 if citekey_matches(e.get("citekey", "") or "", citekey)), None)


def main_tex_holds_deep_index_work(library: Path, citekey: str) -> Optional[str]:
    """Why the existing main.tex is more than an extraction, or None.

    Two signals, either sufficient: the catalog row says the paper is
    deep-indexed, or a deep-index baseline exists (a pass has STARTED —
    it may have crashed before flipping the state)."""
    if not (paper_folder(library, citekey) / "main.tex").exists():
        return None
    row = _catalog_row(library, citekey) or {}
    state = (row.get("indexed") or {}).get("state", "")
    if state in POST_EXTRACTION_STATES:
        return f"catalog indexed.state is {state!r}"
    if deep_index_baseline_path(library, citekey).exists():
        return "a deep-index baseline exists (.virgil/baselines/)"
    return None


def check_main_tex_clobber(library: Path, citekey: str, *, re_extract: bool) -> None:
    """Refuse (raise `ReExtractRequired`) to overwrite deep-index work
    unless `re_extract`. Makes no write."""
    reason = main_tex_holds_deep_index_work(library, citekey)
    if reason and not re_extract:
        raise ReExtractRequired(
            f"{citekey}: refusing to overwrite papers/{citekey}/main.tex — "
            f"{reason}, so it holds deep-index work a fresh extraction would "
            f"erase. To replace it anyway (the old main.tex and baseline are "
            f"backed up first), re-run with --re-extract."
        )


def retire_prior_extraction(library: Path, citekey: str, slug: str) -> Optional[Path]:
    """Back up main.tex (copy) and the deep-index baseline (move) to
    `.virgil/backups/re-extract/<citekey>/<slug>/`. Returns the backup dir,
    or None when there was nothing to retire."""
    main_tex = paper_folder(library, citekey) / "main.tex"
    baseline = deep_index_baseline_path(library, citekey)
    if not main_tex.exists() and not baseline.exists():
        return None
    dest = library / ".virgil" / "backups" / "re-extract" / citekey / slug
    dest.mkdir(parents=True, exist_ok=True)
    if main_tex.exists():
        shutil.copy2(main_tex, dest / "main.tex")
    if baseline.exists():
        # MOVED, not copied: the next deep-index must baseline the NEW text.
        shutil.move(str(baseline), str(dest / baseline.name))
    return dest


def _resync_references_bib(library: Path, citekey: str) -> bool:
    """Sync papers/<citekey>/references.bib's own row from master.bib.

    Upserts (does NOT re-emit) via `_tools.write_paper_bib_entry` — only the
    `<citekey>` block is touched, every other entry in the file survives
    byte-identically. Returns False when the paper folder or the master.bib
    row is missing.

    This is the entry point both `/library/authenticate-bib` (step 6) and
    `/library/apply-bib-edit` (step 3) call.
    """
    paper_dir = paper_folder(library, citekey)
    if not paper_dir.exists():
        return False
    entry = master_entry_for(library, citekey)
    if not entry:
        return False
    write_paper_bib_entry(paper_dir, citekey, entry["type"], entry["fields"])
    return True


def _sync_catalog_entry_from_master(library: Path, citekey: str,
                                    bib_status: dict) -> str:
    """Sync catalog.json top-level fields from master.bib so they can't drift.

    F#4 holdings-only gate (task 443). This is `/library/authenticate-bib`
    step 7, and that skill deliberately serves entries with NO catalog row:
    `/library/triage-pdf`'s `.bib` fan-out queues one `kind: "authenticate"`
    per imported entry, so on a 500-entry import this runs 500 times for
    citekeys that are cited but not held. `upsert_catalog_entry` APPENDS when
    no row matches, so before task 443 this minted exactly the rows its two
    sibling writers refuse — freezing a `bib` snapshot in front of the live
    bib-index projection the frontend reads for a fileless reference, and
    growing the catalog without bound.

    `admit_catalog_row` is the shared gate: for a reference-only entry it
    discharges the state to the `% bib.state` comment in master.bib (its home),
    REFRESHES an already-existing row without minting one (a pre-F#4 leftover
    shadows the live projection in the Library list, so freezing it is the same
    defect from the other side), and answers False — so there is nothing left
    to do here. For a real holding it answers True and the row is written
    exactly as before.

    **Returns the state master.bib SETTLED** — the one the row now carries
    (task 797). `bib_status` is this run's verdict and this run's
    `fieldChanges` only: the state in it is a REQUEST, stamped through the
    write door, which holds a settled state against a weaker one; the row
    then takes the state back from master.bib and `settle_catalog_bib`
    appends the history. So a holding's state reaches master.bib too (the
    door's True arm writes nothing, and before this the tier-1 upgrade the
    skill computed after its own master write never got there), and a caller
    reports what landed, not what it asked for. "" when master.bib has no
    entry.
    """
    entry = master_entry_for(library, citekey)
    if not entry:
        return ""
    fields = entry["fields"]
    authors_str = fields.get("author", "")
    authors = [a.strip() for a in authors_str.split(" and ") if a.strip()]
    year_raw = fields.get("year", "")
    year = int(year_raw) if year_raw.isdigit() else year_raw
    # ONE derivation, read by both arms — the gate's stale-row refresh and the
    # holdings write below — so a reference row and a holdings row cannot come
    # to disagree about what this citekey's title is.
    top = {
        "title": fields.get("title", ""),
        "authors": authors,
        "year": year,
        "doi": fields.get("doi") or None,
    }
    if not admit_catalog_row(
        library, citekey,
        entry_type=entry.get("type", "misc"),
        fields=fields,
        bib_state=(bib_status or {}).get("state", ""),
        bib=bib_status,
        top=top,
    ):
        return settle_master_bib_state(library, citekey, "")
    effective = settle_master_bib_state(
        library, citekey, (bib_status or {}).get("state", ""))
    with lock_catalog(library):
        catalog = read_catalog(library)
        prior = next((e.get("bib") for e in catalog.get("entries", [])
                      if citekey_matches(e.get("citekey", ""), citekey)), None)
        bib = settle_catalog_bib(library, citekey, prior, bib_status,
                                 effective_state=effective)
        row = upsert_catalog_entry(catalog, citekey, **top)
        row["bib"] = bib
        write_catalog(library, catalog)
    return effective or bib.get("state", "")


def _sha256(p: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _page_count(pdf: Path) -> int:
    try:
        import fitz
        doc = fitz.open(str(pdf))
        n = doc.page_count
        doc.close()
        return n
    except Exception:
        return 0


# ── Main pipeline ───────────────────────────────────────────────────────


def _fuse_pgmark_from_alternate(
    citekey: str,
    library: Path,
    primary_format: str,
    alternates: list[str],
    *,
    log_fn,
) -> Optional["FuseResult"]:
    """Step 5c (auto-fusion). Run after primary extraction (DOCX/TEX)
    and main.tex emit, BEFORE the catalog write, so fusion results
    propagate into indexed.pgmarkCount / pgmarkSource. Returns None when
    not applicable; returns a FuseResult when the fuser ran (success or
    fail). Caller inspects .success."""
    if primary_format not in ("docx", "tex"):
        return None
    pdf_alts = [a for a in alternates if a.lower().endswith(".pdf")]
    if not pdf_alts:
        return None
    if len(pdf_alts) > 1:
        # Pick the largest by page count.
        pdf_alts.sort(
            key=lambda f: _page_count(paper_folder(library, citekey) / f),
            reverse=True,
        )
    pdf_path = paper_folder(library, citekey) / pdf_alts[0]
    main_tex_path = paper_folder(library, citekey) / "main.tex"
    log_fn(f"Step 5c: fuse pgmarks from PDF alternate {pdf_path.name}")
    result = fuse_pgmarks_into(main_tex_path, pdf_path, log_fn=log_fn)
    if result.success and result.pgmarks_inserted > 0:
        log_fn(
            f"  Fused {result.pgmarks_inserted} pgmarks "
            f"(aligned {result.aligned_count}/{result.page_count} pages)"
        )
    elif result.success and result.aborted_reason == "already-fused":
        log_fn("  Fusion no-op (already fused)")
    else:
        log_fn(f"  Fusion aborted: {result.aborted_reason}")
    return result


def _unauthenticated_bib_status(bib_entry: dict) -> dict:
    """The row's `bib` block when no auth pass runs: a settled entry keeps its
    state (task 621), anything else reads `unverified`."""
    state = bib_entry.get("state", "")
    return {"state": state if is_terminal_bib_state(state) else "unverified"}


def _authenticate_master_entry(library: Path, citekey: str, bib_entry: dict,
                               fields: dict, log) -> dict:
    """Step 7: authenticate `citekey`'s master.bib entry and write it back.

    Returns the row's `bib` status block. Mutates `fields` (field changes,
    title hygiene) and `bib_entry["type"]` (a DOI-verified type conversion) in
    place, exactly as the inline step did; the caller re-derives its
    title/authors/year from `fields`.
    """
    title = fields.get("title", "")
    authors = fields.get("author", "")
    # A SETTLED entry is not re-authenticated (task 621). Indexing is how a
    # held source arrives for a reference the library already vetted — an
    # imported `canonical` entry, an `authenticated` one whose PDF the user
    # just dropped — and a fresh fuzzy lookup is lower evidence than the
    # verdict already on file: its `field_changes` would overwrite vetted
    # fields and its `unverified` would stamp the state back down. The write
    # door holds the state regardless; skipping here is what keeps the
    # FIELDS. The row carries the settled state rather than a default.
    bib_status = _unauthenticated_bib_status(bib_entry)
    if is_terminal_bib_state(bib_status["state"]):
        log(f"Step 7: skipped (bib.state={bib_status['state']} is settled; "
            "not re-authenticating)")
    else:
        log("Step 7: authenticate bib entry against external sources")
        seed_authors = [a.strip() for a in authors.split(" and ") if a.strip()]
        try:
            result = authenticate(title, seed_authors, fields,
                                  entry_type=bib_entry["type"],
                                  library=library, citekey=citekey)
            bib_status = {
                "state": result.state,
                "doiVerified": result.doi_verified,
                "sources": result.sources,
                "fieldChanges": result.field_changes,
                "score": result.score,
                "note": result.note,
            }
            if result.proposed_type:
                bib_status["proposedType"] = result.proposed_type
            if result.state == "authenticated":
                bib_status["authenticatedAt"] = _now()
            # Honor type auto-conversion (only set when DOI-verified).
            effective_type = result.proposed_type or bib_entry["type"]
            if result.proposed_type:
                # @article → @incollection: journal becomes booktitle.
                if (bib_entry["type"] == "article"
                        and result.proposed_type == "incollection"
                        and "journal" in fields):
                    if "booktitle" not in fields:
                        fields["booktitle"] = fields["journal"]
                    fields.pop("journal", None)
                # any → @unpublished: drop publication-only fields.
                if result.proposed_type == "unpublished":
                    for k in ("journal", "booktitle", "volume", "number", "pages"):
                        fields.pop(k, None)
                bib_entry["type"] = effective_type
                log(f"  Bib type rewritten: {result.proposed_type}")
            # Merge field changes and write back to master.bib.
            if result.state in ("authenticated", "unverified", "manuscript", "failed"):
                if result.field_changes:
                    for fc in result.field_changes:
                        fields[fc["field"]] = fc["to"]
                # P15: title hygiene check post-merge — flag (don't reject)
                # junk titles that slipped through. Mutates `fields` in place
                # to apply normalizations (ALL-CAPS → title case, strip
                # trailing footnote markers).
                clean, reason = assert_title_clean(fields)
                if not clean:
                    log(f"  TITLE-SUSPECT: {reason}")
                    bib_status["titleSuspect"] = reason
                update_master_bib_entry(
                    library,
                    citekey,
                    effective_type,
                    fields,
                    bib_state=result.state,
                )
                log(f"  Updated master.bib ({len(result.field_changes)} field changes, state={result.state})")
            log(f"  bib state: {result.state}, score={result.score:.2f}, sources={result.sources}")
        except Exception as e:
            log(f"  bib auth FAILED: {e}")
            bib_status = {"state": "failed", "note": str(e)}

    return bib_status


def index_paper(citekey: str, library: Path, *, prefer_extractor: str = "auto",
                authenticate_bib: bool = True,
                fuse_pgmarks: bool = True,
                re_extract: bool = False) -> dict:
    log_lines: list[str] = []

    def log(msg: str) -> None:
        log_lines.append(f"[{_now()}] {msg}")
        print(msg, flush=True)

    log(f"Indexing {citekey} from {library}")

    # `resolve_paper_source` is THE spelling of "which file is this paper's
    # source" — the same probe `paper_has_holdings`, and therefore the F#4
    # write gate `admit_catalog_row`, answers with. Called directly rather
    # than through a private wrapper: this module used to keep its own copy
    # of the loop, which disagreed with the SSOT on the one case the SSOT was
    # widened for (a citekey with diacritics whose folder sits on disk under
    # the other Unicode normalization — the 1976-Tichy memo class) and
    # reported "no source" for a paper that is right there.
    #
    # Getting past this line ESTABLISHES holdings for `citekey`, which is what
    # entitles step 7's catalog write below to mint a row.
    _source = resolve_paper_source(library, citekey)
    if _source is None:
        raise FileNotFoundError(
            f"No source for {citekey} at "
            f"papers/{citekey}/{citekey}.{{{','.join(FORMAT_PRIORITY)}}}"
        )
    source_path, source_ext = _source
    log(f"Source: {source_path.name} (format={source_ext})")

    # The clobber door (task 800): refuse BEFORE the expensive extraction.
    check_main_tex_clobber(library, citekey, re_extract=re_extract)

    tools = detect()
    log("Tool detection:\n" + tools.summary())
    missing = tools.missing_required()
    if missing:
        raise RuntimeError(
            "Missing required tools: " + ", ".join(missing) +
            "\nInstall: pip install -r scripts/requirements.txt + brew install poppler"
        )
    if source_ext == "docx" and not tools.python_docx:
        raise RuntimeError(
            "python-docx is required to index .docx sources.\n"
            "Install: pip3 install --user --break-system-packages -r scripts/requirements.txt"
        )

    page_map: list[dict] = []
    layout_position: str = "unknown"
    if source_ext == "pdf":
        # 1. Classify scanned vs digital. Scanned PDFs REQUIRE ocrmypdf
        # — no longer optional. The eager-install model (/library/setup)
        # means ocrmypdf is expected to be present; if it isn't and the
        # PDF is scanned, fail loudly with the install command rather
        # than silently emitting a near-empty extraction.
        log("Step 1: classify scanned vs digital")
        cls = _classify_pdf(str(source_path))
        if cls["scanned"]:
            log(f"  Scanned PDF detected (fonts={cls['fonts']}, words={cls['word_count']})")
            if not tools.ocrmypdf:
                raise RuntimeError(
                    "Scanned PDF detected, but ocrmypdf is not installed.\n"
                    f"Source: {source_path.name}\n"
                    "Fix: run /library/setup  (installs ocrmypdf into the library)."
                )
            if not tools.tesseract:
                raise RuntimeError(
                    "Scanned PDF detected; ocrmypdf is installed but its "
                    "tesseract backend is missing.\n"
                    "Fix: brew install tesseract  (macOS) / "
                    "apt install tesseract-ocr  (Debian/Ubuntu)\n"
                    "Then re-run /library/setup to refresh the manifest."
                )
            backup_dir = paper_folder(library, citekey) / ".originals"
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup = backup_dir / f"{citekey}.pdf"
            if _ocr_if_needed(str(source_path), str(source_path) + ".ocr.tmp"):
                shutil.copy2(str(source_path), str(backup))
                shutil.move(str(source_path) + ".ocr.tmp", str(source_path))
                log(f"  Ran ocrmypdf — original backed up to {backup}")
            else:
                raise RuntimeError(
                    f"ocrmypdf failed on {source_path.name} "
                    "(returned non-zero or produced no output). "
                    "Check the ocrmypdf install and re-run."
                )
        else:
            log("  Digital PDF — no OCR needed.")

        # 2. Detect printed page numbers.
        log("Step 2: detect printed page numbers (pymupdf)")
        page_map, layout_info = detect_print_pages(str(source_path))
        layout_position = layout_info.get("position", "unknown")
        high = sum(1 for p in page_map if p["confidence"] == "high")
        log(f"  {high}/{len(page_map)} pages got high-confidence printed numbers")
        log(f"  pagination layout: {layout_position}")

        # 3. Extract structural blocks (uses layout for asymmetric stripping).
        # `library` flows through so marker's HF_HOME points at the
        # library-local cache (.virgil/models/huggingface/).
        log(f"Step 3: structural extraction (prefer={prefer_extractor})")
        extracted = extract_to_json(
            str(source_path), page_map,
            layout=layout_position,
            prefer=prefer_extractor,
            library=library,
        )
    elif source_ext == "tex":
        # TeX source: it's already LaTeX. The "extraction" is a passthrough
        # copy at step 5 below — no structural extractor runs and the
        # extractor field on the catalog row is set to "tex-passthrough".
        log("Step 1-3: skipped (.tex source — passthrough indexing)")
        extracted = {"extractor": "tex-passthrough", "blocks": []}
    else:
        # DOCX path: paragraph styles already carry structure, so OCR and
        # printed-page detection are skipped. There are no printed-page
        # anchors in DOCX — tex_emit.py omits \pgmark{} when print_page="".
        log("Step 1-2: skipped (DOCX source carries structure natively)")
        log("Step 3: structural extraction (docx-native)")
        extracted = extract_docx.extract_to_json(str(source_path))
    extractor_used = extracted["extractor"]
    log(f"  Extractor: {extractor_used}, blocks: {len(extracted['blocks'])}")

    # 4. Read .bib entry to get title/authors/year for emission.
    log("Step 4: read master.bib for metadata")
    # The one read door (task 621): NFC/NFD-folded, and a master.bib that
    # cannot be read raises rather than reading as "no entry".
    bib_entry = master_entry_for(library, citekey)
    if not bib_entry:
        raise KeyError(f"{citekey} not found in master.bib — add an entry before indexing")
    fields = bib_entry["fields"]
    title = fields.get("title", "")
    authors = fields.get("author", "")
    year = fields.get("year", "")
    log(f"  title={title!r}, authors={authors[:60]!r}, year={year!r}")

    # 5. Emit main.tex.
    paper_dir = paper_folder(library, citekey)
    paper_dir.mkdir(parents=True, exist_ok=True)
    pgmark_warnings: list[str] = []
    pgmark_report = None
    if re_extract:
        retired = retire_prior_extraction(library, citekey, _slug())
        if retired:
            log(f"Step 5: --re-extract — prior main.tex / deep-index baseline "
                f"backed up to {retired}")
    if source_ext == "tex":
        log("Step 5: copy .tex source as main.tex (passthrough)")
        shutil.copyfile(source_path, paper_dir / "main.tex")
        tex = (paper_dir / "main.tex").read_text(errors="replace")
    else:
        log("Step 5: emit main.tex")
        tex = emit(
            extracted["blocks"],
            title=title,
            authors=authors,
            year=year,
            page_map=page_map,
        )
        (paper_dir / "main.tex").write_text(tex)

        # 5b. Validate pgmark placement & continuity (non-gating).
        log("Step 5b: validate pgmark placement & continuity")
        pgmark_report = pgmark_validate(tex)
        pgmark_warnings = pgmark_report.to_warnings()
        if pgmark_warnings:
            log(f"  pgmark validation: {pgmark_report.summary_line()}")
        else:
            log("  pgmark validation: clean")

    # 5c. Auto-fuse pgmarks from a PDF alternate when primary is DOCX/TEX
    # and a PDF alternate exists. Failure here NEVER gates the index —
    # we record a warning and proceed.
    fuse_result: Optional[FuseResult] = None
    alts_for_fusion = _alternate_sources(library, citekey, source_ext)
    if fuse_pgmarks and source_ext in ("docx", "tex"):
        try:
            fuse_result = _fuse_pgmark_from_alternate(
                citekey, library, source_ext, alts_for_fusion, log_fn=log,
            )
        except Exception as e:
            log(f"  pgmark-fusion FAILED with exception: {e}")
            pgmark_warnings.append(f"{FUSION_FAILED_HEAD}: {e}")
        if fuse_result and fuse_result.success and fuse_result.pgmarks_inserted > 0:
            # Re-read main.tex (fusion wrote it) and re-validate.
            tex = (paper_dir / "main.tex").read_text()
            post_fuse_report = pgmark_validate(tex)
            pgmark_warnings = post_fuse_report.to_warnings()
            pgmark_report = post_fuse_report
        elif fuse_result and not fuse_result.success:
            pgmark_warnings.append(
                f"{FUSION_FAILED_HEAD}: {fuse_result.aborted_reason}"
            )

    # 6. Initialize empty Virgil sidecars.
    virgil_dir = paper_dir / "virgil"
    virgil_dir.mkdir(parents=True, exist_ok=True)
    if not (virgil_dir / "virgil.json").exists():
        (virgil_dir / "virgil.json").write_text('{"paragraphs": {}}\n')
    if not (virgil_dir / "notes.json").exists():
        (virgil_dir / "notes.json").write_text('{"notes": []}\n')
    if not (virgil_dir / "footnotes.json").exists():
        (virgil_dir / "footnotes.json").write_text('{"footnotes": []}\n')

    log(f"  Wrote {paper_dir}")

    # 7. Bib authentication (optional, may make external HTTP calls).
    if authenticate_bib:
        bib_status = _authenticate_master_entry(library, citekey, bib_entry,
                                                fields, log)
        title = fields.get("title", title)
        authors = fields.get("author", authors)
        year = fields.get("year", year)
    else:
        bib_status = _unauthenticated_bib_status(bib_entry)

    # 8. Stamp this paper's own row into references.bib (post-auth fields).
    # An UPSERT, not a re-emit: on a first index the file doesn't exist yet
    # and this creates the familiar single-entry mirror, but a RE-index of an
    # already-deep-indexed paper must not wipe the cited works
    # /library/clean-bibliography put there (task 168). A malformed existing
    # bib makes the splice unsafe — the writer refuses and leaves the file
    # untouched; log it and finish the index rather than dying at step 8 with
    # main.tex already on disk.
    try:
        write_paper_bib_entry(paper_dir, citekey, bib_entry["type"], fields)
    except BibSpliceRefused as e:
        log(f"  references.bib NOT updated: {e}")
        bib_status["referencesBibSkipped"] = str(e)

    # 8b. Work-identity duplicate check (post-auth, pre-catalog-write).
    # This is where the DOI is strongest (authenticate() may have just filled
    # or corrected it). If the library already holds this SAME work under a
    # DIFFERENT citekey, we do NOT want to mint a second first-class holdings
    # row: we flag `duplicateOf` on this row and append a duplicate-work inbox
    # notification naming the existing citekey. The extraction stays on disk
    # (nothing is deleted) so a human can reconcile. Closes the
    # greenberg2018content/greenberg2019content class. Lazy-import to avoid an
    # import cycle; any guard error degrades to "no duplicate" so indexing is
    # never blocked by the guard.
    duplicate_of: Optional[str] = None
    try:
        from dedup_index import find_work_in_library
        match = find_work_in_library(
            fields, bib_entry["type"], library,
            incoming_citekey=citekey,
            include_uncertain=False,   # only a hard `same`/alias flags a dup row
            exclude_ck=citekey,
        )
        # NFC-insensitive (the `citekey_matches` SSOT): a match whose key
        # differs from ours only by normalization form IS us, and flagging it
        # as a duplicate work would block the paper's own intake.
        if match is not None and not citekey_matches(match.citekey, citekey):
            duplicate_of = match.citekey
            log(f"  DUPLICATE-WORK: same work already held as {match.citekey!r} "
                f"(relation={match.relation}, conf={match.confidence:.2f})")
            append_inbox_item(library, {
                "kind": "duplicate-work",
                "citekey": citekey,
                "duplicateOf": match.citekey,
                "relation": match.relation,
                "confidence": match.confidence,
                "reasons": list(match.reasons),
                "at": _now(),
                "summary": (
                    f"{citekey} indexes the same work already held as "
                    f"{match.citekey} — flagged duplicateOf (extraction kept on disk)."
                ),
            })
    except Exception as e:
        log(f"  duplicate-work guard skipped: {e}")

    # 9. Update catalog.json.
    log("Step 7: update catalog.json")
    if source_ext == "pdf":
        page_count = _page_count(source_path)
        pgmark_count = len(set(p["print_page"] for p in page_map))
    else:
        # DOCX & TEX: no page metric and no printed-page anchors.
        page_count = 0
        pgmark_count = 0

    # If fusion injected pgmarks from a PDF alternate, override the
    # pgmark counters with the fusion result so the catalog row reflects
    # post-fusion reality.
    pgmark_source: Optional[str] = None
    if fuse_result and fuse_result.success and fuse_result.pgmarks_inserted > 0:
        pgmark_count = fuse_result.pgmarks_inserted
        layout_position = fuse_result.pgmark_position or layout_position
        pgmark_source = fuse_result.pgmark_source_filename

    source_status: dict = {
        "present": True,
        "filename": source_path.name,
        "sha256": _sha256(source_path),
        "format": source_ext,
    }
    if page_count:
        source_status["pageCount"] = page_count
    alts = alts_for_fusion if source_ext in ("docx", "tex") else _alternate_sources(library, citekey, source_ext)
    if alts:
        source_status["alternates"] = alts
        log(f"  Lower-priority sources kept on disk: {alts}")

    # Build the row update outside the lock; do the read-mutate-write
    # under `lock_catalog` so concurrent writers don't clobber each
    # other's row updates.
    indexed_block = {
        "state": "indexed",
        "lastIndexedAt": _now(),
        "extractor": extractor_used,
        "pgmarkCount": pgmark_count,
        "pgmarkPosition": layout_position,
        **({"pgmarkSource": pgmark_source} if pgmark_source else {}),
        "footnoteCount": sum(1 for b in extracted["blocks"] if b.get("kind") == "footnote"),
        "warnings": pgmark_warnings,
    }
    # The F#4 write gate, asked here as everywhere else. It answers True by
    # construction — step 1 resolved a source at exactly the path
    # `paper_has_holdings` scans — so this is not ceremony but the one case
    # where that construction can be false: a source removed while a long
    # marker extraction ran. Minting a holdings row for a file that is gone is
    # precisely what F#4 refuses, so say so rather than write it.
    if not admit_catalog_row(
        library, citekey,
        entry_type=bib_entry.get("type", "misc"), fields=fields,
        bib_state=bib_status.get("state", ""),
    ):
        raise FileNotFoundError(
            f"{citekey}: the source document disappeared during indexing "
            f"(expected papers/{citekey}/{citekey}.{source_ext}) — refusing "
            "to mint a catalog row for a paper that is no longer held."
        )
    with lock_catalog(library):
        catalog = read_catalog(library)
        prior_bib = next((e.get("bib") for e in catalog.get("entries", [])
                          if citekey_matches(e.get("citekey", ""), citekey)), None)
        # State read back from master.bib, history appended (task 797).
        run_changes = len(bib_status.get("fieldChanges") or [])
        bib_status = settle_catalog_bib(library, citekey, prior_bib, bib_status)
        entry = upsert_catalog_entry(
            catalog,
            citekey,
            title=title,
            authors=[a.strip() for a in authors.split(" and ") if a.strip()],
            year=int(year) if year.isdigit() else year,
            doi=fields.get("doi") or None,
            pdf=source_status,
            indexed=indexed_block,
            **({"duplicateOf": duplicate_of} if duplicate_of else {}),
        )
        entry["bib"] = bib_status
        write_catalog(library, catalog)

    # 10. Logs + notifications + version bump.
    log_dir = library / ".virgil" / "logs" / citekey
    log_dir.mkdir(parents=True, exist_ok=True)
    slug = _slug()
    (log_dir / f"{slug}-index.log").write_text("\n".join(log_lines) + "\n")
    pages_line = (
        f"- PDF pages: **{page_count}**\n" if source_ext == "pdf"
        else f"- Source: **{source_path.name}** (no printed-page anchors)\n"
    )
    summary = (
        f"# {citekey} — indexed {slug}\n\n"
        f"- Extractor: **{extractor_used}**\n"
        + pages_line +
        f"- Blocks emitted: **{len(extracted['blocks'])}**\n"
        f"- Bib auth: **{bib_status.get('state', '?')}** ({run_changes} field changes)\n"
        f"- Output: `papers/{citekey}/main.tex`\n"
    )
    (log_dir / f"{slug}-index.summary.md").write_text(summary)
    if pgmark_warnings and pgmark_report is not None:
        (log_dir / f"{slug}-pgmark-continuity.md").write_text(
            pgmark_report.to_markdown()
        )

    append_inbox_item(library, {
        "kind": "indexed",
        "citekey": citekey,
        "at": _now(),
        "summary": f"Indexed {citekey} ({extractor_used}, {len(extracted['blocks'])} blocks)",
    })

    log("Done.")
    return entry


def main() -> int:
    p = argparse.ArgumentParser(description="Index a single source (PDF or DOCX) in the Virgil Library.")
    p.add_argument("citekey", help="Citation key, matches papers/<citekey>/<citekey>.pdf or papers/<citekey>/<citekey>.docx")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument(
        "--extractor", choices=["auto", "marker", "pymupdf"], default="auto",
        help=("auto / marker (default): use marker-pdf (requires /library/setup). "
              "pymupdf: explicit fallback for debugging — loses equations, "
              "footnote zones, drop caps, and most layout. Never selected "
              "automatically."),
    )
    p.add_argument("--no-bib-auth", action="store_true",
                   help="Skip the .bib authentication HTTP calls")
    p.add_argument("--re-extract", action="store_true",
                   help="Replace a main.tex that holds deep-index work "
                        "(catalog deepIndexed, or a .virgil/baselines/ "
                        "snapshot). Without it the indexer refuses. The prior "
                        "main.tex and baseline are backed up to "
                        ".virgil/backups/re-extract/<citekey>/<ISO>/ first.")
    p.add_argument("--no-fuse-pgmarks", action="store_true",
                   help="Skip auto-fusion of pgmarks from a PDF alternate "
                        "when the primary source is DOCX or TEX.")
    args = p.parse_args()
    try:
        index_paper(
            args.citekey,
            Path(args.library).expanduser(),
            prefer_extractor=args.extractor,
            authenticate_bib=not args.no_bib_auth,
            fuse_pgmarks=not args.no_fuse_pgmarks,
            re_extract=args.re_extract,
        )
        return 0
    except Exception as e:
        if isinstance(e, ReExtractRequired):
            print(f"REFUSED: {e}", file=sys.stderr)   # a refusal, not a crash
        else:
            traceback.print_exc()
        # Append failure notification.
        try:
            append_inbox_item(Path(args.library).expanduser(), {
                "kind": "failed",
                "citekey": args.citekey,
                "at": _now(),
                "summary": f"Index failed: {e}",
            })
            bump_catalog_version(Path(args.library).expanduser())
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
