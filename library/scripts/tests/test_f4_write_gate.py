"""F#4 WRITE gate — one door, asked before every catalog row is minted.

Task 443. F#4's holdings-only model was enforced by two of the three catalog
writers and skipped by the third: `index_paper._sync_catalog_entry_from_master`
— reached once per entry of every `.bib` import via `/library/authenticate-bib`
step 7 — called `upsert_catalog_entry` unconditionally, whose no-match branch
APPENDS. So it minted exactly the rows the other two refuse.

Covers:
  * the door (`_tools.admit_catalog_row`): True for a holding, False + a
    discharged `% bib.state` comment for a reference-only entry, and the
    "none"-never-downgrades rule;
  * `_sync_catalog_entry_from_master` obeying it — row count unchanged for a
    fileless citekey, and the FULL row still written for a held one (the
    top-level title/authors/year/doi derivation is the part that must not
    move);
  * the reachability of `/library/authenticate-bib` step 7's documented
    `exit 1` branch, which the pre-443 mint made unreachable;
  * `update_master_bib_entry`'s byte-identical no-op skip, which is what makes
    the door's re-assert free on a per-entry hot path;
  * the SSOT source resolution `index_paper` used to fork (NFC/NFD); and
  * THE CENSUS — the leg with teeth. The gate was never the part that could
    misbehave; a writer that never asks it is, and it runs perfectly.

Run: python3 -m pytest library/scripts/tests/test_f4_write_gate.py -v
     python3 library/scripts/tests/test_f4_write_gate.py     (no pytest needed)
"""
import ast
import inspect
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import index_paper as ip  # noqa: E402
import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
from _tools import (  # noqa: E402
    admit_catalog_row,
    iter_master_bib_states,
    read_catalog,
    resolve_paper_source,
    update_master_bib_entry,
    write_catalog,
)


# ── fixtures ──────────────────────────────────────────────────────────


def _init_library(tmp_path: Path) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "papers").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text("")
    return tmp_path


def _make_holding(library: Path, citekey: str, ext: str = "pdf") -> None:
    d = library / "papers" / citekey
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{citekey}.{ext}").write_text("%PDF-fake\n")


def _seed_master(library: Path, citekey: str, state: str = "unverified",
                 **fields) -> dict:
    f = {"title": "A Work", "author": "Doe, Jane and Roe, Rich",
         "year": "1999", "doi": "10.1000/xyz"}
    f.update(fields)
    update_master_bib_entry(library, citekey, "article", f, bib_state=state)
    return f


def _bib_status(state: str) -> dict:
    return {
        "state": state, "doiVerified": False, "sources": [],
        "fieldChanges": [], "score": 0.0, "note": "",
    }


def _rows(library: Path) -> list:
    return read_catalog(library).get("entries", [])


def _states(library: Path) -> dict:
    return dict(iter_master_bib_states((library / "master.bib").read_text()))


# ── the door ──────────────────────────────────────────────────────────


def test_door_admits_a_holding_and_touches_nothing(tmp_path):
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "held", state="unverified")
    _make_holding(lib, "held")
    before = (lib / "master.bib").read_text()
    assert admit_catalog_row(
        lib, "held", entry_type="article", fields=fields,
        bib_state="authenticated") is True
    # A True answer writes NOTHING — the caller owns the row.
    assert (lib / "master.bib").read_text() == before
    assert _rows(lib) == []


def test_door_refuses_a_reference_and_discharges_the_state(tmp_path):
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    assert admit_catalog_row(
        lib, "refonly", entry_type="article", fields=fields,
        bib_state="authenticated") is False
    # The discharge: the state's HOME is the master.bib comment, and no row.
    assert _states(lib).get("refonly") == "authenticated"
    assert _rows(lib) == []


def test_door_never_downgrades_with_a_none_state(tmp_path):
    """"I have no state to record" must not overwrite one an earlier run set."""
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="authenticated")
    for state in ("none", ""):
        assert admit_catalog_row(
            lib, "refonly", entry_type="article", fields=fields,
            bib_state=state) is False
        assert _states(lib).get("refonly") == "authenticated", state
    assert _rows(lib) == []


