"""The operator's metadata lock is honoured by every pipeline catalog writer.

Task 1470. `metadataLock: true` on a catalog row is the operator's pin: the
pipeline must not rewrite that paper's catalog title (or its other
bibliographic fields) — `_doctrine.md` §4. The one script that checked it
was `apply_metadata_mismatch_policy`; every OTHER writer of the row's title
wrote straight through it, and triage's `.bib` import did worse — it REBUILT
an already-held row from a hand-listed preserve allowlist, so the lock key
itself (and `duplicateOf`, `isScanned`, any key added after the list) was
deleted in the same write that overwrote the pinned title.

The fix is one door, `_tools.split_lock_held`, read by `upsert_catalog_entry`
(index_paper, merge_paper_references), `admit_catalog_row`'s stale-row
refresh, and triage's existing-row branch — which now PATCHES the keys it owns
instead of rebuilding the row.

Task 1624 closes the master.bib half: `_doctrine.md` §4's "do not touch
master.bib" is honoured by the master.bib WRITE DOOR itself
(`update_master_bib_entry` holds the pinned bib fields of a locked row), so
index_paper's re-authentication of an `unverified`/`failed` locked entry, the
authenticate-bib shim, triage's .bib drop and the mismatch policy cannot drift
master.bib away from the pinned catalog row. The operator's own edit passes the
one named bypass (`override_lock` / `--override-metadata-lock`).

Run: python3 -m pytest library/scripts/tests/test_metadata_lock_writers.py -v
     python3 library/scripts/tests/test_metadata_lock_writers.py  (no pytest)
"""
import json
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import index_paper as ip  # noqa: E402
import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
from _tools import (  # noqa: E402
    METADATA_LOCK_KEY,
    admit_catalog_row,
    master_entry_for,
    read_catalog,
    split_lock_held,
    update_master_bib_entry,
    write_catalog,
)


PINNED = "The Pinned Title"


