"""Regression guard for task 158 — the fabricated-script-CLI class.

`bib_auth.py` had no argparse at all: its only entry point was positional
(`<title> [<author>…]`). Two skills nevertheless documented rich invocations —
`find-citation.md` used `--query`/`--type`, `answer-bib-review.md` used
`--citekey`/`--title`/`--author`/`--type` — and argv silently mis-parsed every
one of them (`title="--query"`, the rest of the line becoming "authors"). The
lookups didn't error; they came back garbage, which is worse, because the
skills' only fallback trigger was `ModuleNotFoundError`.

The fix is the CLI the skills already assumed, with the fork the two callers
genuinely have made explicit:

  * SEARCH (`--query`) — discovery. Returns ranked CANDIDATES. Authenticating
    a free-text description is meaningless: the seed title never matches, so
    the verdict is `failed` even when the top hit is exactly right.
  * AUTH (`--citekey` / `--title`) — a verdict on a specific entry.
    `--citekey` reads title/authors/fields/type out of `master.bib` verbatim,
    which is what the doctrine demands and what a hand-marshalled
    `python3 -c` snippet cannot guarantee (an apostrophe in a title breaks
    the shell quoting outright).

These tests never touch the network: `authenticate` and the four search
engines are swapped for recorders.

Run: python3 library/scripts/tests/test_bib_auth_cli.py
(or: python3 -m pytest library/scripts/tests/test_bib_auth_cli.py)
"""
import io
import json
import sys
from contextlib import contextmanager, redirect_stdout, redirect_stderr
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import bib_auth  # noqa: E402


MASTER_BIB = """\
@book{genette1997,
  title = {Paratexts: Thresholds of Interpretation},
  year = {1997},
  publisher = {Cambridge University Press},
  author = {Genette, G{\\'e}rard and Lewin, Jane E.},
  doi = {10.1017/cbo9780511549373}
}

@article{smith2001,
  title = {On Marginalia},
  author = {Smith, Jane},
  year = {2001},
  journal = {Journal of Annotation}
}
"""


def _make_library(tmp_path: Path) -> Path:
    lib = tmp_path / "Library"
    (lib / ".virgil").mkdir(parents=True)
    (lib / "master.bib").write_text(MASTER_BIB, encoding="utf-8")
    (lib / ".virgil" / "catalog.json").write_text("{}", encoding="utf-8")
    return lib


@contextmanager
def _patched(**fns):
    """Temporarily swap module-level functions on bib_auth."""
    saved = {k: getattr(bib_auth, k) for k in fns}
    for k, v in fns.items():
        setattr(bib_auth, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(bib_auth, k, v)


class _Recorder:
    """Stand-in for `authenticate` that records the call and returns a stub."""

    def __init__(self, state: str = "authenticated"):
        self.calls: list[tuple] = []
        self.state = state

    def __call__(self, title, authors, fields, **kw):
        self.calls.append((title, authors, fields, kw))
        return bib_auth.AuthResult(state=self.state, score=0.99,
                                   sources=["stub"], note="stub")


def _run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = bib_auth.main(argv)
    return code, out.getvalue(), err.getvalue()


# ── AUTH mode ───────────────────────────────────────────────────────────


def test_citekey_and_type_parse_and_seed_from_master_bib(tmp_path: Path):
    """`--citekey` + `--type` — the answer-bib-review / authenticate-bib shape."""
    lib = _make_library(tmp_path)
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, out, err = _run(["--citekey", "genette1997", "--library", str(lib),
                               "--type", "book"])
    assert code == 0, err
    assert len(rec.calls) == 1
    title, authors, fields, kw = rec.calls[0]
    # Verbatim from master.bib — no cleanup, no normalization.
    assert title == "Paratexts: Thresholds of Interpretation"
    assert authors == ["Genette, G{\\'e}rard", "Lewin, Jane E."]
    assert fields["doi"] == "10.1017/cbo9780511549373"
    assert kw["entry_type"] == "book"
    assert kw["citekey"] == "genette1997"
    # library is threaded so the recovery chain can read papers/<citekey>/.
    assert Path(kw["library"]).name == "Library"
    # Output shape is the bare AuthResult, as before the CLI existed.
    assert json.loads(out)["state"] == "authenticated"


def test_entry_type_defaults_to_the_bib_entrys_own_type(tmp_path: Path):
    lib = _make_library(tmp_path)
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--citekey", "smith2001", "--library", str(lib)])
    assert code == 0, err
    assert rec.calls[0][3]["entry_type"] == "article"


def test_explicit_title_overrides_the_bib_entry(tmp_path: Path):
    """index-paper re-runs auth with a CORRECTED title; the override is the door."""
    lib = _make_library(tmp_path)
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--citekey", "smith2001", "--library", str(lib),
                             "--title", "Marginalia and Its Discontents"])
    assert code == 0, err
    assert rec.calls[0][0] == "Marginalia and Its Discontents"
    # The rest of the entry still comes from the bib.
    assert rec.calls[0][1] == ["Smith, Jane"]


