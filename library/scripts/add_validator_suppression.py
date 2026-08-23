"""Atomically add a `<kind>-false-positive:` warning to the catalog
for a citekey. The convergence loop needs this entry written in the
same pass that classifies a finding as `[validator-false-positive]`;
without it the next pass re-flags the item and treats it as new work
(fingerprint divergence per shimojima2015semantic / schwarzlose2021brainscapes).

Replaces the ad-hoc "Edit the catalog by hand" pattern several memos
flag as misaligned. Goes through `update_catalog_entry.py` (locked)
so concurrent skill sessions don't race.

Usage:
    python3 add_validator_suppression.py <citekey> <kind> <reason>
        [--library <path>]

Examples:
    python3 add_validator_suppression.py shepard1970second \\
        pgmark-low-confidence-flood \\
        "raster-only tables on OCR'd 1970 paper; all markers positionally verified"

    python3 add_validator_suppression.py kriegeskorte2015deep \\
        case-errors \\
        "arXiv references in body; brand-name allowlist applies"

The kind is appended verbatim with the `-false-positive:` suffix:
e.g. `pgmark-low-confidence-flood-false-positive: <reason>`.
Duplicates are not appended.

A kind NO reader can match is REFUSED (exit 2) rather than written —
`suppression_vocabulary.classify_suppression_category` is the one place that
answers "can any reader match this?", derived from the validator's and the
audit's own vocabularies. Before task 413 an inert kind stored correctly,
survived every recompute, and silenced nothing; this script's own `--help`
advertised two such kinds, and `skills/di-validate.md` advertised three. The
refusal names the category to use instead. There is deliberately no `--force`:
writing the line anyway is the defect.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tools import (
    citekey_matches, lock_catalog, normalize_citekey,
    read_catalog, write_catalog,
)
from suppression_vocabulary import (
    classify_suppression_category, vocabulary_help,
)


def add_suppression(library: Path, citekey: str, kind: str, reason: str) -> dict:
    """Add `<kind>-false-positive: <reason>` to the citekey's
    indexed.warnings, idempotently. Returns a status dict.
    """
    citekey = normalize_citekey(citekey)
    # The gate is HERE, not only in `main()`, so no caller can reach the write
    # around it — this function is the API other scripts import.
    verdict = classify_suppression_category(kind)
    if not verdict.ok:
        return {"status": "refused", "warning": verdict.message()}
    warning = f"{kind}-false-positive: {reason.strip()}"
    with lock_catalog(library):
        catalog = read_catalog(library)
        target = None
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), citekey):
                target = e
                break
        if target is None:
            return {"status": "no-entry", "warning": warning}
        indexed = target.setdefault("indexed", {})
        warnings = indexed.setdefault("warnings", [])
        # De-dupe by kind+reason match.
        for existing in warnings:
            if not isinstance(existing, str):
                continue
            if existing.startswith(f"{kind}-false-positive:") and reason.strip() in existing:
                return {"status": "already-present", "warning": existing}
        warnings.append(warning)
        write_catalog(library, catalog)
    return {"status": "added", "warning": warning}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("citekey")
    ap.add_argument("kind", help=vocabulary_help())
    ap.add_argument(
        "reason",
        help=(
            "One-line human-readable explanation. Shown in the audit "
            "punch-list and preserved across resume passes."
        ),
    )
    ap.add_argument(
        "--library", type=Path, default=None,
        help="Library root (defaults to CWD if it contains master.bib).",
    )
    args = ap.parse_args()
    library = args.library
    if library is None:
        cwd = Path.cwd()
        if (cwd / "master.bib").exists():
            library = cwd
        else:
            library = Path("~/Virgil-Library").expanduser()
    library = library.resolve()
    result = add_suppression(library, args.citekey, args.kind, args.reason)
    ok = result["status"] in ("added", "already-present")
    if result["status"] == "refused":
        # The verdict already opens with `refused:` and carries a multi-line
        # remedy; wrapping it in the status line again reads as a stutter.
        print(f"{args.citekey}: {result['warning']}", file=sys.stderr)
    else:
        print(
            f"{args.citekey}: {result['status']} — {result['warning']}",
            file=sys.stdout if ok else sys.stderr,
        )
    if ok:
        return 0
    # Distinct codes: a refused CATEGORY is a fixable typo on this command
    # line, where `no-entry` is a missing catalog row. A caller that retried
    # a refusal verbatim would loop forever.
    return 2 if result["status"] == "refused" else 1


if __name__ == "__main__":
    sys.exit(main())
