"""Regression guard for task 1469 — a re-index writes its OWNED keys, not a patch.

`index_paper.py` re-observes the source on every run, but it used to hand its
fresh `pdf` / `indexed` blocks to `upsert_catalog_entry`, whose deep-merge is a
PATCH channel. That was wrong in both directions:

  1. keys this pass no longer produced SURVIVED — a re-extract with no fusion
     kept `indexed.pgmarkSource`, a source with no page count kept
     `pdf.pageCount`, removed alternates kept `pdf.alternates`, and the
     deep-index stamp `indexed.exampleCount` outlived the text it counted; and
  2. `indexed.warnings` is a list, so the fresh pgmark lines REPLACED the whole
     array — including the operator's verified `<kind>-false-positive:`
     suppressions and every other pass's kinds.

The fix declares the indexer's keys once (`INDEX_PAPER_PDF_KEYS`,
`INDEX_PAPER_INDEXED_KEYS`) and writes through `replace_owned_keys` (set or
pop each owned key, never touch another) plus the per-kind warnings door
(`merge_indexed_warnings` over `index_warning_kinds()`).

What these tests pin:

  A. `replace_owned_keys` sets, pops, preserves, and refuses a stray key;
  B. `write_index_row` clears stale owned keys, keeps unowned ones, recomputes
     only the declared warning kinds, and refuses an undeclared fresh head;
  C. end-to-end through `index_paper --re-extract`: the task's own scenario;
  D. the deep-index step-5 vocabulary in `_tools.py` matches the skill's own
     patch block and `--recompute-warning-kind` flags (so neither drifts).

Run: python3 library/scripts/tests/test_reindex_owned_keys.py
"""

from __future__ import annotations

import json
import re
import sys
from contextlib import contextmanager
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import index_paper as ip  # noqa: E402
from _tools import (  # noqa: E402
    DEEP_INDEX_STEP5_INDEXED_KEYS,
    DEEP_INDEX_STEP5_WARNING_KINDS,
    read_catalog,
    replace_owned_keys,
    update_master_bib_entry,
    write_catalog,
)

CK = "doe1950work"
SOURCE_TEX = "\\documentclass{article}\n\\begin{document}\nRAW SOURCE\n\\end{document}\n"
DEEP_INDEX_MD = _SCRIPTS.parent / "skills" / "deep-index.md"

SUPPRESSION = "pgmark-gap-false-positive: 12→14 (verified plate)"
FOREIGN = "missing-bib-entry: Smith 1990"


def _stale_row() -> dict:
    return {
        "citekey": CK,
        "pdf": {
            "present": True, "filename": f"{CK}.pdf", "sha256": "old",
            "format": "pdf", "pageCount": 30, "alternates": [f"{CK}.docx"],
        },
        "indexed": {
            "state": "deepIndexed", "extractor": "marker",
            "pgmarkCount": 30, "pgmarkPosition": "footer",
            "pgmarkSource": "alt.pdf", "footnoteCount": 9,
            "exampleCount": 14,
            "warnings": [
                "pgmark-gap: 3→5",
                SUPPRESSION,
                FOREIGN,
                "pgmark-fusion-low-alignment-skipped: pages 4,7",
                "examples-not-converted: §2 table",
            ],
        },
        "bib": {"state": "authenticated"},
        "isScanned": False,
    }


# ── A. replace_owned_keys ─────────────────────────────────────────────


def test_replace_owned_keys_sets_pops_and_preserves():
    block = {"a": 1, "b": 2, "foreign": "keep"}
    replace_owned_keys(block, ("a", "b", "c"), {"a": 10, "c": 3})
    assert block == {"a": 10, "c": 3, "foreign": "keep"}


def test_replace_owned_keys_refuses_an_undeclared_fresh_key():
    try:
        replace_owned_keys({}, ("a",), {"a": 1, "z": 2})
    except ValueError as e:
        assert "z" in str(e)
    else:
        raise AssertionError("a fresh key outside the owned set was written")


# ── B. write_index_row ────────────────────────────────────────────────


def test_write_index_row_clears_stale_owned_keys_and_keeps_the_rest():
    row = _stale_row()
    fresh_pdf = {"present": True, "filename": f"{CK}.tex", "sha256": "new",
                 "format": "tex"}
    fresh_indexed = {"state": "indexed", "lastIndexedAt": "now",
                     "extractor": "tex-passthrough", "pgmarkCount": 0,
                     "pgmarkPosition": "unknown", "footnoteCount": 0}
    ip.write_index_row(row, pdf=fresh_pdf, indexed=fresh_indexed,
                       warnings=["pgmark-gap: 8→10"])
    assert row["pdf"] == fresh_pdf
    ind = row["indexed"]
    for k in ("pgmarkSource", "exampleCount"):
        assert k not in ind, k
    assert ind["state"] == "indexed"
    assert ind["warnings"] == [SUPPRESSION, FOREIGN, "pgmark-gap: 8→10"]
    assert row["bib"] == {"state": "authenticated"}
    assert row["isScanned"] is False


