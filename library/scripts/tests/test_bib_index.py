"""Tests for build_bib_index — the slim browse-index emitter.

Run: python3 -m pytest library/scripts/tests/test_bib_index.py
(or: python3 library/scripts/tests/test_bib_index.py)
"""
import json
import subprocess
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

from _tools import (  # noqa: E402
    build_bib_index,
    iter_master_bib_slim,
    iter_master_bib_states,
    read_master_bib,
)


def _write(lib: Path, bib: str) -> None:
    (lib / ".virgil").mkdir(parents=True, exist_ok=True)
    (lib / "master.bib").write_text(bib)


def test_malformed_entry_does_not_swallow_following_entries(tmp_path):
    # A brace-unbalanced entry must NOT consume the rest of the file. This is
    # the exact failure mode of the old read_master_bib() global brace-match,
    # which dropped ~82% of the real library on one bad entry.
    bib = (
        "@article{good1,\n  title = {First},\n  author = {A, A},\n}\n\n"
        "@article{broken,\n  title = {Bad {unbalanced},\n  author = {B, B},\n}\n\n"
        "@book{good2,\n  title = {Third},\n  author = {C, C},\n  year = {2001},\n}\n"
    )
    keys = [k for k, _t, _f in iter_master_bib_slim(bib)]
    assert keys == ["good1", "broken", "good2"], keys


def test_build_emits_slim_index_with_all_entries(tmp_path):
    _write(tmp_path, (
        "@article{smith2020,\n  title = {A Title},\n  author = {Smith, Jane},\n"
        "  year = {2020},\n  doi = {10.1/x},\n  journal = {J Phil},\n}\n\n"
        "@book{jones2019,\n  title = {A Book},\n  author = {Jones, Bob},\n"
        "  year = {2019},\n  booktitle = {Coll},\n}\n"
    ))
    assert build_bib_index(tmp_path, force=True) is True
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    assert idx["count"] == 2
    by_key = {e["k"]: e for e in idx["entries"]}
    assert by_key["smith2020"] == {
        "k": "smith2020", "t": "A Title", "a": "Smith, Jane",
        "y": "2020", "d": "10.1/x", "j": "J Phil",
    }
    # booktitle maps to "b"; missing doi/journal omitted (not empty strings).
    assert by_key["jones2019"]["b"] == "Coll"
    assert "d" not in by_key["jones2019"]
    # stamp file written alongside.
    assert (tmp_path / ".virgil" / "bib-index.stamp").exists()


def test_slim_projection_carries_all_browse_fields(tmp_path):
    # The browse path reads author/editor for the list, journal/booktitle for
    # search, and volume/number/pages/publisher/series for the picker's
    # expanded details — all must survive into the slim index.
    _write(tmp_path, (
        "@incollection{vol2018,\n  title = {A Chapter},\n  editor = {Ed, Eve},\n"
        "  year = {2018},\n  booktitle = {The Volume},\n  volume = {3},\n"
        "  number = {2},\n  pages = {10--20},\n  publisher = {Pub Co},\n"
        "  series = {A Series},\n}\n"
    ))
    assert build_bib_index(tmp_path, force=True) is True
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    e = idx["entries"][0]
    assert e == {
        "k": "vol2018", "t": "A Chapter", "e": "Ed, Eve", "y": "2018",
        "b": "The Volume", "v": "3", "n": "2", "p": "10--20",
        "q": "Pub Co", "s": "A Series",
    }


def test_projects_bib_state_comment_into_bs(tmp_path):
    # F#4: the per-entry `% bib.state = <state>` comment is the authoritative
    # auth-state home for the reference universe; build_bib_index must project
    # it into each record's `bs`. Entries with no comment carry no `bs`.
    _write(tmp_path, (
        "% bib.state = authenticated\n"
        "@article{auth,\n  title = {A},\n  author = {A, A},\n}\n\n"
        "% bib.state = manuscript\n"
        "@unpublished{ms,\n  title = {M},\n}\n\n"
        "@book{plain,\n  title = {P},\n  year = {1850},\n}\n"
    ))
    assert build_bib_index(tmp_path, force=True) is True
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    by_key = {e["k"]: e for e in idx["entries"]}
    assert by_key["auth"]["bs"] == "authenticated"
    assert by_key["ms"]["bs"] == "manuscript"
    assert "bs" not in by_key["plain"]  # no comment → no state projected
    # Standalone helper agrees.
    assert dict(iter_master_bib_states((tmp_path / "master.bib").read_text())) == {
        "auth": "authenticated", "ms": "manuscript",
    }


