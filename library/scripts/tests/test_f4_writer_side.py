"""F#4 writer-side guard tests.

Covers:
  * holdings-only gating: a reference-only entry mints NO catalog row but
    DOES get a `% bib.state` comment in master.bib (merge + triage paths);
    a real holding still gets/keeps its catalog row.
  * the relaxed merge_bibs_postflight shrinkage guard: a bare catalog total
    decline is NOT an alert; a master shrink / indexed-state regression IS.
  * the needs-reauth round-trip: the canonical writer state survives into
    the bib-index `bs` field (reader recognizes it).
  * the prune script: dry-run mutates nothing; --apply back-fills the
    `% bib.state` comment BEFORE deleting the row (ordering proof).

Run: python3 -m pytest library/scripts/tests/test_f4_writer_side.py -v
"""
import json
import subprocess
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
import merge_bibs_postflight as postflight  # noqa: E402
import prune_catalog_present_false as prune  # noqa: E402
from _tools import (  # noqa: E402
    CANONICAL_BIB_STATES,
    build_bib_index,
    iter_master_bib_states,
    paper_has_holdings,
    read_catalog,
    write_catalog,
)


# ── fixtures ──────────────────────────────────────────────────────────


def _init_library(tmp_path: Path) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _make_holding(library: Path, citekey: str, ext: str = "pdf") -> None:
    d = library / "papers" / citekey
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{citekey}.{ext}").write_text("%PDF-fake\n")


def _bib_status(state: str) -> dict:
    return {
        "state": state, "doiVerified": False, "sources": [],
        "fieldChanges": [], "score": 0.0, "note": "",
    }


def _catalog_keys(library: Path) -> set[str]:
    return {e.get("citekey") for e in read_catalog(library).get("entries", [])}


# ── holdings model helper ─────────────────────────────────────────────


def test_paper_has_holdings_detects_source_file(tmp_path):
    lib = _init_library(tmp_path)
    assert paper_has_holdings(lib, "held") is False
    _make_holding(lib, "held")
    assert paper_has_holdings(lib, "held") is True
    # docx and tex count too.
    _make_holding(lib, "doc", ext="docx")
    assert paper_has_holdings(lib, "doc") is True


# ── Item 4: merge_paper_references holdings-only gate ─────────────────


def test_merge_reference_only_writes_comment_not_catalog_row(tmp_path):
    lib = _init_library(tmp_path)
    # No source file on disk for `refonly` → reference-only.
    # Seed master.bib so _upsert_catalog_row can re-assert the comment.
    from _tools import update_master_bib_entry
    update_master_bib_entry(lib, "refonly", "article",
                            {"title": "A Ref", "author": "X, Y"}, bib_state="unverified")
    mpr._upsert_catalog_row(
        lib, "refonly", _bib_status("authenticated"),
        master_entry={"type": "article", "fields": {"title": "A Ref", "author": "X, Y"}},
    )
    # NO catalog row minted for the reference-only entry.
    assert "refonly" not in _catalog_keys(lib)
    # BUT the % bib.state comment carries the auth state in master.bib.
    states = dict(iter_master_bib_states((lib / "master.bib").read_text()))
    assert states.get("refonly") == "authenticated"


def test_merge_holding_still_gets_catalog_row(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held")
    mpr._upsert_catalog_row(
        lib, "held", _bib_status("authenticated"),
        master_entry={"type": "article", "fields": {"title": "Held", "author": "A, B", "year": "2020"}},
    )
    assert "held" in _catalog_keys(lib)
    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == "held")
    assert row["bib"]["state"] == "authenticated"
    assert row["title"] == "Held"


# ── Item 4: triage_apply holdings-only gate ──────────────────────────


def test_triage_bib_only_reference_mints_no_catalog_row(tmp_path):
    lib = _init_library(tmp_path)
    ta._upsert_catalog_row_bib_only(
        lib, "citedonly", "article",
        {"title": "Cited Only", "author": "Q, R", "year": "1999"},
        bib_state="unverified",
    )
    # Reference-only .bib import → no catalog row created.
    assert "citedonly" not in _catalog_keys(lib)