def test_title_author_type_flags_without_a_citekey(tmp_path: Path):
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--title", "On Marginalia", "--author", "Smith, Jane",
                             "--author", "Doe, John", "--type", "article"])
    assert code == 0, err
    title, authors, fields, kw = rec.calls[0]
    assert title == "On Marginalia"
    assert authors == ["Smith, Jane", "Doe, John"]
    assert kw["entry_type"] == "article"
    # No citekey → no library, so the recovery chain stays off.
    assert kw["library"] is None and kw["citekey"] is None


def test_one_and_joined_author_field_splits(tmp_path: Path):
    rec = _Recorder()
    with _patched(authenticate=rec):
        _run(["--title", "T", "--author", "Smith, J. and Doe, J."])
    assert rec.calls[0][1] == ["Smith, J.", "Doe, J."]


def test_legacy_positional_form_still_works(tmp_path: Path):
    """The pre-158 invocation is still exactly what it was."""
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, out, err = _run(["Paratexts", "Genette, G."])
    assert code == 0, err
    assert rec.calls[0][0] == "Paratexts"
    assert rec.calls[0][1] == ["Genette, G."]
    assert json.loads(out)["state"] == "authenticated"


# ── SEARCH mode ─────────────────────────────────────────────────────────


def _fake_engine(records):
    return lambda *a, **k: list(records)


def test_query_runs_search_not_authentication(tmp_path: Path):
    """A free-text query must NOT be fed to the authenticator."""
    rec = _Recorder()
    hits = [{"source": "crossref", "doi": "10.1/x", "title": "Marginalia in Manuscripts",
             "authors": ["Smith, J."], "year": "1999", "raw": {"huge": "payload"}}]
    with _patched(
        authenticate=rec,
        crossref_search=_fake_engine(hits),
        openalex_search=_fake_engine([]),
        semantic_scholar_search=_fake_engine([]),
        arxiv_search=_fake_engine([]),
    ):
        code, out, err = _run(["--query", "marginalia in medieval manuscripts",
                               "--type", "article"])
    assert code == 0, err
    assert rec.calls == [], "search mode must not authenticate"
    payload = json.loads(out)
    assert payload["mode"] == "search"
    assert payload["entry_type"] == "article"
    assert len(payload["candidates"]) == 1
    cand = payload["candidates"][0]
    assert cand["title"] == "Marginalia in Manuscripts"
    assert "score" in cand
    # `raw` is the upstream payload — kilobytes per record, read by nobody.
    assert "raw" not in cand


def test_search_dedupes_and_ranks_and_honors_limit(tmp_path: Path):
    same_doi = {"source": "crossref", "doi": "10.1/x", "title": "Exact Title",
                "authors": [], "year": "2000"}
    other = {"source": "openalex", "doi": "", "title": "Something Else Entirely",
             "authors": [], "year": "2000"}
    third = {"source": "arxiv", "doi": "", "title": "Exact Titlz", "authors": [],
             "year": "2000"}
    with _patched(
        crossref_search=_fake_engine([same_doi]),
        openalex_search=_fake_engine([dict(same_doi, source="openalex"), other]),
        semantic_scholar_search=_fake_engine([]),
        arxiv_search=_fake_engine([third]),
    ):
        code, out, _ = _run(["--query", "Exact Title", "--limit", "2"])
    assert code == 0
    cands = json.loads(out)["candidates"]
    assert len(cands) == 2, "limit not honored"
    assert cands[0]["title"] == "Exact Title", "not ranked by title similarity"
    dois = [c.get("doi") for c in cands]
    assert dois.count("10.1/x") == 1, "duplicate DOI not deduped"


def test_search_type_narrows_crossref_and_adds_book_engines(tmp_path: Path):
    """`--type` must mean the same thing in SEARCH as it does in AUTH.

    A flag that filters in one mode and is decorative in the other is the
    same doc-vs-code drift this CLI exists to end.
    """
    seen: dict = {}

    def fake_crossref(title, author="", filters=None):
        seen["filters"] = filters
        return []

    called: list[str] = []

    def fake_books(*a, **k):
        called.append("google-books")
        return []

    def fake_openlibrary(*a, **k):
        called.append("openlibrary")
        return []

    with _patched(
        crossref_search=fake_crossref,
        openalex_search=_fake_engine([]),
        semantic_scholar_search=_fake_engine([]),
        arxiv_search=_fake_engine([]),
        _google_books_search=fake_books,
        _openlibrary_title_search=fake_openlibrary,
    ):
        code, _, err = _run(["--query", "Paratexts", "--type", "book"])
    assert code == 0, err
    assert seen["filters"] == {"type": "book"}, seen
    assert sorted(called) == ["google-books", "openlibrary"]

    with _patched(
        crossref_search=fake_crossref,
        openalex_search=_fake_engine([]),
        semantic_scholar_search=_fake_engine([]),
        arxiv_search=_fake_engine([]),
    ):
        _run(["--query", "On Marginalia", "--type", "article"])
    assert seen["filters"] == {"type": "journal-article"}

    with _patched(
        crossref_search=fake_crossref,
        openalex_search=_fake_engine([]),
        semantic_scholar_search=_fake_engine([]),
        arxiv_search=_fake_engine([]),
    ):
        _run(["--query", "anything"])
    assert seen["filters"] is None, "no --type must not invent a filter"


