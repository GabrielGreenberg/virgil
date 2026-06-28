"""Tests for the F#3 pre-digital authentication route in bib_auth.

The corroboration SCORER (`score_predigital`) is pure and tested directly.
The network orchestration (`_authenticate_predigital`) and the `authenticate()`
canonical block are tested with the source helpers monkeypatched, so no network
is touched. The key safety property — fail-closed to the `canonical` descriptor
when corroboration is unavailable — is pinned.

Run: python3 library/scripts/tests/test_bib_auth_predigital.py
(or: python3 -m pytest library/scripts/tests/test_bib_auth_predigital.py)
"""
import sys
from contextlib import contextmanager
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import bib_auth  # noqa: E402


def _rec(source, title, authors, year="1959", publisher=""):
    return {
        "source": source, "doi": "", "title": title, "authors": authors,
        "year": year, "type": "book", "container": "", "volume": "",
        "issue": "", "page": "", "publisher": publisher, "raw": {},
    }


@contextmanager
def _patch(**fns):
    """Temporarily swap bib_auth module-level functions, restoring after."""
    saved = {k: getattr(bib_auth, k) for k in fns}
    try:
        for k, v in fns.items():
            setattr(bib_auth, k, v)
        yield
    finally:
        for k, v in saved.items():
            setattr(bib_auth, k, v)


TITLE = "Course in General Linguistics"
AUTHORS = ["Saussure, Ferdinand de"]


# ── score_predigital (pure) ─────────────────────────────────────────────

def test_two_distinct_sources_authenticate(tmp_path=None):
    records = [
        _rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"]),
        _rec("internet-archive", TITLE, ["Saussure, Ferdinand de"]),
    ]
    ok, score, sources, best = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", records)
    assert ok is True
    assert set(sources) == {"openlibrary-search", "internet-archive"}
    assert 0.85 <= score <= 0.95
    assert best is not None


def test_one_authoritative_plus_publisher_match_authenticates(tmp_path=None):
    records = [_rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"], publisher="Philosophical Library")]
    ok, score, sources, best = bib_auth.score_predigital(
        TITLE, AUTHORS, "1959", "Philosophical Library", records,
    )
    assert ok is True
    assert sources == ["openlibrary-search"]
    assert best is not None


def test_single_source_no_publisher_does_not_authenticate(tmp_path=None):
    records = [_rec("google-books", TITLE, ["Ferdinand de Saussure"])]
    ok, score, sources, best = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", records)
    assert ok is False
    assert score == 0.0
    assert best is None


def test_secondary_source_alone_with_publisher_does_not_authenticate(tmp_path=None):
    # Google Books is NOT authoritative, so even with a publisher match a lone
    # secondary source can't authenticate — needs ≥2 distinct sources or an
    # authoritative source.
    records = [_rec("google-books", TITLE, ["Ferdinand de Saussure"], publisher="Philosophical Library")]
    ok, *_ = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "Philosophical Library", records)
    assert ok is False


def test_wrong_author_is_not_a_corroboration(tmp_path=None):
    records = [
        _rec("openlibrary-search", TITLE, ["Chomsky, Noam"]),
        _rec("internet-archive", TITLE, ["Pinker, Steven"]),
    ]
    ok, *_ = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", records)
    assert ok is False


def test_far_year_rejected_close_year_reprint_accepted(tmp_path=None):
    far = [
        _rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"], year="1916"),
        _rec("internet-archive", TITLE, ["Ferdinand de Saussure"], year="2011"),
    ]
    # 1959 vs 1916 (>5) and vs 2011 (>5) → both rejected → no corroboration.
    ok_far, *_ = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", far)
    assert ok_far is False
    near = [
        _rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"], year="1960"),
        _rec("internet-archive", TITLE, ["Ferdinand de Saussure"], year="1959"),
    ]
    ok_near, *_ = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", near)
    assert ok_near is True