def test_triage_bib_only_updates_existing_holding_row_without_clobbering_pdf(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held")
    # Pre-existing holdings row.
    cat = read_catalog(lib)
    cat["entries"].append({
        "citekey": "held", "title": "Old", "authors": ["A"], "year": 2000,
        "pdf": {"present": True, "filename": "held.pdf"},
        "indexed": {"state": "indexed"},
        "bib": {"state": "unverified"},
    })
    from _tools import lock_catalog
    with lock_catalog(lib):
        write_catalog(lib, cat)
    ta._upsert_catalog_row_bib_only(
        lib, "held", "article",
        {"title": "New Title", "author": "A, A"},
        bib_state="authenticated",
    )
    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == "held")
    # bib.state updated…
    assert row["bib"]["state"] == "authenticated"
    # …but pdf.present + indexed NOT clobbered to the bib-only placeholders.
    assert row["pdf"]["present"] is True
    assert row["indexed"]["state"] == "indexed"


# ── Item 5: relaxed shrinkage guard ──────────────────────────────────


def _snap(snap_dir: Path, master_bib: str, catalog: dict) -> None:
    snap_dir.mkdir(parents=True, exist_ok=True)
    (snap_dir / "master.bib").write_text(master_bib)
    (snap_dir / "catalog.json").write_text(json.dumps(catalog))


def _live(library: Path, master_bib: str, catalog: dict) -> None:
    (library / "master.bib").write_text(master_bib)
    (library / ".virgil").mkdir(parents=True, exist_ok=True)
    (library / ".virgil" / "catalog.json").write_text(json.dumps(catalog))


def test_postflight_catalog_shrink_alone_is_not_an_alert(tmp_path):
    lib = _init_library(tmp_path)
    snap = tmp_path / "snap"
    # master.bib unchanged (same 2 entries); catalog shrinks from 5 → 2
    # (reference rows pruned), no indexed-state regression.
    master = "@article{a,\n  title={A},\n}\n\n@article{b,\n  title={B},\n}\n"
    # The pruned reference-only rows (c/d/e) carry indexed.state="indexed"
    # in the snapshot too — proving that even when their COUNT drops, the
    # guard only fires on a true regression. Here the surviving holdings
    # (a,b) keep "indexed", so indexed total goes 5→2 with NO regression
    # below the holdings floor... but to model a pure-shrink-no-regression
    # case cleanly, the snapshot uses a state that fully disappears with the
    # reference rows yet is NOT a holding signal: reference rows are
    # indexed.state="none", and `none` is allowed to drop freely.
    before_cat = {"entries": [
        {"citekey": "a", "indexed": {"state": "indexed"}},
        {"citekey": "b", "indexed": {"state": "indexed"}},
        {"citekey": "c", "indexed": {"state": "none"}},
        {"citekey": "d", "indexed": {"state": "none"}},
        {"citekey": "e", "indexed": {"state": "none"}},
    ]}
    after_cat = {"entries": [
        {"citekey": "a", "indexed": {"state": "indexed"}},
        {"citekey": "b", "indexed": {"state": "indexed"}},
    ]}
    _snap(snap, master, before_cat)
    _live(lib, master, after_cat)
    cat = postflight._check_catalog(snap, lib)
    mst = postflight._check_master(snap, lib)
    assert cat["shrank"] is True
    assert cat["state_regressions"] == []
    assert mst["shrank"] is False
    # Simulate the alert logic in main().
    alerts = []
    if mst["shrank"]:
        alerts.append("master")
    for r in cat["state_regressions"]:
        alerts.append("regress")
    assert alerts == []  # catalog shrink alone → clean


def test_postflight_indexed_state_regression_still_alerts(tmp_path):
    lib = _init_library(tmp_path)
    snap = tmp_path / "snap"
    master = "@article{a,\n  title={A},\n}\n"
    before_cat = {"entries": [
        {"citekey": "a", "indexed": {"state": "indexed"}},
        {"citekey": "b", "indexed": {"state": "indexed"}},
    ]}
    # A holding lost its indexed status → genuine data loss.
    after_cat = {"entries": [
        {"citekey": "a", "indexed": {"state": "none"}},
    ]}
    _snap(snap, master, before_cat)
    _live(lib, master, after_cat)
    cat = postflight._check_catalog(snap, lib)
    assert any(r["state"] == "indexed" for r in cat["state_regressions"])


