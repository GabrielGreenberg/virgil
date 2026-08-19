"""Regression guard for task 372 — the matching contract
`synthesize_canonical_entries.py` documented and did not implement.

The script resolves `missing-bib-entry: <Author> <Year>` catalog warnings by
writing a canonical entry into the paper's `references.bib`. Its docstring
promised acceptance on "title-similarity >= 0.85 AND author overlap >= 1".
The pre-372 body implemented NEITHER:

  * `--min-similarity` was parsed, threaded, and never read;
  * `_title_similarity` was defined and never called;
  * acceptance was a SUBSTRING test — the last whitespace token of the whole
    author phrase, looked for inside a concatenated blob of the record's
    family names. So `Smith` matched `Smithson`, and `Kehler and Rohde`
    checked only `Rohde`;
  * ranking was `score = 1.0 if not best else best[0] + 0.01` followed by
    `score > best[0]`, under which every later candidate outscored the
    incumbent by construction — so whichever candidate the loop saw LAST was
    written as the canonical entry.

Net: the last author-and-year-plausible Crossref hit landed in a user's
`references.bib` as the canonical reference for a work it may not be. A wrong
canonical entry is worse than an unresolved warning — it looks correct,
survives every structural validator, and is only caught by a human who tries
to follow it.

The fix cannot be the literal docstring, because the warning payload carries
NO title (`clean-bibliography.md`, "Missing-bib-entry lookup spec") — there is
nothing to compute title similarity against. So the title bar is discharged as
an UNAMBIGUITY requirement, and the Library is consulted first (where a target
title does exist). What these tests pin, in the order the design argues them:

  A. author coverage is the lookup spec's rule, not a substring — a surname
     PREFIX collision and an unmatched co-author are both refused;
  B. the year is re-checked LOCALLY, not trusted from the wire filter;
  C. more than one distinct work among the survivors REFUSES — the evidence
     must single out one work;
  D. `--min-similarity` is load-bearing: the SAME candidate set resolves at a
     permissive threshold and refuses at a strict one;
  E. ranking is order-INDEPENDENT and best-is-best (the defect leg — fails on
     last-seen-wins);
  F. Library-first: a `master.bib` entry covering the target is copied
     verbatim and Crossref is never called;
  G. refusals are REPORTED, not silent; and
  H. a genuine unique match still lands (the accepting control, without which
     every leg above passes on a script that refuses everything).

Run: python3 library/scripts/tests/test_synthesize_canonical_entries.py
     (or under pytest; it carries its own no-pytest runner so CI can shell out
     to it — nothing in CI runs Python directly.)
"""
import json
import os
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import synthesize_canonical_entries as synth  # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ─────────────────────────────────────────────────────────────────────────
# Harness — a REAL library root, a REAL paper folder, a stubbed wire call
# ─────────────────────────────────────────────────────────────────────────

CITEKEY = "testpaper2020"


def _make_library(tmp_path: Path, warnings: list[str], master_bib: str = "") -> Path:
    lib = tmp_path / "lib"
    (lib / ".virgil").mkdir(parents=True)
    (lib / "papers" / CITEKEY).mkdir(parents=True)
    (lib / "master.bib").write_text(master_bib, encoding="utf-8")
    (lib / "papers" / CITEKEY / "references.bib").write_text(
        "@article{existing2001,\n  title = {Something Else},\n}\n", encoding="utf-8",
    )
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": [
            {"citekey": CITEKEY, "indexed": {"state": "indexed", "warnings": warnings}},
        ]}, indent=2) + "\n",
        encoding="utf-8",
    )
    return lib


def _rec(family, year, title, *, doi=None, journal=None, page=None,
         extra_authors=()):
    authors = [{"family": family, "given": "A."}]
    authors += [{"family": f, "given": "B."} for f in extra_authors]
    r = {
        "title": [title],
        "author": authors,
        "type": "journal-article",
        "issued": {"date-parts": [[year]]},
    }
    if doi:
        r["DOI"] = doi
    if journal:
        r["container-title"] = [journal]
    if page:
        r["page"] = page
    return r


def _run(lib: Path, records, *, min_similarity=0.85, dry_run=True):
    """Drive the REAL `synthesize()` with `_crossref_query` stubbed.

    `records` may be a list (returned for every target) or a callable
    `(author, year) -> list`. The stub records its call count so the
    Library-first leg can assert the wire was never reached.
    """
    calls = []

    def stub(author, year, rows=5):
        calls.append((author, year))
        return records(author, year) if callable(records) else list(records)

    real = synth._crossref_query
    synth._crossref_query = stub
    os.environ["VIRGIL_LIBRARY_ROOT"] = str(lib)
    try:
        result = synth.synthesize(
            CITEKEY, min_similarity=min_similarity, dry_run=dry_run,
        )
    finally:
        synth._crossref_query = real
        os.environ.pop("VIRGIL_LIBRARY_ROOT", None)
    return result, calls


