"""Regression guard for task 323 — the warnings-clobber / late-persist class.

Two diseases met in `/library/clean-bibliography`:

  1. a producer→consumer ordering gap INSIDE one run — §3g computes
     `missing-bib-entry:` lines and `synthesize_canonical_entries.py`, later in
     the same subskill, gates ENTIRELY on reading them back out of
     `.virgil/catalog.json`; but the write was deferred to `deep-index.md`
     step 5, which runs after the whole §3 dispatch. So synthesis consumed the
     PREVIOUS pass's warnings and was a guaranteed no-op on every first pass
     (and a standalone run persisted nothing at all); and

  2. a patch channel whose whole-array replace made any subskill-side write a
     clobber hazard — `_deep_merge` recurses only into dicts, so a naive
     `{"indexed": {"warnings": [...]}}` patch destroys every other warning
     kind on the row. Fixing (2) is what makes fixing (1) safe.

The fix is a per-KIND recompute-replace (`merge_indexed_warnings`), opt-in at
the call (`update_catalog_entry(..., recompute_warning_kinds=[...])`) and
surfaced on the locked CLI shim as a repeatable `--recompute-warning-kind`.

What these tests pin, in the order the design argues them:

  A. the merge is EXACT-head, not `startswith` — a `<kind>-false-positive:`
     suppression (its own append-if-absent family, with readers that rely on
     the two staying distinguishable) SURVIVES a recompute declaring `<kind>`;
  B. every other kind survives byte-identically and in original order, and a
     declared kind with zero fresh lines CLEARS (replace, not union — union is
     monotone, so resolved gaps would stay flagged forever);
  C. called without the keyword, `update_catalog_entry` is byte-identical to
     the pre-323 whole-array replace, and `_deep_merge` is untouched;
  D. declaring kinds with no `indexed.warnings` array REFUSES rather than
     implying an empty one — an implied empty lets a patch meant for one field
     wipe a whole kind;
  E. the readers match rows NFC-insensitively, since the write side
     normalizes — without which the whole fix silently no-ops on exactly the
     papers whose citekeys carry diacritics (Tichý / López). Task 371 widened
     this half from three hand-fixed readers to the whole silo, and put a
     CENSUS under it (section C2): every citekey comparison in
     `library/scripts/*.py` routes through `_tools.citekey_matches`, with the
     SSOT's own definition the one allowlisted line. The doctrine lives at
     library/AGENTS.md, "A citekey lookup is NFC-insensitive"; and
  F. end-to-end: a first-pass clean-bibliography flow (through the real CLI
     shim, in a subprocess) leaves `missing-bib-entry:` lines on the row, the
     real `synthesize()` then finds targets and synthesizes, and a foreign
     `pgmark-gap:` line plus a `missing-bib-entry-false-positive:` suppression
     both survive unchanged.

Run: python3 library/scripts/tests/test_warning_recompute_merge.py
     (or under pytest; it carries its own no-pytest runner so CI can shell out
     to it — nothing in CI runs Python directly.)
"""
import json
import os
import subprocess
import sys
import unicodedata
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import _tools  # noqa: E402
import synthesize_canonical_entries as synth  # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _make_library(tmp_path: Path, entries: list) -> Path:
    """A minimal but REAL library root: `.virgil/catalog.json` + master.bib."""
    lib = tmp_path / "lib"
    (lib / ".virgil").mkdir(parents=True)
    (lib / "master.bib").write_text("", encoding="utf-8")
    (lib / ".virgil" / "catalog.json").write_text(
        json.dumps({"version": 1, "entries": entries}, indent=2) + "\n",
        encoding="utf-8",
    )
    return lib


def _row(lib: Path, citekey: str) -> dict:
    data = json.loads((lib / ".virgil" / "catalog.json").read_text())
    for e in data.get("entries", []):
        if _tools.citekey_matches(e.get("citekey", ""), citekey):
            return e
    raise AssertionError(f"no row for {citekey!r}")


# ─────────────────────────────────────────────────────────────────────────
# A. The merge helper — exact head, not startswith
# ─────────────────────────────────────────────────────────────────────────

