"""Task 1396 — `resync_paper_bib.py`, the references.bib sync step's CLI door.

`/library/authenticate-bib` step 6 and `/library/apply-bib-edit` step 3 each
carried the same heredoc into `index_paper._resync_references_bib`, a private
helper that answered ONE bool for three outcomes (a legit "no paper folder"
skip and a missing master row printed the same line) and a raw traceback for
the other two. The CLI states five answers as exit codes:

  * synced → 0;
  * no paper folder (legit skip) → 4;
  * master row absent (a defect) → 3;
  * master entry unreadable → 2;
  * references.bib splice refused → 5, the file byte-identical;

and no skill reaches into `index_paper` through a heredoc any more (step 7's
`settle_catalog.py` retired the sibling heredoc).

Run: python3 library/scripts/tests/test_resync_paper_bib_cli.py
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

import resync_paper_bib as cli  # noqa: E402
import settle_catalog  # noqa: E402

GOOD = "@article{smith2001good,\n  title = {Good},\n  year = {2001}\n}\n"
BROKEN = "@article{jones2002broken,\n  title = {Never {closed},\n  year = {2002}\n"
OTHER = "@book{other1990,\n  title = {Other},\n  year = {1990}\n}\n"


def _lib(tmp_path: Path, bib: str) -> Path:
    lib = tmp_path / "lib"
    (lib / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (lib / "master.bib").write_text(bib, encoding="utf-8")
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": []}) + "\n", encoding="utf-8")
    return lib


def _paper(lib: Path, citekey: str, refs: str | None = None) -> Path:
    d = lib / "papers" / citekey
    d.mkdir(parents=True, exist_ok=True)
    if refs is not None:
        (d / "references.bib").write_text(refs, encoding="utf-8")
    return d


def _run(lib: Path, *args: str, script: str = "resync_paper_bib.py") -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != "VIRGIL_LIBRARY_ROOT"}
    env["VIRGIL_LIBRARY_ROOT"] = str(lib)
    return subprocess.run(
        [sys.executable, str(_SCRIPTS / script), *args],
        cwd=str(lib), capture_output=True, text=True, env=env)


def test_synced_exits_0_and_keeps_the_other_entries(tmp_path):
    lib = _lib(tmp_path, GOOD)
    d = _paper(lib, "smith2001good", OTHER)
    proc = _run(lib, "smith2001good")
    assert proc.returncode == cli.EXIT_SYNCED == 0, proc.stderr
    after = (d / "references.bib").read_text(encoding="utf-8")
    assert OTHER in after and "@article{smith2001good," in after


def test_no_paper_folder_exits_4_a_skip_not_a_defect(tmp_path):
    lib = _lib(tmp_path, GOOD)
    proc = _run(lib, "smith2001good")
    assert proc.returncode == cli.EXIT_NO_PAPER == 4, proc.stderr
    assert "skipped" in proc.stdout
    assert not (lib / "papers" / "smith2001good").exists()


def test_absent_master_row_exits_3_distinct_from_the_skip(tmp_path):
    lib = _lib(tmp_path, GOOD)
    d = _paper(lib, "nosuch1999")
    proc = _run(lib, "nosuch1999")
    assert proc.returncode == cli.EXIT_ABSENT == 3
    assert "nosuch1999" in proc.stderr
    assert not (d / "references.bib").exists()


def test_unbalanced_master_entry_exits_2_never_absent(tmp_path):
    lib = _lib(tmp_path, GOOD + "\n" + BROKEN)
    d = _paper(lib, "jones2002broken", OTHER)
    proc = _run(lib, "jones2002broken")
    assert proc.returncode == cli.EXIT_UNREADABLE == 2, (proc.returncode, proc.stderr)
    assert "jones2002broken" in proc.stderr
    assert (d / "references.bib").read_text(encoding="utf-8") == OTHER


def test_undecodable_master_bib_exits_2(tmp_path):
    lib = _lib(tmp_path, GOOD)
    (lib / "master.bib").write_bytes(b"@article{x,\n  title = {\xff\xfe}\n}\n")
    _paper(lib, "x")
    proc = _run(lib, "x")
    assert proc.returncode == 2, (proc.returncode, proc.stderr)


def test_splice_refused_exits_5_and_leaves_the_file_byte_identical(tmp_path):
    # references.bib's own copy of the target never balances — no safe span.
    lib = _lib(tmp_path, GOOD)
    damaged = OTHER + "@article{smith2001good,\n  title = {Open {brace},\n  year = {2001}\n"
    d = _paper(lib, "smith2001good", damaged)
    before = (d / "references.bib").read_bytes()
    proc = _run(lib, "smith2001good")
    assert proc.returncode == cli.EXIT_SPLICE_REFUSED == 5, (proc.returncode, proc.stderr)
    assert "untouched" in proc.stderr
    assert (d / "references.bib").read_bytes() == before


def test_settle_catalog_unreadable_verdict_exits_2(tmp_path):
    lib = _lib(tmp_path, GOOD)
    proc = _run(lib, "smith2001good", str(tmp_path / "nope.json"),
                script="settle_catalog.py")
    assert proc.returncode == settle_catalog.EXIT_FAILED == 2, proc.stderr
    assert "verdict" in proc.stderr and proc.stdout == ""


# ── skill text ─────────────────────────────────────────────────────

_HEREDOC_PRIVATE = re.compile(r"from\s+index_paper\s+import\s+")


def test_no_skill_heredocs_into_index_paper():
    """The defect's shape: skill prose importing a helper out of
    `index_paper` inline. Its doors are `resync_paper_bib.py` and
    `settle_catalog.py`."""
    offenders = []
    for silo in (_SKILLS, _SCRIPTS.parents[1] / "editor" / "skills"):
        for md in sorted(silo.rglob("*.md")):
            text = md.read_text(encoding="utf-8")
            if _HEREDOC_PRIVATE.search(text) or "_resync_references_bib" in text:
                offenders.append(str(md))
    assert not offenders, offenders


def test_both_bib_skills_call_the_door_and_branch_on_every_code():
    for name in ("authenticate-bib.md", "apply-bib-edit.md"):
        text = (_SKILLS / name).read_text(encoding="utf-8")
        assert "resync_paper_bib.py" in text, f"{name} does not call the door"
        for code in (cli.EXIT_SYNCED, cli.EXIT_UNREADABLE, cli.EXIT_ABSENT,
                     cli.EXIT_NO_PAPER, cli.EXIT_SPLICE_REFUSED):
            assert f"`resync={code}`" in text, f"{name} has no branch for exit {code}"
    ab = (_SKILLS / "authenticate-bib.md").read_text(encoding="utf-8")
    assert "settle_catalog.py" in ab
    for code in (settle_catalog.EXIT_SETTLED, settle_catalog.EXIT_FAILED):
        assert f"`settle={code}`" in ab, f"step 7 has no branch for exit {code}"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
