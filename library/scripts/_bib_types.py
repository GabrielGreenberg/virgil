"""The bib entry-TYPE vocabulary, stated once (task 1040).

Three questions about a BibTeX entry type used to be answered in three places
that could drift — and did:

  1. **Which fields does a type forbid?** (`DISALLOWED_FIELDS` — the coherence
     vocabulary `validate_bib_coherence.py` checks against.)
  2. **When Crossref disagrees with the bib's type, what type do we propose?**
     (`propose_type` — the mapper `bib_auth.py` runs on a DOI-verified match.)
  3. **When a type change lands, which fields does it retire?**
     (`retirement_ops` / `apply_type_retirement`.)

Question 3 lived twice: in-process in `index_paper.py` and as a prose table in
`authenticate-bib.md` that claimed to "match" it. The prose table had an
`article → inproceedings` row the script never implemented, so the same
Crossref verdict wrote two different master.bib entries depending on the entry
point — and the index path's `@inproceedings` still carried `journal`, the
exact shape the coherence check flags, which routed deep-index back into a
re-authentication. `merge_paper_references.py` applied a proposed type with no
retirement at all.

Now the retirement is DERIVED: a type change drops every field the NEW type
disallows (question 1's table), plus a small explicit list of extra drops, after
first carrying a value across where the new type has a home for it (journal →
booktitle). A row cannot forget a field the coherence check would flag,
because it never lists those fields by hand. Every caller — the index path,
the merge path, and the skill (through `AuthResult.proposed_copies` /
`proposed_drop_fields` in the helper's JSON) — reads this module.

Stdlib-only on purpose: `merge_paper_references.py --dry-run` and
`validate_bib_coherence.py` must import it without pulling in `bib_auth`'s
network stack.
"""
from __future__ import annotations

from dataclasses import dataclass


# Fields that are incoherent on an entry of each type. Fields outside this set
# are fine (many bibs carry legitimate extras like `month`, `note`, `keywords`).
DISALLOWED_FIELDS: dict[str, set[str]] = {
    "phdthesis": {"journal", "publisher", "pages", "volume", "number", "booktitle"},
    "mastersthesis": {"journal", "publisher", "pages", "volume", "number", "booktitle"},
    "article": {"school", "booktitle"},
    "book": {"journal", "volume", "number", "booktitle"},
    "inbook": {"journal", "volume", "number"},
    "incollection": {"journal", "school"},
    "inproceedings": {"journal", "school"},
    "manual": {"journal", "school", "booktitle"},
    "techreport": {"journal", "booktitle"},
    "unpublished": {"journal", "publisher", "booktitle", "volume"},
}


def propose_type(entry_type: str, cr_type: str) -> str:
    """If a Crossref-verified type disagrees with the input bib type, return
    the proposed bib type. Returns '' when no conversion applies."""
    if not entry_type or not cr_type:
        return ""
    cr_type = cr_type.lower()
    if cr_type == "posted-content" and entry_type != "unpublished":
        return "unpublished"
    if entry_type == "article" and cr_type == "book-chapter":
        return "incollection"
    if entry_type == "article" and cr_type == "proceedings-article":
        return "inproceedings"
    return ""


# Every type `propose_type` can return. The exhaustiveness test pins that each
# one has a row in `TYPE_CHANGES` (and that `propose_type` returns nothing
# else), so a new mapping cannot land without stating its retirement.
PROPOSABLE_TYPES: frozenset[str] = frozenset({"unpublished", "incollection", "inproceedings"})


@dataclass(frozen=True)
class TypeChange:
    """What landing an entry under `new_type` does to its fields, beyond
    dropping what `new_type` disallows (which is always derived)."""

    # (src, dst): when `src` is set and `dst` is not, carry `src`'s value to
    # `dst` before the drops run (journal → booktitle: the container survives).
    copies: tuple[tuple[str, str], ...] = ()
    # Fields to drop that `new_type` does not strictly disallow but that a
    # type change into it should still retire (an @unpublished keeps no
    # pagination of the venue it no longer claims).
    extra_drops: tuple[str, ...] = ()


# Keyed by the NEW type — every current row applies whatever the old type was.
# A row is required for every proposable type, even an empty `TypeChange()`
# ("nothing beyond the derived drops"), so the absence of a rule is a decision.
TYPE_CHANGES: dict[str, TypeChange] = {
    "incollection": TypeChange(copies=(("journal", "booktitle"),)),
    "inproceedings": TypeChange(copies=(("journal", "booktitle"),)),
    "unpublished": TypeChange(extra_drops=("number", "pages")),
}


def retirement_ops(old_type: str, new_type: str) -> tuple[list[dict], list[str]]:
    """The field operations a change `old_type → new_type` performs, as
    `(copies, drops)`: `copies` is `[{"from": src, "to": dst}, …]` (apply only
    when `src` is set and `dst` is absent), `drops` the sorted field names to
    remove AFTER the copies. No change of type → no ops."""
    if not new_type or new_type == old_type:
        return [], []
    change = TYPE_CHANGES.get(new_type, TypeChange())
    drops = set(DISALLOWED_FIELDS.get(new_type, set())) | set(change.extra_drops)
    copies = [{"from": s, "to": d} for s, d in change.copies]
    # A copy's destination is by construction a field the new type keeps.
    assert not any(c["to"] in drops for c in copies), (old_type, new_type)
    return copies, sorted(drops)


def apply_type_retirement(old_type: str, new_type: str, fields: dict) -> dict:
    """Return a copy of `fields` with the `old_type → new_type` retirement
    applied (copies first, then drops). The one in-process implementation —
    `index_paper.py` and `merge_paper_references.py` both call it."""
    copies, drops = retirement_ops(old_type, new_type)
    out = dict(fields)
    for c in copies:
        if str(out.get(c["from"], "")).strip() and not str(out.get(c["to"], "")).strip():
            out[c["to"]] = out[c["from"]]
    for f in drops:
        out.pop(f, None)
    return out
