"""Task 798 — merge-bibs run state lives in a FILE, and the postflight fails closed.

An agent's Bash tool keeps neither exported variables nor cwd between calls,
and merge-bibs' steps are separated by subagent waves. So:

  * the preflight records the parsed args + batch policy + snapshot dir in a
    run-state JSON and a sourceable `.env`, and a SEPARATE shell that sources
    it sees the values;
  * the postflight refuses an empty / bogus snapshot dir (it used to resolve
    "" to cwd = the library, compare master.bib with itself, and say clean);
  * the skill text never hands a value between fenced blocks via the shell.

Run: python3 -m pytest library/scripts/tests/test_merge_bibs_run_state.py -v
"""
import contextlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import merge_bibs_postflight as postflight  # noqa: E402
import merge_bibs_preflight as preflight  # noqa: E402

SKILL = _SCRIPTS.parent / "skills" / "merge-bibs.md"

MASTER_2 = "@article{a,\n  title={A},\n}\n@article{b,\n  title={B},\n}\n"
MASTER_1 = "@article{a,\n  title={A},\n}\n"


def _library(root: Path, master: str) -> Path:
    (root / ".virgil").mkdir(parents=True, exist_ok=True)
    (root / "master.bib").write_text(master)
    (root / ".virgil" / "catalog.json").write_text(json.dumps({"entries": []}))
    return root


@contextlib.contextmanager
def _isolated_preflight(backups: Path):
    """Snapshot into `backups`; no real process/sync/mtime probing.

    Plain patching (no pytest `monkeypatch`) so the shared `_standalone`
    runner — which the python-suite census drives — can run this file.
    """
    patches = {
        "_backup_root": lambda: backups,
        "_detect_competing_processes": lambda: [],
        "_detect_recent_mods": lambda _l: [],
        "_detect_sync_mount": lambda _l: (False, ""),
    }
    saved = {k: getattr(preflight, k) for k in patches}
    for k, v in patches.items():
        setattr(preflight, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(preflight, k, v)


@contextlib.contextmanager
def _cwd(path: Path):
    old = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


# ── postflight fails closed ────────────────────────────────────────────


def _run_postflight(capsys, *argv: str) -> tuple[int, dict]:
    rc = postflight.main(list(argv))
    return rc, json.loads(capsys.readouterr().out)


def test_postflight_refuses_empty_snapshot_dir(tmp_path, capsys):
    lib = _library(tmp_path / "lib", MASTER_1)
    with _cwd(lib):  # the old failure: "" resolved to cwd = the library
        rc, out = _run_postflight(capsys, "--snapshot-dir", "", "--library", str(lib))
    assert rc != 0
    assert out["clean"] is False
    assert "empty --snapshot-dir" in out["error"]


def test_postflight_refuses_library_root_as_snapshot(tmp_path, capsys):
    lib = _library(tmp_path / "lib", MASTER_1)
    rc, out = _run_postflight(
        capsys, "--snapshot-dir", str(lib), "--library", str(lib))
    assert rc != 0
    assert out["clean"] is False
    assert out["error"]


def test_postflight_refuses_snapshot_without_manifest(tmp_path, capsys):
    lib = _library(tmp_path / "lib", MASTER_1)
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "master.bib").write_text(MASTER_2)
    rc, out = _run_postflight(
        capsys, "--snapshot-dir", str(snap), "--library", str(lib))
    assert rc != 0
    assert out["clean"] is False
    assert "manifest" in out["error"]


# ── preflight → run state → postflight, end to end ────────────────────


