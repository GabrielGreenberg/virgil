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


def test_a_given_name_initial_is_not_treated_as_a_cited_surname(tmp_path: Path):
    """`Smith, J.` comma-splits to two parts, and coverage requires EVERY
    cited key — so keeping the initial would refuse a correct match on
    evidence that is not evidence."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Smith, J. 1998"])
    result, _ = _run(lib, [_rec("Smith", 1998, "A Real Smith Paper")])
    check(result.get("synthesized") == 1, f"initial refused a good match: {result!r}")


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


def _winner(tmp_path: Path, records, *, name="w", min_similarity=0.85) -> str:
    """Drive the REAL resolution and return the text actually written."""
    lib = _make_library(tmp_path / name, ["missing-bib-entry: Prior 1957"])
    result, _ = _run(lib, records, min_similarity=min_similarity, dry_run=False)
    check(result.get("synthesized") == 1, f"expected one entry: {result!r}")
    return (lib / "papers" / CITEKEY / "references.bib").read_text()


def test_best_candidate_wins_regardless_of_iteration_order(tmp_path: Path):
    """Two records for ONE work; the richer record must win from either order.

    The fixture is deliberately built so the rich record sorts FIRST — its DOI
    is lexicographically smaller. `_resolve_target` sorts survivors before
    clustering, so a fixture whose rich record happened to sort LAST would be
    satisfied by a plain "take the last one" selection: the sort would launder
    the very defect the leg is named for. Measured: with the rich record
    sorting first, replacing the ranked `max` with `[-1]` fails this leg.
    """
    sparse = _rec("Prior", 1957, "Time and Modality", doi="10.9999/zzz")
    rich = _rec("Prior", 1957, "Time and Modality", doi="10.1093/aaa",
                journal="Oxford University Press", page="1-160")

    forward = _winner(tmp_path, [sparse, rich], name="a")
    backward = _winner(tmp_path, [rich, sparse], name="b")
    check("doi = {10.1093/aaa" in forward,
          f"forward order picked the sparse record: {forward!r}")
    check("doi = {10.1093/aaa" in backward,
          f"reversed order picked the sparse record: {backward!r}")


def test_surname_coverage_outranks_metadata_completeness(tmp_path: Path):
    """The score's FIRST term, alone. A record covering both cited surnames
    beats a richer record covering one — coverage is evidence about identity,
    metadata is only about completeness."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior and Kenny 1957"])
    thin_but_covering = _rec("Prior", 1957, "Time and Modality",
                             doi="10.9/aaa", extra_authors=("Kenny",))
    rich_but_partial = _rec("Prior", 1957, "Time and Modality",
                            doi="10.1/zzz", journal="OUP", page="1-160",
                            extra_authors=("Someone",))
    result, _ = _run(lib, [rich_but_partial, thin_but_covering], dry_run=False)
    # The partial record fails coverage outright, so only one survivor exists —
    # which is itself the point: coverage is a BAR before it is a tie-break.
    check(result.get("synthesized") == 1, f"{result!r}")
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("10.9/aaa" in text, f"partial-coverage record won: {text!r}")


def test_metadata_completeness_breaks_a_coverage_tie(tmp_path: Path):
    """The score's MIDDLE terms, isolated: same coverage, same title, IDENTICAL
    DOI strings, so neither the lexicographic tail nor the title-length term
    can separate them. Only `container-title` / `page` presence can.

    Measured: zeroing the metadata-presence terms fails this leg while leaving
    every other leg green — which is what makes the stated policy ("coverage,
    then metadata completeness, then title length") actually pinned.
    """
    bare = _rec("Prior", 1957, "Time and Modality", doi="10.1/same")
    full = _rec("Prior", 1957, "Time and Modality", doi="10.1/same",
                journal="Oxford University Press", page="1-160")
    check("pages = {1-160}" in _winner(tmp_path, [full, bare], name="a"),
          "bare record won a metadata-completeness tie (forward)")
    check("pages = {1-160}" in _winner(tmp_path, [bare, full], name="b"),
          "bare record won a metadata-completeness tie (reversed)")


#: A CHAIN: `mid` is similar to both ends, the ends are not similar to each
#: other — and `mid` sorts FIRST by normalized title, which is what makes the
#: fixture load-bearing. Clustering against a cluster's REPRESENTATIVE (the
#: shape a "greedy clustering" is most naturally written as) then absorbs
#: both ends into `mid`'s cluster and reports ONE work. A fixture whose chain
#: middle sorts second would be answered identically by both linkages, and
#: the leg would pass on either — which is exactly what the first draft did.
_CHAIN_MID = "aaa bbb ccc ddd"
_CHAIN_END_1 = "aaa bbb ccc yyy"
_CHAIN_END_2 = "bbb ccc ddd zzz"


