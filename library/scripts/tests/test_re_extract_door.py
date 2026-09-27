"""The main.tex clobber door — `index_paper.py --re-extract` (task 800).

`_doctrine.md` told every deep-index-family skill to run
`/library/index-paper <citekey> --re-extract` on a pre-marker paper. The flag
did not exist, and `index_paper.py` wrote main.tex unconditionally — so an
agent that hit the argparse error and dropped the flag replaced a
deep-indexed main.tex (all prose/footnote/bib repair) with a raw extraction.

The rule now: past plain `indexed` (catalog `deepIndexed`, or a deep-index
baseline on disk), an existing main.tex is overwritten ONLY under
`--re-extract`, which backs the prior text up and retires the baseline.

Run: python3 library/scripts/tests/test_re_extract_door.py
"""
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import index_paper as ip  # noqa: E402
from _tools import (  # noqa: E402
    deep_index_baseline_path,
    read_catalog,
    update_master_bib_entry,
    write_catalog,
)

CK = "doe1950work"
DEEP_TEX = "\\documentclass{article}\n\\begin{document}\nDEEP-INDEXED PROSE\n\\end{document}\n"
SOURCE_TEX = "\\documentclass{article}\n\\begin{document}\nRAW SOURCE\n\\end{document}\n"


def _lib(tmp_path: Path, *, state: str | None, baseline: bool = False) -> Path:
    """A library holding CK as a `.tex` source (passthrough — no extractor
    needed) with a deep-indexed main.tex already on disk."""
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    update_master_bib_entry(
        tmp_path, CK, "book",
        {"title": "A Work", "author": "Doe, Jane", "year": "1950"},
        bib_state="authenticated")
    d = tmp_path / "papers" / CK
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{CK}.tex").write_text(SOURCE_TEX)
    (d / "main.tex").write_text(DEEP_TEX)
    entries = []
    if state is not None:
        entries.append({"citekey": CK, "indexed": {"state": state, "extractor": "pymupdf"},
                        "bib": {"state": "authenticated"}, "pdf": {"present": True}})
    write_catalog(tmp_path, {"version": 1, "entries": entries})
    if baseline:
        b = deep_index_baseline_path(tmp_path, CK)
        b.parent.mkdir(parents=True, exist_ok=True)
        b.write_text("OLD BASELINE\n")
    return tmp_path


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


def _run(lib: Path, *, re_extract: bool):
    with _stub_tool_detection():
        return ip.index_paper(CK, lib, authenticate_bib=False,
                              fuse_pgmarks=False, re_extract=re_extract)


def _main_tex(lib: Path) -> str:
    return (lib / "papers" / CK / "main.tex").read_text()


# ── The refusal ─────────────────────────────────────────────────────


def test_deep_indexed_row_without_re_extract_refuses_and_leaves_main_tex(tmp_path):
    lib = _lib(tmp_path, state="deepIndexed")
    before = (lib / "papers" / CK / "main.tex").read_bytes()
    try:
        _run(lib, re_extract=False)
    except ip.ReExtractRequired as e:
        assert "--re-extract" in str(e)
    else:
        raise AssertionError("index_paper overwrote a deep-indexed main.tex")
    assert (lib / "papers" / CK / "main.tex").read_bytes() == before
    assert not (lib / ".virgil" / "backups").exists()


def test_legacy_rich_indexed_state_is_also_protected(tmp_path):
    lib = _lib(tmp_path, state="richIndexed")
    try:
        _run(lib, re_extract=False)
    except ip.ReExtractRequired:
        pass
    else:
        raise AssertionError("richIndexed is the legacy deepIndexed spelling")
    assert _main_tex(lib) == DEEP_TEX


def test_a_baseline_alone_protects_a_paper_whose_state_never_flipped(tmp_path):
    # A deep-index pass that crashed after baselining but before stamping
    # `deepIndexed` has still modified main.tex.
    lib = _lib(tmp_path, state="indexed", baseline=True)
    try:
        _run(lib, re_extract=False)
    except ip.ReExtractRequired as e:
        assert "baseline" in str(e)
    else:
        raise AssertionError("a deep-index baseline must protect main.tex")
    assert _main_tex(lib) == DEEP_TEX


def test_plain_indexed_paper_re_indexes_as_before(tmp_path):
    # Nothing past extraction on disk → the ordinary idempotent re-index.
    lib = _lib(tmp_path, state="indexed")
    _run(lib, re_extract=False)
    assert _main_tex(lib) == SOURCE_TEX


# ── The explicit re-extract ─────────────────────────────────────────


def test_re_extract_backs_up_replaces_and_retires_the_baseline(tmp_path):
    lib = _lib(tmp_path, state="deepIndexed", baseline=True)
    entry = _run(lib, re_extract=True)
    assert _main_tex(lib) == SOURCE_TEX
    backups = list((lib / ".virgil" / "backups" / "re-extract" / CK).iterdir())
    assert len(backups) == 1
    assert (backups[0] / "main.tex").read_text() == DEEP_TEX
    assert (backups[0] / f"{CK}-pre-deepindex.tex").read_text() == "OLD BASELINE\n"
    # Retired: the next deep-index must baseline the NEW extraction.
    assert not deep_index_baseline_path(lib, CK).exists()
    # The row is plain `indexed` again, and names the extractor that ran.
    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == CK)
    assert row["indexed"]["state"] == "indexed"
    assert row["indexed"]["extractor"] == "tex-passthrough"
    assert entry["indexed"]["extractor"] == "tex-passthrough"


# ── The CLI ─────────────────────────────────────────────────────────


def test_cli_declares_re_extract():
    r = subprocess.run([sys.executable, str(_SCRIPTS / "index_paper.py"), "--help"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "--re-extract" in r.stdout


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
