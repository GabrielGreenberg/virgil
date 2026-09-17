"""Settled master.bib entries and the one single-entry read door (task 621).

`update_master_bib_entry` holds a terminal `% bib.state` against a weaker one
(unless `allow_downgrade=True`); `index_paper` does not re-authenticate a
settled entry; `_tools.master_entry_for` finds an entry under either Unicode
normalization and raises instead of reading an unreadable file as "no entry";
the `.bib`-drop merge uses it.

Run: python3 library/scripts/tests/test_master_bib_settled_state.py
"""
from __future__ import annotations

import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import _tools  # noqa: E402
import index_paper as ip  # noqa: E402
import triage_apply as ta  # noqa: E402

NFC = unicodedata.normalize("NFC", "tichý1976")
NFD = unicodedata.normalize("NFD", "tichý1976")

VETTED = {
    "title": "Vetted Title",
    "author": "Tichý, Pavel",
    "year": "1976",
    "pages": "1--20",
    "publisher": "Reidel",
    "doi": "10.1000/vetted",
}


def _lib(tmp_path: Path, key: str = "smith2020", state: str = "authenticated",
         fields: dict | None = None) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "catalog.json").write_text('{"version": 1, "entries": []}\n')
    body = ",\n".join(f"  {k} = {{{v}}}" for k, v in (fields or VETTED).items())
    head = f"% bib.state = {state}\n" if state else ""
    (tmp_path / "master.bib").write_text(f"{head}@book{{{key},\n{body}\n}}\n")
    return tmp_path


def _state(lib: Path, key: str) -> str:
    e = _tools.master_entry_for(lib, key)
    return e["state"] if e else ""


# ── the write door holds a settled state ──────────────────────────────


def test_door_holds_a_settled_state_against_a_weaker_one(tmp_path):
    lib = _lib(tmp_path, state="canonical")
    written = _tools.update_master_bib_entry(
        lib, "smith2020", "book", dict(VETTED), bib_state="unverified")
    assert written == "canonical"
    assert _state(lib, "smith2020") == "canonical"


def test_door_still_lands_the_fields_when_it_holds(tmp_path):
    lib = _lib(tmp_path, state="authenticated")
    _tools.update_master_bib_entry(
        lib, "smith2020", "book", {**VETTED, "note": "added"}, bib_state="failed")
    e = _tools.master_entry_for(lib, "smith2020")
    assert e["fields"]["note"] == "added"
    assert e["state"] == "authenticated"


def test_door_lowers_only_with_allow_downgrade(tmp_path):
    lib = _lib(tmp_path, state="authenticated")
    written = _tools.update_master_bib_entry(
        lib, "smith2020", "book", dict(VETTED), bib_state="needs-reauth",
        allow_downgrade=True)
    assert written == "needs-reauth"
    assert _state(lib, "smith2020") == "needs-reauth"


def test_door_moves_freely_among_unsettled_and_upward(tmp_path):
    lib = _lib(tmp_path, state="unverified")
    assert _tools.update_master_bib_entry(
        lib, "smith2020", "book", dict(VETTED), bib_state="failed") == "failed"
    assert _tools.update_master_bib_entry(
        lib, "smith2020", "book", dict(VETTED), bib_state="authenticated") == "authenticated"


def test_door_holds_through_the_f4_gate_too(tmp_path):
    """`admit_catalog_row` used to state the wider rule was NOT its job; it now
    inherits it from the door."""
    lib = _lib(tmp_path, state="manuscript")
    assert _tools.admit_catalog_row(
        lib, "smith2020", entry_type="book", fields=dict(VETTED),
        bib_state="unverified") is False
    assert _state(lib, "smith2020") == "manuscript"