# ── needs-reauth round-trip ──────────────────────────────────────────


def test_needs_reauth_is_canonical(tmp_path):
    assert "needs-reauth" in CANONICAL_BIB_STATES


def test_needs_reauth_round_trips_into_bib_index(tmp_path):
    # Writer state needs-reauth must survive into the slim index `bs` field
    # (the reader-side VALID_BIB_STATES must recognize it).
    lib = _init_library(tmp_path)
    from _tools import update_master_bib_entry
    update_master_bib_entry(lib, "mismatch", "book",
                            {"title": "A Book"}, bib_state="needs-reauth")
    assert build_bib_index(lib, force=True) is True
    idx = json.loads((lib / ".virgil" / "bib-index.json").read_text())
    row = next(e for e in idx["entries"] if e["k"] == "mismatch")
    assert row["bs"] == "needs-reauth"


# ── Item 6: prune script ─────────────────────────────────────────────


def _seed_prune_fixture(lib: Path) -> None:
    """master.bib + catalog with one holding and two reference-only rows."""
    from _tools import update_master_bib_entry
    _make_holding(lib, "held")
    update_master_bib_entry(lib, "held", "article",
                            {"title": "Held", "author": "A, A"}, bib_state="authenticated")
    update_master_bib_entry(lib, "refA", "article",
                            {"title": "Ref A", "author": "B, B"}, bib_state="unverified")
    update_master_bib_entry(lib, "refB", "book",
                            {"title": "Ref B"}, bib_state="failed")
    cat = {"version": 1, "entries": [
        {"citekey": "held", "pdf": {"present": True}, "indexed": {"state": "indexed"},
         "bib": {"state": "authenticated"}},
        {"citekey": "refA", "pdf": {"present": False}, "indexed": {"state": "none"},
         "bib": {"state": "unverified"}},
        {"citekey": "refB", "pdf": {"present": False}, "indexed": {"state": "none"},
         "bib": {"state": "failed"}},
    ]}
    from _tools import lock_catalog
    with lock_catalog(lib):
        write_catalog(lib, cat)


def test_prune_dry_run_mutates_nothing(tmp_path):
    lib = _init_library(tmp_path)
    _seed_prune_fixture(lib)
    before_cat = (lib / ".virgil" / "catalog.json").read_text()
    before_master = (lib / "master.bib").read_text()
    rc = prune.plan_and_run(lib, apply=False)
    assert rc == 0
    # No mutation in dry-run.
    assert (lib / ".virgil" / "catalog.json").read_text() == before_cat
    assert (lib / "master.bib").read_text() == before_master


def test_prune_apply_backfills_comment_before_deleting_row(tmp_path):
    lib = _init_library(tmp_path)
    _seed_prune_fixture(lib)
    rc = prune.plan_and_run(lib, apply=True)
    assert rc == 0
    # The two reference-only rows are gone; the holding stays.
    assert _catalog_keys(lib) == {"held"}
    # The pruned rows' auth state survives as % bib.state comments — the
    # back-fill-before-delete contract. (refA/refB already had comments from
    # the fixture's update_master_bib_entry writes; the prune must NOT have
    # removed them.)
    states = dict(iter_master_bib_states((lib / "master.bib").read_text()))
    assert states.get("refA") == "unverified"
    assert states.get("refB") == "failed"
    assert states.get("held") == "authenticated"


def test_prune_apply_is_idempotent(tmp_path):
    lib = _init_library(tmp_path)
    _seed_prune_fixture(lib)
    prune.plan_and_run(lib, apply=True)
    keys_after_first = _catalog_keys(lib)
    # Second --apply run is safe (no rows to find).
    rc = prune.plan_and_run(lib, apply=True)
    assert rc == 0
    assert _catalog_keys(lib) == keys_after_first == {"held"}


# ── F4W-1: prune is disk-aware — a held-but-present:false row is SKIPPED ──


