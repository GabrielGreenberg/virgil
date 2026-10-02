"""Task 896 — every library script answers "where is the library?" through ONE door.

`_library_root.resolve_library_root` delegates to the editor silo's validated
`library_path.resolve_library`. Before it, ~31 scripts hand-rolled the answer
(env first or cwd first, the config file and folder pointer ignored, an
UNVALIDATED `~/Virgil-Library` fallback), so a user whose library is configured
elsewhere, running a skill from a paper folder, had writes land in a phantom
library.

These legs run the converted scripts as subprocesses with HOME pointed at a
scratch directory, so the real ~/.config and ~/Virgil-Library are never read.

Run: python3 library/scripts/tests/test_library_root_door.py [--standalone]
"""
from __future__ import annotations

import json
import os
import site
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import _library_root  # noqa: E402


def _make_library(root: Path) -> Path:
    (root / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (root / ".virgil" / "catalog.json").write_text('{"version": 1, "entries": []}\n')
    (root / "master.bib").write_text("")
    (root / "papers").mkdir(exist_ok=True)
    return root


def _world(tmp_path: Path, *, configured: bool) -> tuple[Path, Path, Path]:
    """(home, paper_dir, library) — a library configured ONLY via the config file."""
    home = tmp_path / "home"
    home.mkdir()
    lib = _make_library(tmp_path / "Elsewhere" / "MyLibrary")
    if configured:
        cfg = home / ".config" / "virgil" / "library-path.json"
        cfg.parent.mkdir(parents=True)
        cfg.write_text(json.dumps({"libraryRoot": str(lib), "version": 1}))
    paper = tmp_path / "paper"
    paper.mkdir()
    return home, paper, lib


def _env(home: Path) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "VIRGIL_LIBRARY_ROOT"}
    env["HOME"] = str(home)
    # Moving HOME also moves the user site-packages (where `requests` may
    # live); keep the real one importable.
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (site.getusersitepackages(), env.get("PYTHONPATH", "")) if p)
    return env


def _run(script: str, args: list[str], cwd: Path, home: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(_SCRIPTS / script), *args],
        cwd=str(cwd), env=_env(home), capture_output=True, text=True,
    )


def _spot_checks(tmp_path: Path) -> list[tuple[str, list[str]]]:
    item = tmp_path / "item.json"
    item.write_text(json.dumps({"kind": "failed", "citekey": "x", "at": "t",
                                "summary": "door probe"}))
    return [
        ("append_inbox_item.py", ["--item-file", str(item)]),
        ("bump_catalog_version.py", []),
        ("repair_etal_citekeys.py", ["--report", str(tmp_path / "rep.json")]),
        ("bib_auth.py", ["--citekey", "nokey2020"]),
        ("queue_slot.py", ["pending", "--count"]),
    ]


def test_configured_library_is_found_from_a_paper_folder(tmp_path):
    home, paper, lib = _world(tmp_path, configured=True)
    for script, args in _spot_checks(tmp_path):
        r = _run(script, args, paper, home)
        assert "No library" not in r.stderr, f"{script}: {r.stderr}"
        assert "Traceback" not in r.stderr, f"{script}: {r.stderr}"
        assert r.returncode in (0, 1), f"{script} rc={r.returncode}: {r.stderr}"
    inbox = json.loads((lib / ".virgil" / "notifications" / "inbox.json").read_text())
    assert [i["summary"] for i in inbox["items"]] == ["door probe"]
    assert (lib / ".virgil" / "catalog-version.txt").exists()
    assert not (home / "Virgil-Library").exists(), "wrote into a phantom library"


def test_nothing_configured_refuses_and_writes_nothing(tmp_path):
    home, paper, _lib = _world(tmp_path, configured=False)
    for script, args in _spot_checks(tmp_path):
        r = _run(script, args, paper, home)
        assert r.returncode != 0, f"{script} guessed a library: {r.stdout}"
        assert "Traceback" not in r.stderr, f"{script}: {r.stderr}"
        assert "library" in r.stderr.lower() and "not a valid library" in r.stderr, \
            f"{script}: {r.stderr}"
    assert not (home / "Virgil-Library").exists()
    assert list(paper.iterdir()) == [], "a refusal wrote into the cwd"


def test_an_unvalidated_home_default_is_not_a_library(tmp_path):
    """A bare ~/Virgil-Library (no catalog, no scripts) is not an answer."""
    home, paper, _lib = _world(tmp_path, configured=False)
    (home / "Virgil-Library").mkdir()
    r = _run("bump_catalog_version.py", [], paper, home)
    assert r.returncode != 0
    assert not (home / "Virgil-Library" / ".virgil").exists()


def test_cwd_library_beats_a_pointer_elsewhere(tmp_path):
    home, _paper, lib = _world(tmp_path, configured=True)
    here = _make_library(tmp_path / "HereLibrary")
    r = _run("bump_catalog_version.py", [], here, home)
    assert r.returncode == 0, r.stderr
    assert (here / ".virgil" / "catalog-version.txt").exists()
    assert not (lib / ".virgil" / "catalog-version.txt").exists()


def test_an_explicit_flag_that_is_not_a_library_refuses(tmp_path):
    """`--library` is the whole answer — it never falls through to the config."""
    home, paper, lib = _world(tmp_path, configured=True)
    r = _run("bump_catalog_version.py", ["--library", str(tmp_path / "typo")], paper, home)
    assert r.returncode != 0
    assert "not a valid library" in r.stderr
    assert not (lib / ".virgil" / "catalog-version.txt").exists()


def test_degraded_door_still_validates(tmp_path):
    """Without the editor silo the door states a smaller chain, same validation."""
    lib = _make_library(tmp_path / "lib")
    saved, cwd = _library_root._load_ssot, Path.cwd()
    _library_root._load_ssot = lambda: None
    try:
        os.chdir(lib)
        assert _library_root.resolve_library_root() == lib.resolve()
        os.chdir(tmp_path)
        try:
            _library_root.resolve_library_root(str(tmp_path / "nope"))
        except _library_root.LibraryNotFound as e:
            assert "not a valid library" in str(e)
        else:
            raise AssertionError("degraded door accepted a non-library")
    finally:
        _library_root._load_ssot = saved
        os.chdir(cwd)


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
