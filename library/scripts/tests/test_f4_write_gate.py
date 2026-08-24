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


def test_sync_from_master_refreshes_a_stale_reference_row_without_minting(tmp_path):
    """A pre-F#4 row for a fileless citekey must be REFRESHED, not frozen.

    RENEGOTIATED: the first cut of task 443 asserted the row "simply does not
    move", on the reasoning that `prune_catalog_present_false` owns the
    migration that removes it. Both halves of that were wrong. `LibraryView`
    suppresses its bib-index-backed synthetic row for any citekey the catalog
    already names, so a stale row does not sit harmlessly beside the live
    projection — it SHADOWS it, and the user keeps seeing the frozen state and
    title indefinitely; and nothing in the shipped flow ever invokes the
    prune. The pre-443 code refreshed such a row (through `upsert_catalog_entry`'s
    existing-row branch) and `triage_apply` kept the behaviour by hand, so this
    writer was the one that would have lost it.
    """
    lib = _init_library(tmp_path)
    _seed_master(lib, "refonly", state="unverified")
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "refonly", "title": "Old Stale Title",
         "pdf": {"present": False}, "indexed": {"state": "none"},
         "bib": {"state": "unverified", "fieldChanges": [{"field": "year"}]}},
    ]})
    ip._sync_catalog_entry_from_master(lib, "refonly", _bib_status("authenticated"))
    rows = _rows(lib)
    assert len(rows) == 1, "the gate must never MINT a second row"
    assert rows[0]["bib"]["state"] == "authenticated"
    assert rows[0]["title"] == "A Work", "the top-level fields must not freeze"
    # …and the row's own history accumulates rather than being replaced.
    assert [c.get("field") for c in rows[0]["bib"]["fieldChanges"]] == ["year"]
    # The holdings blocks are NOT clobbered by the refresh.
    assert rows[0]["pdf"] == {"present": False}
    assert rows[0]["indexed"] == {"state": "none"}
    assert _states(lib).get("refonly") == "authenticated"


def test_triage_refreshes_a_stale_reference_row_through_the_same_door(tmp_path):
    """The exception used to be hand-written in `triage_apply` and nowhere
    else — which is exactly how the third writer came to lose it. It is the
    door's now, so all three writers keep it."""
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    write_catalog(lib, {"version": 1, "entries": [
        {"citekey": "refonly", "pdf": {"present": False},
         "indexed": {"state": "none"},
         "bib": {"state": "none", "fieldChanges": [{"field": "title"}]}},
    ]})
    ta._upsert_catalog_row_bib_only(
        lib, "refonly", "article", fields, bib_state="unverified",
        field_changes=[{"field": "year"}])
    rows = _rows(lib)
    assert len(rows) == 1
    assert rows[0]["bib"]["state"] == "unverified"
    assert [c["field"] for c in rows[0]["bib"]["fieldChanges"]] == ["title", "year"]


def test_door_refresh_never_mints(tmp_path):
    """The refresh arm may only touch a row that is already there."""
    lib = _init_library(tmp_path)
    fields = _seed_master(lib, "refonly", state="unverified")
    assert admit_catalog_row(
        lib, "refonly", entry_type="article", fields=fields,
        bib_state="authenticated", bib=_bib_status("authenticated"),
        top={"title": "A Work"}) is False
    assert _rows(lib) == []


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


# ── the writer's extent rule now agrees with the reader's ─────────────


def test_writer_refuses_an_unbalanced_entry_instead_of_eating_its_neighbours(tmp_path):
    """`read_master_bib` CAPS its brace walk at the next entry opener "so one
    bad entry can't swallow the rest"; `update_master_bib_entry` did not, so
    it walked to EOF and the splice replaced every FOLLOWING entry with one
    emitted block. Task 443 made `/library/authenticate-bib` step 7 a
    master.bib writer for the first time, which gave that a high-volume
    reacher — once per entry of every `.bib` import."""
    lib = _init_library(tmp_path)
    (lib / "master.bib").write_text(
        "% bib.state = unverified\n"
        "@article{k1,\n"
        "  title = {A {half-open note},\n"
        "  year = {2001}\n"
        "}\n"
        "\n"
        "@book{k2,\n"
        "  title = {Survivor},\n"
        "  author = {B}\n"
        "}\n"
    )
    before = (lib / "master.bib").read_text()
    # The READER reports both — which is the whole point: the file looks fine.
    from _tools import read_master_bib, BibEntryUnbalanced
    assert set(read_master_bib(lib / "master.bib")) == {"k1", "k2"}
    try:
        ip._sync_catalog_entry_from_master(lib, "k1", _bib_status("authenticated"))
    except BibEntryUnbalanced as e:
        assert "k1" in str(e)
    else:
        raise AssertionError("the writer must refuse an entry it cannot delimit")
    assert (lib / "master.bib").read_text() == before, (
        "a refusal leaves the file exactly as it was")
    assert "@book{k2," in (lib / "master.bib").read_text()