def test_cli_holds_and_says_so_unless_allowed(tmp_path):
    lib = _lib(tmp_path, state="authenticated")
    ff = tmp_path / "f.json"
    ff.write_text("{}")
    cmd = [sys.executable, str(SCRIPTS / "update_master_bib_entry.py"), "smith2020",
           "--library", str(lib), "--entry-type", "book", "--fields-file", str(ff),
           "--merge-existing", "--bib-state", "unverified", "--no-guard"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "--allow-downgrade" in r.stderr
    assert _state(lib, "smith2020") == "authenticated"
    r = subprocess.run(cmd + ["--allow-downgrade"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert _state(lib, "smith2020") == "unverified"


def test_metadata_mismatch_policy_asks_for_the_downgrade_it_means():
    src = (SCRIPTS / "apply_metadata_mismatch_policy.py").read_text(encoding="utf-8")
    assert '"--allow-downgrade"' in src


# ── index_paper: a settled entry is not re-authenticated ──────────────


def _no_auth(*a, **k):
    raise AssertionError("authenticate() must not run for a settled entry")


def test_index_skips_reauth_of_a_settled_entry(tmp_path):
    lib = _lib(tmp_path, state="canonical")
    entry = _tools.master_entry_for(lib, "smith2020")
    before = (lib / "master.bib").read_text()
    real = ip.authenticate
    ip.authenticate = _no_auth
    try:
        status = ip._authenticate_master_entry(
            lib, "smith2020", entry, entry["fields"], lambda m: None)
    finally:
        ip.authenticate = real
    assert status == {"state": "canonical"}
    assert (lib / "master.bib").read_text() == before


def test_index_still_authenticates_an_unsettled_entry(tmp_path):
    lib = _lib(tmp_path, state="unverified")
    entry = _tools.master_entry_for(lib, "smith2020")
    calls = []

    class R:
        state = "authenticated"
        doi_verified = True
        sources = ["crossref"]
        field_changes = [{"field": "title", "from": "Vetted Title", "to": "Better Title"}]
        score = 0.99
        note = ""
        proposed_type = None

    def fake(*a, **k):
        calls.append(1)
        return R()

    real = ip.authenticate
    ip.authenticate = fake
    try:
        status = ip._authenticate_master_entry(
            lib, "smith2020", entry, entry["fields"], lambda m: None)
    finally:
        ip.authenticate = real
    assert calls and status["state"] == "authenticated"
    e = _tools.master_entry_for(lib, "smith2020")
    assert e["fields"]["title"] == "Better Title"
    assert e["state"] == "authenticated"


def test_no_auth_pass_carries_the_settled_state():
    assert ip._unauthenticated_bib_status({"state": "canonical"}) == {"state": "canonical"}
    assert ip._unauthenticated_bib_status({"state": "failed"}) == {"state": "unverified"}
    assert ip._unauthenticated_bib_status({}) == {"state": "unverified"}


# ── the read door ─────────────────────────────────────────────────────


def test_read_door_finds_an_nfd_entry_from_nfc(tmp_path):
    lib = _lib(tmp_path, key=NFD, state="unverified")
    assert NFC not in _tools.read_master_bib(lib / "master.bib")
    e = _tools.master_entry_for(lib, NFC)
    assert e is not None and e["key"] == NFD
    assert e["fields"]["publisher"] == "Reidel"
    assert e["state"] == "unverified"


def test_read_door_answers_none_for_a_missing_entry_or_file(tmp_path):
    lib = _lib(tmp_path)
    assert _tools.master_entry_for(lib, "nobody1999") is None
    (lib / "master.bib").unlink()
    assert _tools.master_entry_for(lib, "smith2020") is None


def test_read_door_raises_on_an_unreadable_file(tmp_path):
    lib = _lib(tmp_path)
    (lib / "master.bib").write_bytes(b"@book{smith2020,\n  title = {\xff\xfe}\n}\n")
    try:
        _tools.master_entry_for(lib, "smith2020")
    except UnicodeDecodeError:
        return
    raise AssertionError("an undecodable master.bib must raise, not read as empty")


def test_read_door_raises_on_an_unbalanced_entry(tmp_path):
    lib = _lib(tmp_path)
    (lib / "master.bib").write_text("@book{smith2020, title = {Open {x},}\n")
    try:
        _tools.master_entry_for(lib, "smith2020")
    except _tools.BibEntryUnbalanced:
        return
    raise AssertionError("an unbalanced entry's fields are a guess — must raise")


# ── the .bib-drop merge ───────────────────────────────────────────────


def _row(key: str, fields: dict) -> dict:
    return {"filename": "drop.bib", "flags": ["bib-only"], "proposedCitekey": key,
            "proposedType": "book", "proposedFields": fields}


def test_bib_drop_merges_into_an_nfd_entry_without_losing_fields(tmp_path):
    lib = _lib(tmp_path, key=NFD, state="unverified")
    out = ta.apply_bib_row(_row(NFC, {"title": "Vetted Title", "note": "from drop"}), lib)
    assert out["status"] == "bib-imported", out
    e = _tools.master_entry_for(lib, NFC)
    for k in ("pages", "publisher", "doi"):
        assert e["fields"].get(k) == VETTED[k], (k, e["fields"])
    assert e["fields"]["note"] == "from drop"
    entries = _tools.read_master_bib(lib / "master.bib")
    assert len(entries) == 1, "the fold must not append a second entry"


def test_bib_drop_is_ignored_for_a_settled_nfd_entry(tmp_path):
    lib = _lib(tmp_path, key=NFD, state="canonical")
    before = (lib / "master.bib").read_text()
    out = ta.apply_bib_row(_row(NFC, {"title": "Other"}), lib)
    assert out["status"] == "bib-ignored", out
    assert (lib / "master.bib").read_text() == before


def test_bib_drop_aborts_when_master_cannot_be_read(tmp_path):
    lib = _lib(tmp_path, state="unverified")
    bad = b"@book{smith2020,\n  title = {\xff}\n}\n"
    (lib / "master.bib").write_bytes(bad)
    real = ta.resolve_bib_state
    ta.resolve_bib_state = lambda *a, **k: ""  # isolate the merge read
    try:
        out = ta.apply_bib_row(_row("smith2020", {"title": "Only this"}), lib)
    finally:
        ta.resolve_bib_state = real
    assert out["status"] == "bib-master-unreadable", out
    assert (lib / "master.bib").read_bytes() == bad


# ── census: no single-entry raw lookup left behind ────────────────────


def test_no_raw_single_entry_lookup_in_the_migrated_callers():
    import re
    pat = re.compile(r"read_master_bib\([^)]*\)\s*\.get\(|master\.get\(citekey\)")
    for name in ("index_paper.py", "triage_apply.py", "update_master_bib_entry.py"):
        src = (SCRIPTS / name).read_text(encoding="utf-8")
        assert not pat.search(src), f"{name} reads one entry around the door"
    assert "except Exception:\n        existing_master = {}" not in (
        SCRIPTS / "triage_apply.py").read_text(encoding="utf-8")


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
