"""Catalog `bib` state is READ BACK from master.bib, never asserted (task 797).

`/library/authenticate-bib` used to compose the catalog row's `bib` block in
step 7's inline Python:

  1. its tier-1 upgrade was computed AFTER step 5 had stamped master.bib, so
     the upgrade reached the catalog row and never master.bib;
  2. it wrote the REQUESTED state even when the write door held a settled one
     (task 621), so a re-auth with a flaky network showed "Unverified" for an
     entry master.bib still called authenticated;
  3. it pre-merged the prior row's `fieldChanges` and the door appended them
     again, so history doubled every run.

The rule now: `bib_auth.settle_auth_verdict` decides the verdict before any
write, `_tools.settle_catalog_bib` composes every catalog writer's `bib`
block (state from master.bib, history appended once), and
`_sync_catalog_entry_from_master` returns the state that SETTLED.

Run: python3 library/scripts/tests/test_auth_state_readback.py
"""
import inspect
import json
import re
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import index_paper as ip  # noqa: E402
import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
from bib_auth import settle_auth_verdict  # noqa: E402
from _tools import (  # noqa: E402
    iter_master_bib_states,
    read_catalog,
    settle_catalog_bib,
    update_master_bib_entry,
    write_catalog,
)


def _lib(tmp_path: Path, citekey: str, state: str, *, held: bool) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    update_master_bib_entry(
        tmp_path, citekey, "book",
        {"title": "A Work", "author": "Doe, Jane", "year": "1950"},
        bib_state=state)
    if held:
        d = tmp_path / "papers" / citekey
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{citekey}.pdf").write_text("%PDF-fake\n")
    return tmp_path


def _master_state(lib: Path, citekey: str) -> str:
    return dict(iter_master_bib_states((lib / "master.bib").read_text())).get(citekey, "")


def _row(lib: Path, citekey: str) -> dict:
    return next(e for e in read_catalog(lib).get("entries", [])
                if e.get("citekey") == citekey)


def _result(state: str, changes=None, sources=None) -> dict:
    return {"state": state, "doi_verified": False, "sources": sources or ["openlibrary"],
            "field_changes": changes or [], "score": 0.5, "note": "run note"}


# ── Member 2: a held settled state is what the row records ──────────


def test_holding_reauth_with_a_weaker_result_keeps_the_settled_state(tmp_path):
    lib = _lib(tmp_path, "held", "authenticated", held=True)
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "held", "bib": {"state": "authenticated",
                                    "sources": ["crossref", "openalex"],
                                    "note": "earned"}}]})
    verdict = settle_auth_verdict(_result("unverified"))
    settled = ip._sync_catalog_entry_from_master(lib, "held", verdict)
    assert settled == "authenticated"
    assert _master_state(lib, "held") == "authenticated"
    bib = _row(lib, "held")["bib"]
    assert bib["state"] == _master_state(lib, "held")
    # The held verdict's evidence does not overwrite the evidence that earned it.
    assert bib["sources"] == ["crossref", "openalex"]
    assert bib["note"] == "earned"


def test_reference_row_reauth_with_a_weaker_result_keeps_the_settled_state(tmp_path):
    lib = _lib(tmp_path, "ref", "canonical", held=False)
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "ref", "bib": {"state": "canonical"}}]})
    settled = ip._sync_catalog_entry_from_master(
        lib, "ref", settle_auth_verdict(_result("failed")))
    assert settled == "canonical" == _master_state(lib, "ref")
    assert _row(lib, "ref")["bib"]["state"] == "canonical"


# ── Member 1: the tier-1 upgrade is decided before the write ────────


def test_tier1_upgrade_is_computed_before_the_write_and_lands_in_master(tmp_path):
    lib = _lib(tmp_path, "held", "unverified", held=True)
    tier1 = [{"field": "publisher", "from": "", "to": "OUP",
              "source": "internet-archive", "at": "t"},
             {"field": "isbn", "from": "", "to": "123",
              "source": "publisher-page", "at": "t"}]
    verdict = settle_auth_verdict(_result("unverified"), tier1)
    assert verdict["state"] == "authenticated"
    assert "authenticatedAt" in verdict
    assert verdict["sources"] == ["openlibrary", "internet-archive", "publisher-page"]
    # Even if the step-5 write stamped the raw state, step 7 re-stamps the verdict.
    settled = ip._sync_catalog_entry_from_master(lib, "held", verdict)
    assert settled == "authenticated" == _master_state(lib, "held")
    assert _row(lib, "held")["bib"]["state"] == "authenticated"


