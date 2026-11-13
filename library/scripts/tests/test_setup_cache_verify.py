"""/library/setup's cache verdict comes from setup.py (task 1603).

The skill used to hand-check ONE cache (`huggingface/`, ~1 GB) and ONE
global default (`~/.cache/huggingface`) — but marker's bulk is surya's
`datalab/` cache (~3 GB), whose global default is
`~/Library/Caches/datalab`. setup.py now measures both caches and every
global default, and the skill reads that output.

Run: python3 library/scripts/tests/test_setup_cache_verify.py
"""
from __future__ import annotations

import json
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import setup  # noqa: E402


def _lib(tmp_path: Path) -> Path:
    lib = tmp_path / "lib"
    (lib / ".virgil" / "models" / "huggingface").mkdir(parents=True)
    (lib / ".virgil" / "models" / "datalab").mkdir(parents=True)
    return lib


def _write(path: Path, n: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * n)


def test_both_caches_reported_and_empty_dirs_are_not_populated(tmp_path):
    lib = _lib(tmp_path)
    home = tmp_path / "home"
    _write(lib / ".virgil/models/huggingface/hub/m.bin", 10)
    v = setup.verify_caches(lib, home=home, env={})
    by = {c["name"]: c for c in v["caches"]}
    assert set(by) == {"huggingface", "datalab"}
    assert by["huggingface"]["populated"] and by["huggingface"]["bytes"] == 10
    # ensure_model_env mkdirs datalab/, so existence alone must not pass.
    assert not by["datalab"]["populated"]
    assert v["allPopulated"] is False


def test_all_populated_when_datalab_holds_weights(tmp_path):
    lib = _lib(tmp_path)
    _write(lib / ".virgil/models/huggingface/a", 1)
    _write(lib / ".virgil/models/datalab/models/layout/2025/w.safetensors", 5)
    v = setup.verify_caches(lib, home=tmp_path / "home", env={})
    assert v["allPopulated"] is True
    assert v["globalPollution"] == []


def test_pollution_in_macos_datalab_default_is_caught(tmp_path):
    lib = _lib(tmp_path)
    home = tmp_path / "home"
    _write(home / "Library/Caches/datalab/models/ocr/w", 7)
    v = setup.verify_caches(lib, home=home, env={})
    assert [(g["name"], g["bytes"]) for g in v["globalPollution"]] == [("datalab", 7)]


def test_pollution_in_huggingface_and_xdg_defaults_is_caught(tmp_path):
    lib = _lib(tmp_path)
    home = tmp_path / "home"
    xdg = tmp_path / "xdg"
    _write(xdg / "huggingface/hub/m", 3)
    _write(xdg / "datalab/models/m", 4)
    v = setup.verify_caches(lib, home=home, env={"XDG_CACHE_HOME": str(xdg)})
    got = sorted((g["name"], g["path"]) for g in v["globalPollution"])
    assert got == [("datalab", str(xdg / "datalab")),
                   ("huggingface", str(xdg / "huggingface"))]


def test_global_defaults_name_both_datalab_spellings(tmp_path):
    home = tmp_path / "home"
    d = setup.global_cache_defaults(home, {})
    assert d["huggingface"] == [home / ".cache/huggingface"]
    assert d["datalab"] == [home / "Library/Caches/datalab", home / ".cache/datalab"]


def test_verify_only_json_cli(tmp_path):
    lib = _lib(tmp_path)
    _write(lib / ".virgil/models/huggingface/a", 1)
    _write(lib / ".virgil/models/datalab/b", 1)
    buf = StringIO()
    with redirect_stdout(buf):
        rc = setup._main([str(lib), "--verify-only", "--json"])
    out = json.loads(buf.getvalue())
    assert {c["name"] for c in out["caches"]} == {"huggingface", "datalab"}
    assert "globalPollution" in out
    assert rc == 0


def test_verify_only_text_names_both_caches_and_fails_when_empty(tmp_path):
    lib = _lib(tmp_path)
    buf = StringIO()
    with redirect_stdout(buf):
        rc = setup._main([str(lib), "--verify-only"])
    text = buf.getvalue()
    assert "CACHE huggingface: EMPTY" in text
    assert "CACHE datalab: EMPTY" in text
    assert rc == 1


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
