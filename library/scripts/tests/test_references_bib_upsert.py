"""Regression guard for task 168 — the references.bib truncation class.

`papers/<citekey>/references.bib` is a single-entry mirror of the master.bib
row only *at index time*. `/library/clean-bibliography` (deep-index step 3f)
overwrites it with the paper's **actual cited works**. FOUR paths re-emitted
the whole file from that one row —

  * `index_paper._resync_references_bib` (called unconditionally by
    `/library/authenticate-bib` step 6),
  * `index_paper`'s index-time stamp (step 8),
  * `triage_apply._write_references_bib` (the .bib-drop folder creation), and
  * `apply-bib-edit.md` step 3, which was skill PROSE telling the agent to
    "re-emit" the file by hand —

so authenticating, applying a manual bib edit to, re-indexing, or dropping a
colliding .bib on a deep-indexed paper collapsed a dozens-entry bibliography
to one, silently. The loss then propagated: `/library/merge-bibs` found one
entry where there had been many and reported a clean run.

The fix is an UPSERT primitive (`_bib_parse.upsert_entry_text`) behind ONE
file-level writer (`_tools.write_paper_bib_entry`) that every path routes
through. Two contracts these tests pin:

  1. every entry other than the target survives BYTE-IDENTICALLY;
  2. when that can't be guaranteed (a malformed .bib whose brace spans are
     ambiguous), the writer REFUSES and changes nothing — a best-guess splice
     would delete a neighbour, i.e. re-create the bug from inside the fix.

Run: python3 -m pytest library/scripts/tests/test_references_bib_upsert.py
"""
import sys
import unicodedata
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

from _bib_parse import (  # noqa: E402
    BibSpliceRefused,
    parse_bib_text,
    upsert_entry_text,
)


# A hand-formatted three-entry bibliography, deliberately NOT in the shape
# `emit_bib_entry` produces: quoted values, tabs, a comment line, an odd blank
# line. Byte-identical survival has to mean survival of all of that.
THREE_ENTRY = (
    "% cited works for smith2001\n"
    "@article{jones1998,\n"
    '  title = "On {Braces} and \\"Quotes\\"",\n'
    "\tauthor = {Jones, J.},\n"
    "  year = {1998},\n"
    "  doi = {10.1000/jones}\n"
    "}\n"
    "\n"
    "@book{smith2001,\n"
    "  title = {The Old Title},\n"
    "  author = {Smith, S.},\n"
    "  year = {2001}\n"
    "}\n"
    "\n"
    "@incollection{brown2010,\n"
    "  title = {A Chapter},\n"
    "  author = {Brown, B.},\n"
    "  booktitle = {A Collection},\n"
    "  pages = {1--20}\n"
    "}\n"
)


def _raw(text: str, citekey: str) -> str:
    return next(e["raw"] for e in parse_bib_text(text) if e["citekey"] == citekey)


def test_resync_of_one_entry_leaves_the_others_byte_identical():
    out = upsert_entry_text(
        THREE_ENTRY,
        "smith2001",
        "book",
        {"title": "The Authenticated Title", "author": "Smith, Sam", "year": "2001",
         "doi": "10.1000/smith"},
    )
    # The other two entries survive byte-for-byte, hand-formatting and all.
    assert _raw(out, "jones1998") == _raw(THREE_ENTRY, "jones1998")
    assert _raw(out, "brown2010") == _raw(THREE_ENTRY, "brown2010")
    # Entry count and file order are unchanged.
    assert [e["citekey"] for e in parse_bib_text(out)] == [
        "jones1998", "smith2001", "brown2010",
    ]
    # The leading comment line survives too.
    assert out.startswith("% cited works for smith2001\n")
    # The target entry actually took the new fields.
    smith = next(e for e in parse_bib_text(out) if e["citekey"] == "smith2001")
    assert smith["fields"]["title"] == "The Authenticated Title"
    assert smith["fields"]["doi"] == "10.1000/smith"


def test_resync_does_not_disturb_surrounding_whitespace():
    out = upsert_entry_text(
        THREE_ENTRY, "smith2001", "book",
        {"title": "The Old Title", "author": "Smith, S.", "year": "2001"},
    )
    # Splicing must not accumulate blank lines between entries — the tail
    # (including the newline that followed the old block) is preserved as-is.
    assert "\n\n\n" not in out
    # Prefix before the target and suffix after it are untouched.
    assert out[:out.index("@book{")] == THREE_ENTRY[:THREE_ENTRY.index("@book{")]
    assert out[out.index("@incollection{"):] == THREE_ENTRY[
        THREE_ENTRY.index("@incollection{"):
    ]


