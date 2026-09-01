"""Tests for _bib_parse — the shared lightweight BibTeX parser.

The load-bearing case here is robustness to a brace-unbalanced entry: the old
global brace-matcher let one bad entry swallow the rest of the file, silently
dropping ~82% of a real 34k-entry master.bib. Membership checks
(`citekey in read_master_bib(...)` in triage_apply) then wrongly reported real
entries as missing → duplicate adds / wrong triage. This mirrors the
regression guard in test_bib_index.py for the `_tools` twin.

Run: python3 -m pytest library/scripts/tests/test_bib_parse.py
(or: python3 library/scripts/tests/test_bib_parse.py)
"""
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

from _bib_parse import (  # noqa: E402
    parse_bib_text,
    read_bib_file,
    read_master_bib,
)


def test_malformed_entry_does_not_swallow_following_entries(tmp_path):
    # A brace-unbalanced entry must NOT consume the rest of the file. This is
    # the exact failure mode of the old global brace-match.
    bib = (
        "@article{good1,\n  title = {First},\n  author = {A, A},\n}\n\n"
        "@article{broken,\n  title = {Bad {unbalanced},\n  author = {B, B},\n}\n\n"
        "@book{good2,\n  title = {Third},\n  author = {C, C},\n  year = {2001},\n}\n"
    )
    entries = parse_bib_text(bib)
    # File order preserved, every entry recovered.
    assert [e["citekey"] for e in entries] == ["good1", "broken", "good2"], entries
    by_key = {e["citekey"]: e for e in entries}
    # good2 survives the malformed entry with correct type + fields.
    assert by_key["good2"]["type"] == "book"
    assert by_key["good2"]["fields"]["year"] == "2001"
    # …and the malformed entry's raw must NOT have swallowed good2.
    assert "good2" not in by_key["broken"]["raw"]


def test_read_master_bib_is_robust_to_malformed_entries(tmp_path):
    bib = (
        "@article{good1,\n  title = {First},\n  author = {A, A},\n}\n\n"
        "@article{broken,\n  title = {Bad {unbalanced},\n  author = {B, B},\n}\n\n"
        "@book{good2,\n  title = {Third},\n  year = {2001},\n}\n"
    )
    p = tmp_path / "master.bib"
    p.write_text(bib)
    d = read_master_bib(p)
    assert set(d.keys()) == {"good1", "broken", "good2"}, list(d.keys())
    assert d["good2"]["fields"]["year"] == "2001"
    assert d["good2"]["type"] == "book"
    assert "good2" not in d["broken"]["raw"]
    # Well-formed raw is exact (round-trippable).
    assert d["good1"]["raw"].startswith("@article{good1,")
    assert d["good1"]["raw"].rstrip().endswith("}")


def test_membership_after_malformed_entry(tmp_path):
    # The concrete triage_apply.py failure: `citekey in read_master_bib(...)`
    # must report the truth for entries that follow a malformed one.
    bib = (
        "@article{first,\n  title = {A},\n}\n\n"
        "@article{bad,\n  title = {Open {brace},\n}\n\n"
        "@article{later,\n  title = {B},\n}\n"
    )
    p = tmp_path / "master.bib"
    p.write_text(bib)
    master = read_master_bib(p)
    assert "later" in master  # would be wrongly False under the old scanner
    assert "first" in master
    assert "missing" not in master


def test_string_comment_preamble_are_skipped(tmp_path):
    # These lack the `@type{key,` form, so the line-anchored splitter excludes
    # them just like the old explicit skip did.
    bib = (
        "@string{jphil = {Journal of Philosophy}}\n\n"
        "@comment{this is a comment block {with braces}}\n\n"
        "@preamble{ \"\\newcommand{\\x}{y}\" }\n\n"
        "@article{real2020,\n  title = {Real},\n  journal = jphil,\n}\n"
    )
    entries = parse_bib_text(bib)
    assert [e["citekey"] for e in entries] == ["real2020"], entries
    assert entries[0]["type"] == "article"


def test_nested_braces_in_fields_are_preserved(tmp_path):
    bib = (
        "@article{nested,\n"
        "  title = {A {Nested} Title with {Deep {Braces}}},\n"
        "  author = {Last, First},\n}\n"
    )
    entries = parse_bib_text(bib)
    assert len(entries) == 1
    assert entries[0]["fields"]["title"] == "A {Nested} Title with {Deep {Braces}}"


def test_read_bib_file_missing_returns_empty(tmp_path):
    assert read_bib_file(tmp_path / "nope.bib") == []


def test_last_wins_on_duplicate_citekeys(tmp_path):
    bib = (
        "@article{dup,\n  title = {Old},\n  year = {1999},\n}\n\n"
        "@article{dup,\n  title = {New},\n  year = {2020},\n}\n"
    )
    p = tmp_path / "master.bib"
    p.write_text(bib)
    d = read_master_bib(p)
    # parse_bib_text keeps both (file order); read_master_bib's dict is last-wins.
    assert [e["citekey"] for e in parse_bib_text(bib)] == ["dup", "dup"]
    assert d["dup"]["fields"]["year"] == "2020"


if __name__ == "__main__":
    # Fixtures are injected BY NAME (see `_standalone.py`). Every leg here
    # takes `tmp_path` alone, so this file never showed the defect that
    # motivated the shared runner (`test_f4_writer_side.py` did) — it carried
    # the same positional runner, which is the shape that hides one.
    from _standalone import main

    sys.exit(main(globals()))
