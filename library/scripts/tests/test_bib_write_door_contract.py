"""The master.bib write door's CALLER contract (task 796).

`update_master_bib_entry.py` is the one door to master.bib. Its callers did not
honour it uniformly:

- its own base check, merge and guards read the entry OUTSIDE the lock and wrote
  inside it, so a concurrent writer's field landing in between was erased;
- exit 2 meant both "argparse: bad invocation" and "the entry is gone", and
  `/library/apply-bib-edit` retired the user's edit on either;
- `/library/authenticate-bib` wrote with no stale-base guard and branched on no
  exit code, so a refused write still reached the catalog and retired the slot.

This suite pins: (1) the decision runs under the writer's lock, (2) ONE exit
table with distinct refusal codes argparse cannot produce, (3) every skill that
invokes the shim captures the exit code and names the do-not-retire codes, and
authenticate-bib's write carries its step-1 base.

Run: python3 library/scripts/tests/test_bib_write_door_contract.py
(pytest when installed, the shared `_standalone` runner otherwise).
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
_REPO = _SCRIPTS.parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _tools import lock_master_bib, read_master_bib  # noqa: E402
import update_master_bib_entry as shim  # noqa: E402

_SHIM = str(_SCRIPTS / "update_master_bib_entry.py")

_ENTRY = """@article{smith2020,
  author = {Smith, John},
  title = {An Example Paper},
  year = {2020}
}
"""


def _lib(tmp_path: Path, bib: str = _ENTRY) -> Path:
    (tmp_path / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    if not (tmp_path / ".virgil" / "catalog.json").exists():
        (tmp_path / ".virgil" / "catalog.json").write_text('{"version": 1, "entries": []}\n')
    (tmp_path / "master.bib").write_text(bib)
    return tmp_path


def _cmd(lib: Path, fields: dict, *extra: str, citekey: str = "smith2020") -> list:
    ff = lib / "_fields.json"
    ff.write_text(json.dumps(fields))
    return [sys.executable, _SHIM, citekey, "--entry-type", "article",
            "--fields-file", str(ff), "--library", str(lib), *extra]


def _run(lib: Path, fields: dict, *extra: str, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(_cmd(lib, fields, *extra, **kw), capture_output=True, text=True)


# ── (1) the decision runs under the writer's lock ─────────────────────


def test_a_field_written_while_the_shim_waits_for_the_lock_survives(tmp_path):
    """Hold the lock, start the shim (a merge-existing change-set), let it reach
    the lock, THEN land a concurrent writer's `doi` and release. A shim that read
    the entry before the lock merges over the stale read and erases the doi."""
    lib = _lib(tmp_path)
    with lock_master_bib(lib):
        proc = subprocess.Popen(
            _cmd(lib, {"title": "An Example Paper, Revised"}, "--merge-existing"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.0)   # the shim is now blocked on the lock
        assert proc.poll() is None, "the shim finished without waiting for the lock"
        (lib / "master.bib").write_text(
            _ENTRY.replace("  year = {2020}\n", "  year = {2020},\n  doi = {10.1234/x}\n"))
    out, err = proc.communicate(timeout=30)
    assert proc.returncode == 0, err
    fields = read_master_bib(lib / "master.bib")["smith2020"]["fields"]
    assert fields.get("doi") == "10.1234/x", "the concurrent writer's field was erased"
    assert fields["title"] == "An Example Paper, Revised"


def test_the_base_check_sees_a_write_that_landed_while_waiting(tmp_path):
    """Same interleave for the stale-base guard: the title moves on disk while
    the shim waits; its change to title is HELD (5), not applied over it."""
    lib = _lib(tmp_path)
    base = lib / "_base.bib"
    base.write_text(_ENTRY)
    with lock_master_bib(lib):
        proc = subprocess.Popen(
            _cmd(lib, {"title": "Auth Title"}, "--merge-existing",
                 "--base-raw-file", str(base), "--base-type", "article"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.0)
        (lib / "master.bib").write_text(_ENTRY.replace("An Example Paper", "User Title"))
    out, err = proc.communicate(timeout=30)
    assert proc.returncode == shim.EXIT_HELD, err
    assert read_master_bib(lib / "master.bib")["smith2020"]["fields"]["title"] == "User Title"


def test_compose_returning_none_writes_nothing(tmp_path):
    from _tools import update_master_bib_entry
    lib = _lib(tmp_path)
    seen = []
    update_master_bib_entry(lib, "smith2020", "article", {"title": "X"},
                            compose=lambda e: seen.append(e) or None)
    assert seen and seen[0]["fields"]["title"] == "An Example Paper"
    assert (lib / "master.bib").read_text() == _ENTRY


# ── (2) ONE exit table ────────────────────────────────────────────────


def test_exit_codes_are_distinct_and_rendered_by_help():
    codes = [row[0] for row in shim.EXIT_TABLE]
    assert len(codes) == len(set(codes))
    # 2 is argparse's; no refusal the shim decides may share it.
    assert [r[1] for r in shim.EXIT_TABLE if r[0] == 2] == ["bad-invocation"]
    help_text = subprocess.run([sys.executable, _SHIM, "--help"],
                               capture_output=True, text=True).stdout
    for code, name, *_ in shim.EXIT_TABLE:
        assert re.search(rf"^\s+{code}\s+{re.escape(name)}\b", help_text, re.M), name


def test_bad_invocations_exit_2_and_write_nothing(tmp_path):
    lib = _lib(tmp_path)
    r = subprocess.run([sys.executable, _SHIM, "smith2020", "--library", str(lib)],
                       capture_output=True, text=True)          # argparse
    assert r.returncode == 2
    (lib / "_bad.json").write_text("[1, 2]")
    r = subprocess.run([sys.executable, _SHIM, "smith2020", "--entry-type", "article",
                        "--fields-file", str(lib / "_bad.json"), "--library", str(lib)],
                       capture_output=True, text=True)          # not an object
    assert r.returncode == 2
    (lib / "_bad.json").write_text("{not json")
    r = subprocess.run([sys.executable, _SHIM, "smith2020", "--entry-type", "article",
                        "--fields-file", str(lib / "_bad.json"), "--library", str(lib)],
                       capture_output=True, text=True)          # unparsable
    assert r.returncode == 2
    (lib / "_base.bib").write_text(_ENTRY)
    r = _run(lib, {"title": "X"}, "--base-raw-file", str(lib / "_base.bib"))
    assert r.returncode == 2                                    # base w/o merge
    assert (lib / "master.bib").read_text() == _ENTRY


def test_a_change_set_never_recreates_a_missing_entry(tmp_path):
    """The legacy (no-base) bib edit on a deleted entry appended a stub holding
    only the changed fields. A change-set is not an entry: 6, nothing written."""
    lib = _lib(tmp_path, "")
    r = _run(lib, {"title": "Only This"}, "--merge-existing")
    assert r.returncode == shim.EXIT_CANNOT_APPLY, r.stderr
    assert (lib / "master.bib").read_text() == ""


def test_an_unreadable_base_is_cannot_apply(tmp_path):
    lib = _lib(tmp_path)
    (lib / "_base.bib").write_text("not bibtex at all")
    r = _run(lib, {"title": "X"}, "--merge-existing",
             "--base-raw-file", str(lib / "_base.bib"))
    assert r.returncode == shim.EXIT_CANNOT_APPLY, r.stderr
    assert (lib / "master.bib").read_text() == _ENTRY


def test_an_unbalanced_entry_is_its_own_code_not_a_traceback(tmp_path):
    bad = "@article{smith2020,\n  title = {Unclosed,\n  year = {2020}\n}\n"
    lib = _lib(tmp_path, bad)
    r = _run(lib, {"title": "X"}, "--merge-existing")
    assert r.returncode == shim.EXIT_UNBALANCED, (r.returncode, r.stderr)
    assert "Traceback" not in r.stderr
    assert (lib / "master.bib").read_text() == bad


# ── (3) every skill caller honours the table ──────────────────────────

_SKILLS = _REPO / "library" / "skills"


def _fenced_blocks(text: str):
    """(block, end offset) per fenced block — line-based, so an indented fence
    inside a numbered step pairs with its own closer."""
    lines = text.splitlines(keepends=True)
    off, start, buf = 0, None, []
    for line in lines:
        off += len(line)
        if line.strip().startswith("```"):
            if start is None:
                start, buf = off, []
            else:
                yield "".join(buf), off
                start = None
        elif start is not None:
            buf.append(line)


def _invocations():
    """(skill, block, prose-after) for every fenced block running the shim."""
    for md in sorted(_SKILLS.glob("*.md")):
        text = md.read_text()
        for block, end in _fenced_blocks(text):
            if not re.search(r"^\s*python3 \S*update_master_bib_entry\.py", block, re.M):
                continue
            # The step's prose right after the block.
            yield md.name, block, text[end:end + 2500]


def test_the_census_finds_every_known_caller():
    names = {name for name, *_ in _invocations()}
    assert {"authenticate-bib.md", "apply-bib-edit.md", "index-paper.md",
            "triage-pdf.md"} <= names, names


def test_every_skill_invocation_captures_and_branches_on_the_exit_code():
    for name, block, tail in _invocations():
        where = f"{name}: {block.strip().splitlines()[0]}"
        assert "rc=$?" in block, f"{where} — does not capture the shim's exit code"
        assert "--help" in tail, f"{where} — does not cite the ONE exit table (--help)"
        # The do-not-retire codes are the dangerous ones to fold into a retire.
        for code in ("2", "7"):
            assert re.search(rf"\*\*{code}\*\*", tail), \
                f"{where} — names no branch for exit {code}"
        if "--base-raw-file" in block:
            assert re.search(r"\*\*5\*\*", tail), f"{where} — no branch for held (5)"
        if "--merge-existing" in block:
            assert re.search(r"\*\*6\*\*", tail), f"{where} — no branch for 6"
        else:
            assert re.search(r"\*\*3\*\*", tail), f"{where} — append with no branch for 3"


def test_authenticate_bib_writes_against_its_step_one_base():
    blocks = [b for n, b, _ in _invocations() if n == "authenticate-bib.md"]
    assert blocks and all("--base-raw-file" in b and "--merge-existing" in b
                          for b in blocks)
    assert "-auth-base.bib" in (_SKILLS / "authenticate-bib.md").read_text().split(
        "2. **Coherence pre-flight")[0], "step 1 does not snapshot the base"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