def test_resync_is_idempotent():
    fields = {"title": "The Authenticated Title", "author": "Smith, Sam",
              "year": "2001"}
    once = upsert_entry_text(THREE_ENTRY, "smith2001", "book", fields)
    twice = upsert_entry_text(once, "smith2001", "book", fields)
    assert once == twice


def test_entry_type_change_replaces_the_whole_block():
    out = upsert_entry_text(
        THREE_ENTRY, "smith2001", "incollection",
        {"title": "The Old Title", "author": "Smith, S.", "year": "2001",
         "booktitle": "Somewhere"},
    )
    entries = {e["citekey"]: e for e in parse_bib_text(out)}
    assert entries["smith2001"]["type"] == "incollection"
    # No stale `@book{smith2001` block left behind.
    assert out.count("smith2001,") == 1


def test_missing_entry_is_appended_not_substituted():
    out = upsert_entry_text(
        THREE_ENTRY, "newkey2020", "article",
        {"title": "Brand New", "author": "New, N.", "year": "2020"},
    )
    assert [e["citekey"] for e in parse_bib_text(out)] == [
        "jones1998", "smith2001", "brown2010", "newkey2020",
    ]
    # Pre-existing content is a strict prefix — nothing was rewritten.
    assert out.startswith(THREE_ENTRY)


def test_empty_and_absent_file_yield_the_plain_single_entry_mirror():
    # The first-index path: no file yet → the familiar single-entry mirror.
    fresh = upsert_entry_text("", "solo1999", "article",
                              {"title": "Solo", "year": "1999"})
    assert fresh == "@article{solo1999,\n  title = {Solo},\n  year = {1999}\n}\n"
    # A whitespace-only file behaves the same (no leading blank lines).
    assert upsert_entry_text("\n\n", "solo1999", "article",
                             {"title": "Solo", "year": "1999"}) == fresh


def test_malformed_neighbour_cannot_swallow_the_tail():
    # A brace-unbalanced entry ahead of the target must not let the splice
    # consume the rest of the file — the parser's contained span is used.
    bib = (
        "@article{broken,\n  title = {Bad {unbalanced},\n  author = {B, B},\n}\n\n"
        "@book{target,\n  title = {T},\n}\n\n"
        "@book{after,\n  title = {A},\n}\n"
    )
    out = upsert_entry_text(bib, "target", "book", {"title": "T2"})
    keys = [e["citekey"] for e in parse_bib_text(out)]
    assert keys == ["broken", "target", "after"]
    assert _raw(out, "after") == _raw(bib, "after")


def test_malformed_target_is_refused_not_guessed():
    # The target's own braces don't balance, so where it ENDS is a guess (the
    # parser caps it at the next opener). Splicing that guess would eat the
    # blank line — or a comment, or stray text — between it and the next entry.
    # Refuse instead; the file is left untouched.
    bib = (
        "@book{target,\n  title = {Bad {unbalanced},\n\n"
        "% ---- the paper's cited works follow ----\n"
        "@book{after,\n  title = {A},\n}\n"
    )
    try:
        upsert_entry_text(bib, "target", "book", {"title": "T2"})
    except BibSpliceRefused as e:
        assert "unbalanced" in str(e)
    else:
        raise AssertionError("expected BibSpliceRefused")


def test_late_balancing_target_does_not_delete_the_entry_it_spans():
    """The critical case. A `{` surplus in one entry's quoted value pairs with
    a `}` surplus in a LATER one, so the target's brace scan balances only past
    a real intervening entry. Splicing that span would silently DELETE the
    neighbour — the exact task-168 failure, reintroduced by the fix. Refuse."""
    bib = (
        '@book{smith2001,\n  title = "Rewriting { Systems",\n  year = {2001}\n}\n\n'
        '@article{kept1998,\n  title = "Closure } Properties",\n  year = {1998}\n}\n\n'
        "@book{tail2010,\n  title = {T}\n}\n"
    )
    try:
        upsert_entry_text(bib, "smith2001", "book",
                          {"title": "Rewriting Systems", "year": "2001"})
    except BibSpliceRefused as e:
        assert "kept1998" in str(e), str(e)
    else:
        raise AssertionError("expected BibSpliceRefused — kept1998 would be lost")