def test_bib_state_comment_tolerates_blank_line_before_entry(tmp_path):
    _write(tmp_path, (
        "% bib.state = failed\n\n"
        "@article{spaced,\n  title = {S},\n}\n"
    ))
    assert build_bib_index(tmp_path, force=True) is True
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    assert idx["entries"][0]["bs"] == "failed"


def test_stamp_gate_skips_rebuild_when_master_unchanged(tmp_path):
    _write(tmp_path, "@article{a,\n  title = {T},\n}\n")
    assert build_bib_index(tmp_path, force=True) is True
    # Second call, master.bib untouched → no-op (returns False).
    assert build_bib_index(tmp_path) is False
    # After a master.bib change, it rebuilds again.
    (tmp_path / "master.bib").write_text("@article{a,\n  title = {T2},\n}\n")
    assert build_bib_index(tmp_path) is True


def test_read_master_bib_is_robust_to_malformed_entries(tmp_path):
    # Regression: the old global brace-matcher let one unbalanced entry swallow
    # the rest of the file (dropped ~82% of a real library). read_master_bib
    # must recover every entry and keep each raw block bounded.
    bib = (
        "@article{good1,\n  title = {First},\n  author = {A, A},\n}\n\n"
        "@article{broken,\n  title = {Bad {unbalanced},\n  author = {B, B},\n}\n\n"
        "@book{good2,\n  title = {Third},\n  year = {2001},\n}\n"
    )
    p = tmp_path / "master.bib"
    p.write_text(bib)
    d = read_master_bib(p)
    assert set(d.keys()) == {"good1", "broken", "good2"}, list(d.keys())
    # good2 must survive the malformed entry, with correct fields…
    assert d["good2"]["fields"]["year"] == "2001"
    assert d["good2"]["type"] == "book"
    # …and the malformed entry's raw must NOT have swallowed good2.
    assert "good2" not in d["broken"]["raw"]
    # well-formed raw is exact (round-trippable).
    assert d["good1"]["raw"].startswith("@article{good1,")
    assert d["good1"]["raw"].rstrip().endswith("}")


def test_missing_master_bib_yields_empty_index(tmp_path):
    (tmp_path / ".virgil").mkdir(parents=True)
    assert build_bib_index(tmp_path, force=True) is True
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    assert idx["count"] == 0


def test_atexit_rebuilds_index_after_a_master_write(tmp_path):
    # Coherence mechanism: a writer process that touches master.bib must
    # rebuild bib-index.json once on exit (atexit-coalesced), with no explicit
    # build call — this is how the index stays fresh during cowork.
    (tmp_path / ".virgil").mkdir(parents=True)
    (tmp_path / "master.bib").write_text(
        "@article{first,\n  title = {One},\n  author = {A, A},\n}\n"
    )
    child = (
        "import sys; sys.path.insert(0, %r)\n"
        "from pathlib import Path\n"
        "from _tools import update_master_bib_entry\n"
        "update_master_bib_entry(Path(%r), 'second', 'article', {'title': 'Two'})\n"
    ) % (_SCRIPTS, str(tmp_path))
    subprocess.run([sys.executable, "-c", child], check=True)
    idx = json.loads((tmp_path / ".virgil" / "bib-index.json").read_text())
    keys = {e["k"] for e in idx["entries"]}
    assert keys == {"first", "second"}, keys


if __name__ == "__main__":
    import tempfile
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        with tempfile.TemporaryDirectory() as d:
            try:
                fn(Path(d))
                print(f"PASS {fn.__name__}")
            except Exception:
                failed += 1
                print(f"FAIL {fn.__name__}")
                traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