def test_false_positive_suppression_survives_its_own_kinds_recompute():
    """The leg the whole design turns on.

    `missing-bib-entry-false-positive:` is representable — the suppression
    writer takes arbitrary kinds — and a `startswith("missing-bib-entry")`
    drop would eat an operator's verified suppression. Head equality keeps the
    two families distinguishable, which is what `pgmark_validate.py`'s
    baseline reader and `suppression_categories_from_catalog` require.
    """
    existing = [
        "missing-bib-entry: Smith 1998",
        "missing-bib-entry-false-positive: Smith 1998 is a title mention",
    ]
    out = _tools.merge_indexed_warnings(
        existing, ["missing-bib-entry"], ["missing-bib-entry: Jones 2004"],
    )
    check(
        out == [
            "missing-bib-entry-false-positive: Smith 1998 is a title mention",
            "missing-bib-entry: Jones 2004",
        ],
        f"suppression eaten or stale line kept: {out!r}",
    )


def test_foreign_kinds_survive_byte_identically_and_in_order():
    existing = [
        "pgmark-gap: 12-14",
        "missing-bib-entry: Smith 1998",
        "footnote-recovery-needed: 9 footnotes in PDF source not present",
        "ambiguous-citation: Lewis 1979 (matches: lewis1979a, lewis1979b)",
        "metadata-mismatch: title-only-missing",
    ]
    before = list(existing)
    out = _tools.merge_indexed_warnings(
        existing,
        ["missing-bib-entry", "ambiguous-citation"],
        ["missing-bib-entry: Jones 2004"],
    )
    check(
        out == [
            "pgmark-gap: 12-14",
            "footnote-recovery-needed: 9 footnotes in PDF source not present",
            "metadata-mismatch: title-only-missing",
            "missing-bib-entry: Jones 2004",
        ],
        f"foreign kinds not preserved in order: {out!r}",
    )
    check(existing == before, "helper mutated its input array")


def test_declared_kind_with_no_fresh_lines_clears_it():
    """Replace, not union: a gap resolved since the last pass stops being
    flagged. Union-by-line is monotone and could never drop."""
    out = _tools.merge_indexed_warnings(
        ["missing-bib-entry: Smith 1998", "pgmark-gap: 12-14"],
        ["missing-bib-entry"],
        [],
    )
    check(out == ["pgmark-gap: 12-14"], f"stale kind not cleared: {out!r}")


def test_undeclared_kind_is_untouched_even_when_fresh_lines_mention_it():
    """Authority scoping: a numeric/Vancouver pass declares only its own kind,
    so a prior author-year pass's findings survive."""
    out = _tools.merge_indexed_warnings(
        ["missing-bib-entry: Smith 1998", "numeric-citation-style: old"],
        ["numeric-citation-style"],
        ["numeric-citation-style: source uses Vancouver-style numeric citations"],
    )
    check(
        out == [
            "missing-bib-entry: Smith 1998",
            "numeric-citation-style: source uses Vancouver-style numeric citations",
        ],
        f"undeclared kind disturbed: {out!r}",
    )


def test_non_string_and_colonless_entries_are_preserved():
    """Junk survives rather than being silently dropped — this is a merge, not
    a normalizer, and a reader that tolerates junk should keep seeing it."""
    existing = [{"legacy": True}, "no-colon-here", 7, "pgmark-gap: 3"]
    out = _tools.merge_indexed_warnings(existing, ["pgmark-gap"], [])
    check(out == [{"legacy": True}, "no-colon-here", 7], f"junk dropped: {out!r}")


def test_empty_kind_list_is_a_pure_append():
    out = _tools.merge_indexed_warnings(["a: 1"], [], ["b: 2"])
    check(out == ["a: 1", "b: 2"], f"unexpected: {out!r}")


def test_blank_and_non_string_kinds_are_ignored():
    """A blank kind must not match the colonless-line head and delete it."""
    out = _tools.merge_indexed_warnings(["", "a: 1"], ["", None, "  "], [])
    check(out == ["", "a: 1"], f"blank kind matched something: {out!r}")


# ─────────────────────────────────────────────────────────────────────────
# B. update_catalog_entry — opt-in, and byte-identical without the keyword
# ─────────────────────────────────────────────────────────────────────────