def test_door_refuses_a_non_canonical_state(tmp_path):
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly")
    try:
        admit_catalog_row(lib, "refonly", entry_type="article",
                          fields=fields, bib_state="autenticated")
    except ValueError as e:
        assert "canonical" in str(e)
    else:
        raise AssertionError("a typo'd state must not reach master.bib")


# ── the third writer now obeys the gate ───────────────────────────────


def test_sync_from_master_mints_no_row_for_a_reference_only_entry(tmp_path):
    """The reported defect: `/library/authenticate-bib` step 7 on a fileless
    reference. Pre-443 this appended a row."""
    lib = _init_library(tmp_path)
    _seed_master(lib, "refonly", state="unverified")
    before = len(_rows(lib))
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("authenticated"))
    assert len(_rows(lib)) == before == 0
    # …and the state landed in its home rather than being lost.
    assert _states(lib).get("refonly") == "authenticated"


def test_sync_from_master_refreshes_the_comment_on_every_run(tmp_path):
    lib = _init_library(tmp_path)
    _seed_master(lib, "refonly", state="unverified")
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("canonical"))
    assert _states(lib).get("refonly") == "canonical"
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("authenticated"))
    assert _states(lib).get("refonly") == "authenticated"
    assert _rows(lib) == []


def test_sync_from_master_writes_the_holding_row_exactly_as_before(tmp_path):
    """CONTROL. The top-level derivation is the part that must not move, so
    assert the whole row rather than its presence."""
    lib = _init_library(tmp_path)
    _seed_master(lib, "held", state="unverified")
    _make_holding(lib, "held")
    status = _bib_status("authenticated")
    ip._sync_catalog_entry_from_master(lib, "held", status)
    rows = _rows(lib)
    assert len(rows) == 1
    row = rows[0]
    assert row["citekey"] == "held"
    assert row["title"] == "A Work"
    assert row["authors"] == ["Doe, Jane", "Roe, Rich"]
    assert row["year"] == 1999
    assert row["doi"] == "10.1000/xyz"
    assert row["bib"]["state"] == "authenticated"
    # The row is minted by `upsert_catalog_entry`, so it carries that
    # function's defaults for the blocks this writer never sets.
    assert row["pdf"] == {"present": False}
    assert row["indexed"] == {"state": "none"}
    assert set(row) == {
        "citekey", "addedAt", "updatedAt", "pdf", "indexed", "bib",
        "title", "authors", "year", "doi",
    }


def test_sync_from_master_still_updates_an_existing_holding_row(tmp_path):
    lib = _init_library(tmp_path)
    _seed_master(lib, "held", state="unverified")
    _make_holding(lib, "held")
    ip._sync_catalog_entry_from_master(lib, "held", _bib_status("unverified"))
    ip._sync_catalog_entry_from_master(lib, "held", _bib_status("authenticated"))
    rows = _rows(lib)
    assert len(rows) == 1
    assert rows[0]["bib"]["state"] == "authenticated"


def test_sync_from_master_leaves_a_stale_reference_row_alone(tmp_path):
    """A pre-F#4 row for a fileless citekey is not this writer's to repair —
    `prune_catalog_present_false` owns that migration. What matters is that
    the gate does not MINT; an existing row is still refreshed by the
    `upsert` path it never reaches, so the row simply does not move."""
    lib = _init_library(tmp_path)
    _seed_master(lib, "refonly", state="unverified")
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "refonly", "pdf": {"present": False},
         "indexed": {"state": "none"}, "bib": {"state": "unverified"}},
    ]})
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("authenticated"))
    rows = _rows(lib)
    assert len(rows) == 1
    assert _states(lib).get("refonly") == "authenticated"


# ── the documented `exit 1` branch is reachable again ─────────────────


