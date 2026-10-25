"""Task 1293 — no library script reads ONE master.bib entry except through the door.

`_tools.master_entry_for` is the single-entry read door (task 621): NFC/NFD
lookup, last entry wins, and a RAISE for every answer that is neither "found"
nor "absent" — an entry whose braces never balance (`BibEntryUnbalanced`), a
master.bib that is missing (`MasterBibMissing`) or undecodable. Task 1229 gave
the skills its CLI (`master_entry.py`, exit 0 / 3 / 2) and a census that no
skill re-wraps it. This is the SCRIPT half of that census.

Each defect it retires read around the door, and each read gave a GUESS the
voice of a fact:

  * `bib_auth._seed_from_master_bib` — `read_master_bib(...).get()` + its own
    NFC scan: the parser caps an unbalanced entry at the next `@` without
    raising, so `--citekey` authenticated guessed fields; and absent / no
    master.bib / unreadable all exited 1.
  * `validate_bib_coherence` — the same read; a pre-flight over guessed fields
    could report COHERENT.
  * `backfill_auth` — re-emitted a raw read's fields to restamp a state.
  * `detect_metadata_mismatch` / `strip_ocr_running_headers` — hand regexes,
    unanchored, `{[^}]+}` (a nested-brace title truncated).

The census: `read_master_bib(` (and a hand `@type{<citekey>,` regex) may appear
in a library script only where it reads the WHOLE file — a key set, a bulk
index, a plan over every entry — each named below with why. A new script that
needs one entry calls the door; one that genuinely needs the whole file joins
the allowlist with its reason.

Run: python3 library/scripts/tests/test_master_entry_read_door_census.py
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _tools  # noqa: E402

# Whole-file readers. Each is a BULK question — never "what does master.bib say
# about this one citekey?".
BULK_READERS: dict[str, str] = {
    "_bib_parse.py": "defines read_master_bib",
    "_tools.py": "the door itself (parses the located span) + key-set helpers",
    "dedup.py": "key sets before/after a merge; verify invariants over every key",
    "dedup_index.py": "builds the work-identity index over every entry",
    "merge_paper_references.py": "folds every paper bib against the whole master",
    "prune_catalog_present_false.py": "NFC/NFD index over every entry for a bulk prune",
    "rename_citekeys.py": "preflight key set: every rename target must be free",
    "repair_etal_citekeys.py": "plans a repair over every catalog row at once",
    "synthesize_canonical_entries.py": "walks every entry to synthesize canonicals",
    "triage_apply.py": "MEMBERSHIP (is the key taken?), not an entry's fields",
    "triage_batch.py": "key set for a whole batch",
    "update_master_bib_entry.py": "parses the CALLER's base block (text=), not master.bib",
}

# A hand-rolled `@type{<citekey>,` locator — the regex shape the door replaced.
_HAND_LOCATOR = re.compile(r"""rf?["']@\(?\\w\+\)?\\?\{\{?\{re\.escape\(citekey\)\}""")


def _scripts() -> list[Path]:
    return sorted(p for p in _SCRIPTS.glob("*.py")
                  if not p.name.startswith("test_"))