def test_without_the_keyword_the_array_still_replaces(tmp_path):
    """Pre-323 behavior, pinned. `_deep_merge` is shared with
    `upsert_catalog_entry`, whose list-replace semantics govern
    authors/tags/importedKeys and are pinned by test_parser_hardening.py."""
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {"state": "indexed", "warnings": ["pgmark-gap: 3", "x: 1"]},
    }])
    _tools.update_catalog_entry(
        lib, "smith2001", {"indexed": {"warnings": ["only: me"]}},
    )
    row = _row(lib, "smith2001")
    check(row["indexed"]["warnings"] == ["only: me"],
          f"replace semantics changed: {row['indexed']['warnings']!r}")
    check(row["indexed"]["state"] == "indexed", "sibling nested key clobbered")
    check("updatedAt" in row, "updatedAt not stamped")


def test_with_kinds_merges_against_the_rows_current_array(tmp_path):
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {
            "state": "deepIndexed",
            "warnings": [
                "pgmark-gap: 12-14",
                "missing-bib-entry: Smith 1998",
                "missing-bib-entry-false-positive: verified by hand",
            ],
        },
    }])
    patch = {"indexed": {"warnings": ["missing-bib-entry: Jones 2004"]}}
    _tools.update_catalog_entry(
        lib, "smith2001", patch, recompute_warning_kinds=["missing-bib-entry"],
    )
    row = _row(lib, "smith2001")
    check(
        row["indexed"]["warnings"] == [
            "pgmark-gap: 12-14",
            "missing-bib-entry-false-positive: verified by hand",
            "missing-bib-entry: Jones 2004",
        ],
        f"merge wrong: {row['indexed']['warnings']!r}",
    )
    check(row["indexed"]["state"] == "deepIndexed", "sibling key clobbered")
    check(
        patch == {"indexed": {"warnings": ["missing-bib-entry: Jones 2004"]}},
        f"caller's patch was mutated: {patch!r}",
    )


def test_kinds_declared_with_no_warnings_array_refuses(tmp_path):
    """An implied empty would let a patch meant for `indexed.state` wipe every
    line of the declared kinds. A defaulted answer here is a decision nobody
    made — so it raises, and the row is untouched."""
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {"state": "indexed", "warnings": ["missing-bib-entry: Smith 1998"]},
    }])
    raised = None
    try:
        _tools.update_catalog_entry(
            lib, "smith2001", {"indexed": {"state": "deepIndexed"}},
            recompute_warning_kinds=["missing-bib-entry"],
        )
    except ValueError as e:
        raised = e
    check(raised is not None, "no ValueError on kinds-without-warnings")
    row = _row(lib, "smith2001")
    check(row["indexed"]["warnings"] == ["missing-bib-entry: Smith 1998"],
          "row was modified despite the refusal")
    check(row["indexed"]["state"] == "indexed", "row was modified despite the refusal")


def test_merge_runs_against_the_row_not_the_patch_on_an_nfd_citekey(tmp_path):
    """The row lookup was already NFC-insensitive; pin it so the merge can't
    regress to a raw compare and silently take the empty-current path."""
    nfd = unicodedata.normalize("NFD", "tichý1988")
    nfc = unicodedata.normalize("NFC", "tichý1988")
    check(nfd != nfc, "fixture is not actually NFD-vs-NFC distinct")
    lib = _make_library(tmp_path, [{
        "citekey": nfd,
        "indexed": {"warnings": ["pgmark-gap: 3", "missing-bib-entry: Old 1970"]},
    }])
    _tools.update_catalog_entry(
        lib, nfc, {"indexed": {"warnings": ["missing-bib-entry: New 1999"]}},
        recompute_warning_kinds=["missing-bib-entry"],
    )
    row = _row(lib, nfc)
    check(
        row["indexed"]["warnings"] == ["pgmark-gap: 3", "missing-bib-entry: New 1999"],
        f"NFD row not merged: {row['indexed']['warnings']!r}",
    )


def test_an_undeclared_fresh_line_refuses(tmp_path):
    """The typo'd-kind shape, and the reason it needs a REFUSAL rather than
    care: declare `missing-bib-entrie`, supply `missing-bib-entry:` lines, and
    nothing is ever dropped — the merge silently degrades to append-only, the
    shim reports success, and the row grows by one line per pass forever."""
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {"warnings": ["missing-bib-entry: Smith 1998"]},
    }])
    raised = None
    try:
        _tools.update_catalog_entry(
            lib, "smith2001",
            {"indexed": {"warnings": ["missing-bib-entry: Jones 2004"]}},
            recompute_warning_kinds=["missing-bib-entrie"],
        )
    except ValueError as e:
        raised = e
    check(raised is not None, "no ValueError on an undeclared fresh line")
    check(_row(lib, "smith2001")["indexed"]["warnings"]
          == ["missing-bib-entry: Smith 1998"], "row modified despite refusal")


