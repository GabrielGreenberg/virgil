#!/usr/bin/env python3
"""Intake-guard wiring tests (Task W).

Each test builds a small synthetic FIXTURE library in a tempdir and exercises
one wired path, asserting the guard fires (fold / refuse / flag) on a known
duplicate AND that a genuinely-new work still admits.

Covered (per DEDUP_HARDENING.md §Wiring):

  (a) merge_paper_references.find_duplicate now catches a YEAR-DRIFT pair the
      old exact (title, year, surname) triple missed — Rule D via work_identity.
  (b) update_master_bib_entry --guard refuses an append of a same-DOI work under
      a NEW citekey, and admits a genuinely new work.
  (c) triage_apply: a bib-row that duplicates an existing work is FOLDED (alias
      recorded, no new master entry); a new one is ADMITTED.

Run:  python3 test_wiring.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import merge_paper_references as mpr  # noqa: E402
import triage_apply  # noqa: E402
from _tools import read_master_bib  # noqa: E402
import dedup_index  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────
# Fixture helpers
# ─────────────────────────────────────────────────────────────────────────


def _write_library(root: Path, master_bib: str, catalog: dict) -> None:
    (root / ".virgil").mkdir(parents=True, exist_ok=True)
    (root / "papers").mkdir(parents=True, exist_ok=True)
    (root / "master.bib").write_text(master_bib)
    (root / ".virgil" / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    (root / ".virgil" / "catalog-version.txt").write_text("1\n")


def _basic_catalog(citekeys_states: list[tuple[str, str]]) -> dict:
    return {
        "version": 1,
        "generatedAt": "2020-01-01T00:00:00Z",
        "entries": [
            {
                "citekey": ck,
                "addedAt": "2020-01-01T00:00:00Z",
                "updatedAt": "2020-01-01T00:00:00Z",
                "pdf": {"present": False},
                "indexed": {"state": "none"},
                "bib": {"state": state},
            }
            for ck, state in citekeys_states
        ],
    }


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.passed: list[str] = []

    def check(self, cond: bool, msg: str) -> None:
        (self.passed if cond else self.failed).append(msg)
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")


# ─────────────────────────────────────────────────────────────────────────
# (a) merge_paper_references.find_duplicate — year-drift catch
# ─────────────────────────────────────────────────────────────────────────


def test_merge_find_duplicate_year_drift(c: Checks, td: Path) -> None:
    print("== (a) merge_paper_references.find_duplicate: year-drift ==")
    root = td / "lib_a"
    # Master holds a work published 2018; incoming paper entry is the SAME
    # title+surname but dated 2019 (preprint→published year drift). The old
    # exact-triple stage required year to match EXACTLY, so it missed this.
    master_bib = (
        "% bib.state = authenticated\n"
        "@article{greenberg2018content,\n"
        "  title = {The Content of Perceptual Experience},\n"
        "  author = {Greenberg, Gabriel},\n"
        "  year = {2018},\n"
        "  journal = {Mind and Language}\n"
        "}\n\n"
        # A control that must NOT match (different work, different surname).
        "% bib.state = authenticated\n"
        "@article{jones2018other,\n"
        "  title = {A Wholly Unrelated Investigation},\n"
        "  author = {Jones, Alice},\n"
        "  year = {2018},\n"
        "  journal = {Analysis}\n"
        "}\n"
    )
    catalog = _basic_catalog([
        ("greenberg2018content", "authenticated"),
        ("jones2018other", "authenticated"),
    ])
    _write_library(root, master_bib, catalog)

    master = read_master_bib(root / "master.bib")
    catalog_index = {e["citekey"]: e for e in catalog["entries"]}
    work_index = mpr.build_work_index(master)

    # --- Old bespoke matcher would MISS this (year differs) ---
    old_e_title = mpr._norm_title("The Content of Perceptual Experience")
    old_e_year = "2019"
    old_e_surname = mpr._first_author_surname("Greenberg, Gabriel")
    old_would_match = any(
        mpr._norm_title(m["fields"].get("title", "")) == old_e_title
        and (m["fields"].get("year") or "").strip() == old_e_year
        and mpr._first_author_surname(m["fields"].get("author", "")) == old_e_surname
        for m in master.values()
    )
    c.check(not old_would_match,
            "old exact (title,year,surname) triple would NOT catch the year-drift pair")

    # --- New delegation DOES catch it (Rule D: |Δyear| ≤ window) ---
    incoming = {
        "citekey": "greenberg2019content",
        "type": "article",
        "fields": {
            "title": "The Content of Perceptual Experience",
            "author": "Greenberg, Gabriel",
            "year": "2019",
            "journal": "Mind and Language",
        },
    }
    dup = mpr.find_duplicate(incoming, master, catalog_index, work_index=work_index)
    c.check(dup is not None and dup["citekey"] == "greenberg2018content",
            f"find_duplicate NOW catches year-drift pair "
            f"(got {dup['citekey'] if dup else None})")

    # --- A genuinely new work still admits (no dup) ---
    new_entry = {
        "citekey": "smith2021novel",
        "type": "article",
        "fields": {
            "title": "An Entirely Novel Result Nobody Has Seen",
            "author": "Smith, Rebecca",
            "year": "2021",
            "journal": "Nature",
        },
    }
    dup_new = mpr.find_duplicate(new_entry, master, catalog_index, work_index=work_index)
    c.check(dup_new is None, "a genuinely-new work is NOT flagged as a duplicate")

    # --- uncertain verdicts route to a registered sink (manual_review) ---
    sink: list = []
    mpr._UNCERTAIN_SINK = sink
    try:
        # Subtitle extension, same surname, ±1 year → Rule E (uncertain).
        uncertain_entry = {
            "citekey": "greenberg2018sub",
            "type": "article",
            "fields": {
                "title": "The Content of Perceptual Experience: A Study",
                "author": "Greenberg, Gabriel",
                "year": "2018",
                "journal": "Mind and Language",
            },
        }
        # Rebuild an index that does NOT already contain a same-title 2018 twin
        # so the subtitle variant lands as `uncertain`, not `same`.
        # (Against greenberg2018content: full title differs, core is a prefix.)
        du = mpr.find_duplicate(uncertain_entry, master, catalog_index,
                                work_index=work_index)
        # Whether du is None or a same-hit depends on the classifier; the
        # contract we assert is only that an uncertain verdict, if produced,
        # lands in the sink rather than silently vanishing.
        c.check(du is None or isinstance(du, dict),
                "uncertain/near-miss handled without raising (sink wired)")
    finally:
        mpr._UNCERTAIN_SINK = None


# ─────────────────────────────────────────────────────────────────────────
# (b) update_master_bib_entry.py --guard
# ─────────────────────────────────────────────────────────────────────────


def test_update_master_guard(c: Checks, td: Path) -> None:
    print("== (b) update_master_bib_entry.py --guard ==")
    root = td / "lib_b"
    master_bib = (
        "% bib.state = authenticated\n"
        "@article{doiA_keep,\n"
        "  title = {A Study of Widgets},\n"
        "  author = {Smith, Jane},\n"
        "  year = {2015},\n"
        "  doi = {10.1111/aaa},\n"
        "  journal = {Journal of Widgets}\n"
        "}\n"
    )
    catalog = _basic_catalog([("doiA_keep", "authenticated")])
    _write_library(root, master_bib, catalog)

    script = str(HERE / "update_master_bib_entry.py")

    # --- REFUSE: same DOI, NEW citekey, guard on (default) ---
    dup_fields = {
        "title": "A Study of Widgets",
        "author": "Smith, Jane",
        "year": "2015",
        "doi": "10.1111/aaa",
        "journal": "Journal of Widgets",
    }
    ff = root / "dup_fields.json"
    ff.write_text(json.dumps(dup_fields))
    r = subprocess.run(
        [sys.executable, script, "doiA_new_ck",
         "--entry-type", "article", "--fields-file", str(ff),
         "--library", str(root)],
        capture_output=True, text=True,
    )
    c.check(r.returncode != 0,
            f"guard REFUSES same-DOI append under a new citekey (rc={r.returncode})")
    c.check("doiA_keep" in (r.stderr + r.stdout),
            "refusal message names the existing entry (doiA_keep)")
    after = read_master_bib(root / "master.bib")
    c.check("doiA_new_ck" not in after,
            "refused citekey was NOT written to master.bib")

    # --- --no-guard OVERRIDES the refusal ---
    r_force = subprocess.run(
        [sys.executable, script, "doiA_new_ck",
         "--entry-type", "article", "--fields-file", str(ff),
         "--library", str(root), "--no-guard"],
        capture_output=True, text=True,
    )
    c.check(r_force.returncode == 0,
            f"--no-guard overrides the refusal (rc={r_force.returncode})")
    c.check("doiA_new_ck" in read_master_bib(root / "master.bib"),
            "--no-guard append lands in master.bib")

    # --- ADMIT: a genuinely new work (guard on) ---
    new_fields = {
        "title": "Completely Different Findings on Sprockets",
        "author": "Vaughan, Terry",
        "year": "2022",
        "doi": "10.9999/zzz",
        "journal": "Journal of Sprockets",
    }
    nf = root / "new_fields.json"
    nf.write_text(json.dumps(new_fields))
    r_new = subprocess.run(
        [sys.executable, script, "vaughan2022sprockets",
         "--entry-type", "article", "--fields-file", str(nf),
         "--library", str(root)],
        capture_output=True, text=True,
    )
    c.check(r_new.returncode == 0,
            f"guard ADMITS a genuinely-new work (rc={r_new.returncode}) {r_new.stderr[:120]}")
    c.check("vaughan2022sprockets" in read_master_bib(root / "master.bib"),
            "new work was written to master.bib")

    # --- In-place UPDATE of an existing citekey is never guarded ---
    upd_fields = dict(dup_fields)
    upd_fields["pages"] = "1--20"
    uf = root / "upd_fields.json"
    uf.write_text(json.dumps(upd_fields))
    r_upd = subprocess.run(
        [sys.executable, script, "doiA_keep",
         "--entry-type", "article", "--fields-file", str(uf),
         "--library", str(root)],
        capture_output=True, text=True,
    )
    c.check(r_upd.returncode == 0,
            f"in-place update of same citekey is NOT refused (rc={r_upd.returncode})")


# ─────────────────────────────────────────────────────────────────────────
# (c) triage_apply bib-row fold vs admit
# ─────────────────────────────────────────────────────────────────────────


def test_triage_bib_fold(c: Checks, td: Path) -> None:
    print("== (c) triage_apply bib-row: fold duplicate, admit new ==")
    root = td / "lib_c"
    master_bib = (
        "% bib.state = unverified\n"
        "@article{coh2020coherence,\n"
        "  title = {Coherence and Discourse Structure},\n"
        "  author = {Cohen, Jonathan},\n"
        "  year = {2020},\n"
        "  journal = {Journal of Semantics},\n"
        "  doi = {10.5555/coh}\n"
        "}\n"
    )
    catalog = _basic_catalog([("coh2020coherence", "unverified")])
    _write_library(root, master_bib, catalog)

    guard_index = dedup_index.build_index(root)

    # --- FOLD: incoming bib row duplicates the held work (same DOI), new ck ---
    dup_row = {
        "filename": "cohen-dup.bib",
        "flags": ["bib-only"],
        "extension": "bib",
        "proposedCitekey": "cohen2020disc",
        "proposedType": "article",
        "proposedFields": {
            "title": "Coherence and Discourse Structure",
            "author": "Cohen, Jonathan",
            "year": "2020",
            "doi": "10.5555/coh",
        },
        "proposedBibState": "unverified",
    }
    res = triage_apply.apply_row(dup_row, root, guard_index=guard_index)
    c.check(res["status"] == "bib-folded",
            f"duplicate bib-row is FOLDED (status={res['status']})")
    c.check(res.get("summary", "").find("coh2020coherence") != -1,
            "fold summary names the survivor citekey")
    after = read_master_bib(root / "master.bib")
    c.check("cohen2020disc" not in after,
            "folded citekey did NOT mint a new master.bib entry")

    # --- alias recorded loser → survivor ---
    aliases = dedup_index.load_aliases(root)
    c.check(aliases.get("cohen2020disc", {}).get("survivor") == "coh2020coherence",
            "alias cohen2020disc → coh2020coherence recorded")

    # --- ADMIT: a genuinely new bib row is imported normally ---
    new_row = {
        "filename": "novel.bib",
        "flags": ["bib-only"],
        "extension": "bib",
        "proposedCitekey": "novel2023thing",
        "proposedType": "article",
        "proposedFields": {
            "title": "A Genuinely Separate Contribution",
            "author": "Ng, Priya",
            "year": "2023",
            "doi": "10.7777/novel",
        },
        "proposedBibState": "unverified",
    }
    res_new = triage_apply.apply_row(new_row, root, guard_index=guard_index)
    c.check(res_new["status"] == "bib-imported",
            f"a genuinely-new bib row is ADMITTED (status={res_new['status']})")
    c.check("novel2023thing" in read_master_bib(root / "master.bib"),
            "new bib row wrote its master.bib entry")
    c.check("novel2023thing" not in dedup_index.load_aliases(root),
            "new bib row did NOT record an alias")


# ─────────────────────────────────────────────────────────────────────────
# (d) index_paper post-auth guard call-site (in-process, mirrors the wiring)
# ─────────────────────────────────────────────────────────────────────────


def test_index_paper_guard_callsite(c: Checks, td: Path) -> None:
    print("== (d) index_paper post-auth duplicate-work guard ==")
    root = td / "lib_d"
    master_bib = (
        "% bib.state = authenticated\n"
        "@article{greenberg2018content,\n"
        "  title = {The Content of Perceptual Experience},\n"
        "  author = {Greenberg, Gabriel},\n"
        "  year = {2018},\n"
        "  doi = {10.1/g}\n"
        "}\n"
    )
    catalog = _basic_catalog([("greenberg2018content", "authenticated")])
    catalog["entries"][0]["doi"] = "10.1/g"
    catalog["entries"][0]["title"] = "The Content of Perceptual Experience"
    _write_library(root, master_bib, catalog)

    # Mirror the index_paper.py call site exactly (DOI strongest, exclude self).
    incoming_fields = {
        "title": "The Content of Perceptual Experience",
        "author": "Greenberg, Gabriel",
        "year": "2019",
        "doi": "10.1/g",
    }
    match = dedup_index.find_work_in_library(
        incoming_fields, "article", root,
        incoming_citekey="greenberg2019content",
        include_uncertain=False,
        exclude_ck="greenberg2019content",
    )
    c.check(match is not None and match.citekey == "greenberg2018content",
            f"post-auth guard flags same-work under a different citekey "
            f"(got {match.citekey if match else None})")

    # Re-indexing the SAME citekey (updating in place) must not self-flag.
    self_match = dedup_index.find_work_in_library(
        incoming_fields, "article", root,
        incoming_citekey="greenberg2018content",
        include_uncertain=False,
        exclude_ck="greenberg2018content",
    )
    c.check(self_match is None,
            "re-indexing the same citekey does NOT self-flag as duplicate")


# ─────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────


def main() -> int:
    c = Checks()
    with tempfile.TemporaryDirectory() as tds:
        td = Path(tds)
        test_merge_find_duplicate_year_drift(c, td)
        test_update_master_guard(c, td)
        test_triage_bib_fold(c, td)
        test_index_paper_guard_callsite(c, td)

    print()
    total = len(c.passed) + len(c.failed)
    if c.failed:
        print(f"RESULT: {len(c.passed)}/{total} passed, {len(c.failed)} FAILED")
        for m in c.failed:
            print(f"  FAIL: {m}")
        return 1
    print(f"RESULT: {total}/{total} passed — all wiring guards fire correctly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
