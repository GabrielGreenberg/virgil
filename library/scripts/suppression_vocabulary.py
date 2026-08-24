"""Which `<category>-false-positive:` suppressions a reader can actually match.

The `<category>-false-positive:` convention has ONE write door
(`add_validator_suppression.py`) and exactly TWO consumers:

- `pgmark_validate._baseline_kinds_from_catalog` — reads categories under the
  `pgmark-` prefix, strips that prefix, and matches the remainder against the
  BARE continuity kinds (`pgmark_validate.CONTINUITY_FINDING_KINDS`).
- `audit_deepindex._catalog_suppression_categories` — reads every category
  VERBATIM and matches it against the audit's own finding categories
  (`audit_deepindex.AUDIT_FINDING_CATEGORIES`).

Anything else an operator types is stored correctly, survives every recompute,
and silences nothing. That is not hypothetical drift — measured on 2026-08-21,
FOUR shapes of it were writable and three of them were documented:

  a fusion-family head         → the baseline reader strips only `pgmark-`, so
  (`FUSION_WARNING_PREFIX` +     a gap found by a fusion resolves to the kind
   a continuity kind)            `fusion-gap`, which matches no kind
  hyphenation-artifact         → the audit emits `hyphenation-artifacts`
  title-thanks                 → the audit emits `title-metadata`
  pgmark-scope                 → scope violations are blockers unconditionally
                                 (`ValidationReport.has_blockers`), so no
                                 baseline entry can ever silence one

`add_validator_suppression.py`'s own `--help` advertised two of those, and
`skills/di-validate.md`'s audit table advertised three. The failure direction
is LOUD rather than lossy — the finding keeps re-blocking the deep-index
convergence gate — but it is invisible at the one moment a human could act on
it, which is when they type the category.

So this module is the ONE place that answers "can any reader match this?" It
DERIVES its answer from the two emitters' own vocabularies and never re-lists
them, and `add_validator_suppression.py` refuses anything it rejects. The
inert form is unwritable rather than merely useless.

**No escape hatch, deliberately.** A `--force` that wrote the line anyway
would reproduce the exact defect this exists to close. The cost is that a
newly-added finding category is refused until it is declared at its
emitter — a loud failure with a named fix, guarded by the census in
`test_pgmark_suppression.py`, which fails first.

Task 413. Bug class: "a stored value that looks authoritative and is read by
nothing that can match it."
"""
from __future__ import annotations

import difflib
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_deepindex import AUDIT_FINDING_CATEGORIES  # noqa: E402
from fuse_alternate import (  # noqa: E402
    FUSION_WARNING_PREFIX,
    fusion_warning_heads,
)
from pgmark_validate import (  # noqa: E402
    CONTINUITY_FINDING_KINDS,
    PGMARK_WARNING_PREFIX,
    SCOPE_WARNING_HEAD,
)

#: The suffix `add_validator_suppression.py` appends. Spelled here only so a
#: category typed WITH it already can be recognized and redirected — writing
#: it verbatim yields `<k>-false-positive-false-positive:`, which is one more
#: member of the same inert family.
FALSE_POSITIVE_SUFFIX = "-false-positive"


def suppressible_categories() -> frozenset[str]:
    """Every category some reader can match, DERIVED from both emitters.

    The union of the two consumers' vocabularies, in the spelling an operator
    must type:

    - `pgmark-<kind>` for each continuity kind (the validator strips the
      prefix and compares against the bare kind), and
    - each audit finding category verbatim.

    Note the two families genuinely overlap under one prefix and that is not
    a mistake to tidy away: `pgmark-low-confidence-flood` is a VALIDATOR kind
    and `pgmark-low-confidence` is an AUDIT category. Both are consumable,
    by different readers, and a rule that reasoned about the `pgmark-` prefix
    alone would reject one of them.
    """
    return frozenset(
        {f"{PGMARK_WARNING_PREFIX}{k}" for k in CONTINUITY_FINDING_KINDS}
        | set(AUDIT_FINDING_CATEGORIES)
    )


@dataclass(frozen=True)
class SuppressionVerdict:
    """Whether a category may be written, and if not, what to write instead.

    `suggestion` is the load-bearing field: the `## Done when` for task 413
    requires the refusal to name the ACTUAL category derived from the input,
    not a generic instruction. It is `None` only where no substitute exists
    (a scope violation, or a fusion head with no bare counterpart).
    """

    ok: bool
    category: str
    reason: str = ""
    suggestion: str | None = None

    def message(self) -> str:
        """One human-readable line for the CLI's stderr."""
        if self.ok:
            return f"{self.category}: consumable"
        out = f"refused: `{self.category}` — {self.reason}"
        if self.suggestion is not None:
            out += f"\n  Suppress `{self.suggestion}` instead:"
            out += f"\n      add_validator_suppression.py <citekey> {self.suggestion} \"<why>\""
        return out


def _closest(category: str) -> str | None:
    matches = difflib.get_close_matches(
        category, sorted(suppressible_categories()), n=1, cutoff=0.6,
    )
    return matches[0] if matches else None