def test_a_malformed_row_warnings_value_refuses(tmp_path):
    """`for w in "pgmark-gap: 3"` iterates CHARACTERS. Merging into that would
    rewrite the row from them — a malformed row is a human's repair, not this
    function's guess."""
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {"warnings": "missing-bib-entry: Smith 1998"},
    }])
    raised = None
    try:
        _tools.update_catalog_entry(
            lib, "smith2001",
            {"indexed": {"warnings": ["missing-bib-entry: Jones 2004"]}},
            recompute_warning_kinds=["missing-bib-entry"],
        )
    except ValueError as e:
        raised = e
    check(raised is not None, "no ValueError on a non-list row warnings value")
    check(_row(lib, "smith2001")["indexed"]["warnings"]
          == "missing-bib-entry: Smith 1998", "row modified despite refusal")


def test_an_empty_kind_list_still_selects_merge_mode_not_replace(tmp_path):
    """`None` means "legacy replace"; a LIST — even empty — means "merge".
    A caller that computed its kind list and got [] means "I dropped nothing",
    and handing that back the CLOBBER path is the exact surprise this whole
    change exists to remove."""
    lib = _make_library(tmp_path, [{
        "citekey": "smith2001",
        "indexed": {"warnings": ["pgmark-gap: 3"]},
    }])
    _tools.update_catalog_entry(
        lib, "smith2001", {"indexed": {"warnings": []}}, recompute_warning_kinds=[],
    )
    check(_row(lib, "smith2001")["indexed"]["warnings"] == ["pgmark-gap: 3"],
          "an empty kind list took the whole-array replace path")


def test_merge_on_a_row_with_no_indexed_warnings_yet(tmp_path):
    lib = _make_library(tmp_path, [{"citekey": "smith2001"}])
    _tools.update_catalog_entry(
        lib, "smith2001", {"indexed": {"warnings": ["missing-bib-entry: Smith 1998"]}},
        recompute_warning_kinds=["missing-bib-entry"],
    )
    row = _row(lib, "smith2001")
    check(row["indexed"]["warnings"] == ["missing-bib-entry: Smith 1998"],
          f"unexpected: {row['indexed']!r}")


# ─────────────────────────────────────────────────────────────────────────
# C. Reader normalization — the fix would no-op on diacritic citekeys
# ─────────────────────────────────────────────────────────────────────────

def test_suppression_categories_reads_an_nfd_row():
    nfd = unicodedata.normalize("NFD", "lópez2010")
    nfc = unicodedata.normalize("NFC", "lópez2010")
    catalog = {"entries": [{
        "citekey": nfd,
        "indexed": {"warnings": ["pgmark-gap-false-positive: verified"]},
    }]}
    got = _tools.suppression_categories_from_catalog(catalog, nfc, prefix="pgmark-")
    check(got == {"gap"}, f"NFD row not matched: {got!r}")


def test_pgmark_baseline_reads_both_halves_off_an_nfd_row():
    """A pre-existing sibling of the same class, closed alongside because the
    two halves of ONE function would otherwise disagree.

    `_baseline_kinds_from_catalog` reads suppressions through the shared
    (NFC-insensitive) reader and prior-pass findings through its own compare.
    Left raw, an NFD-spelled row resolved the suppressions and NOT the prior
    findings, so every finding read as "new" and re-blocked the convergence
    loop on exactly the papers whose citekeys carry diacritics.
    """
    import pgmark_validate  # noqa: PLC0415 — imported here to keep the module optional

    nfd = unicodedata.normalize("NFD", "čerić2001")
    nfc = unicodedata.normalize("NFC", "čerić2001")
    check(nfd != nfc, "fixture is not actually NFD-vs-NFC distinct")
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        cat = Path(td) / "catalog.json"
        cat.write_text(json.dumps({"entries": [{
            "citekey": nfd,
            "indexed": {"warnings": [
                "pgmark-gap: 12-14",
                "pgmark-duplicate-false-positive: verified by hand",
            ]},
        }]}), encoding="utf-8")
        got = pgmark_validate._baseline_kinds_from_catalog(cat, nfc)
    check(got == {"gap", "duplicate"},
          f"NFD row: one or both halves blind ({got!r})")