def test_a_chain_of_candidates_refuses_rather_than_merging(tmp_path: Path):
    """Complete linkage, pinned against the representative-linkage shape.

    Jaccard at 0.5: mid~end1 (0.6) and mid~end2 (0.6), end1!~end2 (0.33). A
    representative-linkage pass admits BOTH ends into the first cluster and
    reports one work — the accepting direction on exactly the evidence that
    should decline, since three candidates that do not all agree with each
    other are not one work. Every other fixture in this suite has at most two
    survivors, where a chain is unrepresentable.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    result, _ = _run(lib, [
        _rec("Prior", 1957, _CHAIN_MID),
        _rec("Prior", 1957, _CHAIN_END_1),
        _rec("Prior", 1957, _CHAIN_END_2),
    ], min_similarity=0.5)
    check(result.get("synthesized") == 0,
          f"a chain of candidates was merged into one work: {result!r}")
    check(_reasons(result) == ["ambiguous-candidates"], f"{result!r}")


def test_the_verdict_does_not_depend_on_the_order_crossref_returned(tmp_path: Path):
    """The PROPERTY the `survivors.sort` exists for, asserted directly.

    Stated honestly: for this fixture complete linkage alone already answers
    the same way in every order, so removing the sort does not fail this leg —
    it pins the property, not the mechanism, and the mechanism it most
    plausibly protects (residual greedy order-sensitivity at four or more
    candidates) has no fixture here. Keeping it means a future change that
    makes the pass order-sensitive at THIS size is caught.
    """
    recs = [
        _rec("Prior", 1957, _CHAIN_MID),
        _rec("Prior", 1957, _CHAIN_END_1),
        _rec("Prior", 1957, _CHAIN_END_2),
    ]
    verdicts = set()
    for i, order in enumerate([
        [recs[0], recs[1], recs[2]], [recs[2], recs[1], recs[0]],
        [recs[1], recs[0], recs[2]], [recs[1], recs[2], recs[0]],
    ]):
        lib = _make_library(tmp_path / f"o{i}", ["missing-bib-entry: Prior 1957"])
        result, _ = _run(lib, order, min_similarity=0.5)
        verdicts.add((result.get("synthesized"), tuple(_reasons(result))))
    check(len(verdicts) == 1,
          f"verdict depends on input order: {verdicts!r}")


def test_a_disambiguated_year_still_clears_the_year_bar(tmp_path: Path):
    """`missing-bib-entry: Fodor 1975a` — author-year disambiguation is the
    norm in the corpus this script is FOR.

    `work_identity.norm_year` answers None for `1975a` (no word boundary
    before the letter), and both acceptance bars short-circuit on None — so
    without the target-year slice EVERY lettered target is refused whatever
    the evidence, and reported as `no-author-year-match`, which names the
    wrong cause. The suffix must survive into the citekey, since that is what
    distinguishes it from its sibling.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Fodor 1975a"])
    result, _ = _run(lib, [_rec("Fodor", 1975, "The Language of Thought")],
                     dry_run=False)
    check(result.get("synthesized") == 1,
          f"lettered year refused a perfect match: {result!r}")
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("@book{fodor1975language," in text or "@article{fodor1975language," in text,
          f"unexpected citekey for a lettered year: {text!r}")


def test_the_citekey_names_the_FIRST_cited_author(tmp_path: Path):
    """The one artifact the user has to type into `\cite{}`.

    Building it from the raw phrase's last token gives `al<year>…` for every
    `et al.` mention and the SECOND author for `A and B` — and the `et al.`
    half is newly reachable, because the pre-372 substring gate refused every
    `et al.` target before it could get there.
    """
    lib = _make_library(tmp_path, ["missing-bib-entry: Grosz et al. 1986"])
    result, _ = _run(lib, [
        _rec("Grosz", 1986, "Attention Intentions and Discourse",
             extra_authors=("Sidner",)),
    ])
    check(result["citekeys"] == ["grosz1986attention"],
          f"citekey not built from the first cited author: {result!r}")

    lib2 = _make_library(tmp_path / "b", ["missing-bib-entry: Grosz and Sidner 1986"])
    two, _ = _run(lib2, [
        _rec("Grosz", 1986, "Attention Intentions and Discourse",
             extra_authors=("Sidner",)),
    ])
    check(two["citekeys"] == ["grosz1986attention"],
          f"citekey took the SECOND author: {two!r}")


def test_a_generational_suffix_does_not_become_the_surname(tmp_path: Path):
    """The lookup spec's step 1 ends "drop trailing jr|sr|iii".

    A bib field carries the suffix inside the surname portion
    (`King Jr., Martin Luther`) while Crossref carries it in a separate key —
    so without the drop the Library side keys on `jr` and the other two
    sources key on `king`, defeating Library-first for exactly those entries.
    """
    master = """@book{king1963letter,
  author = {King Jr., Martin Luther},
  year = {1963},
  title = {Letter from Birmingham Jail},
}
"""
    lib = _make_library(tmp_path, ["missing-bib-entry: King 1963"],
                        master_bib=master)
    result, calls = _run(lib, [_rec("King", 1963, "A Crossref Guess")])
    check(result.get("synthesized") == 1, f"suffixed master row missed: {result!r}")
    check(calls == [], f"fell through to Crossref: {calls!r}")


