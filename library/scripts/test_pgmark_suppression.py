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
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import audit_deepindex  # noqa: E402
import pgmark_validate  # noqa: E402
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
        "pgmark-gap: page 3 -> page 9 (skipped 5)",           # plain, not FP
        "not-a-suppression-warning without colon suffix",
        42,                                                    # non-str ignored
    ])
    pg = suppression_categories_from_catalog(cat, "k", prefix="pgmark-")
    c.check(pg == {"gap", "low-confidence-flood"},
            f"prefix='pgmark-' strips prefix AND `-false-positive` suffix (got {sorted(pg)})")

    verbatim = suppression_categories_from_catalog(cat, "k", prefix=None)
    c.check(verbatim == {"pgmark-gap", "pgmark-low-confidence-flood", "case-errors"},
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


def main() -> int:
    c = Checks()
    test_shared_helper_modes(c)
    with tempfile.TemporaryDirectory() as tds:
        td = Path(tds)
        test_false_positive_suppresses_gap(c, td)
        test_plain_baseline_path_unchanged(c, td)
        test_audit_deepindex_suppression_unchanged(c, td)
        test_cli_end_to_end(c, td)

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
