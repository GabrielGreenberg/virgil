"""End-to-end indexer for a single source (PDF or DOCX) in the Virgil Library.

Usage:
  python index_paper.py <citekey> [--library ~/Virgil-Library]

Reads `pdfs/<citekey>.pdf` or `pdfs/<citekey>.docx`, runs the pipeline, writes:
  papers/<citekey>/main.tex
  papers/<citekey>/references.bib   (single-entry mirror of master.bib row)
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

# Make sibling scripts importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import detect
from pgmark import detect_print_pages
from pgmark_validate import validate as pgmark_validate
from extract import extract_to_json, _ocr_if_needed
import extract_docx
from tex_emit import emit
from bib_auth import authenticate, assert_title_clean


# Source-format priority. When more than one source file exists for a
# citekey (e.g., the user dropped a .docx alongside an existing .pdf),
# the FIRST one in this tuple wins — DOCX carries explicit structure
# (paragraph styles, headings, tables) that the PDF pipeline has to
# reverse-engineer with heuristics, so a Word source produces cleaner
# output and supersedes the PDF.
FORMAT_PRIORITY = ("docx", "pdf")
SUPPORTED_EXTS = FORMAT_PRIORITY


def _resolve_source(library: Path, citekey: str) -> tuple[Path, str]:
    """Find the source file for `citekey` and return (path, ext).

    Scans `pdfs/<citekey>.<ext>` in FORMAT_PRIORITY order; first hit wins.
    Lower-priority sources for the same citekey are left on disk as
    archives but are not used for indexing.

    The `pdfs/` directory keeps its name for backward compat — see CLAUDE.md.
    """
    for ext in FORMAT_PRIORITY:
        p = library / "pdfs" / f"{citekey}.{ext}"
        if p.exists():
            return p, ext
    raise FileNotFoundError(
        f"No source for {citekey} at pdfs/{citekey}.{{{','.join(FORMAT_PRIORITY)}}}"
    )


def _alternate_sources(library: Path, citekey: str, primary_ext: str) -> list[str]:
    """Return filenames of any same-citekey sources of *lower* priority
    than `primary_ext`. They sit on disk as archives — recorded in the
    catalog so the frontend can surface "also available as PDF/DOCX"."""
    alts: list[str] = []
    for ext in FORMAT_PRIORITY:
        if ext == primary_ext:
            continue
        p = library / "pdfs" / f"{citekey}.{ext}"
        if p.exists():
            alts.append(p.name)
    return alts


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")


def _read_master_bib(path: Path) -> dict[str, dict]:
    """Lightweight bib parser that returns {citekey: {type, fields, raw}}."""
    if not path.exists():
        return {}
    text = path.read_text()
    entries: dict[str, dict] = {}
    i = 0
    while i < len(text):
        if text[i] != "@":
            i += 1
            continue
        # Find type
        type_end = text.find("{", i)
        if type_end == -1:
            break
        entry_type = text[i + 1:type_end].strip().lower()
        # Find citekey
        key_end = text.find(",", type_end)
        if key_end == -1:
            break
        citekey = text[type_end + 1:key_end].strip()
        # Find matching closing brace
        depth = 1
        j = type_end + 1
        while j < len(text) and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        raw = text[i:j]
        # Parse fields with a simple state machine.
        body = text[key_end + 1:j - 1]
        fields = _parse_fields(body)
        entries[citekey] = {"type": entry_type, "fields": fields, "raw": raw}
        i = j
    return entries


def _parse_fields(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    while i < len(body):
        # Skip whitespace and commas.
        while i < len(body) and body[i] in " \t\n\r,":
            i += 1
        if i >= len(body):
            break
        # Field name = until '='
        eq = body.find("=", i)
        if eq == -1:
            break
        name = body[i:eq].strip().lower()
        i = eq + 1
        # Skip whitespace
        while i < len(body) and body[i] in " \t\n\r":
            i += 1
        if i >= len(body):
            break
        # Value: either {…} or "…" or bare-word
        if body[i] == "{":
            depth = 1
            j = i + 1
            while j < len(body) and depth > 0:
                if body[j] == "{":
                    depth += 1
                elif body[j] == "}":
                    depth -= 1
                j += 1
            out[name] = body[i + 1:j - 1].strip()
            i = j
        elif body[i] == '"':
            j = body.find('"', i + 1)
            if j == -1:
                break
            out[name] = body[i + 1:j].strip()
            i = j + 1
        else:
            j = i
            while j < len(body) and body[j] not in ",\n":
                j += 1
            out[name] = body[i:j].strip()
            i = j
    return out


def _emit_bib_entry(citekey: str, entry_type: str, fields: dict[str, str]) -> str:
    field_lines = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields.items() if v)
    return f"@{entry_type}{{{citekey},\n{field_lines}\n}}\n"


def _update_master_bib_entry(
    master_path: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
    bib_state: str = "",
) -> None:
    """Replace one entry in master.bib with updated fields.

    Finds the @type{citekey, ...} block, replaces it (and any preceding
    '% bib.state = ...' comment line) with a freshly emitted block.
    If the citekey is not found, appends at the end.
    """
    if not master_path.exists():
        master_path.write_text("")
    text = master_path.read_text()

    # Locate the @type{citekey, ...} block.
    import re
    pattern = re.compile(r"@\w+\s*\{\s*" + re.escape(citekey) + r"\s*,")
    m = pattern.search(text)

    replacement = ""
    if bib_state:
        replacement += f"% bib.state = {bib_state}\n"
    replacement += _emit_bib_entry(citekey, entry_type, fields)

    if m:
        entry_start = m.start()
        # Find matching closing brace from the opening brace.
        brace_pos = text.index("{", m.start())
        depth = 1
        j = brace_pos + 1
        while j < len(text) and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        entry_end = j

        # Check for a preceding "% bib.state = ..." comment line.
        # Find the start of the line the @ is on, then check the line before it.
        at_line_start = text.rfind("\n", 0, entry_start)
        if at_line_start == -1:
            at_line_start = 0
        else:
            at_line_start += 1
        prev_line_start = text.rfind("\n", 0, max(0, at_line_start - 1))
        if prev_line_start == -1:
            prev_line_start = 0
        else:
            prev_line_start += 1
        prev_line = text[prev_line_start:at_line_start].strip()
        if prev_line.startswith("% bib.state"):
            entry_start = prev_line_start

        text = text[:entry_start] + replacement + text[entry_end:]
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += "\n" + replacement

    master_path.write_text(text)


def _resync_references_bib(library: Path, citekey: str) -> bool:
    """Re-emit papers/<citekey>/references.bib from master.bib."""
    paper_dir = library / "papers" / citekey
    if not paper_dir.exists():
        return False
    master = _read_master_bib(library / "master.bib")
    entry = master.get(citekey)
    if not entry:
        return False
    (paper_dir / "references.bib").write_text(
        _emit_bib_entry(citekey, entry["type"], entry["fields"])
    )
    return True


def _sync_catalog_entry_from_master(library: Path, citekey: str,
                                    bib_status: dict) -> None:
    """Sync catalog.json top-level fields from master.bib so they can't drift."""
    master = _read_master_bib(library / "master.bib")
    entry = master.get(citekey)
    if not entry:
        return
    fields = entry["fields"]
    catalog = _read_catalog(library)
    authors_str = fields.get("author", "")
    authors = [a.strip() for a in authors_str.split(" and ") if a.strip()]
    year_raw = fields.get("year", "")
    year = int(year_raw) if year_raw.isdigit() else year_raw
    _upsert_entry(
        catalog, citekey,
        title=fields.get("title", ""),
        authors=authors,
        year=year,
        doi=fields.get("doi") or None,
        bib=bib_status,
    )
    _write_catalog(library, catalog)