def test_writer_still_rewrites_a_balanced_entry_holding_a_column_zero_at(tmp_path):
    """CONTROL for the pass ORDER. The uncapped pass must run FIRST, or an
    entry whose value contains a column-0 `@type{...}` — a `note = {@article{
    x, ...}}` — is capped at that false opener and loses its later fields."""
    lib = _init_library(tmp_path)
    (lib / "master.bib").write_text(
        "@article{k1,\n"
        "  note = {see\n"
        "@article{other, title = {X}}\n"
        "},\n"
        "  year = {2001}\n"
        "}\n"
    )
    from _tools import read_master_bib
    got = read_master_bib(lib / "master.bib")
    assert "year" in got["k1"]["fields"], "the uncapped pass must run first"
    update_master_bib_entry(lib, "k1", "article", got["k1"]["fields"],
                            bib_state="authenticated")
    assert _states(lib).get("k1") == "authenticated"


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
# while appending a row F#4 refuses. So: every declaration in a shipped script
# that can MINT a catalog row must ASK, inside that same declaration, in the
# one holdings vocabulary.
#
# Two accepted spellings, because they are two names for one question:
#   `admit_catalog_row`   — the door (ask + discharge + refresh-never-mint);
#   `paper_has_holdings`  — the bare gate the door is built on.
# `resolve_paper_source` is deliberately NOT one: it ANSWERS the question but
# does not gate on it, so a declaration that resolves a source, logs it and
# mints anyway would be exonerated. `index_paper`'s main pipeline therefore
# asks the door outright rather than leaning on having resolved a file.
#
# The allowlist is EMPTY and stays that way — a hit is ASK-it, never list-it.

_GATE_VOCABULARY = ("admit_catalog_row", "paper_has_holdings")

_MINT_ALLOWED: dict[str, str] = {}

# The writers that own the mint, exempt BY NAME rather than by file: `_tools.py`
# is in the population like everything else, so a NEW `_tools` helper that
# mints without asking is censused. Excluding the module wholesale — the first
# cut of this census — would have been invisible twice over, since a caller of
# such a helper spells no needle either, and relocating a mint into `_tools` is
# the likeliest next refactor (task 443 itself put the door there).
_TOOLS_MINT_OWNERS = {
    "upsert_catalog_entry": "the shared writer whose no-match branch appends; "
                            "it is what every gated caller mints THROUGH",
}


def _shipped_scripts() -> list[Path]:
    """Every shipped `.py` under library/scripts/, RECURSIVELY.

    `glob("*.py")` — the first cut — is top-level only, so a script in a
    subdirectory (there is one today) sat outside a population the doctrine
    described as "every shipped script".
    """
    root = Path(_SCRIPTS)
    return sorted(
        p for p in root.rglob("*.py")
        if not p.name.startswith("test_") and "/tests/" not in p.as_posix()
    )


def _import_aliases(tree: ast.AST) -> set[str]:
    """Local names bound to `upsert_catalog_entry`, alias included.

    A literal-name needle is defeated by `from _tools import
    upsert_catalog_entry as _upsert`, and aliased imports are an established
    idiom in this silo (`import work_identity as wi`).
    """
    names = {"upsert_catalog_entry"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                if a.name == "upsert_catalog_entry" and a.asname:
                    names.add(a.asname)
    return names


def _is_entries_expr(node: ast.AST) -> bool:
    """Does this expression denote the catalog's `entries` LIST?

    Three spellings, all live in this codebase:
      `catalog["entries"]`, `catalog.setdefault("entries", [])`,
      `catalog.get("entries", [])`.
    """
    if (isinstance(node, ast.Subscript)
            and isinstance(node.slice, ast.Constant)
            and node.slice.value == "entries"):
        return True
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("setdefault", "get") and node.args
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == "entries"):
        return True
    return False