def test_synthesis_reads_warnings_off_an_nfd_row(tmp_path):
    nfd = unicodedata.normalize("NFD", "tichý1988")
    nfc = unicodedata.normalize("NFC", "tichý1988")
    lib = _make_library(tmp_path, [{
        "citekey": nfd,
        "indexed": {"warnings": ["missing-bib-entry: Prior 1957"]},
    }])
    got = synth._read_catalog_warnings(lib, nfc)
    check(got == ["missing-bib-entry: Prior 1957"], f"NFD row not read: {got!r}")
    check(synth._missing_bib_targets(got) == [("Prior", "1957")],
          "target extraction changed")


def test_fuse_alternate_writer_updates_an_nfd_row(tmp_path):
    """The LOUD member of the class (task 371).

    `update_catalog_for_fusion` is called AFTER `main.tex` has already been
    rewritten by the fusion. A raw compare leaves `found` false on an
    NFD-spelled row and the function raises `KeyError` — so the paper is
    fused and its catalog row keeps a stale `pgmarkCount`/`pgmarkSource`,
    mid-gesture, with nothing to retry against.
    """
    import fuse_alternate  # noqa: PLC0415

    nfd = unicodedata.normalize("NFD", "tichý1988")
    nfc = unicodedata.normalize("NFC", "tichý1988")
    check(nfd != nfc, "fixture is not actually NFD-vs-NFC distinct")
    lib = _make_library(tmp_path, [{
        "citekey": nfd,
        "indexed": {"pgmarkCount": 0, "warnings": ["pgmark-gap: 12-14"]},
    }])
    result = fuse_alternate.FuseResult(
        success=True,
        pgmarks_inserted=3,
        page_count=3,
        aligned_count=3,
        pgmark_source_filename="alternate.pdf",
        pgmark_position="header",
        validation_report=None,
    )
    # Must not raise: the raw compare here is a KeyError after the fusion.
    fuse_alternate.update_catalog_for_fusion(lib, nfc, result)

    row = _row(lib, nfc)
    indexed = row.get("indexed") or {}
    check(indexed.get("pgmarkSource") == "alternate.pdf",
          f"NFD row not updated by the fusion writer: {indexed!r}")
    check(indexed.get("pgmarkPosition") == "header",
          f"pgmarkPosition not written: {indexed!r}")
    check("pgmark-gap: 12-14" in (indexed.get("warnings") or []),
          f"a foreign warning kind was eaten: {indexed!r}")


def test_fuse_alternate_reader_returns_an_nfd_row(tmp_path):
    """The silent member — `_read_catalog_entry` returning None degrades
    every consumer exactly like the three readers task 323 fixed."""
    import fuse_alternate  # noqa: PLC0415

    nfd = unicodedata.normalize("NFD", "čerić2001")
    nfc = unicodedata.normalize("NFC", "čerić2001")
    check(nfd != nfc, "fixture is not actually NFD-vs-NFC distinct")
    lib = _make_library(tmp_path, [{"citekey": nfd, "title": "A Paper"}])
    got = fuse_alternate._read_catalog_entry(lib, nfc)
    check(got is not None and got.get("title") == "A Paper",
          f"NFD row not read: {got!r}")
    # …and the reverse spelling, so neither direction is privileged.
    lib2 = _make_library(tmp_path / "b", [{"citekey": nfc, "title": "B Paper"}])
    got2 = fuse_alternate._read_catalog_entry(lib2, nfd)
    check(got2 is not None and got2.get("title") == "B Paper",
          f"NFC row not read from an NFD query: {got2!r}")


def test_triage_apply_master_membership_is_nfc_insensitive(tmp_path):
    """`read_master_bib` keys its dict by the SPELLING on disk, so a raw
    `citekey in read_master_bib(...)` reports a real NFD-spelled entry as
    missing — and triage then appends a SECOND entry for the same work."""
    import triage_apply  # noqa: PLC0415

    nfd = unicodedata.normalize("NFD", "lópez2010")
    nfc = unicodedata.normalize("NFC", "lópez2010")
    lib = tmp_path / "lib"
    (lib / ".virgil").mkdir(parents=True)
    (lib / "master.bib").write_text(
        "@article{" + nfd + ",\n  title = {A Paper},\n  year = {2010}\n}\n",
        encoding="utf-8",
    )
    check(triage_apply._master_has_citekey(lib, nfc),
          "NFD master.bib entry read as missing")


