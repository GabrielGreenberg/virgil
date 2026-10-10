"""Regression guard for task 1040 — a type change's field retirement is ONE rule.

The retirement a Crossref type verdict implies lived in `index_paper.py`
(in-process) and as a prose table in `authenticate-bib.md` that claimed to
match it — and did not: the prose had `article → inproceedings`, the script
did not, so the index path wrote an `@inproceedings` still carrying `journal`
(the shape `validate_bib_coherence.py` flags, which re-triggers
re-authentication). `merge_paper_references.py` applied a proposed type with
no retirement at all. Now `_bib_types` owns it, derived from the coherence
table, and every path reads it.

Run: python3 library/scripts/tests/test_bib_type_retirement.py
"""
import ast
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import _bib_types as bt  # noqa: E402
from validate_bib_coherence import check_cross_field_coherence  # noqa: E402

# Every bib type the coherence table knows, plus the common extras, crossed
# with every Crossref work type the mapper could plausibly see.
_BIB_TYPES = sorted(set(bt.DISALLOWED_FIELDS) | {"misc", "online", "proceedings"})
_CR_TYPES = [
    "journal-article", "book-chapter", "proceedings-article", "posted-content",
    "book", "monograph", "dissertation", "report", "edited-book", "other", "",
]

# A deliberately over-full entry: every field any type disallows, all set.
_ALL_FIELDS = sorted(set().union(*bt.DISALLOWED_FIELDS.values()))


def _full_entry() -> dict:
    return {f: f"<{f}>" for f in _ALL_FIELDS} | {"title": "T", "author": "A", "year": "2001"}


def test_mapper_emits_only_proposable_types():
    emitted = {
        bt.propose_type(b, c) for b in _BIB_TYPES for c in _CR_TYPES
    } - {""}
    assert emitted == set(bt.PROPOSABLE_TYPES), (
        f"propose_type emits {sorted(emitted)}, PROPOSABLE_TYPES declares "
        f"{sorted(bt.PROPOSABLE_TYPES)} — keep them in step"
    )


def test_every_proposable_type_has_a_retirement_row():
    missing = sorted(t for t in bt.PROPOSABLE_TYPES if t not in bt.TYPE_CHANGES)
    assert not missing, (
        f"no TYPE_CHANGES row for {missing}: state the retirement (an empty "
        "TypeChange() if nothing beyond the derived drops)"
    )


def test_every_mapped_change_lands_coherent():
    """The headline contract: whatever the old type and whatever fields it
    carried, the retired entry passes the coherence check for its new type."""
    for b in _BIB_TYPES:
        for c in _CR_TYPES:
            new = bt.propose_type(b, c)
            if not new:
                continue
            out = bt.apply_type_retirement(b, new, _full_entry())
            problems = check_cross_field_coherence(new, out)
            assert not problems, f"{b} → {new} (Crossref {c!r}): {problems}"


def test_article_to_inproceedings_carries_journal_to_booktitle():
    out = bt.apply_type_retirement(
        "article", "inproceedings",
        {"title": "T", "journal": "Proc. NeurIPS", "pages": "1--9"},
    )
    assert out == {"title": "T", "booktitle": "Proc. NeurIPS", "pages": "1--9"}, out


def test_article_to_incollection_keeps_an_existing_booktitle():
    out = bt.apply_type_retirement(
        "article", "incollection",
        {"journal": "J", "booktitle": "The Real Book"},
    )
    assert out == {"booktitle": "The Real Book"}, out


def test_unpublished_drops_venue_and_pagination():
    out = bt.apply_type_retirement("article", "unpublished", _full_entry())
    for f in ("journal", "booktitle", "volume", "number", "pages", "publisher"):
        assert f not in out, (f, out)
    assert out["title"] == "T"


def test_no_type_change_is_a_no_op():
    entry = _full_entry()
    assert bt.retirement_ops("article", "article") == ([], [])
    assert bt.retirement_ops("article", "") == ([], [])
    assert bt.apply_type_retirement("article", "", entry) == entry


def test_auth_result_states_the_retirement():
    """The skill reads `proposed_copies` / `proposed_drop_fields` from the
    helper's JSON (`asdict(AuthResult)`) instead of restating a table."""
    import bib_auth

    fields = bib_auth._retirement_fields("article", "inproceedings")
    copies, drops = bt.retirement_ops("article", "inproceedings")
    assert fields == {"proposed_copies": copies, "proposed_drop_fields": drops}
    assert {"from": "journal", "to": "booktitle"} in copies and "journal" in drops
    r = bib_auth.AuthResult(state="authenticated", proposed_type="inproceedings", **fields)
    from dataclasses import asdict
    d = asdict(r)
    assert d["proposed_drop_fields"] == drops and d["proposed_copies"] == copies
    assert bib_auth._propose_type is bt.propose_type


def test_merge_path_lands_the_retired_entry():
    import merge_paper_references as mpr

    class R:
        proposed_type = "inproceedings"
        field_changes = [{"field": "doi", "to": "10.1/x"}]

    new_type, fields = mpr.landed_entry(
        "article", {"title": "T", "journal": "Proc. X"}, R())
    assert new_type == "inproceedings"
    assert fields == {"title": "T", "booktitle": "Proc. X", "doi": "10.1/x"}, fields


def test_index_path_has_no_private_retirement():
    """`index_paper.py` calls the shared rule and spells no type-specific
    field pops of its own (the fork this task closed). Read as source: the
    module imports marker/pymupdf and is not cheap to import."""
    src = (_SCRIPTS / "index_paper.py").read_text(encoding="utf-8")
    assert "apply_type_retirement(" in src
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and any(
            isinstance(c, ast.Constant) and c.value in bt.PROPOSABLE_TYPES
            for c in node.comparators
        ):
            raise AssertionError(
                f"index_paper.py:{node.lineno} compares against a proposable "
                "type — type-change retirement belongs to _bib_types"
            )


def test_skill_prose_restates_no_retirement_table():
    md = (_SCRIPTS.parent / "skills" / "authenticate-bib.md").read_text(encoding="utf-8")
    assert 'proposed_drop_fields' in md and 'proposed_copies' in md
    assert "--drop-field journal" not in md, (
        "authenticate-bib.md spells a retirement by hand again — read the "
        "helper's proposed_drop_fields instead"
    )


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