class _MintFinder(ast.NodeVisitor):
    """Does this statement list MINT a catalog row?

    Read through `ast` with local dataflow, not a regex, because the shapes a
    writer actually takes are not one line — and because the loose reading
    ("an append inside a declaration that touches the catalog") is worthless
    in the other direction: measured, it indicts ten shipped READERS that walk
    the catalog and append to a report list.

    Four shapes, each a real spelling here or one line from one:
      1. a call to `upsert_catalog_entry` (or a LOCAL ALIAS of it);
      2. `.append(...)` onto the entries LIST — the receiver written out
         (`catalog["entries"].append(row)`, triage_apply's pre-443 shape) OR
         a local bound from it first (`rows = catalog.setdefault("entries",
         []); rows.append(row)` — the idiom `upsert_catalog_entry` itself
         uses, and invisible to any one-line needle);
      3. an assignment to an `["entries"]` subscript whose RHS ADDS an element
         — a mint with no `append` in it at all. The "adds" half is
         load-bearing: the same assignment is how a row is REMOVED
         (`catalog["entries"] = [e for e in ... if not drop]`), and the two
         live shipped removers (`dedup._apply_catalog`,
         `repair_etal_citekeys.apply_merge_duplicate`) would otherwise be
         indicted for shrinking the catalog. Stated limit: "adds" is read
         syntactically — a concatenation with a list, or a display holding an
         element beside a `*spread` — so a mint routed through a helper that
         returns the grown list reads as a plain rebind and is missed. Shapes
         1, 2 and 4 remain the ones a real writer takes;
      4. `write_catalog(..., {..., "entries": ...})` — likewise.
    """

    def __init__(self, aliases: set[str]):
        self.aliases = aliases
        self.mints = False
        self._entries_locals: set[str] = set()

    def _receiver_is_entries(self, node: ast.AST) -> bool:
        if _is_entries_expr(node):
            return True
        return isinstance(node, ast.Name) and node.id in self._entries_locals

    @staticmethod
    def _adds_an_element(value: ast.AST) -> bool:
        if isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add):
            return any(isinstance(s, ast.List) and s.elts
                       for s in (value.left, value.right))
        if isinstance(value, ast.List):
            return (any(isinstance(e, ast.Starred) for e in value.elts)
                    and any(not isinstance(e, ast.Starred) for e in value.elts))
        return False

    def visit_Assign(self, node: ast.Assign) -> None:
        for tgt in node.targets:
            if (isinstance(tgt, ast.Subscript)
                    and isinstance(tgt.slice, ast.Constant)
                    and tgt.slice.value == "entries"
                    and self._adds_an_element(node.value)):
                self.mints = True
            if isinstance(tgt, ast.Name) and _is_entries_expr(node.value):
                self._entries_locals.add(tgt.id)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        f = node.func
        if isinstance(f, ast.Name) and f.id in self.aliases:
            self.mints = True
        if isinstance(f, ast.Attribute):
            if f.attr in self.aliases:
                self.mints = True
            if f.attr == "append" and self._receiver_is_entries(f.value):
                self.mints = True
        if isinstance(f, ast.Name) and f.id == "write_catalog":
            for arg in node.args:
                if isinstance(arg, ast.Dict) and any(
                    isinstance(k, ast.Constant) and k.value == "entries"
                    for k in arg.keys
                ):
                    self.mints = True
        self.generic_visit(node)

    def verdict(self) -> bool:
        return self.mints