def test_query_with_a_citekey_is_authentication_not_search(tmp_path: Path):
    """`--citekey` names a specific entry; the query is then just a seed title."""
    lib = _make_library(tmp_path)
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, out, err = _run(["--citekey", "smith2001", "--library", str(lib),
                               "--query", "ignored-as-a-search"])
    assert code == 0, err
    assert len(rec.calls) == 1
    assert "mode" not in json.loads(out)


# ── Refusals ────────────────────────────────────────────────────────────


def test_unknown_citekey_exits_1(tmp_path: Path):
    lib = _make_library(tmp_path)
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--citekey", "nobody1900", "--library", str(lib)])
    assert code == 1
    assert "nobody1900" in err
    assert rec.calls == []


def test_bad_library_exits_2(tmp_path: Path):
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--citekey", "x", "--library", str(tmp_path / "nope")])
    assert code == 2
    assert "not a Virgil library" in err
    assert rec.calls == []


def test_fields_file_supplies_the_current_entry_fields(tmp_path: Path):
    """The fast-paths read `current_fields`; a non-library entry needs a door.

    /editor/answer-bib-review holds a work cited by the USER's paper, which is
    usually not in master.bib — so `--citekey` doesn't apply and, without
    `--fields-file`, its DOI/arXiv/ISBN fast-paths could never run however
    firmly the skill prose said they would.
    """
    ff = tmp_path / "fields.json"
    ff.write_text(json.dumps({
        "title": "On Marginalia", "author": "Smith, Jane",
        "doi": "10.1000/marg", "journal": "Journal of Annotation",
    }), encoding="utf-8")
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--fields-file", str(ff), "--type", "article"])
    assert code == 0, err
    title, authors, fields, kw = rec.calls[0]
    assert fields["doi"] == "10.1000/marg"
    # title/author fall back to the fields when not stated separately.
    assert title == "On Marginalia"
    assert authors == ["Smith, Jane"]


def test_fields_file_merges_over_a_citekey_seed(tmp_path: Path):
    lib = _make_library(tmp_path)
    ff = tmp_path / "fields.json"
    ff.write_text(json.dumps({"doi": "10.1000/override"}), encoding="utf-8")
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--citekey", "smith2001", "--library", str(lib),
                             "--fields-file", str(ff)])
    assert code == 0, err
    fields = rec.calls[0][2]
    assert fields["doi"] == "10.1000/override", "explicit file must win"
    assert fields["journal"] == "Journal of Annotation", "bib fields must survive"


def test_unreadable_fields_file_exits_2(tmp_path: Path):
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--title", "T", "--fields-file",
                             str(tmp_path / "nope.json")])
    assert code == 2
    assert "--fields-file" in err
    assert rec.calls == []


def test_env_var_resolves_the_library_without_the_editor_silo(tmp_path: Path):
    """VIRGIL_LIBRARY_ROOT works even where `library_path.py` isn't reachable.

    The env var is part of the documented resolution chain, but that chain
    lives in the OTHER silo — so honoring it only through that delegate would
    make it silently inert in a library-only checkout, with an error message
    still advertising it.
    """
    import os as _os

    lib = _make_library(tmp_path)
    rec = _Recorder()
    prev = _os.environ.get("VIRGIL_LIBRARY_ROOT")
    _os.environ["VIRGIL_LIBRARY_ROOT"] = str(lib)
    try:
        with _patched(authenticate=rec, _import_library_path_resolver=lambda: None):
            code, _, err = _run(["--citekey", "smith2001"])
    finally:
        if prev is None:
            _os.environ.pop("VIRGIL_LIBRARY_ROOT", None)
        else:
            _os.environ["VIRGIL_LIBRARY_ROOT"] = prev
    assert code == 0, err
    assert rec.calls[0][0] == "On Marginalia"


def test_no_seed_at_all_exits_2(tmp_path: Path):
    rec = _Recorder()
    with _patched(authenticate=rec):
        code, _, err = _run(["--type", "article"])
    assert code == 2
    assert "nothing to look up" in err
    assert rec.calls == []


# ── The skills' own invocations parse ───────────────────────────────────


def test_every_flag_the_skills_document_is_accepted():
    """The exact flag sets find-citation.md and answer-bib-review.md use.

    `parse_args` on an unknown flag exits 2 via SystemExit — which is what
    made the pre-158 docs a live defect rather than a typo.
    """
    ap = bib_auth._build_arg_parser()
    for argv in (
        ["--query", "q", "--type", "article"],                       # find-citation
        ["--citekey", "k", "--title", "t", "--author", "a",
         "--type", "article", "--library", "/tmp/l"],                # answer-bib-review
    ):
        ns = ap.parse_args(argv)
        assert ns is not None


def _run_standalone() -> int:
    """Run the suite without pytest (it isn't installed everywhere)."""
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
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