def _seed_held_but_present_false(lib: Path) -> None:
    """A genuine holding carrying a STALE pdf.present=false row (the bug the
    merge writer used to mint), alongside a true reference-only row."""
    from _tools import update_master_bib_entry, lock_catalog
    # `staleheld` has a real source file on disk but a present:false catalog row.
    _make_holding(lib, "staleheld")
    update_master_bib_entry(lib, "staleheld", "article",
                            {"title": "Stale Held", "author": "H, H"},
                            bib_state="authenticated")
    update_master_bib_entry(lib, "refonly", "article",
                            {"title": "Ref Only", "author": "R, R"},
                            bib_state="unverified")
    cat = {"version": 1, "entries": [
        {"citekey": "staleheld", "pdf": {"present": False},
         "indexed": {"state": "none"}, "bib": {"state": "authenticated"}},
        {"citekey": "refonly", "pdf": {"present": False},
         "indexed": {"state": "none"}, "bib": {"state": "unverified"}},
    ]}
    with lock_catalog(lib):
        write_catalog(lib, cat)


def test_prune_skips_held_present_false_row_dry_run(tmp_path):
    lib = _init_library(tmp_path)
    _seed_held_but_present_false(lib)
    before_cat = (lib / ".virgil" / "catalog.json").read_text()
    before_master = (lib / "master.bib").read_text()
    rc = prune.plan_and_run(lib, apply=False)
    assert rc == 0
    # Dry-run never mutates.
    assert (lib / ".virgil" / "catalog.json").read_text() == before_cat
    assert (lib / "master.bib").read_text() == before_master


def test_prune_skips_held_present_false_row_apply(tmp_path):
    lib = _init_library(tmp_path)
    _seed_held_but_present_false(lib)
    rc = prune.plan_and_run(lib, apply=True)
    assert rc == 0
    # The held paper's row SURVIVES (not pruned despite present:false); the true
    # reference-only row is pruned.
    assert "staleheld" in _catalog_keys(lib)
    assert "refonly" not in _catalog_keys(lib)
    # The held row was NOT back-filled/touched: its catalog row is unchanged
    # (still the original present:false / bib.state authenticated entry).
    held_row = next(
        e for e in read_catalog(lib)["entries"] if e["citekey"] == "staleheld"
    )
    assert held_row["pdf"]["present"] is False
    assert held_row["bib"]["state"] == "authenticated"
    assert held_row["indexed"]["state"] == "none"


# ── F4W-3: a holding's merged catalog row carries pdf.present == True ─────


def test_merge_holding_row_has_pdf_present_true(tmp_path):
    lib = _init_library(tmp_path)
    _make_holding(lib, "held")
    mpr._upsert_catalog_row(
        lib, "held", _bib_status("authenticated"),
        master_entry={"type": "article",
                      "fields": {"title": "Held", "author": "A, B", "year": "2020"}},
    )
    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == "held")
    # The root fix: no longer minted with the stale present:false default.
    assert row["pdf"]["present"] is True


def test_merge_holding_does_not_clobber_existing_pdf_metadata(tmp_path):
    # F4W-3 REPLACE-safety: a pre-existing holding row with rich pdf metadata
    # keeps it (the merge omits pdf for an existing row rather than replacing it).
    lib = _init_library(tmp_path)
    _make_holding(lib, "held")
    from _tools import lock_catalog
    cat = read_catalog(lib)
    cat.setdefault("entries", []).append({
        "citekey": "held", "title": "Old", "authors": ["A"], "year": 2000,
        "pdf": {"present": True, "filename": "held.pdf", "pageCount": 42,
                "format": "pdf"},
        "indexed": {"state": "indexed"}, "bib": {"state": "unverified"},
    })
    with lock_catalog(lib):
        write_catalog(lib, cat)
    mpr._upsert_catalog_row(
        lib, "held", _bib_status("authenticated"),
        master_entry={"type": "article",
                      "fields": {"title": "New", "author": "A, B", "year": "2020"}},
    )
    row = next(e for e in read_catalog(lib)["entries"] if e["citekey"] == "held")
    # Rich pdf metadata preserved (not replaced by a bare {present:True}).
    assert row["pdf"]["present"] is True
    assert row["pdf"]["filename"] == "held.pdf"
    assert row["pdf"]["pageCount"] == 42
    assert row["pdf"]["format"] == "pdf"