def test_refusal_leaves_the_file_untouched_on_disk(tmp_path):
    from _tools import write_paper_bib_entry

    bib = (
        '@book{smith2001,\n  title = "Rewriting { Systems",\n  year = {2001}\n}\n\n'
        '@article{kept1998,\n  title = "Closure } Properties",\n  year = {1998}\n}\n'
    )
    paper_dir = tmp_path / "papers" / "smith2001"
    paper_dir.mkdir(parents=True)
    (paper_dir / "references.bib").write_text(bib)
    try:
        write_paper_bib_entry(paper_dir, "smith2001", "book", {"title": "New"})
    except BibSpliceRefused:
        pass
    else:
        raise AssertionError("expected BibSpliceRefused")
    assert (paper_dir / "references.bib").read_text() == bib


def test_unbalanced_emitted_value_is_refused_not_written():
    # An unbalanced brace in a field VALUE would write a corrupt block and, on
    # the next pass, duplicate the tail of the entry — growing without bound.
    bib = "@book{t,\n  title = {Old}\n}\n\n@book{keep,\n  title = {K}\n}\n"
    try:
        upsert_entry_text(bib, "t", "book",
                          {"title": "Close } brace", "year": "2001"})
    except BibSpliceRefused as e:
        assert "unbalanced braces" in str(e)
    else:
        raise AssertionError("expected BibSpliceRefused")
    # An ESCAPED brace is a legitimate value and must still go through.
    out = upsert_entry_text(bib, "t", "book", {"title": r"Literal \{ brace"})
    assert r"Literal \{ brace" in out
    assert _raw(out, "keep") == _raw(bib, "keep")


def test_duplicate_citekeys_update_the_block_readers_actually_see():
    # `read_master_bib` is last-wins, so updating the FIRST duplicate would
    # write somewhere no reader looks and never converge.
    bib = (
        "@book{dup,\n  title = {First},\n  year = {1990}\n}\n\n"
        "@book{dup,\n  title = {Second},\n  year = {1991}\n}\n"
    )
    out = upsert_entry_text(bib, "dup", "book",
                            {"title": "AUTHORITATIVE", "year": "2001"})
    effective = {e["citekey"]: e["fields"]["title"] for e in parse_bib_text(out)}
    assert effective["dup"] == "AUTHORITATIVE"
    assert upsert_entry_text(out, "dup", "book",
                             {"title": "AUTHORITATIVE", "year": "2001"}) == out


def test_bom_prefixed_file_replaces_in_place_instead_of_duplicating():
    bib = "﻿@article{alpha,\n  title = {A}\n}\n\n@book{beta,\n  title = {B}\n}\n"
    out = upsert_entry_text(bib, "alpha", "article", {"title": "NEW"})
    assert out.startswith("﻿")
    assert out.count("@article{alpha,") == 1
    assert "NEW" in out
    assert _raw(out, "beta") == _raw(bib, "beta")


def test_crlf_file_keeps_crlf_line_endings():
    bib = (
        "@article{jones1998,\r\n  title = {J}\r\n}\r\n\r\n"
        "@book{smith2001,\r\n  title = {Old}\r\n}\r\n"
    )
    out = upsert_entry_text(bib, "smith2001", "book", {"title": "New"})
    assert "\n" not in out.replace("\r\n", "")
    assert _raw(out, "jones1998") == _raw(bib, "jones1998")


def test_no_field_entry_round_trips():
    # The comma-less `@misc{key\n}` form the emitter used to produce was
    # invisible to the parser, so an upsert appended a duplicate instead of
    # replacing it.
    seed = upsert_entry_text("", "solo", "misc", {})
    assert [e["citekey"] for e in parse_bib_text(seed)] == ["solo"]
    out = upsert_entry_text(seed, "solo", "misc", {"title": "Now titled"})
    assert [e["citekey"] for e in parse_bib_text(out)] == ["solo"]


def test_append_onto_a_file_ending_in_blank_lines_adds_one_separator():
    out = upsert_entry_text("@book{a,\n  title = {A}\n}\n\n\n", "b", "book",
                            {"title": "B"})
    assert "\n\n\n" not in out
    assert [e["citekey"] for e in parse_bib_text(out)] == ["a", "b"]


def test_nfd_citekey_on_disk_is_matched_and_rewritten_nfc():
    # A .bib on disk may hold either normalization (1976-Tichý memo). Looking
    # up only NFC would append a SECOND entry for the same work.
    nfd = unicodedata.normalize("NFD", "1976-Tichý")
    nfc = unicodedata.normalize("NFC", "1976-Tichý")
    bib = (
        f"@article{{{nfd},\n  title = {{Old}},\n}}\n\n"
        "@book{other,\n  title = {Other},\n}\n"
    )
    out = upsert_entry_text(bib, nfc, "article", {"title": "New"})
    keys = [e["citekey"] for e in parse_bib_text(out)]
    assert len(keys) == 2, keys
    assert keys[0] == nfc
    assert _raw(out, "other") == _raw(bib, "other")