def test_run_state_round_trips_through_a_separate_shell(tmp_path, capsys):
    lib = _library(tmp_path / "lib", MASTER_2)
    state = tmp_path / "run.json"
    with _isolated_preflight(tmp_path / "backups"):
        rc = preflight.main([
            "--library", str(lib), "--run-state", str(state),
            "--filter", "barthes*", "--force", "--dry-run",
        ])
    assert rc == 0
    capsys.readouterr()
    pf = json.loads(state.read_text())
    assert pf["run"] == {
        "filter": "barthes*", "force": True, "dry_run": True,
        "batch_requested": None, "allow_parallel_sync": False, "batch": 5,
    }
    assert pf["refuse"] is None

    # A FRESH shell (nothing inherited but the file) sees every value.
    env_file = Path(str(state) + ".env")
    out = subprocess.run(
        ["bash", "-c", f". '{env_file}' && cd \"$VIRGIL_LIBRARY_ROOT\" && "
         'printf "%s|%s|%s|%s|%s|%s" "$PWD" "$SNAPSHOT_DIR" "$MERGE_FILTER" '
         '"$MERGE_FORCE" "$DRY_RUN" "$BATCH"'],
        capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"},
    )
    assert out.returncode == 0, out.stderr
    pwd, snap, filt, force, dry, batch = out.stdout.split("|")
    assert Path(pwd).resolve() == lib.resolve()
    assert snap == pf["snapshot_dir"] and Path(snap).is_dir()
    assert (filt, force, dry, batch) == ("barthes*", "1", "1", "5")

    # The merge truncates master.bib; the postflight — given only the
    # snapshot dir, no --library, run from an unrelated cwd — catches it.
    (lib / "master.bib").write_text(MASTER_1)
    with _cwd(tmp_path):
        rc, post = _run_postflight(capsys, "--snapshot-dir", snap)
    assert rc == 0
    assert post["clean"] is False
    assert post["master_bib"]["shrank"] is True
    assert Path(post["library_root"]) == lib.resolve()
    assert post["restore_commands"]


def test_env_quotes_hostile_values(tmp_path, capsys):
    lib = _library(tmp_path / "lib", MASTER_1)
    state = tmp_path / "run.json"
    with _isolated_preflight(tmp_path / "backups"):
        preflight.main(["--library", str(lib), "--run-state", str(state),
                        "--filter", "it's $(echo pwned)*"])
    capsys.readouterr()
    out = subprocess.run(
        ["bash", "-c", f". '{state}.env' && printf %s \"$MERGE_FILTER\""],
        capture_output=True, text=True,
    )
    assert out.stdout == "it's $(echo pwned)*"


def test_batch_policy():
    bp = preflight._batch_policy
    kw = dict(sync_kind="dropbox", allow_parallel_sync=False, any_writers=False)
    assert bp(requested=None, sync_mounted=False, **kw) == (5, None)
    assert bp(requested=3, sync_mounted=False, **kw) == (3, None)
    assert bp(requested=None, sync_mounted=True, **kw) == (1, None)
    assert bp(requested=4, sync_mounted=True, **kw)[1] == "parallel-in-sync:dropbox"
    assert bp(requested=4, sync_mounted=True,
              **{**kw, "allow_parallel_sync": True}) == (4, None)
    assert bp(requested=0, sync_mounted=False, **kw)[1] == "bad-batch"
    assert bp(requested=None, sync_mounted=False,
              **{**kw, "any_writers": True})[1] == "other-writers"


# ── skill-text census ──────────────────────────────────────────────────

_RUN_STATE_VARS = ("SNAPSHOT_DIR", "DRY_RUN", "MERGE_FILTER", "MERGE_FORCE",
                   "BATCH", "VIRGIL_LIBRARY_ROOT")
_SOURCE_LINE = '. /tmp/merge-bibs-run.json.env && cd "$VIRGIL_LIBRARY_ROOT"'


def _fenced_bash_blocks(text: str) -> list[tuple[int, str]]:
    return [(text[:m.start()].count("\n") + 1, m.group(1))
            for m in re.finditer(r"```bash\n(.*?)```", text, re.S)]


def test_every_block_reading_run_state_sources_it():
    """No fenced block reads a run-state value it didn't source itself."""
    blocks = _fenced_bash_blocks(SKILL.read_text())
    assert blocks
    offenders = []
    for line, body in blocks:
        if "merge_bibs_preflight.py" in body or "library_path_py" in body:
            continue  # the blocks that PRODUCE the run state
        reads = [v for v in _RUN_STATE_VARS
                 if re.search(rf'\$\{{?{v}\b|environ(?:\.get)?[\[(]"{v}"', body)]
        if reads and _SOURCE_LINE not in body:
            offenders.append((line, reads))
    assert not offenders, f"blocks read run state without sourcing it: {offenders}"


def test_step0_keeps_stderr_out_of_the_json():
    text = SKILL.read_text()
    pre = [b for _, b in _fenced_bash_blocks(text) if "merge_bibs_preflight.py" in b]
    assert pre, "Step 0 must run the preflight"
    for b in pre:
        assert "2>&1" not in b
        assert "--run-state /tmp/merge-bibs-run.json" in b
    # Nothing hands state forward through a bare export any more.
    assert "export SNAPSHOT_DIR" not in text


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