def test_low_title_similarity_rejected(tmp_path=None):
    records = [
        _rec("openlibrary-search", "A Completely Different Book", ["Ferdinand de Saussure"]),
        _rec("internet-archive", "Another Unrelated Title", ["Ferdinand de Saussure"]),
    ]
    ok, *_ = bib_auth.score_predigital(TITLE, AUTHORS, "1959", "", records)
    assert ok is False


# ── _authenticate_predigital (network-monkeypatched) ─────────────────────

def test_predigital_fail_closed_when_no_sources(tmp_path=None):
    empty = lambda *a, **k: []
    with _patch(
        _openlibrary_title_search=empty, _google_books_search=empty,
        _internet_archive_search=empty, openalex_search=empty,
        crossref_search=empty,
    ):
        res = bib_auth._authenticate_predigital(
            TITLE, AUTHORS, {"title": TITLE, "author": AUTHORS[0], "year": "1959"},
            entry_type="book", year_int=1959,
        )
    assert res is None


def test_predigital_authenticates_with_two_catalogs(tmp_path=None):
    with _patch(
        _openlibrary_title_search=lambda t, a="": [_rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"])],
        _google_books_search=lambda t, a="": [],
        _internet_archive_search=lambda t, a="": [_rec("internet-archive", TITLE, ["Saussure, Ferdinand de"])],
        openalex_search=lambda t: [],
        crossref_search=lambda t, a="", filters=None: [],
    ):
        res = bib_auth._authenticate_predigital(
            TITLE, AUTHORS, {"title": TITLE, "author": AUTHORS[0], "year": "1959"},
            entry_type="book", year_int=1959,
        )
    assert res is not None
    assert res.state == "authenticated"
    assert "predigital(" in res.sources[0]


# ── authenticate() canonical block (integration, no network) ─────────────

def test_authenticate_predigital_route_supersedes_canonical(tmp_path=None):
    fields = {"title": TITLE, "author": AUTHORS[0], "year": "1959",
              "publisher": "Philosophical Library"}
    with _patch(
        _authenticate_core=lambda *a, **k: bib_auth.AuthResult(state="failed"),
        _openlibrary_title_search=lambda t, a="": [_rec("openlibrary-search", TITLE, ["Ferdinand de Saussure"])],
        _google_books_search=lambda t, a="": [],
        _internet_archive_search=lambda t, a="": [_rec("internet-archive", TITLE, ["Saussure, Ferdinand de"])],
        openalex_search=lambda t: [],
        crossref_search=lambda t, a="", filters=None: [],
    ):
        res = bib_auth.authenticate(TITLE, AUTHORS, fields, entry_type="book")
    assert res.state == "authenticated"


def test_authenticate_falls_back_to_canonical_when_uncorroborated(tmp_path=None):
    fields = {"title": TITLE, "author": AUTHORS[0], "year": "1959"}
    empty = lambda *a, **k: []
    with _patch(
        _authenticate_core=lambda *a, **k: bib_auth.AuthResult(state="failed"),
        _openlibrary_title_search=empty, _google_books_search=empty,
        _internet_archive_search=empty, openalex_search=empty,
        crossref_search=empty,
    ):
        res = bib_auth.authenticate(TITLE, AUTHORS, fields, entry_type="book")
    assert res.state == "canonical"


def test_modern_failed_entry_stays_failed(tmp_path=None):
    # A 2008 book that fails the modern chain must NOT enter the pre-digital
    # route — it stays `failed` so the action-needed signal survives.
    fields = {"title": "A Modern Monograph", "author": "Author, A", "year": "2008"}
    empty = lambda *a, **k: []
    with _patch(
        _authenticate_core=lambda *a, **k: bib_auth.AuthResult(state="failed"),
        _openlibrary_title_search=empty, _google_books_search=empty,
        _internet_archive_search=empty, openalex_search=empty,
        crossref_search=empty,
    ):
        res = bib_auth.authenticate("A Modern Monograph", ["Author, A"], fields, entry_type="book")
    assert res.state == "failed"


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
