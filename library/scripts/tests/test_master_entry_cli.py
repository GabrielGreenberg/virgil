"""Task 1229 — `master_entry.py`, the read door's CLI, owns three answers.

`/library/authenticate-bib` step 1 used to wrap `_tools.master_entry_for` in a
heredoc and read an EMPTY `base.bib` as "not in master.bib". But the door
RAISES on an entry whose braces never balance (and on an unreadable file), and
a raising heredoc also leaves the file empty — so a damaged entry the user can
see was reported as absent. The CLI states the distinction as an exit code:

  * found → 0, the raw block on stdout;
  * absent → 3, nothing on stdout;
  * unbalanced / unreadable → 2, the door's message on stderr, nothing on stdout;

and the skill's step 1 invokes the CLI and branches on all three codes, with no
skill anywhere hand-rolling the import around `master_entry_for` again.

Run: python3 library/scripts/tests/test_master_entry_cli.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
_SKILLS = _SCRIPTS.parent / "skills"
sys.path.insert(0, str(_SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import master_entry  # noqa: E402

GOOD = "@article{smith2001good,\n  title = {Good},\n  year = {2001}\n}\n"
BROKEN = "@article{jones2002broken,\n  title = {Never {closed},\n  year = {2002}\n"


def _lib(tmp_path: Path, bib: str) -> Path:
    lib = tmp_path / "lib"
    (lib / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (lib / "master.bib").write_text(bib, encoding="utf-8")
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": []}) + "\n", encoding="utf-8")
    return lib


def _run(lib: Path, citekey: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "VIRGIL_LIBRARY_ROOT"}
    env["VIRGIL_LIBRARY_ROOT"] = str(lib)
    return subprocess.run(
        [sys.executable, str(_SCRIPTS / "master_entry.py"), citekey],
        cwd=str(lib), capture_output=True, text=True, env=env)


def test_found_entry_exits_0_with_its_block(tmp_path):
    lib = _lib(tmp_path, "% bib.state = authenticated\n" + GOOD)
    proc = _run(lib, "smith2001good")
    assert proc.returncode == master_entry.EXIT_FOUND == 0, proc.stderr
    assert proc.stdout.startswith("@article{smith2001good,"), proc.stdout
    assert "title = {Good}" in proc.stdout and "bib.state" not in proc.stdout


def test_absent_entry_exits_3_with_nothing_on_stdout(tmp_path):
    lib = _lib(tmp_path, GOOD)
    proc = _run(lib, "nosuch1999key")
    assert proc.returncode == master_entry.EXIT_ABSENT == 3
    assert proc.stdout == ""


def test_unbalanced_entry_exits_2_never_absent(tmp_path):
    """The headline: a damaged entry is NOT reported as missing."""
    lib = _lib(tmp_path, GOOD + "\n" + BROKEN)
    proc = _run(lib, "jones2002broken")
    assert proc.returncode == master_entry.EXIT_UNREADABLE == 2, (
        proc.returncode, proc.stderr)
    assert proc.stdout == ""
    assert "jones2002broken" in proc.stderr
    # A sibling entry in the same file still reads.
    assert _run(lib, "smith2001good").returncode == 0


def test_undecodable_master_bib_exits_2(tmp_path):
    lib = _lib(tmp_path, GOOD)
    (lib / "master.bib").write_bytes(b"@article{x,\n  title = {\xff\xfe}\n}\n")
    proc = _run(lib, "x")
    assert proc.returncode == 2, (proc.returncode, proc.stderr)
    assert proc.stdout == ""


def test_missing_master_bib_is_unreadable_not_absent(tmp_path):
    """The door raises `MasterBibMissing` (an OSError) rather than answering
    None, so the CLI's OSError arm reports a lost master.bib as 2 (task 1293)."""
    lib = _lib(tmp_path, GOOD)
    (lib / "master.bib").unlink()
    import io
    from contextlib import redirect_stderr
    import _library_root
    saved = master_entry.library_root_or_exit
    master_entry.library_root_or_exit = lambda code=2: lib
    err = io.StringIO()
    try:
        with redirect_stderr(err):
            rc = master_entry.main(["smith2001good"])
    finally:
        master_entry.library_root_or_exit = saved
    assert rc == master_entry.EXIT_UNREADABLE == 2, err.getvalue()
    assert "master.bib" in err.getvalue()
    assert _library_root  # the resolver itself refuses a master.bib-less root


def _step_one(text: str) -> str:
    return text.split("2. **Coherence pre-flight")[0].split("1. **Read the citekey")[1]


def test_authenticate_bib_step_one_branches_on_every_exit_code():
    step = _step_one((_SKILLS / "authenticate-bib.md").read_text(encoding="utf-8"))
    assert "master_entry.py" in step
    assert "master_entry_for" not in step, "step 1 hand-rolls the door again"
    for code in (master_entry.EXIT_FOUND, master_entry.EXIT_ABSENT,
                 master_entry.EXIT_UNREADABLE):
        assert re.search(rf"`read={code}`", step), f"step 1 has no branch for exit {code}"
    assert not re.search(r"empty file means", step, re.I), (
        "step 1 still infers absence from an empty file")


def test_no_skill_wraps_the_read_door_in_a_heredoc():
    """The CLI is the skills' door; an inline `from _tools import
    master_entry_for` in skill prose is the defect's shape."""
    offenders = []
    for silo in (_SKILLS, _SCRIPTS.parents[1] / "editor" / "skills"):
        for md in sorted(silo.rglob("*.md")):
            if "import master_entry_for" in md.read_text(encoding="utf-8"):
                offenders.append(str(md))
    assert not offenders, offenders


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