# ── The writer that carries the contract ──────────────────────────────


def test_write_paper_bib_entry_preserves_a_deep_indexed_bibliography(tmp_path):
    """The end-to-end shape of the bug: authenticate-bib on a deep-indexed
    paper used to collapse its cited works to one entry."""
    from _tools import write_paper_bib_entry

    paper_dir = tmp_path / "papers" / "smith2001"
    paper_dir.mkdir(parents=True)
    refs = paper_dir / "references.bib"
    refs.write_text(THREE_ENTRY)

    write_paper_bib_entry(
        paper_dir, "smith2001", "book",
        {"title": "The Authenticated Title", "author": "Smith, Sam",
         "year": "2001", "doi": "10.1000/smith"},
    )

    after = refs.read_text()
    assert [e["citekey"] for e in parse_bib_text(after)] == [
        "jones1998", "smith2001", "brown2010",
    ]
    assert _raw(after, "jones1998") == _raw(THREE_ENTRY, "jones1998")
    assert _raw(after, "brown2010") == _raw(THREE_ENTRY, "brown2010")


def test_resync_references_bib_upserts_from_master(tmp_path):
    """`_resync_references_bib` — the helper both bib skills call — is now an
    upsert. Same fixture, driven through the real master.bib read path."""
    from index_paper import _resync_references_bib

    library = tmp_path
    (library / "master.bib").write_text(
        "% bib.state = authenticated\n"
        "@book{smith2001,\n"
        "  title = {The Authenticated Title},\n"
        "  author = {Smith, Sam},\n"
        "  year = {2001},\n"
        "  doi = {10.1000/smith}\n"
        "}\n"
    )
    paper_dir = library / "papers" / "smith2001"
    paper_dir.mkdir(parents=True)
    (paper_dir / "references.bib").write_text(THREE_ENTRY)

    assert _resync_references_bib(library, "smith2001") is True

    after = (paper_dir / "references.bib").read_text()
    assert [e["citekey"] for e in parse_bib_text(after)] == [
        "jones1998", "smith2001", "brown2010",
    ]
    assert _raw(after, "jones1998") == _raw(THREE_ENTRY, "jones1998")
    assert _raw(after, "brown2010") == _raw(THREE_ENTRY, "brown2010")
    smith = next(e for e in parse_bib_text(after) if e["citekey"] == "smith2001")
    assert smith["fields"]["doi"] == "10.1000/smith"
    # The master.bib `% bib.state` comment is master-side bookkeeping; it does
    # not leak into the paper's bibliography.
    assert "bib.state" not in after


def test_resync_still_creates_the_single_entry_mirror_for_a_fresh_paper(tmp_path):
    """Fresh-indexed papers (no references.bib yet) behave exactly as before —
    the merge semantics are a strict superset."""
    from index_paper import _resync_references_bib

    library = tmp_path
    (library / "master.bib").write_text(
        "@article{fresh2024,\n  title = {Fresh},\n  year = {2024}\n}\n"
    )
    (library / "papers" / "fresh2024").mkdir(parents=True)

    assert _resync_references_bib(library, "fresh2024") is True
    assert (library / "papers" / "fresh2024" / "references.bib").read_text() == (
        "@article{fresh2024,\n  title = {Fresh},\n  year = {2024}\n}\n"
    )


def test_write_paper_bib_entry_creates_folder_and_file_when_absent(tmp_path):
    """The triage `.bib`-drop path: a bib-only paper folder that doesn't exist
    yet is created, and the file is the plain single-entry mirror."""
    from _tools import write_paper_bib_entry

    paper_dir = tmp_path / "papers" / "dropped2015"
    write_paper_bib_entry(paper_dir, "dropped2015", "misc",
                          {"title": "Dropped", "year": "2015"})
    assert (paper_dir / "references.bib").read_text() == (
        "@misc{dropped2015,\n  title = {Dropped},\n  year = {2015}\n}\n"
    )


# Statements that WRITE a whole file. A `references.bib` write is only allowed
# when it is derived from the file's existing text (append / in-place rewrite);
# a write of a freshly EMITTED entry is the truncation bug.
_WRITE_CALL_RE = r"(?:\.write_text\(|open\([^)]*[\"']w[\"'][^)]*\)\.write\()"
_EMIT_RE = r"(?:\w+\.)?emit_bib_entry\(|f[\"']@\{"