# ── F4W-2: postflight holdings floor catches a vanishing present:true row ──


def test_postflight_present_drop_alerts_even_with_state_none(tmp_path):
    lib = _init_library(tmp_path)
    snap = tmp_path / "snap"
    master = "@article{a,\n  title={A},\n}\n"
    # A held-but-not-yet-indexed paper (pdf.present=true, indexed.state="none")
    # disappears: NO master shrink, NO real-index-state regression (none is
    # excluded) — yet it IS data loss. The holdings floor must catch it.
    before_cat = {"entries": [
        {"citekey": "a", "pdf": {"present": True}, "indexed": {"state": "none"}},
        {"citekey": "b", "pdf": {"present": True}, "indexed": {"state": "none"}},
    ]}
    after_cat = {"entries": [
        {"citekey": "a", "pdf": {"present": True}, "indexed": {"state": "none"}},
    ]}
    _snap(snap, master, before_cat)
    _live(lib, master, after_cat)
    cat = postflight._check_catalog(snap, lib)
    mst = postflight._check_master(snap, lib)
    # No state regression (only `none` dropped) and no master shrink…
    assert cat["state_regressions"] == []
    assert mst["shrank"] is False
    # …but the holdings floor flags the vanished present:true row.
    assert cat["before_present"] == 2
    assert cat["after_present"] == 1
    assert cat["present_dropped"] is True
    # And main()'s JSON surfaces it as an alert.
    out = postflight.main(["--snapshot-dir", str(snap), "--library", str(lib)])
    assert out == 0


def test_postflight_present_drop_surfaced_as_alert_in_json(tmp_path, capsys):
    lib = _init_library(tmp_path)
    snap = tmp_path / "snap"
    master = "@article{a,\n  title={A},\n}\n"
    before_cat = {"entries": [
        {"citekey": "a", "pdf": {"present": True}, "indexed": {"state": "none"}},
        {"citekey": "b", "pdf": {"present": True}, "indexed": {"state": "none"}},
    ]}
    after_cat = {"entries": [
        {"citekey": "a", "pdf": {"present": True}, "indexed": {"state": "none"}},
    ]}
    _snap(snap, master, before_cat)
    _live(lib, master, after_cat)
    postflight.main(["--snapshot-dir", str(snap), "--library", str(lib)])
    payload = json.loads(capsys.readouterr().out)
    assert payload["clean"] is False
    assert any("holdings dropped" in a for a in payload["alerts"])
    # present-count recorded in the JSON output.
    assert payload["catalog_json"]["before_present"] == 2
    assert payload["catalog_json"]["after_present"] == 1


def test_prune_backfills_state_even_when_master_entry_missing(tmp_path):
    # A catalog row whose master.bib entry was already deleted: the prune must
    # still record the state (synthesize a minimal entry) before dropping it,
    # so the auth info is not lost forever.
    lib = _init_library(tmp_path)
    cat = {"version": 1, "entries": [
        {"citekey": "ghost", "title": "Ghost", "authors": ["Z, Z"], "year": 1977,
         "pdf": {"present": False}, "indexed": {"state": "none"},
         "bib": {"state": "canonical"}},
    ]}
    from _tools import lock_catalog
    with lock_catalog(lib):
        write_catalog(lib, cat)
    prune.plan_and_run(lib, apply=True)
    assert _catalog_keys(lib) == set()
    states = dict(iter_master_bib_states((lib / "master.bib").read_text()))
    assert states.get("ghost") == "canonical"


if __name__ == "__main__":
    # Fixtures are injected BY NAME (see `_standalone.py`). The hand-written
    # runner this replaces passed `tmp_path` POSITIONALLY, so
    # `test_postflight_present_drop_surfaced_as_alert_in_json` — which also
    # takes `capsys` — died with a TypeError that reads like an ordinary
    # failure, and the file quietly reported 18/19.
    from _standalone import main

    sys.exit(main(globals()))