def classify_suppression_category(category: str) -> SuppressionVerdict:
    """Can any reader match a `<category>-false-positive:` line?

    Rungs, in order — each earlier one is a shape whose right answer is more
    specific than "unknown category, did you mean …?".
    """
    category = (category or "").strip()
    if not category:
        return SuppressionVerdict(
            ok=False, category=category,
            reason="empty category; nothing to suppress",
        )

    if category in suppressible_categories():
        return SuppressionVerdict(ok=True, category=category)

    # The operator typed the stored SPELLING rather than the category. Writing
    # it verbatim yields `<k>-false-positive-false-positive:`.
    if category.endswith(FALSE_POSITIVE_SUFFIX):
        stem = category[: -len(FALSE_POSITIVE_SUFFIX)]
        stem_verdict = classify_suppression_category(stem)
        return SuppressionVerdict(
            ok=False, category=category,
            reason=(
                f"the `{FALSE_POSITIVE_SUFFIX}` suffix is added by this script; "
                f"pass the category alone"
            ),
            suggestion=stem if stem_verdict.ok else stem_verdict.suggestion,
        )

    # The fusion family (`FUSION_WARNING_PREFIX`, the SSOT in
    # `fuse_alternate.py` — never re-spelled here, per task 373's census).
    # It writes its findings under that prefix over the SAME continuity
    # vocabulary the validator uses, but the validator's baseline reader
    # strips only `pgmark-` — so such a suppression resolves to a bogus
    # `fusion-<kind>` and matches nothing.
    # The fact an operator is recording ("this gap is a journal offset") is a
    # fact about the PAPER, not about which pass found it, so the bare
    # `pgmark-<kind>` form is the one that carries it.
    if category.startswith(FUSION_WARNING_PREFIX):
        tail = category[len(FUSION_WARNING_PREFIX):]
        if tail in set(CONTINUITY_FINDING_KINDS):
            return SuppressionVerdict(
                ok=False, category=category,
                reason=(
                    f"the `{FUSION_WARNING_PREFIX}` family shares ONE "
                    f"continuity vocabulary with `{PGMARK_WARNING_PREFIX}`, "
                    f"and the validator's baseline reader strips only "
                    f"`{PGMARK_WARNING_PREFIX}` — so this stores fine and "
                    f"silences nothing"
                ),
                suggestion=f"{PGMARK_WARNING_PREFIX}{tail}",
            )
        if category in set(fusion_warning_heads()):
            return SuppressionVerdict(
                ok=False, category=category,
                reason=(
                    "a fusion-status head has no baseline semantics — no "
                    "reader consumes a suppression for it. Re-run the fusion, "
                    "or drop the line with "
                    "`update_catalog_entry.py --recompute-warning-kind`"
                ),
            )
        return SuppressionVerdict(
            ok=False, category=category,
            reason=f"not a head the `{FUSION_WARNING_PREFIX}` family emits",
            suggestion=_closest(category),
        )

    # Scope violations are blockers unconditionally (`has_blockers` returns
    # True on any scope violation before it ever looks at the baseline), so a
    # suppression cannot reach them by design.
    if category == SCOPE_WARNING_HEAD:
        return SuppressionVerdict(
            ok=False, category=category,
            reason=(
                "a scope violation is always a blocker — the baseline is "
                "consulted only for continuity findings. Move the `\\pgmark` "
                "out of the offending argument instead"
            ),
        )

    return SuppressionVerdict(
        ok=False, category=category,
        reason="no validator or audit reader matches this category",
        suggestion=_closest(category),
    )


def vocabulary_help() -> str:
    """The valid categories, for the write door's `--help`.

    Derived rather than hand-listed: the pre-413 help text advertised
    `hyphenation-artifact` and `title-thanks`, neither of which any reader has
    ever emitted.
    """
    by_reader = categories_by_reader()
    pg = by_reader["validator"]
    audit = by_reader["audit"]
    return (
        "Validator/audit category being suppressed. The `-false-positive:` "
        "suffix is added. A category no reader can match is REFUSED (it would "
        "store fine and silence nothing). "
        "Validator (pgmark continuity): " + ", ".join(pg) + ". "
        "Audit: " + ", ".join(audit) + "."
    )


def categories_by_reader() -> dict[str, list[str]]:
    """The consumable set SPLIT by which reader consumes it.

    The union `suppressible_categories()` returns is what a WRITE door needs
    ("may this be written?"). A reader that documents the vocabulary — the
    `di-validate.md` tables — needs the split, because the two families are
    typed differently by the operator and the prefix cannot tell them apart:
    `pgmark-low-confidence-flood` is a VALIDATOR kind and
    `pgmark-low-confidence` is an AUDIT category. So the split is published
    here rather than re-derived by each consumer.
    """
    return {
        "validator": sorted(
            f"{PGMARK_WARNING_PREFIX}{k}" for k in CONTINUITY_FINDING_KINDS
        ),
        "audit": sorted(AUDIT_FINDING_CATEGORIES),
    }


def main() -> int:
    """`python3 suppression_vocabulary.py [--json] [category …]` — list or classify."""
    args = sys.argv[1:]
    if args and args[0] == "--json":
        import json

        by_reader = categories_by_reader()
        print(json.dumps({
            **by_reader,
            "all": sorted(suppressible_categories()),
        }, indent=2))
        return 0
    if not args:
        for c in sorted(suppressible_categories()):
            print(c)
        return 0
    rc = 0
    for c in args:
        v = classify_suppression_category(c)
        print(v.message())
        if not v.ok:
            rc = 2
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