def test_authenticate_bib_step7_exit_1_branch_is_reachable(tmp_path):
    """`/library/authenticate-bib` step 7 documents an `exit 1` for "no
    catalog row for this citekey (a reference-only entry … the F#4 gate never
    minted one)". Pre-443 the `_sync_catalog_entry_from_master` call three
    lines above it had just minted that row, so the branch could never fire —
    a documented branch the same step made unreachable."""
    lib = _init_library(tmp_path)
    _seed_master(lib, "refonly", state="unverified")
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("authenticated"))
    patch = tmp_path / "patch.json"
    patch.write_text(json.dumps({"indexed": {"warnings": []}}))
    proc = subprocess.run(
        [sys.executable, str(Path(_SCRIPTS) / "update_catalog_entry.py"),
         "refonly", "--patch-file", str(patch),
         "--recompute-warning-kind", "bib-coherence"],
        cwd=str(lib), capture_output=True, text=True,
    )
    assert proc.returncode == 1, (proc.returncode, proc.stdout, proc.stderr)


# ── the re-assert is free ─────────────────────────────────────────────


def test_master_write_is_skipped_when_the_block_is_byte_identical(tmp_path):
    """The door re-asserts the comment once per refused row. On a 500-entry
    `.bib` import that is 500 rewrites of a ~10 MB file for no change at all,
    so `update_master_bib_entry` must skip a byte-identical replacement."""
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    path = lib / "master.bib"
    before = path.read_text()
    stamp = path.stat().st_mtime_ns
    update_master_bib_entry(lib, "refonly", "article", fields,
                            bib_state="unverified")
    assert path.read_text() == before
    assert path.stat().st_mtime_ns == stamp, "a no-op re-assert rewrote master.bib"
    # …and a real change still lands.
    update_master_bib_entry(lib, "refonly", "article", fields,
                            bib_state="authenticated")
    assert _states(lib).get("refonly") == "authenticated"


# ── the source-resolution fork index_paper used to keep ───────────────


def test_index_paper_resolves_a_source_under_either_normalization(tmp_path):
    """`index_paper` kept a private copy of the `resolve_paper_source` loop
    that looked only under the caller's spelling of the citekey. A folder on
    disk under the other Unicode normalization was reported as "no source"
    for a paper that is right there (the 1976-Tichy memo class)."""
    lib = _init_library(tmp_path)
    nfd = unicodedata.normalize("NFD", "tichý1976")
    nfc = unicodedata.normalize("NFC", "tichý1976")
    assert nfd != nfc
    _make_holding(lib, nfd)
    resolved = resolve_paper_source(lib, nfc)
    assert resolved is not None, "the SSOT must find the NFD folder from NFC"
    assert resolved[1] == "pdf"


# ── the two sibling writers still behave ──────────────────────────────


def test_merge_reference_only_still_mints_no_row(tmp_path):
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    mpr._upsert_catalog_row(
        lib, "refonly", _bib_status("authenticated"),
        master_entry={"type": "article", "fields": fields},
    )
    assert _rows(lib) == []
    assert _states(lib).get("refonly") == "authenticated"


def test_triage_bib_only_still_mints_no_row(tmp_path):
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    ta._upsert_catalog_row_bib_only(
        lib, "refonly", "article", fields, bib_state="unverified")
    assert _rows(lib) == []
    assert _states(lib).get("refonly") == "unverified"


# ── THE CENSUS ────────────────────────────────────────────────────────
#
# The gate was never the part that could misbehave — a writer that never asks
# it is, and `upsert_catalog_entry(catalog, citekey, **fields)` runs perfectly
# while appending a row F#4 refuses. So: every shipped script outside
# `_tools.py` that can MINT a catalog row must ASK, inside the same
# declaration, in the one holdings vocabulary.
#
# Three accepted spellings, because they are three names for one question:
#   `admit_catalog_row`   — the door (ask + discharge), what a writer wants;
#   `paper_has_holdings`  — the bare gate the door is built on;
#   `resolve_paper_source`— the probe `paper_has_holdings` is derived from. A
#                           declaration that has resolved a real source has
#                           given a STRICTLY STRONGER answer than the boolean
#                           (this is `index_paper`'s main pipeline: it cannot
#                           reach the catalog write without a file on disk).
#
# The allowlist is EMPTY and stays that way — a hit is ASK-it, never list-it.