def _reasons(result):
    return [r["reason"] for r in result.get("refusals", [])]


# ─────────────────────────────────────────────────────────────────────────
# H. The accepting control — first, because every refusal leg below is
#    vacuous against a script that refuses everything.
# ─────────────────────────────────────────────────────────────────────────

def test_a_genuine_unique_match_still_lands(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    result, _ = _run(lib, [_rec("Prior", 1957, "Time and Modality")])
    check(result.get("synthesized") == 1,
          f"accepting control refused: {result!r}")
    check(result["citekeys"] == ["prior1957time"],
          f"unexpected citekey: {result!r}")
    #  deliberately: this leg is the CONTROL, so it must pass against the
    # pre-372 implementation too (which had no  channel). A control
    # that fails for a reason unrelated to what it controls is not a control.
    check(not result.get("refusals"), f"unexpected refusals: {result!r}")


def test_the_entry_is_actually_written_and_tagged(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    _run(lib, [_rec("Prior", 1957, "Time and Modality")], dry_run=False)
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("@article{prior1957time," in text, f"entry not written: {text!r}")
    check("synthesized via Crossref" in text, f"provenance tag missing: {text!r}")
    check("review before final publication" in text,
          f"review tag missing — the stated residual leans on it: {text!r}")


# ─────────────────────────────────────────────────────────────────────────
# A. Author coverage is the lookup spec's rule, not a substring
# ─────────────────────────────────────────────────────────────────────────

def test_surname_prefix_collision_is_refused(tmp_path: Path):
    """`Smith` must not match `Smithson`.

    The pre-372 test was `author.split()[-1].lower() not in authors_in_rec`
    over a concatenated family-name string — a substring, so every surname
    that is a prefix of another author's surname matched.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Smith 1998"])
    result, _ = _run(lib, [_rec("Smithson", 1998, "A Different Book Entirely")])
    check(result.get("synthesized") == 0, f"prefix collision accepted: {result!r}")
    check(_reasons(result) == ["no-author-year-match"], f"{result!r}")


def test_unmatched_co_author_is_refused(tmp_path: Path):
    """`Kehler and Rohde` requires BOTH surnames.

    The pre-372 check read only the LAST token of the whole author phrase, so
    a record by Rohde alone satisfied a mention of Kehler and Rohde.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Kehler and Rohde 2017"])
    result, _ = _run(lib, [_rec("Rohde", 2017, "Something By Rohde Alone")])
    check(result.get("synthesized") == 0, f"co-author gap accepted: {result!r}")
    check(_reasons(result) == ["no-author-year-match"], f"{result!r}")


def test_multi_author_mention_matches_when_all_surnames_are_present(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Kehler and Rohde 2017"])
    result, _ = _run(lib, [
        _rec("Kehler", 2017, "Evaluating Coherence", extra_authors=("Rohde",)),
    ])
    check(result.get("synthesized") == 1, f"legitimate multi-author refused: {result!r}")


def test_et_al_mention_is_a_prefix_claim_over_the_first_three_authors(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Grosz et al. 1995"])
    ok, _ = _run(lib, [
        _rec("Joshi", 1995, "Centering A Framework",
             extra_authors=("Grosz", "Weinstein")),
    ])
    check(ok.get("synthesized") == 1, f"et al. within first three refused: {ok!r}")

    lib2 = _make_library(tmp_path / "b", ["missing-bib-entry: Grosz et al. 1995"])
    late, _ = _run(lib2, [
        _rec("Joshi", 1995, "Centering A Framework",
             extra_authors=("Weinstein", "Sidner", "Grosz")),
    ])
    check(late.get("synthesized") == 0,
          f"et al. accepted a fourth-position surname: {late!r}")


# ─────────────────────────────────────────────────────────────────────────
# B. The year is re-checked locally
# ─────────────────────────────────────────────────────────────────────────

def test_year_drift_is_refused(tmp_path: Path):
    """The wire query's `from-pub-date` filter is a narrowing hint, not the
    bar — Crossref's publication date drifts from the issued year for
    online-first records, and a stub (or a widened query) can hand back
    anything. The pre-372 body checked the year nowhere at all."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    result, _ = _run(lib, [_rec("Prior", 1962, "Formal Logic")])
    check(result.get("synthesized") == 0, f"year drift accepted: {result!r}")
    check(_reasons(result) == ["no-author-year-match"], f"{result!r}")


# ─────────────────────────────────────────────────────────────────────────
# C/E. Ambiguity refuses; ranking is order-independent and best-is-best
# ─────────────────────────────────────────────────────────────────────────

def test_two_distinct_works_by_the_same_author_and_year_refuse(tmp_path: Path):
    """The defect leg for the ranking, read from the other side.

    Pre-372, `score = 1.0 if not best else best[0] + 0.01` made the LAST
    candidate win, so this shape wrote one of the two — silently picking a
    work on iteration order. With no target title, "which of these two" is a
    question the evidence cannot answer, so the honest answer is neither.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Lewis 1979"])
    records = [
        _rec("Lewis", 1979, "Scorekeeping in a Language Game"),
        _rec("Lewis", 1979, "Attitudes De Dicto and De Se"),
    ]
    result, _ = _run(lib, records)
    check(result.get("synthesized") == 0, f"ambiguity resolved by guess: {result!r}")
    check(_reasons(result) == ["ambiguous-candidates"], f"{result!r}")
    check(result["refusals"][0]["works"] == 2, f"{result!r}")

    # …and the refusal does not depend on the order they arrived in.
    reversed_result, _ = _run(lib, list(reversed(records)))
    check(reversed_result.get("synthesized") == 0,
          f"order-dependent verdict: {reversed_result!r}")


def test_best_candidate_wins_regardless_of_iteration_order(tmp_path: Path):
    """Two records for ONE work (title agreement clears the threshold); the
    richer record must win from either input order.

    Pre-372 this was `best[0] + 0.01` last-seen-wins, so the answer flipped
    with the order Crossref happened to return them.
    """
    sparse = _rec("Prior", 1957, "Time and Modality")
    rich = _rec("Prior", 1957, "Time and Modality",
                doi="10.1093/acprof/9780198241584.001.0001",
                journal="Oxford University Press", page="1-160")

    lib_a = _make_library(tmp_path / "a", ["missing-bib-entry: Prior 1957"])
    forward, _ = _run(lib_a, [sparse, rich], dry_run=False)
    lib_b = _make_library(tmp_path / "b", ["missing-bib-entry: Prior 1957"])
    backward, _ = _run(lib_b, [rich, sparse], dry_run=False)

    check(forward.get("synthesized") == 1 and backward.get("synthesized") == 1,
          f"same-work pair refused: {forward!r} / {backward!r}")
    text_a = (lib_a / "papers" / CITEKEY / "references.bib").read_text()
    text_b = (lib_b / "papers" / CITEKEY / "references.bib").read_text()
    check("doi = {10.1093" in text_a,
          f"forward order picked the sparse record: {text_a!r}")
    check("doi = {10.1093" in text_b,
          f"reversed order picked the sparse record: {text_b!r}")


# ─────────────────────────────────────────────────────────────────────────
# D. `--min-similarity` is load-bearing
# ─────────────────────────────────────────────────────────────────────────

def test_min_similarity_decides_whether_two_candidates_are_one_work(tmp_path: Path):
    """The SAME candidate set, two thresholds, two verdicts.

    Pre-372 the parameter was threaded from the CLI and never read, so this
    leg is unrepresentable against it: both calls returned the same thing.
    The knob is monotone in the SAFE direction — raising it splits candidates
    and refuses more.
    """
    records = [
        _rec("Prior", 1957, "Time and Modality"),
        _rec("Prior", 1957, "Time and Modality in Tense Logic"),
    ]
    lenient_lib = _make_library(tmp_path / "a", ["missing-bib-entry: Prior 1957"])
    lenient, _ = _run(lenient_lib, records, min_similarity=0.5)
    check(lenient.get("synthesized") == 1,
          f"permissive threshold did not merge the pair: {lenient!r}")

    strict_lib = _make_library(tmp_path / "b", ["missing-bib-entry: Prior 1957"])
    strict, _ = _run(strict_lib, records, min_similarity=0.95)
    check(strict.get("synthesized") == 0,
          f"strict threshold still resolved: {strict!r}")
    check(_reasons(strict) == ["ambiguous-candidates"], f"{strict!r}")


def test_identical_doi_settles_sameness_below_the_threshold(tmp_path: Path):
    """Two records that share a DOI are one work whatever their titles say —
    the one merge that cannot be wrong."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    result, _ = _run(lib, [
        _rec("Prior", 1957, "Time and Modality", doi="10.1/x"),
        _rec("Prior", 1957, "Completely Different Words Here", doi="10.1/x"),
    ], min_similarity=0.99)
    check(result.get("synthesized") == 1, f"shared DOI still split: {result!r}")


# ─────────────────────────────────────────────────────────────────────────
# F. Library first (_find-or-surface.md rule 2)
# ─────────────────────────────────────────────────────────────────────────

MASTER = """@book{prior1957timeandmodality,
  author = {Prior, Arthur N.},
  year = {1957},
  title = {Time and Modality},
  publisher = {Oxford University Press},
  doi = {10.1/authenticated},
}
"""


def test_a_master_bib_hit_is_used_verbatim_and_never_queries_crossref(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"], master_bib=MASTER)
    result, calls = _run(lib, [_rec("Prior", 1957, "Some Crossref Guess")],
                         dry_run=False)
    check(result.get("synthesized") == 1, f"library hit refused: {result!r}")
    check(calls == [], f"Crossref queried despite a Library hit: {calls!r}")
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("@book{prior1957timeandmodality," in text,
          f"master citekey not preserved: {text!r}")
    check("10.1/authenticated" in text, f"master fields not copied: {text!r}")
    check("from library master.bib" in text, f"provenance tag missing: {text!r}")
    check("Some Crossref Guess" not in text, f"Crossref record leaked in: {text!r}")


def test_a_master_entry_that_does_not_cover_the_mention_falls_through(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Quine 1957"], master_bib=MASTER)
    result, calls = _run(lib, [_rec("Quine", 1957, "A Real Quine Paper")])
    check(result.get("synthesized") == 1, f"fall-through failed: {result!r}")
    check(len(calls) == 1, f"Crossref not consulted on a Library miss: {calls!r}")


def test_two_distinct_library_works_refuse_rather_than_pick(tmp_path: Path):
    master = MASTER + """
@article{prior1957escapism,
  author = {Prior, Arthur N.},
  year = {1957},
  title = {Escapism The Logical Basis of Ethics},
}
"""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"], master_bib=master)
    result, calls = _run(lib, [])
    check(result.get("synthesized") == 0, f"library ambiguity resolved: {result!r}")
    check(_reasons(result) == ["ambiguous-in-library"], f"{result!r}")
    check(calls == [], f"fell through to Crossref on an ambiguous Library: {calls!r}")


# ─────────────────────────────────────────────────────────────────────────
# G. Refusals are surfaced
# ─────────────────────────────────────────────────────────────────────────

def test_every_declined_target_is_named_in_the_result(tmp_path: Path):
    lib = _make_library(tmp_path, [
        "missing-bib-entry: Smith 1998",
        "missing-bib-entry: Prior 1957",
    ])

    def per_target(author, year):
        if author == "Prior":
            return [_rec("Prior", 1957, "Time and Modality")]
        return [_rec("Smithson", 1998, "Not The Same Author")]

    result, _ = _run(lib, per_target)
    check(result.get("synthesized") == 1, f"{result!r}")
    check([r["target"] for r in result["refusals"]] == ["Smith 1998"],
          f"declined target not surfaced: {result!r}")


def test_a_truncated_master_entry_is_refused_not_spliced(tmp_path: Path):
    """`read_master_bib` caps an unbalanced entry at the next opener, so its
    `raw` can be a truncated fragment. Copying that verbatim would splice
    broken BibTeX into the user's `references.bib` — worse than the wrong
    entry this whole task is about, because it breaks every later parse."""
    broken = """@book{prior1957timeandmodality,
  author = {Prior, Arthur N.},
  year = {1957},
  title = {Time and {Modality},
@article{later2000thing,
  author = {Later, A.},
  year = {2000},
  title = {Something},
}
"""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"],
                        master_bib=broken)
    result, _ = _run(lib, [], dry_run=False)
    check(result.get("synthesized") == 0, f"truncated entry spliced: {result!r}")
    check(_reasons(result) == ["library-entry-unreadable"], f"{result!r}")
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("prior1957" not in text, f"broken entry reached the .bib: {text!r}")


def test_an_already_present_citekey_is_reported_not_silently_skipped(tmp_path: Path):
    """A warning whose entry is already in `references.bib` is a STALE
    warning, and the operator wants to know that — the pre-372 `continue`
    dropped the target without a word, which reads identically to 'nothing
    matched'."""
    master = MASTER.replace("prior1957timeandmodality", "existing2001")
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"],
                        master_bib=master)
    result, _ = _run(lib, [])
    check(result.get("synthesized") == 0, f"{result!r}")
    check(_reasons(result) == ["already-in-references-bib"], f"{result!r}")


def test_no_crossref_records_is_reported_distinctly(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Obscure 1899"])
    result, _ = _run(lib, [])
    check(_reasons(result) == ["no-crossref-records"], f"{result!r}")


def _run_standalone() -> int:
    """Run without pytest (it isn't installed everywhere), supplying the one
    fixture these tests use (`tmp_path`) from `tempfile`."""
    import inspect
    import tempfile
    import traceback

    tests = [
        (n, f) for n, f in sorted(globals().items())
        if n.startswith("test_") and callable(f)
    ]
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
    # `--standalone` forces the built-in runner regardless of whether pytest is
    # installed. The vitest shell passes it, because that shell asserts on the
    # "<n>/<n> passed" tally this runner prints — under pytest the tally is
    # absent and the JS test would fail on a machine where the Python suite
    # actually PASSED, which is a guard failing for a reason unrelated to what
    # it guards.
    if "--standalone" in sys.argv:
        raise SystemExit(_run_standalone())
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
