"""A Library manual bib edit is a DIFF against a named base (task 763).

The "Edit entry" modal used to queue a WHOLE entry, and `/library/apply-bib-edit`
applied it with `--allow-field-drop` — so every field the modal did not carry
(one `/library/authenticate-bib` added while the modal was open or the edit sat
queued) was deleted. Now the modal queues `{type, baseType, set, remove,
baseRaw}` and the skill runs the shim with `--merge-existing`, one `--drop-field`
per removal, and `--base-raw-file` / `--base-type`: fields nobody named survive
by construction, and a named field that moved on disk since the base is HELD
(exit 5) instead of overwritten.

Run: python3 library/scripts/tests/test_bib_edit_base_check.py
(pytest when installed, the shared `_standalone` runner otherwise).
"""
import json
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _tools import read_master_bib  # noqa: E402

_SHIM = str(_SCRIPTS / "update_master_bib_entry.py")

# What the modal opened on.
_BASE = """@article{smith2020,
  author = {Smith, John},
  title = {An Exmaple Paper},
  year = {2020},
  keywords = {annotation}
}
"""

# What is on disk by the time the edit applies: an auth pass added a doi.
_DISK = """@article{smith2020,
  author = {Smith, John},
  title = {An Exmaple Paper},
  year = {2020},
  keywords = {annotation},
  doi = {10.1234/example.2020}
}
"""


def _lib(tmp_path: Path, bib: str = _DISK) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text(bib)
    (tmp_path / "_base.bib").write_text(_BASE)
    return tmp_path


def _apply(lib: Path, set_: dict, remove=(), *, type_="article",
           base_type="article", base=True) -> subprocess.CompletedProcess:
    ff = lib / "_set.json"
    ff.write_text(json.dumps(set_))
    cmd = [sys.executable, _SHIM, "smith2020", "--entry-type", type_,
           "--fields-file", str(ff), "--merge-existing", "--library", str(lib)]
    for k in remove:
        cmd += ["--drop-field", k]
    if base:
        cmd += ["--base-raw-file", str(lib / "_base.bib"), "--base-type", base_type]
    return subprocess.run(cmd, capture_output=True, text=True)


def _entry(lib: Path) -> dict:
    return read_master_bib(lib / "master.bib")["smith2020"]


def test_field_added_since_base_survives_an_edit(tmp_path):
    """The reported loss: fixing the title must not delete the new doi."""
    lib = _lib(tmp_path)
    r = _apply(lib, {"title": "An Example Paper"})
    assert r.returncode == 0, r.stderr
    f = _entry(lib)["fields"]
    assert f["title"] == "An Example Paper"
    assert f["doi"] == "10.1234/example.2020"
    assert f["keywords"] == "annotation"


def test_removed_field_is_removed(tmp_path):
    """✕ on a custom row reaches the file as a named removal."""
    lib = _lib(tmp_path)
    r = _apply(lib, {}, remove=["keywords"])
    assert r.returncode == 0, r.stderr
    f = _entry(lib)["fields"]
    assert "keywords" not in f
    assert f["doi"] == "10.1234/example.2020"


def test_set_on_a_field_changed_on_disk_is_held(tmp_path):
    lib = _lib(tmp_path, _DISK.replace("An Exmaple Paper", "An Example Paper, Revised"))
    r = _apply(lib, {"title": "An Example Paper", "year": "2021"})
    assert r.returncode == 5, r.stderr
    assert "title" in r.stderr
    f = _entry(lib)["fields"]
    assert f["title"] == "An Example Paper, Revised"   # newer disk value kept
    assert f["year"] == "2021"                          # the rest still lands


def test_remove_of_a_field_changed_on_disk_is_held(tmp_path):
    lib = _lib(tmp_path, _DISK.replace("{annotation}", "{annotation, marginalia}"))
    r = _apply(lib, {}, remove=["keywords"])
    assert r.returncode == 5, r.stderr
    assert "keywords" in r.stderr
    assert _entry(lib)["fields"]["keywords"] == "annotation, marginalia"


def test_edit_matching_the_disk_is_no_conflict(tmp_path):
    lib = _lib(tmp_path, _DISK.replace("An Exmaple Paper", "An Example Paper"))
    r = _apply(lib, {"title": "An Example Paper"})
    assert r.returncode == 0, r.stderr


def test_unchanged_type_keeps_the_type_on_disk(tmp_path):
    lib = _lib(tmp_path, _DISK.replace("@article", "@incollection"))
    r = _apply(lib, {"year": "2021"})
    assert r.returncode == 0, r.stderr
    assert _entry(lib)["type"] == "incollection"


def test_type_change_against_a_moved_type_is_held(tmp_path):
    lib = _lib(tmp_path, _DISK.replace("@article", "@incollection"))
    r = _apply(lib, {}, type_="book")
    assert r.returncode == 5, r.stderr
    assert _entry(lib)["type"] == "incollection"


def test_type_change_lands(tmp_path):
    lib = _lib(tmp_path)
    r = _apply(lib, {}, type_="book")
    assert r.returncode == 0, r.stderr
    assert _entry(lib)["type"] == "book"


def test_base_check_requires_merge_and_an_existing_entry(tmp_path):
    lib = _lib(tmp_path, "")
    r = _apply(lib, {"title": "X"})
    assert r.returncode == 2
    assert "no longer in master.bib" in r.stderr


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