_GATE_VOCABULARY = ("admit_catalog_row", "paper_has_holdings",
                    "resolve_paper_source")

_MINT_ALLOWED: dict[str, str] = {}

# What "mints a catalog row" looks like. Two shapes, because the three
# writers do not share one:
#   * `upsert_catalog_entry(` — the shared writer, whose no-match branch
#     APPENDS (this is the call the third writer made unconditionally); and
#   * an append onto the CATALOG — `triage_apply` hand-rolls its row and
#     appends it directly, so a needle that saw only the shared writer would
#     be blind to the one writer that does not use it.
# The append needle is anchored on the receiver naming `catalog`, not on the
# bare word `entries`: five unrelated scripts build lists called `entries`
# (bib entries, TOC entries, reference entries) and a bare needle indicts
# every one of them, which is a census answering a different question.
_MINT_CALL = re.compile(
    r"""upsert_catalog_entry\s*\(|\bcatalog\b[^\n]*\.append\s*\("""
)


def _shipped_scripts() -> list[Path]:
    root = Path(_SCRIPTS)
    return sorted(p for p in root.glob("*.py") if not p.name.startswith("test_"))


def _blank_docstrings(text: str, tree: ast.AST) -> list[str]:
    """`text`'s lines with every DOCSTRING blanked.

    A docstring is prose, and prose naming the gate must not exonerate the
    code beneath it — which is not hypothetical: the pre-443
    `_sync_catalog_entry_from_master` fix was measured by neutering its gate
    call, and the census kept passing because the docstring left above it
    still said `admit_catalog_row`. That is the exact "a comment describing a
    retired mechanism is how the next reader concludes the invariant is held"
    shape, one level up, in the guard that exists to prevent it.

    String literals elsewhere are deliberately KEPT: `triage_apply` mints its
    row through `catalog["entries"].append(...)`, whose quoted key is the
    needle itself.
    """
    lines = text.splitlines()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if not (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            continue
        for i in range(first.lineno - 1, (first.end_lineno or first.lineno)):
            if 0 <= i < len(lines):
                lines[i] = ""
    return lines


def _declaration_ranges(tree: ast.AST) -> list[tuple[str, int, int]]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append((node.name, node.lineno, node.end_lineno or node.lineno))
    return out


def _ungated_mint_sites(text: str) -> list[str]:
    """Names of declarations that mint a catalog row without asking the gate.

    Read through `ast`, not a line window: the ask and the mint are routinely
    thirty lines apart (`merge_paper_references._upsert_catalog_row` asks at
    the top and writes at the bottom), and a window tight enough to be
    meaningful would miss every one of them.
    """
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    lines = _blank_docstrings(text, ast.parse(text))
    decls = _declaration_ranges(tree)
    offenders: list[str] = []
    for name, start, end in decls:
        body = "\n".join(lines[start - 1:end])
        # Only the INNERMOST declaration counts, or an outer function would
        # be indicted for a nested one's mint (and vice versa, exonerated by
        # a nested one's ask).
        inner = [
            (n2, s2, e2) for (n2, s2, e2) in decls
            if (s2, e2) != (start, end) and s2 >= start and e2 <= end
        ]
        for _n2, s2, e2 in inner:
            body = body.replace("\n".join(lines[s2 - 1:e2]), "")
        body = "\n".join(
            "" if ln.strip().startswith("#") else ln for ln in body.splitlines()
        )
        if not _MINT_CALL.search(body):
            continue
        if any(v in body for v in _GATE_VOCABULARY):
            continue
        offenders.append(name)
    return offenders


def test_census_no_writer_mints_a_catalog_row_without_asking_the_gate():
    offenders: list[str] = []
    for p in _shipped_scripts():
        if p.name == "_tools.py" or p.name in _MINT_ALLOWED:
            continue
        offenders += [f"{p.name}::{n}" for n in _ungated_mint_sites(p.read_text())]
    assert offenders == [], (
        "these declarations mint a catalog row without asking the F#4 "
        f"holdings gate (admit_catalog_row): {offenders}"
    )


def test_census_canary_detects_an_ungated_mint():
    """A census that matches nothing passes for the wrong reason — and this
    canary stands on SYNTHETIC source, never on a line the fix drained."""
    ungated_shared = (
        "def w(library, citekey, fields):\n"
        "    with lock_catalog(library):\n"
        "        catalog = read_catalog(library)\n"
        "        upsert_catalog_entry(catalog, citekey, **fields)\n"
        "        write_catalog(library, catalog)\n"
    )
    assert _ungated_mint_sites(ungated_shared) == ["w"]
    # the hand-rolled append form (triage_apply's shape)
    ungated_append = (
        "def w(library, citekey, row):\n"
        '    catalog["entries"].append(row)\n'
    )
    assert _ungated_mint_sites(ungated_append) == ["w"]
    # …and an unrelated list called `entries` is NOT a catalog mint
    unrelated = (
        "def w(text):\n"
        "    entries = []\n"
        "    for block in text.split():\n"
        "        entries.append(block)\n"
        "    return entries\n"
    )
    assert _ungated_mint_sites(unrelated) == []
    # each accepted spelling exonerates
    for verb in _GATE_VOCABULARY:
        gated = (
            "def w(library, citekey, fields):\n"
            f"    if not {verb}(library, citekey):\n"
            "        return\n"
            "    upsert_catalog_entry(catalog, citekey, **fields)\n"
        )
        assert _ungated_mint_sites(gated) == [], verb
    # a whole-line comment naming the gate does not exonerate
    commented = (
        "def w(library, citekey, fields):\n"
        "    # admit_catalog_row is asked by the caller, honest\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n"
    )
    assert _ungated_mint_sites(commented) == ["w"]
    # …and neither does a DOCSTRING naming it. This one is not hypothetical:
    # the pre-443 defect was measured by neutering the gate CALL, and the
    # census kept passing off the docstring left standing above it.
    docstringed = (
        "def w(library, citekey, fields):\n"
        '    """Sync the row.\n'
        "\n"
        "    `admit_catalog_row` is the F#4 gate; a reference-only entry\n"
        "    mints no row.\n"
        '    """\n'
        "    upsert_catalog_entry(catalog, citekey, **fields)\n"
    )
    assert _ungated_mint_sites(docstringed) == ["w"]
    # a MODULE docstring naming it must not exonerate either
    module_doc = (
        '"""admit_catalog_row is the gate."""\n'
        "def w(library, citekey, fields):\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n"
    )
    assert _ungated_mint_sites(module_doc) == ["w"]
    # a nested declaration's ask must not exonerate its parent's mint
    nested = (
        "def outer(library, citekey, fields):\n"
        "    def inner():\n"
        "        return admit_catalog_row(library, citekey)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n"
    )
    assert _ungated_mint_sites(nested) == ["outer"]


def test_census_sees_the_four_real_mint_sites():
    """A needle that has stopped matching the production writers would pass
    the census vacuously. Pin that all four are still IN the population."""
    found = []
    for p in _shipped_scripts():
        if p.name == "_tools.py":
            continue
        text = p.read_text()
        try:
            tree = ast.parse(text)
        except SyntaxError:
            continue
        lines = text.splitlines()
        for name, start, end in _declaration_ranges(tree):
            body = "\n".join(lines[start - 1:end])
            if _MINT_CALL.search(body):
                found.append(f"{p.name}::{name}")
    for expected in (
        "index_paper.py::_sync_catalog_entry_from_master",
        "index_paper.py::index_paper",
        "merge_paper_references.py::_upsert_catalog_row",
        "triage_apply.py::_upsert_catalog_row_bib_only",
    ):
        assert expected in found, (expected, found)


def test_census_allowlist_is_empty():
    """A hit is ASK-it, never list-it. An allowlist here would be a standing
    licence for the next writer to skip the gate."""
    assert _MINT_ALLOWED == {}


def _run_standalone() -> int:
    import tempfile
    import traceback

    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
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
