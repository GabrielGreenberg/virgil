#!/usr/bin/env python3
"""Regression tests for the `<category>-false-positive:` suppression convention
shared by the pgmark validator and the deep-index audit (task 2026-07-18-162).

The bug: `add_validator_suppression.py` writes
`pgmark-<kind>-false-positive: <reason>` into a catalog entry's
`indexed.warnings[]` so a verified pgmark false positive stops gating the
deep-index convergence loop. But `pgmark_validate._baseline_kinds_from_catalog`
stripped only the `pgmark-` prefix and KEPT the `-false-positive` suffix, so the
bare finding kind (`gap`, `low-confidence-flood`, …) never matched the baseline
set and the finding re-reported as **new** every pass. Its sibling reader in
`audit_deepindex` stripped the suffix correctly — two readers of one convention,
only one right.

Fix: a single shared reader `_tools.suppression_categories_from_catalog`, called
by both. These tests pin the contract from `## Done when`:

  1. A `pgmark-gap-false-positive:` warning makes the `gap` continuity finding
     `new_vs_baseline=False` (pre-existing), so it no longer blocks.
  2. The plain `pgmark-<kind>:` baseline path (prior-pass warnings) still works.
  3. audit_deepindex still suppresses its own categories through the shared
     helper (`case-errors-false-positive:` → `case-errors`).
  4. The shared helper's two modes behave (prefix=None verbatim; prefix scopes
     and strips).
  5. CLI end-to-end: `pgmark_validate.py <tex> --baseline-from-catalog` prints
     the gap finding as `_pre-existing_`.

Run:  python3 test_pgmark_suppression.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import add_validator_suppression  # noqa: E402
import audit_deepindex  # noqa: E402
import pgmark_validate  # noqa: E402
import suppression_vocabulary  # noqa: E402
from _tools import suppression_categories_from_catalog  # noqa: E402


# A minimal body-scope tex whose two arabic pgmarks (1 → 5) form a single
# `gap` continuity finding and nothing else (no duplicate, no reset, n<5 so no
# low-confidence-flood, no PDF range check).
GAP_TEX = (
    "\\documentclass{article}\n"
    "\\begin{document}\n"
    "Opening paragraph \\pgmark{1} of the body.\n\n"
    "A later paragraph \\pgmark{5} further along.\n"
    "\\end{document}\n"
)


def _catalog(citekey: str, warnings: list[str]) -> dict:
    return {
        "version": 1,
        "entries": [
            {"citekey": citekey, "indexed": {"warnings": warnings}},
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
# 4. Shared helper — both modes.
# ─────────────────────────────────────────────────────────────────────────


def test_shared_helper_modes(c: Checks) -> None:
    print("== shared helper: suppression_categories_from_catalog ==")
    cat = _catalog("k", [
        "pgmark-gap-false-positive: verified journal offset",
        "pgmark-low-confidence-flood-false-positive: raster OCR tables",
        "case-errors-false-positive: arXiv brand names",
        # RENEGOTIATED (task 413). This spelling was previously absent, and
        # the exact-set assertion below therefore said nothing about it. It is
        # what `fuse_alternate` writes its findings under, so it is the
        # spelling an operator reads off a row and copies — and the reader
        # strips only `pgmark-`, yielding the bogus kind `fusion-gap`. The
        # reader is NOT changed (two namespaces stay distinguishable, task
        # 413's resolved decision); what changed is that the write door now
        # refuses to mint this line at all. Pinned here so the reader's half
        # of the asymmetry stays visible at the site.
        "pgmark-fusion-gap-false-positive: verified journal offset",
        "pgmark-gap: page 3 -> page 9 (skipped 5)",           # plain, not FP
        "not-a-suppression-warning without colon suffix",
        42,                                                    # non-str ignored
    ])
    pg = suppression_categories_from_catalog(cat, "k", prefix="pgmark-")
    c.check(pg == {"gap", "low-confidence-flood", "fusion-gap"},
            f"prefix='pgmark-' strips prefix AND `-false-positive` suffix (got {sorted(pg)})")
    c.check("fusion-gap" not in pgmark_validate.CONTINUITY_FINDING_KIND_SET,
            "the fusion spelling resolves to a kind NO finding can carry — "
            "which is why the write door refuses it (task 413)")

    verbatim = suppression_categories_from_catalog(cat, "k", prefix=None)
    c.check(verbatim == {"pgmark-gap", "pgmark-low-confidence-flood",
                         "case-errors", "pgmark-fusion-gap"},
            f"prefix=None returns each category verbatim (got {sorted(verbatim)})")

    c.check(suppression_categories_from_catalog(cat, "missing", prefix="pgmark-") == set(),
            "unknown citekey → empty set")


# ─────────────────────────────────────────────────────────────────────────
# 1. The core contract: a suppressed pgmark finding is pre-existing.
# ─────────────────────────────────────────────────────────────────────────


def test_false_positive_suppresses_gap(c: Checks, td: Path) -> None:
    print("== pgmark_validate: `-false-positive` suppression is honored ==")
    lib = td / "lib1"
    cat_path = lib / ".virgil" / "catalog.json"
    cat_path.parent.mkdir(parents=True, exist_ok=True)
    cat_path.write_text(json.dumps(
        _catalog("testpaper2020", ["pgmark-gap-false-positive: verified offset"])
    ))

    baseline = pgmark_validate._baseline_kinds_from_catalog(cat_path, "testpaper2020")
    c.check("gap" in baseline,
            f"baseline_kinds contains bare 'gap' (got {sorted(baseline)})")

    report = pgmark_validate.validate(GAP_TEX, baseline_kinds=baseline, pdf_pages=None)
    gaps = [f for f in report.continuity_findings if f.kind == "gap"]
    c.check(len(gaps) == 1, f"exactly one gap finding present (got {len(gaps)})")
    c.check(gaps and gaps[0].new_vs_baseline is False,
            "the gap finding is pre-existing (new_vs_baseline=False)")
    c.check(report.has_blockers is False,
            "suppressed-only report has NO blockers (would not gate the pass)")


# ─────────────────────────────────────────────────────────────────────────
# 2. The plain prior-pass baseline path still works.
# ─────────────────────────────────────────────────────────────────────────


def test_plain_baseline_path_unchanged(c: Checks, td: Path) -> None:
    print("== pgmark_validate: plain `pgmark-<kind>:` baseline still works ==")
    lib = td / "lib2"
    cat_path = lib / ".virgil" / "catalog.json"
    cat_path.parent.mkdir(parents=True, exist_ok=True)
    cat_path.write_text(json.dumps(
        _catalog("testpaper2020", ["pgmark-gap: page 1 -> page 5 (skipped 3)"])
    ))

    baseline = pgmark_validate._baseline_kinds_from_catalog(cat_path, "testpaper2020")
    c.check("gap" in baseline,
            f"plain warning yields bare 'gap' in baseline (got {sorted(baseline)})")

    report = pgmark_validate.validate(GAP_TEX, baseline_kinds=baseline, pdf_pages=None)
    gaps = [f for f in report.continuity_findings if f.kind == "gap"]
    c.check(gaps and gaps[0].new_vs_baseline is False,
            "plain baseline still marks the gap finding pre-existing")

    # And with NO baseline the same finding is genuinely new (guards against a
    # helper that suppresses everything).
    fresh = pgmark_validate.validate(GAP_TEX, baseline_kinds=set(), pdf_pages=None)
    fresh_gaps = [f for f in fresh.continuity_findings if f.kind == "gap"]
    c.check(fresh_gaps and fresh_gaps[0].new_vs_baseline is True,
            "empty baseline → gap finding is new (blocks)")


# ─────────────────────────────────────────────────────────────────────────
# 3. audit_deepindex sibling still suppresses its own categories.
# ─────────────────────────────────────────────────────────────────────────


def test_audit_deepindex_suppression_unchanged(c: Checks, td: Path) -> None:
    print("== audit_deepindex: category suppression via shared helper ==")
    lib = td / "lib3"
    (lib / ".virgil").mkdir(parents=True, exist_ok=True)
    (lib / ".virgil" / "catalog.json").write_text(json.dumps(_catalog(
        "testpaper2020",
        [
            "case-errors-false-positive: arXiv references; brand allowlist",
            "pgmark-low-confidence-flood-false-positive: raster OCR tables",
        ],
    )))
    cats = audit_deepindex._catalog_suppression_categories(lib, "testpaper2020")
    c.check("case-errors" in cats,
            f"audit category 'case-errors' suppressed (got {sorted(cats)})")
    c.check("pgmark-low-confidence-flood" in cats,
            "pgmark category is returned verbatim (prefix kept) for audit reader")


# ─────────────────────────────────────────────────────────────────────────
# 5. CLI end-to-end.
# ─────────────────────────────────────────────────────────────────────────


def test_cli_end_to_end(c: Checks, td: Path) -> None:
    print("== CLI: --baseline-from-catalog prints gap as _pre-existing_ ==")
    lib = td / "libcli"
    paper = lib / "papers" / "testpaper2020"
    paper.mkdir(parents=True, exist_ok=True)
    (paper / "main.tex").write_text(GAP_TEX)
    (lib / ".virgil").mkdir(parents=True, exist_ok=True)
    (lib / ".virgil" / "catalog.json").write_text(json.dumps(
        _catalog("testpaper2020", ["pgmark-gap-false-positive: verified offset"])
    ))

    r = subprocess.run(
        [sys.executable, str(HERE / "pgmark_validate.py"),
         str(paper / "main.tex"), "--baseline-from-catalog",
         "--no-pdf-check", "--json"],
        capture_output=True, text=True,
    )
    c.check(r.returncode == 0,
            f"CLI exits 0 with suppression honored (rc={r.returncode}) {r.stderr[:200]}")
    try:
        payload = json.loads(r.stdout)
    except Exception as e:
        c.check(False, f"CLI emitted parseable JSON ({e}); stdout={r.stdout[:200]}")
        return
    gaps = [f for f in payload["continuity_findings"] if f["kind"] == "gap"]
    c.check(gaps and gaps[0]["new_vs_baseline"] is False,
            "CLI reports the gap finding as pre-existing (not new)")
    c.check(payload["has_blockers"] is False,
            "CLI report has no blockers → convergence loop is not re-gated")


# ─────────────────────────────────────────────────────────────────────────
# 6. The write door refuses a category no reader can match (task 413).
#
# DEFECT LEGS — every one of these WROTE a line on the pre-413 script, and
# every written line was inert. Measured by neutering the gate in
# `add_suppression`.
# ─────────────────────────────────────────────────────────────────────────


def _run_add(lib: Path, citekey: str, kind: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HERE / "add_validator_suppression.py"),
         citekey, kind, "verified by hand", "--library", str(lib)],
        capture_output=True, text=True,
    )


def _fresh_lib(td: Path, name: str, citekey: str = "testpaper2020") -> Path:
    lib = td / name
    (lib / ".virgil").mkdir(parents=True, exist_ok=True)
    (lib / ".virgil" / "catalog.json").write_text(json.dumps(_catalog(citekey, [])))
    return lib


def _stored(lib: Path, citekey: str = "testpaper2020") -> list:
    cat = json.loads((lib / ".virgil" / "catalog.json").read_text())
    for e in cat["entries"]:
        if e["citekey"] == citekey:
            return e["indexed"]["warnings"]
    return []


def test_write_door_refuses_inert_categories(c: Checks, td: Path) -> None:
    print("== write door: an unmatchable category is REFUSED, not written ==")

    # Every member of the class, with the spelling that shipped and the
    # reason it is inert. The third column is the category the refusal must
    # NAME — `## Done when` requires the actual derived category, never a
    # generic instruction. `None` = no substitute exists.
    cases = [
        # the reported member: fuse_alternate's own family spelling
        ("pgmark-fusion-gap", "pgmark-gap"),
        ("pgmark-fusion-low-confidence-flood", "pgmark-low-confidence-flood"),
        # advertised by this script's own pre-413 --help AND by di-validate.md
        ("hyphenation-artifact", "hyphenation-artifacts"),
        ("title-thanks", "title-metadata"),
        # a scope violation is a blocker unconditionally — nothing to suggest
        ("pgmark-scope", None),
        # a fusion STATUS head has no bare counterpart
        ("pgmark-fusion-failed", None),
        # the stored spelling rather than the category
        ("pgmark-gap-false-positive", "pgmark-gap"),
    ]
    for i, (kind, suggestion) in enumerate(cases):
        lib = _fresh_lib(td, f"libref{i}")
        r = _run_add(lib, "testpaper2020", kind)
        c.check(r.returncode == 2,
                f"`{kind}` refused with exit 2 (got {r.returncode})")
        c.check(_stored(lib) == [],
                f"`{kind}` wrote NOTHING to the catalog (got {_stored(lib)})")
        if suggestion is None:
            continue
        c.check(suggestion in r.stderr,
                f"`{kind}` refusal names `{suggestion}` (got {r.stderr.strip()[:160]!r})")

    # And the CONTROL: a consumable category still writes, or the fix is
    # "refuse everything" wearing a guard's clothes.
    for kind in ("pgmark-gap", "case-errors", "pgmark-low-confidence"):
        lib = _fresh_lib(td, f"libok-{kind}")
        r = _run_add(lib, "testpaper2020", kind)
        c.check(r.returncode == 0, f"`{kind}` still writes (rc={r.returncode})")
        c.check(_stored(lib) == [f"{kind}-false-positive: verified by hand"],
                f"`{kind}` stored verbatim (got {_stored(lib)})")

    # An already-stored inert suppression is LEFT ALONE — the rejection is
    # write-side only (`## Done when`), so no operator's catalog is rewritten.
    lib = _fresh_lib(td, "liblegacy")
    (lib / ".virgil" / "catalog.json").write_text(json.dumps(_catalog(
        "testpaper2020", ["pgmark-fusion-gap-false-positive: verified offset"])))
    r = _run_add(lib, "testpaper2020", "pgmark-gap")
    c.check(r.returncode == 0, "a row carrying a legacy inert line still accepts a write")
    c.check("pgmark-fusion-gap-false-positive: verified offset" in _stored(lib),
            f"the legacy inert line survives untouched (got {_stored(lib)})")


def test_write_door_gate_is_on_the_api_not_the_cli(c: Checks, td: Path) -> None:
    print("== write door: the gate is inside add_suppression(), not main() ==")
    # `add_suppression` is what other scripts import. A gate that lived only
    # in `main()` would leave every programmatic caller writing inert lines.
    lib = _fresh_lib(td, "libapi")
    res = add_validator_suppression.add_suppression(
        lib, "testpaper2020", "pgmark-fusion-gap", "verified offset")
    c.check(res["status"] == "refused",
            f"the imported API refuses too (got {res['status']!r})")
    c.check(_stored(lib) == [], f"nothing written (got {_stored(lib)})")


# ─────────────────────────────────────────────────────────────────────────
# 7. The vocabularies are CHECKED against their emitters (task 413).
#
# The leg with teeth. The classifier was never the part that could
# misbehave — a vocabulary that drifts from what its emitter emits is, and
# a stale entry there turns this fix into a REFUSAL of a legitimate
# suppression. Both directions, per emitter.
# ─────────────────────────────────────────────────────────────────────────


def test_audit_categories_match_the_emit_sites(c: Checks) -> None:
    print("== census: AUDIT_FINDING_CATEGORIES == the audit's own literals ==")
    src = (HERE / "audit_deepindex.py").read_text()
    emitted = set(re.findall(
        r'findings\.append\(\(\s*\n?\s*"([a-z][a-z0-9.-]*)"', src))
    emitted |= set(re.findall(
        r'"findings":\s*\[\(\s*"([a-z][a-z0-9.-]*)"', src))
    c.check(bool(emitted), "census matched no category literals at all")
    declared = set(audit_deepindex.AUDIT_FINDING_CATEGORIES)
    c.check(
        emitted == declared,
        f"emitted != AUDIT_FINDING_CATEGORIES; "
        f"undeclared={sorted(emitted - declared)} "
        f"declared-but-unemitted={sorted(declared - emitted)}",
    )
    c.check(len(audit_deepindex.AUDIT_FINDING_CATEGORIES) == len(declared),
            "AUDIT_FINDING_CATEGORIES has duplicate members")

    # The vocabulary is HELD, not merely described — the sibling of
    # `ContinuityFinding.__post_init__`. Without a consumer the declaration
    # would itself be the dead-SSOT shape this task exists to close.
    try:
        audit_deepindex._assert_declared_categories(
            [("invisibles", "real"), ("brand-new-category", "undeclared")])
        c.check(False, "an undeclared audit category was accepted")
    except ValueError as e:
        c.check("brand-new-category" in str(e),
                f"the refusal names the undeclared category (got {e})")
    try:
        audit_deepindex._assert_declared_categories(
            [(cat, "d") for cat in audit_deepindex.AUDIT_FINDING_CATEGORIES])
        c.check(True, "every declared category passes the guard")
    except ValueError as e:
        c.check(False, f"the guard refuses its own vocabulary: {e}")


def test_suppressible_set_is_derived_not_listed(c: Checks) -> None:
    print("== census: the suppressible set is DERIVED from both emitters ==")
    expected = {
        f"{pgmark_validate.PGMARK_WARNING_PREFIX}{k}"
        for k in pgmark_validate.CONTINUITY_FINDING_KINDS
    } | set(audit_deepindex.AUDIT_FINDING_CATEGORIES)
    got = suppression_vocabulary.suppressible_categories()
    c.check(set(got) == expected,
            f"suppressible set != derived union: {sorted(set(got) ^ expected)}")
    # Every declared category must survive its own write door, or the
    # vocabulary and the gate disagree about one thing.
    bad = [c_ for c_ in sorted(expected)
           if not suppression_vocabulary.classify_suppression_category(c_).ok]
    c.check(not bad, f"declared categories the gate refuses: {bad}")
    # The overlap that a prefix-only rule would get wrong: an AUDIT category
    # under the `pgmark-` prefix is consumable verbatim.
    c.check(suppression_vocabulary.classify_suppression_category(
                "pgmark-low-confidence").ok,
            "the audit's `pgmark-low-confidence` stays consumable")


def test_help_text_advertises_only_consumable_categories(c: Checks) -> None:
    print("== census: --help advertises nothing inert ==")
    # The pre-413 help named `hyphenation-artifact` and `title-thanks`, both
    # unmatched by any reader — the same defect one level up. Derived now.
    help_text = suppression_vocabulary.vocabulary_help()
    for stale in ("hyphenation-artifact,", "title-thanks"):
        c.check(stale not in help_text,
                f"--help still advertises the inert `{stale}`")
    for good in ("pgmark-gap", "case-errors", "hyphenation-artifacts",
                 "title-metadata"):
        c.check(good in help_text, f"--help omits the consumable `{good}`")


def test_skill_doc_table_names_only_consumable_categories(c: Checks) -> None:
    print("== census: skills/di-validate.md names nothing inert ==")
    # The audit table there advertised three inert spellings. A doc is the
    # other place an operator reads the vocabulary off, so it is censused
    # like the --help is.
    doc = HERE.parent / "skills" / "di-validate.md"
    if not doc.exists():
        c.check(False, f"di-validate.md not found at {doc}")
        return
    text = doc.read_text()
    cited = set(re.findall(r"`([a-z][a-z0-9.-]*)-false-positive:", text))
    c.check(bool(cited), "no `<category>-false-positive:` spellings found in the doc")
    inert = sorted(
        cat for cat in cited
        if not suppression_vocabulary.classify_suppression_category(cat).ok
    )
    c.check(not inert, f"the doc advertises inert suppression categories: {inert}")


def main() -> int:
    c = Checks()
    test_shared_helper_modes(c)
    test_audit_categories_match_the_emit_sites(c)
    test_suppressible_set_is_derived_not_listed(c)
    test_help_text_advertises_only_consumable_categories(c)
    test_skill_doc_table_names_only_consumable_categories(c)
    with tempfile.TemporaryDirectory() as tds:
        td = Path(tds)
        test_false_positive_suppresses_gap(c, td)
        test_plain_baseline_path_unchanged(c, td)
        test_audit_deepindex_suppression_unchanged(c, td)
        test_cli_end_to_end(c, td)
        test_write_door_refuses_inert_categories(c, td)
        test_write_door_gate_is_on_the_api_not_the_cli(c, td)

    print()
    total = len(c.passed) + len(c.failed)
    if c.failed:
        print(f"RESULT: {len(c.passed)}/{total} passed, {len(c.failed)} FAILED")
        for m in c.failed:
            print(f"  FAIL: {m}")
        return 1
    print(f"RESULT: {total}/{total} passed — pgmark false-positive suppression works")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