def test_triage_apply_bib_state_reads_an_nfd_row(tmp_path):
    import triage_apply  # noqa: PLC0415
    nfd = unicodedata.normalize("NFD", "tichý1988")
    nfc = unicodedata.normalize("NFC", "tichý1988")
    catalog = {"entries": [{"citekey": nfd, "bib": {"state": "authenticated"}}]}
    check(triage_apply._bib_state_for_citekey(catalog, nfc) == "authenticated",
          "NFD row not matched by the bib-state reader")


# ─────────────────────────────────────────────────────────────────────────
# C2. The CENSUS — the leg with teeth (task 371)
#
# `citekey_matches` was never the part that could misbehave; a call site
# that never asks it is, and `e.get("citekey") == citekey` type-checks
# perfectly while being exactly the defect. Task 323 fixed three readers by
# hand; two months later FIFTEEN raw comparisons (plus one raw membership
# test) were still live across ten files — fuse_alternate ×2,
# triage_apply ×3 + the membership test, repair_etal_citekeys ×2,
# fuzzy_citekey_disambiguate ×2, apply_metadata_mismatch_policy,
# audit_deepindex, drain_queue, index_paper, update_master_bib_entry,
# dedup_index — which is what a hand-drained class looks like with no
# guard under it.
#
# The allowlist is EMPTY but for the SSOT's own definition. A hit is
# CONVERT-it, never an entry.
# ─────────────────────────────────────────────────────────────────────────

# `<file>:<line-fragment>` — the ONE line entitled to compare citekeys raw.
PERMITTED_RAW_CITEKEY_COMPARISONS = {
    "_tools.py": "return normalize_citekey(stored) == normalize_citekey(query)",
}

_SCRIPTS_DIR = Path(_SCRIPTS)


def _code_only(src: str) -> str:
    """Blank `#` comments and TRIPLE-quoted strings, preserving line numbers.

    Ordinary single-line literals are KEPT deliberately: the drift lives in
    them (`e.get("citekey") == citekey`), so blanking them would make the
    census blind to the commonest shape of the defect. Docstrings go, because
    this file's own prose quotes the defect verbatim.
    """
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    triple = False
    while i < n:
        c = src[i]
        if quote is None:
            if c == "#":
                while i < n and src[i] != "\n":
                    out.append(" ")
                    i += 1
                continue
            if c in "\"'":
                if src[i:i + 3] == c * 3:
                    quote, triple = c, True
                    out.append("   ")
                    i += 3
                    continue
                quote, triple = c, False
                out.append(c)
                i += 1
                continue
            out.append(c)
            i += 1
            continue
        if c == "\\":
            out.append("  " if triple else src[i:i + 2])
            i += 2
            continue
        if triple and src[i:i + 3] == quote * 3:
            quote = None
            out.append("   ")
            i += 3
            continue
        if not triple and c == quote:
            quote = None
            out.append(c)
            i += 1
            continue
        out.append(("\n" if c == "\n" else " ") if triple else c)
        i += 1
    return "".join(out)


# The operand immediately LEFT of / RIGHT of an `==`/`!=`. Deliberately
# adjacent rather than a window: `if not citekey or state == "none"` names a
# citekey on the line and compares something else entirely.
_OPERAND_L = __import__("re").compile(
    r"""([A-Za-z_][\w.]*(?:\(\s*["'][\w-]+["']\s*(?:,[^()]*)?\))?)\s*$""")
_OPERAND_R = __import__("re").compile(
    r"""^\s*([A-Za-z_][\w.]*(?:\(\s*["'][\w-]+["']\s*(?:,[^()]*)?\))?)""")
# Names that denote a citekey in this silo. `old` / `new_key` / `candidate_key`
# are the rename planners' spellings; `paper.name` is a paper FOLDER, which on
# macOS comes back decomposed.
_CITEKEY_NAME = __import__("re").compile(
    r"citekey|\bold\b|\bnew_key\b|\bcandidate_key\b|paper\.name", __import__("re").I)


