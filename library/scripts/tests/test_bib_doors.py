"""The master.bib / references.bib entry doors and the library cite rewriter (task 620).

Every library writer that removes, renames or replaces a `.bib` entry locates it
through ONE locator — the one readers use (LAST line-anchored match, NFC then
NFD, extent from `bib_entry_extent`) — and refuses an entry it cannot delimit.
A library citekey rename rewrites `\\cite` keys through the editor's tested
rewriter and reaches other papers' `references.bib` and citekey-keyed sidecars.

Run: python3 library/scripts/tests/test_bib_doors.py
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _bib_parse  # noqa: E402
import _tools  # noqa: E402
import merge_paper_references as mpr  # noqa: E402
import rename_citekeys  # noqa: E402
import repair_etal_citekeys as rec  # noqa: E402
from _citekey_rename import rewrite_cite_keys, rewrite_cite_keys_many  # noqa: E402

UNBALANCED = (
    "@article{bad, title = {Unbalanced {x},}\n"
    "\n"
    "@book{keep1,\n  title = {One}\n}\n"
    "\n"
    "@book{keep2,\n  title = {Two}\n}\n"
)


def _lib(tmp_path: Path, master: str) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text(master)
    return tmp_path


def _paper(lib: Path, key: str, tex: str = "", refs: str = "", sidecars=None) -> Path:
    d = lib / "papers" / key
    (d / "virgil").mkdir(parents=True, exist_ok=True)
    if tex:
        (d / "main.tex").write_text(tex)
    if refs:
        (d / "references.bib").write_text(refs)
    for name, data in (sidecars or {}).items():
        (d / "virgil" / name).write_text(json.dumps(data))
    return d


# ── member 1: the et-al merge's removal scan ───────────────────────────────

def test_bib_entry_extent_contains_the_audit_fixture():
    # The lane's reproduction: the reader's extent is capped + reported unbalanced.
    assert _tools.bib_entry_extent(UNBALANCED, 0) == (UNBALANCED.index("@book{keep1"), False)


def test_merge_duplicate_refuses_an_unbalanced_entry_before_any_write(tmp_path):
    lib = _lib(tmp_path, UNBALANCED)
    other = _paper(lib, "other2020", tex="\\cite{bad}\n")
    try:
        rec.apply_merge_duplicate(lib, "bad", "keep1")
    except _tools.BibEntryUnbalanced:
        pass
    else:
        raise AssertionError("an entry the door cannot delimit must be refused")
    assert (lib / "master.bib").read_text() == UNBALANCED, "every later entry survives"
    assert (other / "main.tex").read_text() == "\\cite{bad}\n", "nothing written first"


def test_merge_duplicate_removes_only_its_own_entry(tmp_path):
    master = (
        "% bib.state = unverified\n@article{al2001x,\n  title = {T}\n}\n\n"
        "@article{smith2001x,\n  title = {T}\n}\n"
    )
    lib = _lib(tmp_path, master)
    rec.apply_merge_duplicate(lib, "al2001x", "smith2001x")
    assert (lib / "master.bib").read_text() == "\n@article{smith2001x,\n  title = {T}\n}\n"


# ── member 2: the merge rollback ───────────────────────────────────────────

def test_merge_rollback_refuses_an_unbalanced_entry(tmp_path):
    lib = _lib(tmp_path, UNBALANCED)
    try:
        mpr._remove_master_entry(lib, "bad")
    except _tools.BibEntryUnbalanced:
        pass
    else:
        raise AssertionError("rollback must refuse, not delete to EOF")
    assert (lib / "master.bib").read_text() == UNBALANCED


def test_merge_rollback_removes_entry_and_state_line(tmp_path):
    lib = _lib(tmp_path, "@book{a,\n t={1}\n}\n% bib.state = unverified\n@book{b,\n t={2}\n}\n@book{c,\n t={3}\n}\n")
    assert mpr._remove_master_entry(lib, "b") is True
    assert (lib / "master.bib").read_text() == "@book{a,\n t={1}\n}\n@book{c,\n t={3}\n}\n"
    assert mpr._remove_master_entry(lib, "zzz") is False


# ── member 3: cite-key rewriting ───────────────────────────────────────────

def test_rewrite_leaves_hyphen_and_colon_neighbours_alone():
    tex = "\\citet{smith2020foo-2} \\cite{van-smith2020foo} \\cite{x:smith2020foo} \\cite{smith2020foo}"
    out, n = rewrite_cite_keys(tex, "smith2020foo", "jones2020foo")
    assert n == 1
    assert out == "\\citet{smith2020foo-2} \\cite{van-smith2020foo} \\cite{x:smith2020foo} \\cite{jones2020foo}"


def test_rewrite_walks_two_optional_args_and_multi_key_lists():
    tex = "\\citep[see][p.~4]{smith2020foo} \\citealp{a, smith2020foo,%\n b}"
    out, n = rewrite_cite_keys(tex, "smith2020foo", "jones2020foo")
    assert n == 2
    assert out == "\\citep[see][p.~4]{jones2020foo} \\citealp{a, jones2020foo,%\n b}"


def test_rewrite_many_is_simultaneous():
    out, _ = rewrite_cite_keys_many("\\cite{a} \\cite{b}", {"a": "b", "b": "c"})
    assert out == "\\cite{b} \\cite{c}"


def test_no_private_backslash_b_cite_regex_in_library_scripts():
    offenders = []
    for p in sorted(SCRIPTS.glob("*.py")):
        src = p.read_text(encoding="utf-8")
        if re.search(r"\\\\cite\[a-zA-Z\]\*[^\n]*\\b\{?re\.escape", src):
            offenders.append(p.name)
    assert offenders == [], f"hand-rolled \\b cite rewriters: {offenders}"


# ── member 4: a rename reaches other papers' references.bib + sidecars ────

def test_rename_reaches_other_papers_bib_and_sidecars(tmp_path):
    lib = _lib(tmp_path, "@article{al2001x,\n  title = {T}\n}\n")
    _paper(lib, "al2001x", refs="@article{al2001x,\n  title = {T}\n}\n")
    other = _paper(
        lib, "other2020",
        tex="See \\citep[p.~2]{al2001x}.\n",
        refs="@book{z,\n t={z}\n}\n\n@article{al2001x,\n  title = {T}\n}\n",
        sidecars={
            "annotations.json": {"al2001x": "<p>mine</p>"},
            "bib-review-requests.json": {"requests": [{"bibKey": "al2001x"}]},
            "citations.json": {"citations": [{"keys": ["al2001x"], "command": "\\citep{al2001x}"}]},
        },
    )
    status = rec.apply_rename(lib, rec.Rename(old="al2001x", new="smith2001x"))
    assert "master_bib:renamed" in status["steps"]
    assert (other / "main.tex").read_text() == "See \\citep[p.~2]{smith2001x}.\n"
    assert "@article{smith2001x," in (other / "references.bib").read_text()
    assert "al2001x" not in (other / "references.bib").read_text()
    ann = json.loads((other / "virgil" / "annotations.json").read_text())
    assert ann == {"smith2001x": "<p>mine</p>"}
    rev = json.loads((other / "virgil" / "bib-review-requests.json").read_text())
    assert rev["requests"][0]["bibKey"] == "smith2001x"
    cit = json.loads((other / "virgil" / "citations.json").read_text())
    assert cit["citations"][0]["keys"] == ["smith2001x"]
    own = lib / "papers" / "smith2001x" / "references.bib"
    assert own.read_text() == "@article{smith2001x,\n  title = {T}\n}\n"


def test_merge_onto_a_key_the_paper_already_has_removes_the_old_row(tmp_path):
    lib = _lib(tmp_path, "@article{al2001x,\n t={T}\n}\n@article{smith2001x,\n t={T}\n}\n")
    other = _paper(
        lib, "other2020", tex="\\cite{al2001x,smith2001x}\n",
        refs="@article{al2001x,\n t={T}\n}\n@article{smith2001x,\n t={T}\n}\n",
    )
    rec.apply_merge_duplicate(lib, "al2001x", "smith2001x")
    refs = (other / "references.bib").read_text()
    assert refs == "@article{smith2001x,\n t={T}\n}\n", "no duplicate key minted"
    assert (other / "main.tex").read_text() == "\\cite{smith2001x,smith2001x}\n"


def test_rename_citekeys_reaches_other_papers(tmp_path):
    lib = _lib(tmp_path, "@article{woods2002shape,\n t={T}\n}\n")
    (lib / ".virgil" / "catalog.json").write_text(json.dumps({"entries": []}))
    other = _paper(lib, "other2020", tex="\\cite{woods2002shape}\n",
                   refs="@article{woods2002shape,\n t={T}\n}\n")
    rename_citekeys.apply_all(lib, [{"old": "woods2002shape", "new": "murray2002shape"}],
                              dry_run=False, backup_dir=tmp_path / "bak")
    assert (other / "main.tex").read_text() == "\\cite{murray2002shape}\n"
    assert "@article{murray2002shape," in (other / "references.bib").read_text()


def test_references_bib_rename_refuses_an_unbalanced_entry():
    try:
        _bib_parse.rename_entry_text(UNBALANCED, "bad", "good")
    except _bib_parse.BibSpliceRefused:
        pass
    else:
        raise AssertionError("expected BibSpliceRefused")


# ── member 5: writers act on the LAST line-anchored entry, like readers ────

DUP = (
    "@article{k,\n  title = {First},\n  doi = {10.1/first}\n}\n\n"
    "@article{k,\n  title = {Last},\n  pages = {1--2}\n}\n"
)


def test_update_edits_the_copy_readers_see(tmp_path):
    lib = _lib(tmp_path, DUP)
    seen = _tools.read_master_bib(lib / "master.bib")["k"]["fields"]
    assert seen["title"] == "Last"
    _tools.update_master_bib_entry(lib, "k", "article", {**seen, "year": "2001"})
    text = (lib / "master.bib").read_text()
    assert "doi = {10.1/first}" in text, "the invisible copy is untouched"
    got = _tools.read_master_bib(lib / "master.bib")["k"]["fields"]
    assert got == {"title": "Last", "pages": "1--2", "year": "2001"}


def test_rename_renames_the_copy_readers_see(tmp_path):
    lib = _lib(tmp_path, DUP)
    assert _tools.rename_master_bib_entry(lib, "k", "k2") is True
    got = _tools.read_master_bib(lib / "master.bib")
    assert got["k"]["fields"]["title"] == "First"
    assert got["k2"]["fields"]["title"] == "Last"


def test_opener_inside_a_note_is_not_an_entry(tmp_path):
    master = (
        "@misc{host,\n  note = {quoted:\n@article{k,\n}},\n  year = {1999}\n}\n\n"
        "@article{k,\n  title = {Real}\n}\n"
    )
    lib = _lib(tmp_path, master)
    assert _tools.rename_master_bib_entry(lib, "k", "k2") is True
    text = (lib / "master.bib").read_text()
    assert "@article{k,\n}}" in text, "the note's text is not an entry"
    assert "@article{k2,\n  title = {Real}" in text
    # and a missing key never matches text inside a value
    lib2 = _lib(tmp_path / "b", master.split("\n\n")[0] + "\n")
    assert _tools.rename_master_bib_entry(lib2, "k", "k2") is False


def test_rename_refuses_to_mint_a_duplicate(tmp_path):
    lib = _lib(tmp_path, "@book{a,\n t={1}\n}\n@book{b,\n t={2}\n}\n")
    before = (lib / "master.bib").read_text()
    try:
        _tools.rename_master_bib_entry(lib, "a", "b")
    except _tools.BibKeyTaken:
        pass
    else:
        raise AssertionError("expected BibKeyTaken")
    assert (lib / "master.bib").read_text() == before


def test_nfd_stored_key_is_found_and_written_nfc(tmp_path):
    nfd = unicodedata.normalize("NFD", "tichý1976")
    nfc = unicodedata.normalize("NFC", "tichý1976")
    lib = _lib(tmp_path, f"@book{{{nfd},\n t={{1}}\n}}\n")
    assert _tools.rename_master_bib_entry(lib, nfc, "tichy1976") is True
    assert (lib / "master.bib").read_text() == "@book{tichy1976,\n t={1}\n}\n"


# ── census: no hand-rolled master.bib brace walk outside the doors ─────────

# A file that BOTH walks brace depth AND spells a .bib entry opener is measuring
# an entry's extent by hand. Only the doors may; the rest are stated residuals.
_BIB_OPENER = re.compile(r"@\\w\+|@\(\\w\+\)|_ENTRY_START_RE")
_BRACE_WALK_ALLOWED = {
    "_tools.py": "the master.bib door (bib_entry_extent) + the field parser",
    "_bib_parse.py": "the references.bib door (parse_bib_text) + the field parser",
    "audit_deepindex.py": "read-only auditor; never writes a .bib",
    "synthesize_canonical_entries.py": "a balance CHECK on an emitted value, not an extent",
    "dedup.py": "RESIDUAL: its own capped span scan for merges (DEDUP_HARDENING.md) — "
                "not yet routed through the door",
}


def test_no_new_hand_rolled_bib_extent_walks():
    offenders = []
    for p in sorted(SCRIPTS.glob("*.py")):
        src = p.read_text(encoding="utf-8")
        if re.search(r"\bdepth \+= 1", src) and _BIB_OPENER.search(src):
            if p.name not in _BRACE_WALK_ALLOWED:
                offenders.append(p.name)
    assert offenders == [], (
        f"hand-rolled .bib entry extent in {offenders}: locate the entry through "
        "_tools.locate_master_entry (master.bib) or _bib_parse.find_entry_span "
        "(references.bib)"
    )


def test_the_census_would_have_caught_the_old_writers():
    old = 'pat = re.compile(r"@\\w+\\s*\\{\\s*" + key)\nwhile depth:\n    depth += 1\n'
    assert re.search(r"\bdepth \+= 1", old) and _BIB_OPENER.search(old)


def test_no_unanchored_opener_search_in_bib_writers():
    for name in ("repair_etal_citekeys.py", "merge_paper_references.py", "rename_citekeys.py"):
        src = (SCRIPTS / name).read_text(encoding="utf-8")
        assert r"@\w+\s*\{\s*" not in src, f"{name} spells its own entry opener"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