def test_no_library_script_re_emits_a_whole_references_bib():
    """Grep-guard against reintroducing the truncation.

    Matches the WRITE and the EMIT independently and pairs them by proximity,
    so it also catches the two-line form (`refs = dir / "references.bib"` then
    `refs.write_text(emit_bib_entry(...))`) — which is exactly the shape
    `write_paper_bib_entry` itself uses and therefore the likeliest
    copy-paste reintroduction. `_tools.write_paper_bib_entry` is the one
    sanctioned site (it upserts); append-only and in-place-rewrite writers
    (populate_references_bib_from_itemize, synthesize_canonical_entries,
    fuzzy_citekey_disambiguate, repair_etal_citekeys) never emit, so they
    don't match."""
    import re

    offenders = []
    for py in sorted(Path(_SCRIPTS).glob("*.py")):
        if py.name.startswith("test_"):
            continue
        lines = py.read_text().splitlines()
        for i, line in enumerate(lines):
            if not re.search(_WRITE_CALL_RE, line):
                continue
            # The emitted content may sit on this line or the next couple.
            window = "\n".join(lines[i:i + 3])
            if not re.search(_EMIT_RE, window):
                continue
            # Does this write target references.bib? Look back a few lines for
            # the filename (covers both the inline and the `refs = …` forms).
            context = "\n".join(lines[max(0, i - 3):i + 3])
            if "references.bib" not in context:
                continue
            if py.name == "_tools.py":
                continue  # the sanctioned upsert writer
            offenders.append(f"{py.name}:{i + 1}: {line.strip()}")
    assert offenders == [], (
        "references.bib re-emit found — route it through "
        "_tools.write_paper_bib_entry:\n  " + "\n  ".join(offenders)
    )


def test_the_re_emit_guard_actually_catches_the_shapes_it_claims_to():
    """A grep-guard that matches nothing is worse than none — pin the shapes."""
    import re

    should_catch = [
        '(paper_dir / "references.bib").write_text(emit_bib_entry(ck, t, f))',
        'refs = paper_dir / "references.bib"\nrefs.write_text(emit_bib_entry(ck, t, f))',
        '(paper_dir / "references.bib").write_text(_tools.emit_bib_entry(ck, t, f))',
        '(paper_dir / "references.bib").write_text(\n    emit_bib_entry(ck, t, f)\n)',
        'open(paper_dir / "references.bib", "w").write(emit_bib_entry(ck, t, f))',
        'p = d / "references.bib"\np.write_text(f"@{t}{{{ck},\\n}}\\n")',
    ]
    for snippet in should_catch:
        lines = snippet.splitlines()
        hit = False
        for i, line in enumerate(lines):
            if not re.search(_WRITE_CALL_RE, line):
                continue
            if not re.search(_EMIT_RE, "\n".join(lines[i:i + 3])):
                continue
            if "references.bib" not in "\n".join(lines[max(0, i - 3):i + 3]):
                continue
            hit = True
        assert hit, f"guard missed a reintroduction shape:\n{snippet}"

    should_not_catch = [
        # Append-only: content derived from the existing file.
        'bib_path.write_text(bib_existing + addition, encoding="utf-8")',
        # In-place citekey rewrite of references.bib.
        'refs = d / "references.bib"\nrefs.write_text(new_txt, encoding="utf-8")',
        # master.bib, not a paper bib.
        '_atomic_write_text(master_path, text)',
    ]
    for snippet in should_not_catch:
        lines = snippet.splitlines()
        for i, line in enumerate(lines):
            if not re.search(_WRITE_CALL_RE, line):
                continue
            assert not re.search(_EMIT_RE, "\n".join(lines[i:i + 3])), (
                f"guard false-positives on a legitimate writer:\n{snippet}"
            )


def test_resync_returns_false_when_paper_dir_or_master_row_missing(tmp_path):
    from index_paper import _resync_references_bib

    library = tmp_path
    (library / "master.bib").write_text(
        "@article{known,\n  title = {K}\n}\n"
    )
    assert _resync_references_bib(library, "known") is False  # no paper dir
    (library / "papers" / "unknown").mkdir(parents=True)
    assert _resync_references_bib(library, "unknown") is False  # no master row
    assert not (library / "papers" / "unknown" / "references.bib").exists()


def _run_standalone() -> int:
    """Run the suite without pytest (it isn't installed everywhere).

    Supplies the one fixture these tests use (`tmp_path`) from `tempfile`, so
    `python3 library/scripts/tests/test_references_bib_upsert.py` is a real
    verification and not a skip.
    """
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