def test_write_index_row_refuses_an_undeclared_warning_head():
    try:
        ip.write_index_row(_stale_row(), pdf={}, indexed={},
                           warnings=["pgmark-gapp: typo"])
    except ValueError as e:
        assert "pgmark-gapp" in str(e)
    else:
        raise AssertionError("an undeclared head would never be cleared")


def test_index_warning_kinds_cover_the_validator_and_fusion_families():
    kinds = set(ip.index_warning_kinds())
    from fuse_alternate import fusion_warning_heads
    from pgmark_validate import CONTINUITY_FINDING_KINDS, SCOPE_WARNING_HEAD
    assert SCOPE_WARNING_HEAD in kinds
    assert {f"pgmark-{k}" for k in CONTINUITY_FINDING_KINDS} <= kinds
    assert set(fusion_warning_heads()) <= kinds
    assert set(DEEP_INDEX_STEP5_WARNING_KINDS) <= kinds
    # Suppressions and other passes' kinds are never declared.
    assert not any(k.endswith("-false-positive") for k in kinds)
    assert "missing-bib-entry" not in kinds


# ── C. end-to-end re-extract ──────────────────────────────────────────


class _Tools:
    python_docx = True

    def summary(self) -> str:
        return "(stubbed)"

    def missing_required(self) -> list:
        return []


@contextmanager
def _stub_tool_detection():
    real = ip.detect
    ip.detect = lambda: _Tools()
    try:
        yield
    finally:
        ip.detect = real


def test_re_extract_leaves_the_row_describing_the_new_extraction(tmp_path):
    lib = tmp_path
    (lib / ".virgil").mkdir(parents=True, exist_ok=True)
    (lib / "master.bib").write_text("")
    update_master_bib_entry(
        lib, CK, "book",
        {"title": "A Work", "author": "Doe, Jane", "year": "1950"},
        bib_state="authenticated")
    d = lib / "papers" / CK
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{CK}.tex").write_text(SOURCE_TEX)
    (d / "main.tex").write_text("DEEP\n")
    write_catalog(lib, {"version": 1, "entries": [_stale_row()]})

    with _stub_tool_detection():
        ip.index_paper(CK, lib, authenticate_bib=False,
                       fuse_pgmarks=False, re_extract=True)

    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == CK)
    pdf, ind = row["pdf"], row["indexed"]
    assert pdf["format"] == "tex" and pdf["filename"] == f"{CK}.tex"
    assert "pageCount" not in pdf, pdf
    assert "alternates" not in pdf, pdf
    assert "pgmarkSource" not in ind, ind
    assert "exampleCount" not in ind, ind
    assert ind["state"] == "indexed"
    # The suppression and the other pass's kind survive; every line of a
    # kind this extraction recomputed (pgmark, fusion, step-5) is gone.
    assert ind["warnings"] == [SUPPRESSION, FOREIGN], ind["warnings"]


# ── D. parity with deep-index.md step 5 ───────────────────────────────


def _step5_section() -> str:
    text = DEEP_INDEX_MD.read_text()
    start = text.index("### 5. Update catalog")
    end = text.index("### 6.", start)
    return text[start:end]


def test_step5_warning_kinds_match_the_skill_bash_block():
    flags = re.findall(r"--recompute-warning-kind\s+([a-z][a-z0-9-]*)",
                       _step5_section())
    assert flags, "deep-index.md step 5 declares no --recompute-warning-kind"
    assert tuple(flags) == DEEP_INDEX_STEP5_WARNING_KINDS, flags


def test_step5_indexed_keys_match_the_skill_patch_block():
    m = re.search(r"cat > \"\$t/patch\.json\" <<'EOF'\n(.*?)\nEOF",
                  _step5_section(), re.S)
    assert m, "deep-index.md step 5 has no patch.json heredoc"
    body = re.sub(r"<[^>]*>", "0", m.group(1))  # placeholders → JSON
    patch = json.loads(body)
    keys = set(patch["indexed"]) - {"warnings"}
    # The step-5 keys the indexer does not itself produce are exactly the
    # ones a re-index must retire.
    indexer_own = set(ip.INDEX_PAPER_INDEXED_KEYS) - set(DEEP_INDEX_STEP5_INDEXED_KEYS)
    assert keys - indexer_own == set(DEEP_INDEX_STEP5_INDEXED_KEYS), keys
    # And every key either patch carries is one the indexer clears or sets.
    assert keys <= set(ip.INDEX_PAPER_INDEXED_KEYS), keys


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