def _init_library(tmp_path: Path) -> Path:
    (tmp_path / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": []}) + "\n")
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _make_holding(library: Path, citekey: str) -> None:
    d = library / "papers" / citekey
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{citekey}.pdf").write_text("%PDF-fake\n")


def _fields(**over) -> dict:
    f = {"title": "A Different Title From The Drop",
         "author": "Doe, Jane", "year": "2001", "doi": "10.1000/new"}
    f.update(over)
    return f


def _held_row(citekey: str, *, locked: bool) -> dict:
    row = {
        "citekey": citekey, "title": PINNED, "authors": ["Pinned, Author"],
        "year": 1999, "doi": "10.1000/pinned",
        "addedAt": "2020-01-01T00:00:00Z",
        "pdf": {"present": True, "pageCount": 12},
        "indexed": {"state": "deep", "warnings": []},
        "bib": {"state": "authenticated"},
        "tags": ["kept"], "duplicateOf": "other2001", "isScanned": True,
        "someFutureKey": {"nested": 1},
    }
    if locked:
        row[METADATA_LOCK_KEY] = True
    return row


def _row(library: Path, citekey: str) -> dict:
    return next(e for e in read_catalog(library)["entries"]
                if e["citekey"] == citekey)


# ── the door ──────────────────────────────────────────────────────────


def test_split_holds_only_bibliographic_keys_on_a_locked_row():
    row = _held_row("x", locked=True)
    writable, held = split_lock_held(
        row, {"title": "New", "year": 1999, "pdf": {"present": True}})
    assert writable == {"pdf": {"present": True}}
    # `year` is re-written with its own value — not a hold worth reporting.
    assert held == ["title"]


def test_split_passes_everything_on_an_unlocked_row():
    writable, held = split_lock_held(_held_row("x", locked=False), {"title": "New"})
    assert writable == {"title": "New"} and held == []


# ── triage's .bib import (the reported defect) ────────────────────────


def test_bib_import_onto_a_locked_holding_keeps_the_pin_and_every_key(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held2001")
    write_catalog(lib, {"version": 1, "entries": [_held_row("held2001", locked=True)]})
    held = ta._upsert_catalog_row_bib_only(
        lib, "held2001", "article", _fields(), bib_state="unverified",
        field_changes=[{"field": "title"}])
    row = _row(lib, "held2001")
    assert row[METADATA_LOCK_KEY] is True, "the import deleted the operator's pin"
    assert row["title"] == PINNED, "the import overwrote a locked title"
    assert row["authors"] == ["Pinned, Author"] and row["doi"] == "10.1000/pinned"
    for k in ("duplicateOf", "isScanned", "tags", "someFutureKey", "addedAt"):
        assert row[k] == _held_row("held2001", locked=True)[k], k
    assert row["pdf"] == {"present": True, "pageCount": 12}
    assert row["indexed"]["state"] == "deep"
    # The import still lands what it owns: the bib state + its history.
    assert row["bib"]["fieldChanges"] == [{"field": "title"}]
    assert "updatedAt" in row
    # …and says what the lock held, so the triage report can name it.
    assert held == ["authors", "doi", "title", "year"]


def test_bib_import_onto_an_unlocked_holding_takes_the_new_fields_only(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held2001")
    write_catalog(lib, {"version": 1, "entries": [_held_row("held2001", locked=False)]})
    held = ta._upsert_catalog_row_bib_only(
        lib, "held2001", "article", _fields(), bib_state="unverified")
    row = _row(lib, "held2001")
    assert held == []
    assert row["title"] == "A Different Title From The Drop"
    assert row["year"] == 2001 and row["authors"] == ["Doe, Jane"]
    assert METADATA_LOCK_KEY not in row
    for k in ("duplicateOf", "isScanned", "tags", "someFutureKey", "addedAt"):
        assert row[k] == _held_row("held2001", locked=False)[k], k


# ── the other writers of the row's title, through the same door ───────


def test_index_paper_sync_from_master_keeps_a_locked_title(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held2001")
    update_master_bib_entry(lib, "held2001", "article", _fields(),
                            bib_state="unverified")
    write_catalog(lib, {"version": 1, "entries": [_held_row("held2001", locked=True)]})
    ip.sync_catalog_entry_from_master(lib, "held2001", {"state": "unverified"})
    row = _row(lib, "held2001")
    assert row["title"] == PINNED and row[METADATA_LOCK_KEY] is True


def test_merge_paper_references_keeps_a_locked_title(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held2001")
    update_master_bib_entry(lib, "held2001", "article", _fields(),
                            bib_state="unverified")
    write_catalog(lib, {"version": 1, "entries": [_held_row("held2001", locked=True)]})
    mpr._upsert_catalog_row(lib, "held2001", {"state": "unverified"},
                            {"type": "article", "fields": _fields()})
    row = _row(lib, "held2001")
    assert row["title"] == PINNED and row["pdf"]["present"] is True


def test_door_refresh_of_a_locked_reference_row_keeps_its_title(tmp_path):
    lib = _init_library(tmp_path)
    update_master_bib_entry(lib, "ref2001", "article", _fields(),
                            bib_state="unverified")
    row = _held_row("ref2001", locked=True)
    row["pdf"] = {"present": False}
    write_catalog(lib, {"version": 1, "entries": [row]})
    assert admit_catalog_row(
        lib, "ref2001", entry_type="article", fields=_fields(),
        bib_state="unverified", top={"title": "Refreshed"}) is False
    assert _row(lib, "ref2001")["title"] == PINNED


# ── the master.bib half (task 1624) ───────────────────────────────────


def _locked_with_master(tmp_path: Path, citekey: str = "held2001") -> Path:
    lib = _init_library(tmp_path)
    _make_holding(lib, citekey)
    update_master_bib_entry(lib, citekey, "article", {
        "title": PINNED, "author": "Pinned, Author", "year": "1999",
        "doi": "10.1000/pinned"}, bib_state="unverified")
    write_catalog(lib, {"version": 1, "entries": [_held_row(citekey, locked=True)]})
    return lib


def _master_fields(lib: Path, citekey: str = "held2001") -> dict:
    return master_entry_for(lib, citekey)["fields"]


def test_master_door_holds_pinned_fields_of_a_locked_row(tmp_path):
    lib = _locked_with_master(tmp_path)
    held: list = []
    state = update_master_bib_entry(
        lib, "held2001", "article", _fields(journal="Some Journal"),
        bib_state="failed", lock_held=held)
    f = _master_fields(lib)
    assert f["title"] == PINNED and f["author"] == "Pinned, Author"
    assert f["year"] == "1999" and f["doi"] == "10.1000/pinned"
    # Everything the pin does not cover still lands, state included.
    assert f["journal"] == "Some Journal" and state == "failed"
    assert held == ["author", "doi", "title", "year"]


def test_master_door_holds_a_pinned_field_against_removal(tmp_path):
    lib = _locked_with_master(tmp_path)
    update_master_bib_entry(lib, "held2001", "article", {"title": "Other"})
    f = _master_fields(lib)
    assert f["title"] == PINNED and f["doi"] == "10.1000/pinned"


def test_master_door_override_is_the_operators_bypass(tmp_path):
    lib = _locked_with_master(tmp_path)
    held: list = []
    update_master_bib_entry(lib, "held2001", "article", _fields(),
                            override_lock=True, lock_held=held)
    assert _master_fields(lib)["title"] == "A Different Title From The Drop"
    assert held == []


def test_master_door_unlocked_row_is_unaffected(tmp_path):
    lib = _locked_with_master(tmp_path)
    write_catalog(lib, {"version": 1, "entries": [_held_row("held2001", locked=False)]})
    update_master_bib_entry(lib, "held2001", "article", _fields())
    assert _master_fields(lib)["title"] == "A Different Title From The Drop"


@contextmanager
def _stub_authenticate(field_changes):
    class _R:
        state = "unverified"
        doi_verified = False
        sources = ["stub"]
        score = 0.5
        note = ""
        proposed_type = None
    _R.field_changes = field_changes
    real = ip.authenticate
    ip.authenticate = lambda *a, **k: _R()
    try:
        yield
    finally:
        ip.authenticate = real


def test_reindex_auth_of_a_locked_unverified_entry_keeps_master_and_row(tmp_path):
    lib = _locked_with_master(tmp_path)
    fields = dict(_master_fields(lib))
    bib_entry = {"type": "article", "state": "unverified", "fields": fields}
    changes = [{"field": "title", "from": PINNED, "to": "A Lookup Title"},
               {"field": "pages", "from": "", "to": "1--20"}]
    with _stub_authenticate(changes):
        status = ip._authenticate_master_entry(
            lib, "held2001", bib_entry, fields, lambda m: None)
    assert _master_fields(lib)["title"] == PINNED
    assert _master_fields(lib)["pages"] == "1--20"
    # The in-memory fields feed references.bib + the catalog sync: same answer.
    assert fields["title"] == PINNED
    assert status["fieldChanges"] == [changes[1]]
    assert status["lockHeld"] == ["title"]
    ip.sync_catalog_entry_from_master(lib, "held2001", status)
    assert _row(lib, "held2001")["title"] == PINNED


def test_bib_drop_onto_a_locked_entry_keeps_master_and_references(tmp_path):
    lib = _locked_with_master(tmp_path)
    out = ta.apply_bib_row({
        "filename": "drop.bib", "proposedCitekey": "held2001",
        "proposedType": "article", "proposedFields": _fields(),
        "proposedBibState": "unverified"}, lib)
    assert out["status"] != "bib-ignored", out
    assert _master_fields(lib)["title"] == PINNED
    refs = (lib / "papers" / "held2001" / "references.bib").read_text()
    assert PINNED in refs and "A Different Title From The Drop" not in refs


def _shim(script: str, lib: Path, *args: str) -> "subprocess.CompletedProcess":
    return subprocess.run(
        [sys.executable, str(Path(_SCRIPTS) / script), *args, "--library", str(lib)],
        capture_output=True, text=True)


def test_bib_shim_reports_a_lock_hold_as_exit_5(tmp_path):
    lib = _locked_with_master(tmp_path)
    ff = tmp_path / "set.json"
    ff.write_text(json.dumps({"title": "Shim Title", "note": "n"}))
    r = _shim("update_master_bib_entry.py", lib, "held2001", "--entry-type",
              "article", "--fields-file", str(ff), "--merge-existing")
    assert r.returncode == 5, r.stderr
    assert "metadataLock" in r.stderr
    f = _master_fields(lib)
    assert f["title"] == PINNED and f["note"] == "n"
    r = _shim("update_master_bib_entry.py", lib, "held2001", "--entry-type",
              "article", "--fields-file", str(ff), "--merge-existing",
              "--override-metadata-lock")
    assert r.returncode == 0, r.stderr
    assert _master_fields(lib)["title"] == "Shim Title"


def test_catalog_shim_honours_the_lock_only_when_asked(tmp_path):
    lib = _locked_with_master(tmp_path)
    pf = tmp_path / "patch.json"
    pf.write_text(json.dumps({"title": "Policy Title", "bib": {"state": "needs-reauth"}}))
    r = _shim("update_catalog_entry.py", lib, "held2001", "--patch-file",
              str(pf), "--honour-metadata-lock")
    assert r.returncode == 5, r.stderr
    row = _row(lib, "held2001")
    assert row["title"] == PINNED and row["bib"]["state"] == "needs-reauth"
    r = _shim("update_catalog_entry.py", lib, "held2001", "--patch-file", str(pf))
    assert r.returncode == 0, r.stderr
    assert _row(lib, "held2001")["title"] == "Policy Title"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
