"""The relocate door, Python half (task 619).

`triage_apply` parked files with a bare `shutil.move(src, dir / filename)` —
a POSIX rename, which silently replaces a same-named earlier drop. Every park
now goes through `_tools.safe_move`, which never replaces anything.

Run: python3 library/scripts/tests/test_safe_move.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _tools  # noqa: E402
import triage_apply  # noqa: E402


# ── the door ─────────────────────────────────────────────────────────────

def test_safe_move_suffixes_instead_of_replacing(tmp_path):
    dst = tmp_path / "dst"
    dst.mkdir()
    (dst / "download.pdf").write_bytes(b"first")
    (dst / "download (2).pdf").write_bytes(b"second")
    src = tmp_path / "download.pdf"
    src.write_bytes(b"third")
    landed = _tools.safe_move(src, dst)
    assert landed == dst / "download (3).pdf"
    assert not src.exists()
    assert (dst / "download.pdf").read_bytes() == b"first"
    assert (dst / "download (2).pdf").read_bytes() == b"second"
    assert landed.read_bytes() == b"third"


def test_safe_move_plain_when_free_and_creates_dir(tmp_path):
    src = tmp_path / "a.docx"
    src.write_bytes(b"x")
    landed = _tools.safe_move(src, tmp_path / "new" / "dir")
    assert landed == tmp_path / "new" / "dir" / "a.docx"
    assert landed.read_bytes() == b"x" and not src.exists()


def test_safe_move_refuse_leaves_both(tmp_path):
    dst = tmp_path / "dst"
    dst.mkdir()
    (dst / "k.pdf").write_bytes(b"old")
    src = tmp_path / "k.pdf"
    src.write_bytes(b"new")
    try:
        _tools.safe_move(src, dst, on_collision="refuse")
    except _tools.RelocateCollision as e:
        assert e.dest == dst / "k.pdf"
    else:
        raise AssertionError("refuse mode replaced a file")
    assert src.read_bytes() == b"new"
    assert (dst / "k.pdf").read_bytes() == b"old"


def test_safe_move_falls_back_when_links_unsupported(tmp_path):
    def no_link(*_a, **_k):
        raise PermissionError("no hard links on this mount")

    real = _tools.os.link
    _tools.os.link = no_link
    try:
        dst = tmp_path / "dst"
        dst.mkdir()
        (dst / "f.txt").write_text("old")
        src = tmp_path / "f.txt"
        src.write_text("new")
        landed = _tools.safe_move(src, dst)
    finally:
        _tools.os.link = real
    assert landed.name == "f (2).txt" and landed.read_text() == "new"
    assert (dst / "f.txt").read_text() == "old" and not src.exists()


def test_safe_move_extensionless_and_directory(tmp_path):
    dst = tmp_path / "dst"
    (dst / "notes").mkdir(parents=True)
    src = tmp_path / "notes"
    src.mkdir()
    (src / "inner.txt").write_text("keep")
    landed = _tools.safe_move(src, dst)
    assert landed == dst / "notes (2)"
    assert (landed / "inner.txt").read_text() == "keep"
    assert (dst / "notes").is_dir()


# ── the callers: every triage park keeps both same-named drops ───────────

def _lib(tmp_path: Path) -> Path:
    (tmp_path / "unsorted").mkdir()
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _inbox(lib: Path) -> list[dict]:
    for p in (lib / ".virgil/notifications/inbox.json",
              lib / "notifications/inbox.json"):
        if p.exists():
            return json.loads(p.read_text())["items"]
    return []


def _drop_twice(lib: Path, row: dict, park_dir: Path) -> list[dict]:
    results = []
    for body in (b"first", b"second"):
        (lib / "unsorted" / "download.pdf").write_bytes(body)
        results.append(triage_apply.apply_row(dict(row), lib))
    assert (park_dir / "download.pdf").read_bytes() == b"first"
    assert (park_dir / "download (2).pdf").read_bytes() == b"second"
    assert not (lib / "unsorted" / "download.pdf").exists()
    assert "download (2).pdf" in results[1]["summary"], results[1]
    return results


def test_needs_title_park_keeps_both(tmp_path):
    lib = _lib(tmp_path)
    row = {"filename": "download.pdf", "flags": ["needs-title"],
           "proposedCitekey": "x2020"}
    _drop_twice(lib, row, lib / "unsorted" / "_pending")
    parked = [i["parkedAs"] for i in _inbox(lib) if i["kind"] == "triage-needs-title"]
    assert parked == ["unsorted/_pending/download.pdf",
                      "unsorted/_pending/download (2).pdf"]


def test_needs_metadata_quarantine_keeps_both(tmp_path):
    lib = _lib(tmp_path)
    row = {"filename": "download.pdf", "flags": ["needs-metadata"]}
    _drop_twice(lib, row, lib / "unsorted" / "_needs-metadata")
    parked = [i["parkedAs"] for i in _inbox(lib) if i["kind"] == "triage-needs-metadata"]
    assert parked[-1] == "unsorted/_needs-metadata/download (2).pdf"


def test_whole_handbook_park_keeps_both(tmp_path):
    lib = _lib(tmp_path)
    row = {"filename": "download.pdf", "flags": ["whole-handbook"]}
    _drop_twice(lib, row, lib / "unsorted" / "_pending")


def test_variant_copy_keeps_both(tmp_path):
    lib = _lib(tmp_path)
    row = {"filename": "download.pdf", "flags": ["variant-copy"],
           "existingCitekey": "smith2020"}
    _drop_twice(lib, row, lib / "papers" / "smith2020" / "variants")


def test_normal_flow_still_refuses_collision(tmp_path):
    lib = _lib(tmp_path)
    paper = lib / "papers" / "smith2020"
    paper.mkdir(parents=True)
    (paper / "smith2020.pdf").write_bytes(b"held")
    (lib / "master.bib").write_text(
        "@article{smith2020,\n  title = {T},\n  year = {2020},\n}\n")
    (lib / "unsorted" / "smith.pdf").write_bytes(b"dropped")
    result = triage_apply.apply_row({
        "filename": "smith.pdf", "extension": "pdf", "flags": [],
        "proposedCitekey": "smith2020", "proposedType": "article",
        "proposedFields": {"title": "T", "year": "2020"},
    }, lib)
    assert result["status"] == "collision", result
    assert (paper / "smith2020.pdf").read_bytes() == b"held"
    assert (lib / "unsorted" / "smith.pdf").read_bytes() == b"dropped"


def test_no_bare_move_onto_a_park_in_triage_apply():
    src = (SCRIPTS / "triage_apply.py").read_text()
    assert "shutil.move" not in src
    assert "os.replace" not in src and "os.rename" not in src


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