def _append_notification(library: Path, item: dict) -> None:
    inbox_path = library / "notifications" / "inbox.json"
    inbox = {"items": []}
    if inbox_path.exists():
        try:
            inbox = json.loads(inbox_path.read_text())
        except Exception:
            pass
    inbox.setdefault("items", []).append(item)
    # Cap to last 200 items so it doesn't grow forever.
    inbox["items"] = inbox["items"][-200:]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(json.dumps(inbox, indent=2) + "\n")


def _bump_catalog_version(library: Path) -> None:
    p = library / "catalog-version.txt"
    cur = 0
    if p.exists():
        try:
            cur = int(p.read_text().strip() or "0")
        except Exception:
            cur = 0
    p.write_text(str(cur + 1) + "\n")


def _read_catalog(library: Path) -> dict:
    p = library / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"version": 1, "generatedAt": _now(), "entries": []}


def _write_catalog(library: Path, catalog: dict) -> None:
    catalog["generatedAt"] = _now()
    (library / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")


def _upsert_entry(catalog: dict, citekey: str, **fields) -> dict:
    for e in catalog.get("entries", []):
        if e.get("citekey") == citekey:
            e.update(fields)
            e["updatedAt"] = _now()
            return e
    e = {
        "citekey": citekey,
        "addedAt": _now(),
        "updatedAt": _now(),
        "pdf": {"present": False},
        "indexed": {"state": "none"},
        "bib": {"state": "none"},
        **fields,
    }
    catalog.setdefault("entries", []).append(e)
    return e


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


def index_paper(citekey: str, library: Path, *, prefer_extractor: str = "auto",
                authenticate_bib: bool = True) -> dict:
    log_lines: list[str] = []

    def log(msg: str) -> None:
        log_lines.append(f"[{_now()}] {msg}")
        print(msg, flush=True)

    log(f"Indexing {citekey} from {library}")

    source_path, source_ext = _resolve_source(library, citekey)
    log(f"Source: {source_path.name} (format={source_ext})")

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
        # 1. Classify scanned vs digital, OCR if needed.
        log("Step 1: classify scanned vs digital")
        backup_dir = library / "pdfs" / ".originals"
        if tools.ocrmypdf:
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup = backup_dir / f"{citekey}.pdf"
            if _ocr_if_needed(str(source_path), str(source_path) + ".ocr.tmp"):
                shutil.copy2(str(source_path), str(backup))
                shutil.move(str(source_path) + ".ocr.tmp", str(source_path))
                log(f"  Ran ocrmypdf — original backed up to {backup}")

        # 2. Detect printed page numbers.
        log("Step 2: detect printed page numbers (pymupdf)")
        page_map, layout_info = detect_print_pages(str(source_path))
        layout_position = layout_info.get("position", "unknown")
        high = sum(1 for p in page_map if p["confidence"] == "high")
        log(f"  {high}/{len(page_map)} pages got high-confidence printed numbers")
        log(f"  pagination layout: {layout_position}")

        # 3. Extract structural blocks (uses layout for asymmetric stripping).
        log(f"Step 3: structural extraction (prefer={prefer_extractor})")
        extracted = extract_to_json(str(source_path), page_map, layout=layout_position)
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
    master = _read_master_bib(library / "master.bib")
    bib_entry = master.get(citekey)
    if not bib_entry:
        raise KeyError(f"{citekey} not found in master.bib — add an entry before indexing")
    fields = bib_entry["fields"]
    title = fields.get("title", "")
    authors = fields.get("author", "")
    year = fields.get("year", "")
    log(f"  title={title!r}, authors={authors[:60]!r}, year={year!r}")

    # 5. Emit main.tex.
    log("Step 5: emit main.tex")
    tex = emit(
        extracted["blocks"],
        title=title,
        authors=authors,
        year=year,
        page_map=page_map,
    )
    paper_dir = library / "papers" / citekey
    paper_dir.mkdir(parents=True, exist_ok=True)
    (paper_dir / "main.tex").write_text(tex)

    # 5b. Validate pgmark placement & continuity (non-gating).
    log("Step 5b: validate pgmark placement & continuity")
    pgmark_report = pgmark_validate(tex)
    pgmark_warnings: list[str] = pgmark_report.to_warnings()
    if pgmark_warnings:
        log(f"  pgmark validation: {pgmark_report.summary_line()}")
    else:
        log("  pgmark validation: clean")

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
    bib_status: dict = {"state": "unverified"}
    if authenticate_bib:
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
                    title = fields.get("title", title)
                    authors = fields.get("author", authors)
                    year = fields.get("year", year)
                # P15: title hygiene check post-merge — flag (don't reject)
                # junk titles that slipped through. Mutates `fields` in place
                # to apply normalizations (ALL-CAPS → title case, strip
                # trailing footnote markers).
                clean, reason = assert_title_clean(fields)
                if not clean:
                    log(f"  TITLE-SUSPECT: {reason}")
                    bib_status["titleSuspect"] = reason
                    title = fields.get("title", title)
                _update_master_bib_entry(
                    library / "master.bib",
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

    # 8. Single-entry references.bib mirror (post-auth fields).
    (paper_dir / "references.bib").write_text(
        _emit_bib_entry(citekey, bib_entry["type"], fields)
    )

    # 9. Update catalog.json.
    log("Step 7: update catalog.json")
    catalog = _read_catalog(library)
    if source_ext == "pdf":
        page_count = _page_count(source_path)
        pgmark_count = len(set(p["print_page"] for p in page_map))
    else:
        page_count = 0  # DOCX: paragraph count is not equivalent to "pages"
        pgmark_count = 0

    source_status: dict = {
        "present": True,
        "filename": source_path.name,
        "sha256": _sha256(source_path),
        "format": source_ext,
    }
    if page_count:
        source_status["pageCount"] = page_count
    alts = _alternate_sources(library, citekey, source_ext)
    if alts:
        source_status["alternates"] = alts
        log(f"  Lower-priority sources kept on disk: {alts}")

    entry = _upsert_entry(
        catalog,
        citekey,
        title=title,
        authors=[a.strip() for a in authors.split(" and ") if a.strip()],
        year=int(year) if year.isdigit() else year,
        doi=fields.get("doi") or None,
        pdf=source_status,
        indexed={
            "state": "indexed",
            "lastIndexedAt": _now(),
            "extractor": extractor_used,
            "pgmarkCount": pgmark_count,
            "pgmarkPosition": layout_position,
            "footnoteCount": sum(1 for b in extracted["blocks"] if b.get("kind") == "footnote"),
            "warnings": pgmark_warnings,
        },
        bib=bib_status,
    )
    _write_catalog(library, catalog)

    # 10. Logs + notifications + version bump.
    log_dir = library / "logs" / citekey
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
        f"- Bib auth: **{bib_status.get('state', '?')}** ({len(bib_status.get('fieldChanges', []))} field changes)\n"
        f"- Output: `papers/{citekey}/main.tex`\n"
    )
    (log_dir / f"{slug}-index.summary.md").write_text(summary)
    if pgmark_warnings:
        (log_dir / f"{slug}-pgmark-continuity.md").write_text(
            pgmark_report.to_markdown()
        )

    _append_notification(library, {
        "kind": "indexed",
        "citekey": citekey,
        "at": _now(),
        "summary": f"Indexed {citekey} ({extractor_used}, {len(extracted['blocks'])} blocks)",
    })
    _bump_catalog_version(library)

    log("Done.")
    return entry


def main() -> int:
    p = argparse.ArgumentParser(description="Index a single source (PDF or DOCX) in the Virgil Library.")
    p.add_argument("citekey", help="Citation key, matches pdfs/<citekey>.pdf or pdfs/<citekey>.docx")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--extractor", choices=["auto", "marker", "pymupdf"], default="auto")
    p.add_argument("--no-bib-auth", action="store_true",
                   help="Skip the .bib authentication HTTP calls")
    args = p.parse_args()
    try:
        index_paper(
            args.citekey,
            Path(args.library).expanduser(),
            prefer_extractor=args.extractor,
            authenticate_bib=not args.no_bib_auth,
        )
        return 0
    except Exception as e:
        traceback.print_exc()
        # Append failure notification.
        try:
            _append_notification(Path(args.library).expanduser(), {
                "kind": "failed",
                "citekey": args.citekey,
                "at": _now(),
                "summary": f"Index failed: {e}",
            })
            _bump_catalog_version(Path(args.library).expanduser())
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