def _calls_read_master_bib(path: Path) -> bool:
    """A real CALL — `read_master_bib(` / `x.read_master_bib(` — read off the
    AST, so a docstring quoting the defect's shape is not an offender."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else (
                f.attr if isinstance(f, ast.Attribute) else "")
            if name == "read_master_bib":
                return True
    return False


def test_only_bulk_readers_call_read_master_bib():
    offenders = [p.name for p in _scripts()
                 if p.name not in BULK_READERS and _calls_read_master_bib(p)]
    assert not offenders, (
        f"{offenders} call read_master_bib( outside the bulk-reader allowlist. "
        "One entry → `_tools.master_entry_for` (it raises on an unbalanced "
        "entry and a missing master.bib; the raw parser guesses). A whole-file "
        "read → add the script to BULK_READERS with its reason.")


def test_no_script_hand_rolls_a_citekey_locator():
    offenders = [p.name for p in _scripts()
                 if _HAND_LOCATOR.search(p.read_text(encoding="utf-8"))]
    assert not offenders, (
        f"{offenders} locate a master.bib entry with a hand regex; "
        "use `_tools.master_entry_for`")


def test_allowlist_is_live():
    """A stale allowlist row is a hole a regression walks through."""
    defined = {"_bib_parse.py"}  # defines it; its own callers are internal
    dead = [n for n in BULK_READERS if n not in defined and (
        not (_SCRIPTS / n).exists() or not _calls_read_master_bib(_SCRIPTS / n))]
    assert not dead, f"BULK_READERS rows with no read_master_bib call: {dead}"


def test_the_fixed_readers_go_through_the_door():
    for name in ("bib_auth.py", "validate_bib_coherence.py",
                 "detect_metadata_mismatch.py", "strip_ocr_running_headers.py"):
        assert "master_entry_for" in (_SCRIPTS / name).read_text(encoding="utf-8"), name
    assert "settle_master_bib_state" in (_SCRIPTS / "backfill_auth.py").read_text(
        encoding="utf-8")


# ── the door's own answers ───────────────────────────────────────────────


def test_door_raises_on_a_missing_master_bib(tmp_path):
    """None would read as "absent" — a library whose master.bib was lost to
    sync is damage, and `master_entry.py` must answer 2, not 3."""
    try:
        _tools.master_entry_for(tmp_path, "smith2001")
    except _tools.MasterBibMissing:
        pass
    else:
        raise AssertionError("a missing master.bib answered as 'absent'")
    assert issubclass(_tools.MasterBibMissing, OSError)


def test_door_reads_utf8_regardless_of_locale(tmp_path):
    """Under an ASCII locale the door's read must still decode UTF-8."""
    import os
    import subprocess

    (tmp_path / "master.bib").write_text(
        "@book{tichy1976,\n  title = {Tichý},\n  year = {1976}\n}\n", encoding="utf-8")
    probe = (
        "import sys; sys.path.insert(0, sys.argv[1]); import _tools; "
        "from pathlib import Path; "
        "e = _tools.master_entry_for(Path(sys.argv[2]), 'tichy1976'); "
        "sys.stdout.buffer.write(e['fields']['title'].encode('utf-8'))")
    env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONUTF8": "0",
           "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, "-X", "utf8=0", "-c", probe,
                        str(_SCRIPTS), str(tmp_path)], capture_output=True, env=env)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    assert r.stdout.decode("utf-8") == "Tichý"


# ── the converted readers ────────────────────────────────────────────────


def test_strip_ocr_takes_a_nested_brace_title_whole(tmp_path):
    import strip_ocr_running_headers as so

    bib = tmp_path / "master.bib"
    bib.write_text("@article{ann2001,\n  note = {see @article{ann2001, x}},\n"
                   "  title = {The {Nested} Title},\n  year = {2001}\n}\n",
                   encoding="utf-8")
    assert so._read_master_bib_title(bib, "ann2001") == "The {Nested} Title"
    bib.write_text("@article{ann2001,\n  title = {Never {closed},\n  year = {2001}\n",
                   encoding="utf-8")
    assert so._read_master_bib_title(bib, "ann2001") is None  # no guess


def test_detect_mismatch_reports_an_unbalanced_entry_as_unreadable(tmp_path):
    import detect_metadata_mismatch as dm

    (tmp_path / "master.bib").write_text(
        "@article{ann2001,\n  title = {Never {closed},\n  year = {2001}\n",
        encoding="utf-8")
    paper = _tools.paper_folder(tmp_path, "ann2001")
    paper.mkdir(parents=True)
    (paper / "ann2001.pdf").write_bytes(b"%PDF-1.4\n")
    saved = dm._resolve_library_root
    dm._resolve_library_root = lambda: tmp_path
    try:
        r = dm.detect("ann2001")
        assert r.get("reason") == "unreadable", r
        (tmp_path / "master.bib").write_text("", encoding="utf-8")
        assert dm.detect("ann2001").get("reason") == "absent"
    finally:
        dm._resolve_library_root = saved


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