def _raw_citekey_comparisons(directory: Path) -> list[tuple[str, int, str]]:
    import re  # noqa: PLC0415
    hits: list[tuple[str, int, str]] = []
    for path in sorted(directory.glob("*.py")):
        if path.name.startswith("test_"):
            continue          # fixture assertions on ASCII keys
        raw_lines = path.read_text(encoding="utf-8").splitlines()
        code_lines = _code_only(path.read_text(encoding="utf-8")).splitlines()
        for lineno, line in enumerate(code_lines, 1):
            if "citekey_matches" in line:
                continue
            for m in re.finditer(r"[=!]=", line):
                left = _OPERAND_L.search(line[:m.start()])
                right = _OPERAND_R.search(line[m.end():])
                operands = [x.group(1) for x in (left, right) if x]
                if not any(_CITEKEY_NAME.search(o) for o in operands):
                    continue
                text = raw_lines[lineno - 1].strip()
                allowed = PERMITTED_RAW_CITEKEY_COMPARISONS.get(path.name)
                if allowed and allowed in text:
                    continue
                hits.append((path.name, lineno, text))
                break
    return hits


def _raw_master_membership(directory: Path) -> list[str]:
    """`read_master_bib` keys its dict by the on-disk SPELLING, so
    `citekey in read_master_bib(...)` is this same defect wearing a
    membership test's clothes. The operand before `in` must be a citekey —
    `for k in read_master_bib(...)` is an iteration, not a lookup.
    """
    import re  # noqa: PLC0415
    needle = re.compile(r"\bin\s+read_master_bib\s*\(")
    hits: list[str] = []
    for path in sorted(directory.glob("*.py")):
        if path.name.startswith("test_"):
            continue
        for lineno, line in enumerate(
                _code_only(path.read_text(encoding="utf-8")).splitlines(), 1):
            m = needle.search(line)
            if not m:
                continue
            left = _OPERAND_L.search(line[:m.start()])
            if left and _CITEKEY_NAME.search(left.group(1)):
                hits.append(f"{path.name}:{lineno}")
    return hits


def test_no_production_script_compares_citekeys_raw():
    hits = _raw_citekey_comparisons(_SCRIPTS_DIR)
    check(hits == [], "raw citekey comparisons (route through "
                      f"`citekey_matches`):\n  " +
          "\n  ".join(f"{f}:{n}: {t}" for f, n, t in hits))


def test_the_census_can_actually_see_the_defect(tmp_path):
    """A canary on a SYNTHETIC fixture, never on a live line — a guard whose
    only evidence is the defect it exists to drain passes vacuously the day
    the defect is fixed."""
    d = tmp_path / "scripts"
    d.mkdir()
    (d / "zz_synthetic.py").write_text(
        'def f(e, entry, match, citekey):\n'
        '    if e.get("citekey") == citekey:\n'
        '        return e\n'
        '    if entry.get("citekey") != citekey:\n'
        '        return None\n'
        '    if match.citekey != citekey:\n'
        '        return None\n',
        encoding="utf-8",
    )
    hits = _raw_citekey_comparisons(d)
    # One hit per line (the scanner breaks after the first operator per line).
    check(len(hits) == 3, f"census blind to a planted defect: {hits!r}")
    check({n for _, n, _ in hits} == {2, 4, 6}, f"wrong lines: {hits!r}")

    # …and it must NOT indict a converted site or a citekey-adjacent
    # comparison about something else.
    (d / "zz_synthetic.py").write_text(
        'def f(e, citekey, state):\n'
        '    if citekey_matches(e.get("citekey", ""), citekey):\n'
        '        return e\n'
        '    if not citekey or state == "none":\n'
        '        return None\n',
        encoding="utf-8",
    )
    check(_raw_citekey_comparisons(d) == [],
          "census indicts a correct site")


def test_no_production_script_membership_tests_master_bib_raw():
    """The second shape: `read_master_bib` keys its dict by the on-disk
    spelling, so `citekey in read_master_bib(...)` is the same defect wearing
    a membership test's clothes."""
    hits = _raw_master_membership(_SCRIPTS_DIR)
    check(hits == [], f"raw master.bib membership test(s): {hits}")


