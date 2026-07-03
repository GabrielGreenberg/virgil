"""Regression tests for the Hazard-5 bib-parser hardening + catalog-writer fixes.

Covers (see DEDUP_HARDENING.md §"Adjacent correctness fixes" and the P task):

  A. Nasty synthetic entries survive parsing in BOTH parsers:
     - 5(a) `"`-quoted value with an inner quote (escaped and braced) no longer
       truncates the value or drops the following fields (e.g. doi).
     - 5(b) a column-0 `@type{key,` inside a BALANCED brace value is not
       mis-detected as a new entry; the enclosing entry keeps all its fields.
     - containment for a genuinely brace-UNbalanced entry is preserved (one bad
       entry can't swallow the rest of the file).
  B. Real-slice round-trip: parse the master.bib snapshot with `read_master_bib`
     and assert entry count >= the pre-fix baseline (no NEW drops) and that a
     spot-set of known-DOI entries still carry their DOIs.
  C. `upsert_catalog_entry` deep-merges nested dict fields on an existing row
     (importedKeys/authenticatedAt survive a `bib={state}` patch).
  D. The `_guard` blocks an append of a same-work-different-citekey row
     (DuplicateWorkError) while a genuinely-new work still appends.

Run:  python3 test_parser_hardening.py
Exits non-zero on any failure; prints a PASS/FAIL tally + snapshot counts.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _bib_parse  # noqa: E402
import _tools  # noqa: E402
import work_identity  # noqa: E402


# The snapshot the harness pins for the real-slice round-trip. Overridable via
# env so the test is not machine-locked.
SNAPSHOT = Path(os.environ.get(
    "MASTER_BIB_SNAPSHOT",
    "/private/tmp/claude-501/-Users-gabriel-Library-CloudStorage-Dropbox-Virgil-Library/"
    "5ea2a9bc-4622-4019-bc92-4ac2f124c0f7/scratchpad/dedup-workspace/snapshots/master.bib.snapshot",
))

# Pre-fix baseline measured on the pinned snapshot (both parsers agree).
PREFIX_ENTRY_COUNT = 27012
PREFIX_DOI_COUNT = 18764

# A deterministic spot-set of entries known to carry DOIs in the snapshot.
SPOT_DOIS = {
    "-Berger": "10.1136/bmj.332.7551.1219",
    "bedny2007item": "10.1016/j.neuroimage.2007.01.039",
    "chalmers2009ontological": "10.1093/oso/9780199546046.003.0003",
    "dowty1977semantic": "10.1007/bf00351936",
    "gbf03": "10.1145/882262.882358",
    "hertenstein2004retention": "10.1111/j.1467-8624.2004.00695.x",
    "king1994propositions": "10.1111/j.1475-4975.1994.tb00279.x",
    "luce1988rank": "10.1007/bf00056140",
    "navalpakkam2007search": "10.1016/j.neuron.2007.01.018",
    "rabbitt1989reflexive": "10.1037/0096-1523.15.2.315",
    "shams2010crossmodal": "10.1016/j.plrev.2010.04.006",
    "travis1985strictly": "10.1080/00455091.1985.10716416",
}


# ─────────────────────────────────────────────────────────────────────────
# Tiny test harness (stdlib-only; no pytest dependency).
# ─────────────────────────────────────────────────────────────────────────

_PASS = 0
_FAIL = 0
_FAILURES: list[str] = []


def check(cond: bool, msg: str) -> None:
    global _PASS, _FAIL
    if cond:
        _PASS += 1
    else:
        _FAIL += 1
        _FAILURES.append(msg)
        print(f"  FAIL: {msg}")


def _write_tmp_bib(text: str) -> Path:
    p = Path(tempfile.mktemp(suffix=".bib"))
    p.write_text(text)
    return p


# ─────────────────────────────────────────────────────────────────────────
# A. Nasty synthetic entries
# ─────────────────────────────────────────────────────────────────────────


def test_hazard_5a_escaped_inner_quote():
    """A `"`-quoted value with backslash-escaped inner quotes keeps the whole
    value AND the following doi field (both parsers)."""
    text = (
        '@article{quoteinner,\n'
        '  title = "He said \\"hello\\" to me",\n'
        '  doi = {10.1/aaa}\n'
        '}\n'
    )
    e = _bib_parse.parse_bib_text(text)[0]
    check(e["fields"]["title"] == 'He said \\"hello\\" to me',
          f"5a bib_parse title truncated: {e['fields'].get('title')!r}")
    check(e["fields"].get("doi") == "10.1/aaa",
          f"5a bib_parse doi dropped: {e['fields'].get('doi')!r}")

    p = _write_tmp_bib(text)
    mm = _tools.read_master_bib(p)
    check(mm.get("quoteinner", {}).get("fields", {}).get("title") == 'He said \\"hello\\" to me',
          f"5a _tools title truncated: {mm.get('quoteinner', {}).get('fields', {}).get('title')!r}")
    check(mm.get("quoteinner", {}).get("fields", {}).get("doi") == "10.1/aaa",
          f"5a _tools doi dropped: {mm.get('quoteinner', {}).get('fields', {}).get('doi')!r}")


def test_hazard_5a_braced_inner_quote():
    """A `"`-quoted value containing a brace-wrapped quote `{"}` closes at the
    outer `"`, not the inner one — later fields survive."""
    text = '@misc{braced, title = "a {"} b", year = {2001}, doi = {10.1/qqq}}\n'
    e = _bib_parse.parse_bib_text(text)[0]
    check(e["fields"].get("year") == "2001",
          f"5a-braced bib_parse year lost: {e['fields']!r}")
    check(e["fields"].get("doi") == "10.1/qqq",
          f"5a-braced bib_parse doi lost: {e['fields']!r}")

    p = _write_tmp_bib(text)
    mm = _tools.read_master_bib(p)
    check(mm.get("braced", {}).get("fields", {}).get("doi") == "10.1/qqq",
          f"5a-braced _tools doi lost: {mm.get('braced', {}).get('fields')!r}")


def test_hazard_5b_at_type_inside_brace_value():
    """A column-0 `@article{fake,...}` inside a BALANCED `note = {...}` value is
    NOT split into a phantom entry; the enclosing entry keeps its doi and the
    next real entry survives (both parsers)."""
    text = (
        '@article{realentry,\n'
        '  title = {A study},\n'
        '  note = {For example, one writes:\n'
        '@article{fake,\n'
        '  title = {not a real entry},\n'
        '  year = {1999}\n'
        '}\n'
        'which is inside this note.},\n'
        '  doi = {10.2/bbb}\n'
        '}\n'
        '\n'
        '@article{nextreal,\n'
        '  title = {Another},\n'
        '  doi = {10.3/ccc}\n'
        '}\n'
    )
    res = _bib_parse.parse_bib_text(text)
    keys = [x["citekey"] for x in res]
    check(keys == ["realentry", "nextreal"],
          f"5b bib_parse minted phantom / wrong keys: {keys}")
    by_key = {x["citekey"]: x for x in res}
    check(by_key.get("realentry", {}).get("fields", {}).get("doi") == "10.2/bbb",
          f"5b bib_parse realentry doi dropped: {by_key.get('realentry', {}).get('fields')!r}")
    check(by_key.get("nextreal", {}).get("fields", {}).get("doi") == "10.3/ccc",
          "5b bib_parse nextreal doi dropped")

    p = _write_tmp_bib(text)
    mm = _tools.read_master_bib(p)
    check(list(mm) == ["realentry", "nextreal"],
          f"5b _tools minted phantom / wrong keys: {list(mm)}")
    check(mm.get("realentry", {}).get("fields", {}).get("doi") == "10.2/bbb",
          f"5b _tools realentry doi dropped: {mm.get('realentry', {}).get('fields')!r}")


def test_containment_preserved_on_unbalanced_entry():
    """A genuinely brace-UNbalanced entry must NOT swallow the rest of the file:
    subsequent real entries and their DOIs survive (the pre-existing guarantee
    this superset fix must not regress)."""
    text = (
        '@article{broken,\n'
        '  title = {Unbalanced {oops},\n'
        '  doi = {10.9/broken}\n'
        '}\n'
        '\n'
        '@article{survivor1,\n'
        '  title = {First survivor},\n'
        '  doi = {10.1/one}\n'
        '}\n'
        '\n'
        '@article{survivor2,\n'
        '  title = {Second survivor},\n'
        '  doi = {10.2/two}\n'
        '}\n'
    )
    res = _bib_parse.parse_bib_text(text)
    keys = [x["citekey"] for x in res]
    check("survivor1" in keys and "survivor2" in keys,
          f"containment: survivors dropped by bib_parse: {keys}")
    by_key = {x["citekey"]: x for x in res}
    check(by_key.get("survivor2", {}).get("fields", {}).get("doi") == "10.2/two",
          "containment: survivor2 doi lost (bib_parse)")

    p = _write_tmp_bib(text)
    mm = _tools.read_master_bib(p)
    check("survivor1" in mm and "survivor2" in mm,
          f"containment: survivors dropped by _tools: {list(mm)}")
    check(mm.get("survivor2", {}).get("fields", {}).get("doi") == "10.2/two",
          "containment: survivor2 doi lost (_tools)")


def test_wellformed_entries_unchanged():
    """A plain well-formed entry parses identically (the fix is a superset)."""
    text = (
        '@article{plain,\n'
        '  title = {Ordinary Title},\n'
        '  author = {Doe, Jane},\n'
        '  year = {2010},\n'
        '  doi = {10.5/plain}\n'
        '}\n'
    )
    e = _bib_parse.parse_bib_text(text)[0]
    check(e["fields"] == {
        "title": "Ordinary Title",
        "author": "Doe, Jane",
        "year": "2010",
        "doi": "10.5/plain",
    }, f"well-formed entry changed: {e['fields']!r}")
    # A normal "-quoted value (no inner quotes) still parses cleanly.
    text2 = '@misc{q, title = "Simple Quoted", year = {2001}}\n'
    e2 = _bib_parse.parse_bib_text(text2)[0]
    check(e2["fields"] == {"title": "Simple Quoted", "year": "2001"},
          f"simple quoted value changed: {e2['fields']!r}")


# ─────────────────────────────────────────────────────────────────────────
# B. Real-slice round-trip on the snapshot
# ─────────────────────────────────────────────────────────────────────────


def test_snapshot_round_trip():
    if not SNAPSHOT.exists():
        print(f"  SKIP: snapshot not found at {SNAPSHOT}")
        return None
    mm = _tools.read_master_bib(SNAPSHOT)
    pb = _bib_parse.read_master_bib(SNAPSHOT)
    n_tools = len(mm)
    n_bib = len(pb)
    n_doi = sum(1 for v in mm.values() if v["fields"].get("doi"))
    check(n_tools >= PREFIX_ENTRY_COUNT,
          f"_tools entry count regressed: {n_tools} < {PREFIX_ENTRY_COUNT}")
    check(n_bib >= PREFIX_ENTRY_COUNT,
          f"_bib_parse entry count regressed: {n_bib} < {PREFIX_ENTRY_COUNT}")
    check(n_doi >= PREFIX_DOI_COUNT,
          f"doi count regressed: {n_doi} < {PREFIX_DOI_COUNT}")
    missing = [
        k for k, doi in SPOT_DOIS.items()
        if mm.get(k, {}).get("fields", {}).get("doi") != doi
    ]
    check(not missing, f"spot DOIs changed/dropped: {missing}")
    return (n_tools, n_bib, n_doi)


# ─────────────────────────────────────────────────────────────────────────
# C. upsert_catalog_entry deep-merge
# ─────────────────────────────────────────────────────────────────────────


def test_upsert_deep_merge_preserves_nested_keys():
    cat = {"entries": [{
        "citekey": "x2020",
        "bib": {"state": "authenticated",
                "importedKeys": ["a", "b"],
                "authenticatedAt": "2020-01-01"},
        "indexed": {"state": "indexed"},
    }]}
    r = _tools.upsert_catalog_entry(cat, "x2020", bib={"state": "needs-reauth"})
    check(r["bib"].get("state") == "needs-reauth", f"bib.state not updated: {r['bib']!r}")
    check(r["bib"].get("importedKeys") == ["a", "b"],
          f"importedKeys WIPED by shallow clobber: {r['bib']!r}")
    check(r["bib"].get("authenticatedAt") == "2020-01-01",
          f"authenticatedAt WIPED: {r['bib']!r}")
    check(r["indexed"].get("state") == "indexed", "sibling nested dict untouched")
    check("updatedAt" in r, "updatedAt not stamped on upsert")
    # scalar replace semantics unchanged
    r2 = _tools.upsert_catalog_entry(cat, "x2020", note="hello")
    check(r2.get("note") == "hello", "scalar field not set")
    # list fields REPLACE (not merge)
    cat2 = {"entries": [{"citekey": "y", "tags": ["old"]}]}
    r3 = _tools.upsert_catalog_entry(cat2, "y", tags=["new"])
    check(r3.get("tags") == ["new"], f"list field should replace, got {r3.get('tags')!r}")
    # returns the same row object (identity), row count unchanged
    check(cat["entries"][0] is r, "upsert should return the in-place row")
    check(len(cat["entries"]) == 1, "upsert on existing row should not append")


# ─────────────────────────────────────────────────────────────────────────
# D. upsert_catalog_entry duplicate-work guard
# ─────────────────────────────────────────────────────────────────────────


def _guard_index():
    return work_identity.WorkIndex([
        {"citekey": "smith2019", "type": "article",
         "fields": {"title": "A Theory of Widgets", "author": "Smith, J.",
                    "year": "2019", "doi": "10.1/xyz"}},
    ])


def test_guard_blocks_same_work_different_citekey():
    idx = _guard_index()
    cat = {"entries": []}
    raised = None
    try:
        _tools.upsert_catalog_entry(
            cat, "smith2019dup",
            _guard=idx,
            _guard_fields={"title": "A Theory of Widgets", "author": "Smith, J.",
                           "year": "2019", "doi": "10.1/xyz"},
            _guard_type="article",
            bib={"state": "none"},
        )
    except _tools.DuplicateWorkError as e:
        raised = e
    check(raised is not None, "expected DuplicateWorkError on same-DOI different-citekey")
    if raised is not None:
        check(raised.existing_citekey == "smith2019",
              f"wrong existing citekey: {raised.existing_citekey!r}")
        check(getattr(raised.verdict, "relation", None) == "same",
              "verdict should be relation=same")
    check(len(cat["entries"]) == 0, "guard must NOT append the duplicate row")


def test_guard_admits_genuinely_new_work():
    idx = _guard_index()
    cat = {"entries": []}
    r = _tools.upsert_catalog_entry(
        cat, "jones2021",
        _guard=idx,
        _guard_fields={"title": "Something Entirely Different", "author": "Jones, K.",
                       "year": "2021", "doi": "10.2/abc"},
        _guard_type="article",
    )
    check(r.get("citekey") == "jones2021", "new work should append")
    check(len(cat["entries"]) == 1, "new work row not appended")


def test_guard_ignores_exact_citekey_match():
    """When the incoming citekey already exists, the guard is never consulted —
    it's an update, not a new mint (even if _guard is passed)."""
    idx = _guard_index()
    cat = {"entries": [{"citekey": "smith2019", "bib": {"state": "authenticated"}}]}
    # Same citekey as the guard's only work → update path, no raise.
    r = _tools.upsert_catalog_entry(
        cat, "smith2019",
        _guard=idx,
        _guard_fields={"title": "A Theory of Widgets", "doi": "10.1/xyz"},
        _guard_type="article",
        bib={"state": "needs-reauth"},
    )
    check(r["bib"].get("state") == "needs-reauth", "exact-citekey update should proceed")
    check(len(cat["entries"]) == 1, "exact-citekey update should not append")