def _decl_units(tree: ast.Module) -> list[tuple[str, list]]:
    """(name, own statements) per declaration, plus MODULE scope.

    Module scope is a unit because a mint outside any function — at import
    time, or inside the `if __name__ == "__main__":` block every shipped
    script has — is a mint like any other and the first cut never examined it.
    Statements belonging to a NESTED declaration are excluded from its
    parent's unit, so a nested function's ask cannot exonerate its parent's
    mint (and vice versa).
    """
    units: list[tuple[str, list]] = []
    decls = [n for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for d in decls:
        inner = [c for c in ast.walk(d)
                 if isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef)) and c is not d]
        own = [s for s in d.body if s not in inner]
        units.append((d.name, own))
    top = [s for s in tree.body
           if not isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    if top:
        units.append(("<module>", top))
    return units


def _asks_gate(nodes: list, source_lines: list[str]) -> bool:
    """Is a gate spelled as CODE in these statements?

    String literals are blanked for this half: a log line or an error message
    naming `paper_has_holdings` is prose, and prose must not exonerate. The
    MINT half keeps literals, because `catalog["entries"]` is a quoted key
    (the `_source-scan` two-views rule).
    """
    for n in nodes:
        for sub in ast.walk(n):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                continue
            if isinstance(sub, ast.Name) and sub.id in _GATE_VOCABULARY:
                return True
            if isinstance(sub, ast.Attribute) and sub.attr in _GATE_VOCABULARY:
                return True
    return False


def _ungated_mint_sites(text: str) -> list[str]:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    aliases = _import_aliases(tree)
    lines = text.splitlines()
    offenders: list[str] = []
    for name, nodes in _decl_units(tree):
        if name in _TOOLS_MINT_OWNERS:
            continue
        finder = _MintFinder(aliases)
        for n in nodes:
            finder.visit(n)
        if not finder.verdict():
            continue
        if _asks_gate(nodes, lines):
            continue
        offenders.append(name)
    return sorted(offenders)


def test_census_no_writer_mints_a_catalog_row_without_asking_the_gate():
    offenders: list[str] = []
    for p in _shipped_scripts():
        if p.name in _MINT_ALLOWED:
            continue
        offenders += [f"{p.name}::{n}" for n in _ungated_mint_sites(p.read_text())]
    assert offenders == [], (
        "these declarations mint a catalog row without asking the F#4 "
        f"holdings gate (admit_catalog_row): {offenders}"
    )


def test_census_canary_detects_an_ungated_mint():
    """A census that matches nothing passes for the wrong reason — and every
    canary here stands on SYNTHETIC source, never on a line the fix drained.

    The shapes below are the ones an adversarial pass on task 443's FIRST cut
    slipped past: nine realistic ungated writers, all reported clean.
    """
    def one(src): return _ungated_mint_sites(src)

    # 1. the shared writer, one line
    assert one(
        "def w(library, citekey, fields):\n"
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n"
        "    write_catalog(library, catalog)\n") == ["w"]
    # 2. an ALIASED import of it
    assert one(
        "from _tools import upsert_catalog_entry as _up\n"
        "def w(library, citekey, fields):\n"
        "    catalog = read_catalog(library)\n"
        "    _up(catalog, citekey, **fields)\n") == ["w"]
    # 3. the hand-rolled append, one line (triage_apply's pre-443 shape)
    assert one(
        "def w(library, citekey, row):\n"
        "    catalog = read_catalog(library)\n"
        '    catalog["entries"].append(row)\n'
        "    write_catalog(library, catalog)\n") == ["w"]
    # 4. …the SAME writer with the list bound to a local first — the idiom
    #    `upsert_catalog_entry` itself uses, and invisible to a one-line needle
    assert one(
        "def w(library, citekey, row):\n"
        "    catalog = read_catalog(library)\n"
        '    rows = catalog.setdefault("entries", [])\n'
        "    rows.append(row)\n"
        "    write_catalog(library, catalog)\n") == ["w"]
    # 5. a mint with no `append` at all — assigning the entries list
    assert one(
        "def w(library, citekey, row):\n"
        "    catalog = read_catalog(library)\n"
        '    catalog["entries"] = list(catalog.get("entries", [])) + [row]\n'
        "    write_catalog(library, catalog)\n") == ["w"]
    # 5b. …but the same assignment REMOVING rows is not a mint. Both live
    #     shipped removers (`dedup`, `repair_etal_citekeys`) take this shape.
    assert one(
        "def w(library, drop):\n"
        "    catalog = read_catalog(library)\n"
        '    catalog["entries"] = [e for e in catalog.get("entries", []) '
        'if e["citekey"] not in drop]\n'
        "    write_catalog(library, catalog)\n") == []
    # 6. …or handing write_catalog a freshly built dict
    assert one(
        "def w(library, rows):\n"
        '    write_catalog(library, {"version": 1, "entries": rows})\n') == ["w"]
    # 7. module scope / the __main__ block every shipped script has
    assert one(
        "def main(argv):\n"
        "    return argv\n"
        'if __name__ == "__main__":\n'
        "    catalog = read_catalog(LIB)\n"
        "    upsert_catalog_entry(catalog, CITEKEY, **FIELDS)\n") == ["<module>"]
    # 8. a nested declaration's ask must not exonerate its parent's mint
    assert one(
        "def outer(library, citekey, fields):\n"
        "    def inner():\n"
        "        return admit_catalog_row(library, citekey)\n"
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n") == ["outer"]
    # 9. a gate word inside a STRING is prose, and prose does not exonerate
    assert one(
        "def w(library, citekey, fields):\n"
        '    raise ValueError("caller must run paper_has_holdings first")\n'
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n") == ["w"]
    # 10. …nor does a docstring. (Not hypothetical: task 443's own first
    #     neuter run passed the census off the docstring left standing above
    #     the removed gate call.)
    assert one(
        "def w(library, citekey, fields):\n"
        '    """`admit_catalog_row` is the F#4 gate."""\n'
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n") == ["w"]
    # 11. …nor a module docstring
    assert one(
        '"""admit_catalog_row is the gate."""\n'
        "def w(library, citekey, fields):\n"
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n") == ["w"]

    # Each accepted spelling exonerates.
    for verb in _GATE_VOCABULARY:
        assert one(
            "def w(library, citekey, fields):\n"
            f"    if not {verb}(library, citekey):\n"
            "        return\n"
            "    catalog = read_catalog(library)\n"
            "    upsert_catalog_entry(catalog, citekey, **fields)\n") == [], verb
    # `resolve_paper_source` does NOT: it answers the question without gating
    # on the answer, so a declaration that logs it and mints anyway is a
    # false exoneration.
    assert one(
        "def w(library, citekey, fields):\n"
        "    src = resolve_paper_source(library, citekey)\n"
        '    log(f"source={src}")\n'
        "    catalog = read_catalog(library)\n"
        "    upsert_catalog_entry(catalog, citekey, **fields)\n") == ["w"]

    # FALSE POSITIVES — measured, not assumed. A reader that walks the catalog
    # and appends to an unrelated list mints nothing; the loose reading of
    # shape 2 ("an append anywhere in a declaration that touches the catalog")
    # indicts TEN shipped readers, which is a census answering a different
    # question. `merge_bibs_postflight` is that live shape.
    assert one(
        "def w(library, alerts):\n"
        "    catalog = read_catalog(library)\n"
        '    for r in catalog["state_regressions"]:\n'
        "        alerts.append(r)\n") == []
    assert one(
        "def w(text, out):\n"
        "    for block in text.split():\n"
        "        out.append(block)\n") == []
    # …and an append onto a list bound from something that is NOT `entries`
    # is not a mint either.
    assert one(
        "def w(library, out):\n"
        "    catalog = read_catalog(library)\n"
        '    rows = catalog.setdefault("warnings", [])\n'
        "    rows.append(1)\n") == []


def test_census_sees_the_four_real_mint_sites():
    """A needle that has stopped matching the production writers would pass
    the census vacuously. Pin that all four are still IN the population."""
    found = []
    for p in _shipped_scripts():
        try:
            tree = ast.parse(p.read_text())
        except SyntaxError:
            continue
        aliases = _import_aliases(tree)
        for name, nodes in _decl_units(tree):
            finder = _MintFinder(aliases)
            for n in nodes:
                finder.visit(n)
            if finder.verdict():
                found.append(f"{p.name}::{name}")
    for expected in (
        "index_paper.py::_sync_catalog_entry_from_master",
        "index_paper.py::index_paper",
        "merge_paper_references.py::_upsert_catalog_row",
        "triage_apply.py::_upsert_catalog_row_bib_only",
    ):
        assert expected in found, (expected, found)


def test_census_door_itself_mints_nothing():
    """`admit_catalog_row` is NOT on the exemption list, and does not need to
    be: its refresh arm touches only a row that already exists. If it ever
    starts minting, the census indicts it like any other writer — which is the
    point of censusing `_tools.py` rather than skipping it."""
    src = (Path(_SCRIPTS) / "_tools.py").read_text()
    tree = ast.parse(src)
    aliases = _import_aliases(tree)
    hit = [nodes for name, nodes in _decl_units(tree) if name == "admit_catalog_row"]
    assert hit, "the door is gone"
    finder = _MintFinder(aliases)
    for n in hit[0]:
        finder.visit(n)
    assert finder.verdict() is False
    assert "admit_catalog_row" not in _TOOLS_MINT_OWNERS


def test_census_population_reaches_subdirectories_and_tools():
    """Two scope holes the first cut had: a non-recursive glob (so a script in
    a subdirectory was unpoliced while the doctrine said otherwise), and
    skipping `_tools.py` wholesale (so a mint RELOCATED there — the likeliest
    next refactor — was invisible on both sides)."""
    names = {p.as_posix() for p in _shipped_scripts()}
    assert any(p.endswith("/_tools.py") for p in names), "_tools.py is censused"
    assert any(p.count("/scripts/") and p.rsplit("/scripts/", 1)[1].count("/")
               for p in names), "the population reaches subdirectories"


def test_census_tools_exemptions_are_per_name_and_still_own_a_mint():
    """A stale exemption is a standing licence for the next private mint."""
    src = (Path(_SCRIPTS) / "_tools.py").read_text()
    tree = ast.parse(src)
    aliases = _import_aliases(tree)
    for owner in _TOOLS_MINT_OWNERS:
        hit = [nodes for name, nodes in _decl_units(tree) if name == owner]
        assert hit, f"exempted owner is gone: {owner}"
        finder = _MintFinder(aliases)
        for n in hit[0]:
            finder.visit(n)
        assert finder.verdict(), (
            f"{owner} no longer mints — drop its exemption")


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