def test_the_membership_census_can_see_its_defect(tmp_path):
    d = tmp_path / "scripts"
    d.mkdir()
    (d / "zz_synthetic.py").write_text(
        'def f(library, citekey):\n'
        '    return citekey in read_master_bib(library / "master.bib")\n',
        encoding="utf-8",
    )
    check(_raw_master_membership(d) == ["zz_synthetic.py:2"],
          f"membership census blind: {_raw_master_membership(d)!r}")
    # …and the converted shape (an iteration, not a membership test) is clean.
    (d / "zz_synthetic.py").write_text(
        'def f(library, citekey):\n'
        '    return any(citekey_matches(k, citekey)\n'
        '               for k in read_master_bib(library / "master.bib"))\n',
        encoding="utf-8",
    )
    check(_raw_master_membership(d) == [],
          "membership census indicts the converted shape")


# ─────────────────────────────────────────────────────────────────────────
# D. End-to-end — the first-pass flow, through the real CLI shim
# ─────────────────────────────────────────────────────────────────────────

def test_first_pass_persist_then_synthesize(tmp_path):
    """The defect, end to end.

    Before this task there was no way for a clean-bibliography run to get
    `missing-bib-entry:` lines onto the row before synthesis read them, so
    `synthesize()` returned `{"synthesized": 0, "reason": "no missing-bib-entry
    warnings"}` on every first pass. Here the persist step runs through the
    REAL locked CLI shim (subprocess — so the `--recompute-warning-kind` flag
    wiring is exercised, not just the Python API), and synthesis then fires.

    Crossref is stubbed: the network is not what's under test, and the leg
    would otherwise be a flake. Everything else is real.
    """
    citekey = "smith2001"
    lib = _make_library(tmp_path, [{
        "citekey": citekey,
        "indexed": {
            "state": "indexed",
            "warnings": [
                "pgmark-gap: 12-14",
                "missing-bib-entry-false-positive: Hyperproof is a title mention",
            ],
        },
    }])
    (lib / "papers" / citekey).mkdir(parents=True)
    bib = lib / "papers" / citekey / "references.bib"
    bib.write_text("@book{smith2001,\n  title = {Own Row},\n}\n", encoding="utf-8")

    patch = tmp_path / "warn.json"
    patch.write_text(json.dumps({"indexed": {"warnings": [
        "missing-bib-entry: Prior 1957",
    ]}}), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(Path(_SCRIPTS) / "update_catalog_entry.py"), citekey,
         "--patch-file", str(patch), "--library", str(lib),
         "--recompute-warning-kind", "missing-bib-entry",
         "--recompute-warning-kind", "ambiguous-citation"],
        capture_output=True, text=True,
    )
    check(proc.returncode == 0, f"shim failed: {proc.stdout}\n{proc.stderr}")

    warnings = _row(lib, citekey)["indexed"]["warnings"]
    check("pgmark-gap: 12-14" in warnings, f"foreign kind lost: {warnings!r}")
    check(
        "missing-bib-entry-false-positive: Hyperproof is a title mention" in warnings,
        f"suppression lost: {warnings!r}",
    )
    check("missing-bib-entry: Prior 1957" in warnings,
          f"fresh line not persisted: {warnings!r}")

    # Synthesis, same run — the consumer that used to see nothing.
    real_query = synth._crossref_query
    os.environ["VIRGIL_LIBRARY_ROOT"] = str(lib)
    synth._crossref_query = lambda author, year, rows=5: [{
        "title": ["Time and Modality"],
        "author": [{"family": "Prior", "given": "A. N."}],
        "type": "book",
        "issued": {"date-parts": [[1957]]},
        "publisher": "Oxford University Press",
    }]
    try:
        result = synth.synthesize(citekey, dry_run=True)
    finally:
        synth._crossref_query = real_query
        os.environ.pop("VIRGIL_LIBRARY_ROOT", None)
    check(result.get("synthesized", 0) > 0,
          f"synthesis still a no-op on the first pass: {result!r}")


def _run_standalone() -> int:
    """Run without pytest (it isn't installed everywhere), supplying the one
    fixture these tests use (`tmp_path`) from `tempfile`."""
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
    # `--standalone` forces the built-in runner regardless of whether pytest is
    # installed. The vitest shell passes it, because that shell asserts on the
    # "<n>/<n> passed" tally this runner prints — under pytest the tally is
    # absent and the JS test would fail on a machine where the Python suite
    # actually PASSED, which is a guard failing for a reason unrelated to what
    # it guards.
    if "--standalone" in sys.argv:
        raise SystemExit(_run_standalone())
    try:
        import pytest
    except ImportError:
        raise SystemExit(_run_standalone())
    raise SystemExit(pytest.main([__file__, "-q"]))