def test_no_guard_path_unaffected():
    """Callers passing no guard behave exactly as before (append a new row)."""
    cat = {"entries": []}
    r = _tools.upsert_catalog_entry(cat, "anything", bib={"state": "none"})
    check(r.get("citekey") == "anything", "no-guard append failed")
    check(len(cat["entries"]) == 1, "no-guard append did not add row")


# ─────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────


def main() -> int:
    tests = [
        test_hazard_5a_escaped_inner_quote,
        test_hazard_5a_braced_inner_quote,
        test_hazard_5b_at_type_inside_brace_value,
        test_containment_preserved_on_unbalanced_entry,
        test_wellformed_entries_unchanged,
        test_snapshot_round_trip,
        test_upsert_deep_merge_preserves_nested_keys,
        test_guard_blocks_same_work_different_citekey,
        test_guard_admits_genuinely_new_work,
        test_guard_ignores_exact_citekey_match,
        test_no_guard_path_unaffected,
    ]
    snapshot_counts = None
    for t in tests:
        print(f"• {t.__name__}")
        result = t()
        if t.__name__ == "test_snapshot_round_trip":
            snapshot_counts = result

    print("\n" + "=" * 60)
    print(f"PASS: {_PASS}   FAIL: {_FAIL}")
    if snapshot_counts:
        n_tools, n_bib, n_doi = snapshot_counts
        print(f"snapshot entries: _tools={n_tools} _bib_parse={n_bib} "
              f"(pre-fix {PREFIX_ENTRY_COUNT})")
        print(f"snapshot DOIs:    {n_doi} (pre-fix {PREFIX_DOI_COUNT})")
    if _FAILURES:
        print("\nfailures:")
        for f in _FAILURES:
            print(f"  - {f}")
    return 1 if _FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