def test_a_bare_single_surname_is_a_prefix_claim_too(tmp_path: Path):
    """`Smith 1990` asserts SOLE-or-first authorship — a stronger claim than
    `Smith et al. 1990`, so it cannot get the weaker test. Before this, the
    bare mention was accepted against a ten-author record with Smith LAST
    while the `et al.` form was refused, inverting the two."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Smith 1990"])
    buried = _rec("Alpha", 1990, "A Very Large Collaboration",
                  extra_authors=("Beta", "Gamma", "Delta", "Smith"))
    result, _ = _run(lib, [buried])
    check(result.get("synthesized") == 0,
          f"bare surname matched a fifth-position author: {result!r}")
    check(_reasons(result) == ["no-author-year-match"], f"{result!r}")


def test_a_string_valued_title_is_written_whole(tmp_path: Path):
    """Crossref's `title` is normally a list; the acceptance path tolerates a
    bare string. The WRITER must read the same field the same way — indexing
    `[0]` on a string yields the first CHARACTER, and a well-formed entry
    whose title is one letter passes every filter into the user's `.bib`."""
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"])
    rec = _rec("Prior", 1957, "Time and Modality", journal="Mind")
    rec["title"] = "Time and Modality"
    rec["container-title"] = "Mind"
    _run(lib, [rec], dry_run=False)
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("title = {Time and Modality}" in text, f"title truncated: {text!r}")
    check("journal = {Mind}" in text, f"container truncated: {text!r}")


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
  doi = {10.1/masterrow},
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
    check("10.1/masterrow" in text, f"master fields not copied: {text!r}")
    check("from library master.bib" in text, f"provenance tag missing: {text!r}")
    # The tag must separate the two claims: the FIELDS are authenticated, the
    # WORK was matched on author+year alone. A tag that says only
    # "authenticated" reads as "verified to be the cited work", which is the
    # stated residual promised away again.
    check("verify it is the work this paper cites" in text,
          f"provenance tag overstates what was verified: {text!r}")
    # …and it states the row's OWN recorded auth state rather than asserting
    # one. master.bib legitimately holds `unverified` / `failed` rows, and
    # stamping "authenticated" over one of those is `_find-or-surface.md`
    # rule 1 — a low-confidence match passed off as authenticated, written
    # into the user's file.
    check("bib.state = none" in text,
          f"provenance asserts an auth state it never read: {text!r}")
    check("authenticated" not in text,
          f"unchecked authentication claim: {text!r}")
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
    check(calls == [], f"fell through to Crossref on an ambiguous Library: {calls!r}")
    check(_reasons(result) == ["ambiguous-in-library"], f"{result!r}")


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
    text = (lib / "papers" / CITEKEY / "references.bib").read_text()
    check("prior1957" not in text, f"broken entry reached the .bib: {text!r}")
    # Last, so a renamed reason reports a DISPLAY drift rather than standing in
    # for the behavioural failure above.
    check(_reasons(result) == ["library-entry-unreadable"], f"{result!r}")


def test_an_already_present_citekey_is_reported_not_silently_skipped(tmp_path: Path):
    """A warning whose entry is already in `references.bib` is a STALE
    warning, and the operator wants to know that — the pre-372 `continue`
    dropped the target without a word, which reads identically to 'nothing
    matched'."""
    master = MASTER.replace("prior1957timeandmodality", "existing2001")
    lib = _make_library(tmp_path, ["missing-bib-entry: Prior 1957"],
                        master_bib=master)
    result, _ = _run(lib, [], dry_run=False)
    check(result.get("synthesized") == 0, f"{result!r}")
    # The substantive half: the file must be untouched. Without it the leg's
    # only tooth is a display string on a target that could not have resolved
    # anyway, since no Crossref records were supplied.
    check((lib / "papers" / CITEKEY / "references.bib").read_text()
          == "@article{existing2001,\n  title = {Something Else},\n}\n",
          "references.bib touched for an already-present citekey")
    check(_reasons(result) == ["already-in-references-bib"], f"{result!r}")


def test_no_crossref_records_is_reported_distinctly(tmp_path: Path):
    lib = _make_library(tmp_path, ["missing-bib-entry: Obscure 1899"])
    result, _ = _run(lib, [], dry_run=False)
    check(result.get("synthesized") == 0, f"{result!r}")
    check(_reasons(result) == ["no-crossref-records"], f"{result!r}")
    # The substantive half: an empty candidate set must leave the file alone.
    # Without this the leg's only tooth is a display string, so a rename would
    # be the whole failure and a real write would be invisible.
    check((lib / "papers" / CITEKEY / "references.bib").read_text()
          == "@article{existing2001,\n  title = {Something Else},\n}\n",
          "references.bib touched on a no-match target")


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