def test_canonical_upgrades_and_one_source_does_not(tmp_path):
    two = [{"field": "a", "source": "worldcat"}, {"field": "b", "source": "crossref-raw"}]
    assert settle_auth_verdict(_result("canonical"), two)["state"] == "authenticated"
    one = [{"field": "a", "source": "worldcat"}, {"field": "b", "source": "worldcat"}]
    assert settle_auth_verdict(_result("unverified"), one)["state"] == "unverified"
    assert settle_auth_verdict(_result("failed"), two)["state"] == "failed"


def test_settle_verdict_cli(tmp_path):
    rf = tmp_path / "r.json"
    rf.write_text(json.dumps(_result("unverified", changes=[{"field": "year"}])))
    tf = tmp_path / "t.json"
    tf.write_text(json.dumps([{"field": "x", "source": "worldcat"},
                              {"field": "y", "source": "internet-archive"}]))
    proc = subprocess.run(
        [sys.executable, str(_SCRIPTS / "bib_auth.py"), "settle-verdict",
         "--result-file", str(rf), "--tier1-file", str(tf)],
        capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["state"] == "authenticated"
    assert [c["field"] for c in out["fieldChanges"]] == ["year", "x", "y"]


# ── Member 3: history grows by exactly the fresh list per run ───────


def test_pre_f4_reference_row_history_grows_by_the_fresh_list_only(tmp_path):
    lib = _lib(tmp_path, "ref", "unverified", held=False)
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "ref", "bib": {"state": "unverified",
                                   "fieldChanges": [{"field": "old"}]}}]})
    for n in range(1, 4):
        ip._sync_catalog_entry_from_master(
            lib, "ref", settle_auth_verdict(_result("unverified", changes=[{"field": f"r{n}"}])))
    fields = [c["field"] for c in _row(lib, "ref")["bib"]["fieldChanges"]]
    assert fields == ["old", "r1", "r2", "r3"]


def test_holding_row_history_grows_by_the_fresh_list_only(tmp_path):
    lib = _lib(tmp_path, "held", "unverified", held=True)
    for n in range(1, 4):
        ip._sync_catalog_entry_from_master(
            lib, "held", settle_auth_verdict(_result("unverified", changes=[{"field": f"r{n}"}])))
    fields = [c["field"] for c in _row(lib, "held")["bib"]["fieldChanges"]]
    assert fields == ["r1", "r2", "r3"]


# ── The shared composition ─────────────────────────────────────────


def test_settle_catalog_bib_reads_state_from_master(tmp_path):
    lib = _lib(tmp_path, "k", "manuscript", held=False)
    out = settle_catalog_bib(lib, "k", {"state": "manuscript", "fieldChanges": [1]},
                             {"state": "unverified", "fieldChanges": [2], "score": 0.1})
    assert out["state"] == "manuscript"
    assert "score" not in out
    assert out["fieldChanges"] == [1, 2]
    # No master comment at all → the request stands.
    (lib / "master.bib").write_text("")
    assert settle_catalog_bib(lib, "k", None, {"state": "unverified"})["state"] == "unverified"


def test_every_catalog_bib_writer_composes_through_the_one_function():
    """CENSUS: no writer hand-merges `fieldChanges` anymore."""
    for mod in (ip, mpr, ta):
        src = inspect.getsource(mod)
        assert "settle_catalog_bib(" in src, mod.__name__
        # A hand merge concatenates history on one line: `…fieldChanges… + …`.
        assert not re.search(r'fieldChanges[^\n]*\+', src), mod.__name__


def _run_standalone() -> int:
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    failures = 0
    for name, fn in tests:
        with tempfile.TemporaryDirectory() as td:
            try:
                if "tmp_path" in inspect.signature(fn).parameters:
                    fn(tmp_path=Path(td))
                else:
                    fn()
                print(f"  PASS  {name}")
            except Exception:
                failures += 1
                print(f"  FAIL  {name}")
                traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
