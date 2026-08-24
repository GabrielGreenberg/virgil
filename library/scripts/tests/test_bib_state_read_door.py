"""F#4 READ-side contract: the auth-state HOME is master.bib's `% bib.state`.

Task 442. F#4 (485be521) moved a *fileless* reference's authentication state
out of catalog.json and into a `% bib.state = <state>` comment on its
master.bib entry. The WRITERS migrated and the TypeScript reader migrated;
the Python readers kept asking the catalog, which for a fileless entry can
only answer "none".

These legs drive the REAL readers over a fixture library whose authenticated
entry has NO catalog row — the shape every pre-442 fixture in the repo lacks,
which is why the defect was unrepresentable in all of them. Each `test_*`
below whose name carries `fileless` fails on the pre-442 tree; the `held_`
controls (a real holding, catalog row present) pass either way and are what
proves the catalog fallback still works.

Run: python3 -m pytest library/scripts/tests/test_bib_state_read_door.py -v
"""
import json
import re
import sys
from pathlib import Path

_SCRIPTS = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _SCRIPTS)

import merge_paper_references as mpr  # noqa: E402
import triage_apply as ta  # noqa: E402
import triage_batch as tb  # noqa: E402
import dedup_index  # noqa: E402
from _tools import (  # noqa: E402
    lock_catalog,
    master_bib_state_map,
    read_catalog,
    resolve_bib_state,
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


AUTH_FIELDS = {
    "title": "The Authenticated Work",
    "author": "Reader, R.",
    "year": "1999",
    "journal": "Journal of Reading",
}


def _seed_authenticated_fileless(library: Path, citekey: str = "auth1999work") -> str:
    """A master entry carrying `% bib.state = authenticated` and NO catalog row."""
    update_master_bib_entry(library, citekey, "article", dict(AUTH_FIELDS),
                            bib_state="authenticated")
    assert citekey not in {e.get("citekey") for e in read_catalog(library).get("entries", [])}
    return citekey


def _seed_authenticated_held(library: Path, citekey: str = "held1999work") -> str:
    """The CONTROL: same entry, but held on disk with a legacy catalog row
    carrying the state. Exercises the fallback arm."""
    _make_holding(library, citekey)
    update_master_bib_entry(library, citekey, "article", dict(AUTH_FIELDS),
                            bib_state="authenticated")
    cat = read_catalog(library)
    cat.setdefault("entries", []).append({
        "citekey": citekey, "title": AUTH_FIELDS["title"], "authors": ["Reader, R."],
        "year": 1999,
        "pdf": {"present": True, "filename": f"{citekey}.pdf"},
        "indexed": {"state": "indexed"},
        "bib": {"state": "authenticated"},
    })
    with lock_catalog(library):
        write_catalog(library, cat)
    return citekey


def _write_paper_refs(library: Path, paper: str, citekey: str) -> None:
    d = library / "papers" / paper
    d.mkdir(parents=True, exist_ok=True)
    (d / "references.bib").write_text(
        f"@article{{{citekey},\n"
        f"  title = {{{AUTH_FIELDS['title']}}},\n"
        f"  author = {{{AUTH_FIELDS['author']}}},\n"
        f"  year = {{{AUTH_FIELDS['year']}}},\n"
        f"}}\n"
    )


def _bib_row(citekey: str, title: str = "Drive-By Title") -> dict:
    return {
        "filename": "drop.bib",
        "extension": "bib",
        "flags": ["bib-only"],
        "proposedCitekey": citekey,
        "proposedType": "article",
        "proposedFields": {"title": title, "author": "Dropper, D.", "year": "2001"},
        "proposedBibState": "unverified",
    }


# ── the door itself ───────────────────────────────────────────────────


def test_door_reads_master_comment_for_a_fileless_entry(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    assert resolve_bib_state(lib, ck) == "authenticated"


def test_door_falls_back_to_a_legacy_catalog_row(tmp_path):
    lib = _init_library(tmp_path)
    # A pre-F#4 holdings row whose state is the ONLY copy — master carries the
    # entry with no comment at all.
    (lib / "master.bib").write_text("@article{legacy,\n  title = {Legacy},\n}\n")
    cat = read_catalog(lib)
    cat.setdefault("entries", []).append(
        {"citekey": "legacy", "bib": {"state": "canonical"}})
    with lock_catalog(lib):
        write_catalog(lib, cat)
    assert resolve_bib_state(lib, "legacy") == "canonical"


def test_door_master_wins_a_disagreement(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    cat = read_catalog(lib)
    cat.setdefault("entries", []).append(
        {"citekey": ck, "bib": {"state": "unverified"}})
    with lock_catalog(lib):
        write_catalog(lib, cat)
    assert resolve_bib_state(lib, ck) == "authenticated"


def test_door_answers_none_when_neither_speaks(tmp_path):
    lib = _init_library(tmp_path)
    assert resolve_bib_state(lib, "nobody") == "none"


def test_door_is_normalization_tolerant(tmp_path):
    lib = _init_library(tmp_path)
    # NFC in master, NFD in the query (the 1976-Tichý class).
    import unicodedata
    nfc = unicodedata.normalize("NFC", "tichý1976")
    nfd = unicodedata.normalize("NFD", "tichý1976")
    assert nfc != nfd
    update_master_bib_entry(lib, nfc, "article", {"title": "T"},
                            bib_state="authenticated")
    assert resolve_bib_state(lib, nfd) == "authenticated"


def test_door_accepts_a_prebuilt_state_map_and_never_reads_disk(tmp_path):
    """The hot-loop form: `master.bib` is ~10MB in the reporting library, so a
    per-citekey read would be the fix's own regression."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    states = master_bib_state_map((lib / "master.bib").read_text())
    # Delete master.bib outright: a door that re-read it would answer "none".
    (lib / "master.bib").unlink()
    assert resolve_bib_state(lib, ck, master_states=states) == "authenticated"


# ── M1 · merge_paper_references defers to a fileless authenticated entry ──


def _run_merge(lib: Path, paper: str, tmp_path: Path) -> dict:
    report_dir = tmp_path / "reports"
    rc = mpr.main([paper, "--library", str(lib), "--dry-run",
                   "--report-dir", str(report_dir)])
    assert rc == 0
    return json.loads((report_dir / f"{paper}.json").read_text())


def test_merge_defers_to_fileless_authenticated_master_entry(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    _make_holding(lib, "citingpaper")
    _write_paper_refs(lib, "citingpaper", ck)
    before = (lib / "master.bib").read_text()

    rep = _run_merge(lib, "citingpaper", tmp_path)

    assert [d["master_entry"] for d in rep["deferred_dup"]] == [ck], rep
    assert rep["unauth_dup_handled"] == [], rep
    assert (lib / "master.bib").read_text() == before


def test_merge_held_authenticated_master_entry_still_defers(tmp_path):
    """CONTROL — the catalog-row path, byte-identical to pre-442 behaviour."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_held(lib)
    _make_holding(lib, "citingpaper")
    _write_paper_refs(lib, "citingpaper", ck)

    rep = _run_merge(lib, "citingpaper", tmp_path)

    assert [d["master_entry"] for d in rep["deferred_dup"]] == [ck], rep


def test_merge_still_collective_auths_a_genuinely_unverified_entry(tmp_path):
    """CONTROL — the door must not turn every duplicate into a deferral."""
    lib = _init_library(tmp_path)
    ck = "unver1999work"
    update_master_bib_entry(lib, ck, "article", dict(AUTH_FIELDS),
                            bib_state="unverified")
    _make_holding(lib, "citingpaper")
    _write_paper_refs(lib, "citingpaper", ck)

    rep = _run_merge(lib, "citingpaper", tmp_path)

    assert rep["deferred_dup"] == [], rep
    assert [d["master_entry"] for d in rep["unauth_dup_handled"]] == [ck], rep


# ── M2 · a .bib drop ignores a fileless authenticated entry ───────────


def test_bib_drop_ignores_fileless_authenticated_entry(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    before = (lib / "master.bib").read_text()

    res = ta.apply_bib_row(_bib_row(ck), lib)

    assert res["status"] == "bib-ignored", res
    assert "authenticated" in res["summary"]
    assert (lib / "master.bib").read_text() == before


def test_bib_drop_ignores_held_authenticated_entry(tmp_path):
    """CONTROL — the catalog-row path."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_held(lib)
    before = (lib / "master.bib").read_text()

    res = ta.apply_bib_row(_bib_row(ck), lib)

    assert res["status"] == "bib-ignored", res
    assert (lib / "master.bib").read_text() == before


def test_bib_drop_still_merges_an_unverified_entry(tmp_path):
    """CONTROL — an unverified entry is still updatable by a drop."""
    lib = _init_library(tmp_path)
    ck = "unver1999work"
    update_master_bib_entry(lib, ck, "article", dict(AUTH_FIELDS),
                            bib_state="unverified")

    res = ta.apply_bib_row(_bib_row(ck), lib)

    assert res["status"] not in ("bib-ignored",), res
    assert "Drive-By Title" in (lib / "master.bib").read_text()


def test_bib_drop_never_downgrades_a_terminal_state(tmp_path):
    """`canonical` is terminal too — it was NOT in the guard's pair, so a drop
    used to replace its fields wholesale and stamp `unverified` over it."""
    lib = _init_library(tmp_path)
    ck = "canon1900work"
    update_master_bib_entry(lib, ck, "book", dict(AUTH_FIELDS),
                            bib_state="canonical")
    before = (lib / "master.bib").read_text()

    res = ta.apply_bib_row(_bib_row(ck), lib)

    assert res["status"] == "bib-ignored", res
    assert (lib / "master.bib").read_text() == before


# ── the belt-and-braces write guard ───────────────────────────────────


def test_write_master_never_downgrades_a_terminal_state(tmp_path):
    """The path `_process_dup_unauth` takes. With the read fixed a terminal
    entry is deferred to and never reaches it — this is the guard for the case
    where it is reached legitimately (a parallel run settled the entry between
    the read and the write)."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)

    mpr._write_master(lib, ck, "article", dict(AUTH_FIELDS, note="added"),
                      state="unverified")

    assert resolve_bib_state(lib, ck) == "authenticated"
    # …and the FIELDS still land — only the state holds.
    assert "added" in (lib / "master.bib").read_text()


def test_write_master_still_writes_a_terminal_state(tmp_path):
    """CONTROL — the guard must not freeze an entry at its first state."""
    lib = _init_library(tmp_path)
    ck = "unver1999work"
    update_master_bib_entry(lib, ck, "article", dict(AUTH_FIELDS),
                            bib_state="unverified")

    mpr._write_master(lib, ck, "article", dict(AUTH_FIELDS), state="authenticated")

    assert resolve_bib_state(lib, ck) == "authenticated"


def test_write_master_still_writes_between_non_terminal_states(tmp_path):
    """CONTROL — `unverified` → `failed` is honest new information."""
    lib = _init_library(tmp_path)
    ck = "unver1999work"
    update_master_bib_entry(lib, ck, "article", dict(AUTH_FIELDS),
                            bib_state="unverified")

    mpr._write_master(lib, ck, "article", dict(AUTH_FIELDS), state="failed")

    assert resolve_bib_state(lib, ck) == "failed"


def test_terminal_state_set_is_spelled_once(tmp_path):
    """The merge defer branch and the drop guard read the SAME set — pre-442
    they were two hand lists and the drop guard was missing `canonical`."""
    from _tools import TERMINAL_BIB_STATES, CANONICAL_BIB_STATES
    assert mpr.TERMINAL_BIB_STATES is TERMINAL_BIB_STATES
    assert TERMINAL_BIB_STATES <= CANONICAL_BIB_STATES
    # `needs-reauth` means "action needed", so it is deliberately NOT terminal.
    assert "needs-reauth" not in TERMINAL_BIB_STATES


# ── M3 · the triage REVIEW row warns ──────────────────────────────────


def test_triage_review_flags_a_fileless_existing_entry(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)
    drop = lib / "unsorted" / "drop.bib"
    drop.parent.mkdir(parents=True, exist_ok=True)
    drop.write_text(f"@article{{{ck},\n  title = {{Drive-By}},\n}}\n")

    rows = tb.triage_bib(drop, lib, read_catalog(lib))

    assert len(rows) == 1
    assert "citekey-exists" in rows[0]["flags"], rows[0]
    assert any("authenticated" in n for n in rows[0]["notes"]), rows[0]


def test_triage_review_flags_a_held_existing_entry(tmp_path):
    """CONTROL — the catalog-row path."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_held(lib)
    drop = lib / "unsorted" / "drop.bib"
    drop.parent.mkdir(parents=True, exist_ok=True)
    drop.write_text(f"@article{{{ck},\n  title = {{Drive-By}},\n}}\n")

    rows = tb.triage_bib(drop, lib, read_catalog(lib))

    assert "citekey-exists" in rows[0]["flags"], rows[0]
    assert any("authenticated" in n for n in rows[0]["notes"]), rows[0]


def test_triage_review_leaves_a_genuinely_new_key_unflagged(tmp_path):
    """CONTROL — the flag must still mean something."""
    lib = _init_library(tmp_path)
    drop = lib / "unsorted" / "drop.bib"
    drop.parent.mkdir(parents=True, exist_ok=True)
    drop.write_text("@article{brandnew2030,\n  title = {New},\n}\n")

    rows = tb.triage_bib(drop, lib, read_catalog(lib))

    assert "citekey-exists" not in rows[0]["flags"], rows[0]


# ── M4 · the dedup survivor vote sees a fileless entry's state ────────


def test_dedup_records_carry_a_fileless_entry_bib_state(tmp_path):
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_fileless(lib)

    recs = dedup_index.load_library_records(lib)
    rec = next(r for r in recs if r["citekey"] == ck)

    assert rec["meta"]["bib_state"] == "authenticated", rec


def test_dedup_records_carry_a_held_entry_bib_state(tmp_path):
    """CONTROL — the catalog-row path."""
    lib = _init_library(tmp_path)
    ck = _seed_authenticated_held(lib)

    recs = dedup_index.load_library_records(lib)
    rec = next(r for r in recs if r["citekey"] == ck)

    assert rec["meta"]["bib_state"] == "authenticated", rec


# ── the census: no reader re-derives the answer ───────────────────────
#
# The door was never the part that could misbehave — a call site that asks the
# CATALOG instead is, and `(e.get("bib") or {}).get("state")` type-checks and
# runs perfectly while answering "none" for 85% of the corpus. Membership is
# DISCOVERED (every shipped script under library/scripts/), and the allowlist
# names the four sites that are entitled to read a catalog row's state, each
# with the reason it is entitled.

_CATALOG_STATE_READ_ALLOWED = {
    # THE DOOR — `resolve_bib_state`'s fallback arm and the one public
    # spelling of it (`catalog_row_bib_state`). The two scripts that legitimately
    # read a row's state (`prune_catalog_present_false`, the F#4 catalog→master
    # migration, and `backfill_auth`, the same repair direction) now call that
    # helper, so they need no exemption at all — which is the point: an
    # allowlist is a standing licence for the next private read.
    "_tools.py": "the resolver itself: master first, catalog row as the "
                 "pre-F#4 fallback",
}


def _shipped_scripts() -> list[Path]:
    root = Path(__file__).resolve().parent.parent
    return sorted(
        p for p in root.glob("*.py")
        if not p.name.startswith("test_")
    )


# Two spellings, because the pre-442 readers used BOTH and a one-shape needle
# would have been blind to three of the four offenders:
#   A — one expression:  `((e.get("bib") or {}).get("state"))` / `row["bib"]["state"]`
#   B — a bound local:   `bib = e.get("bib") or {}`  …  `bib.get("state")`
#       (merge_paper_references, dedup_index and backfill_auth all took this
#       form, split across two lines, where a line-scoped regex sees nothing)
_A_BRACKET = re.compile(r"""\[\s*["']bib["']\s*\]\s*(?:\[|\.get\()\s*["']state["']""")
_A_GET = re.compile(
    r"""\.get\(\s*["']bib["']\s*\)\s*(?:or\s*\{\s*\}\s*)?\)?\s*"""
    r"""(?:\[|\.get\()\s*["']state["']"""
)
# `<name> = <expr>.get("bib")…` / `<name> = <expr>["bib"]`
_B_BIND = re.compile(
    r"""^\s*(\w+)\s*=\s*[^=\n]*?(?:\.get\(\s*["']bib["']\s*\)|\[\s*["']bib["']\s*\])"""
)
_B_WINDOW = 8


def _strip_comments(text: str) -> list[str]:
    """Blank whole-line comments. String literals are KEPT — the needle IS a
    quoted key, so blanking them would erase what the census greps for (the
    `_source-scan` trap the TypeScript censuses record)."""
    return ["" if line.strip().startswith("#") else line
            for line in text.splitlines()]


def _reads_catalog_bib_state(text: str) -> bool:
    lines = _strip_comments(text)
    for i, line in enumerate(lines):
        if _A_BRACKET.search(line) or _A_GET.search(line):
            return True
        m = _B_BIND.match(line)
        if not m:
            continue
        name = m.group(1)
        tail = re.compile(
            rf"""\b{re.escape(name)}\s*(?:\[|\.get\()\s*["']state["']"""
        )
        for follow in lines[i + 1:i + 1 + _B_WINDOW]:
            if tail.search(follow):
                return True
    return False


def test_census_no_script_reads_bib_state_off_a_catalog_row(tmp_path):
    offenders = []
    for p in _shipped_scripts():
        if p.name in _CATALOG_STATE_READ_ALLOWED:
            continue
        if _reads_catalog_bib_state(p.read_text()):
            offenders.append(p.name)
    assert offenders == [], (
        "these scripts read bib.state off a catalog row instead of calling "
        f"resolve_bib_state(): {offenders}"
    )


def test_census_canary_detects_the_retired_spellings():
    """A census that matches nothing passes for the wrong reason — and this
    canary stands on SYNTHETIC lines, never on a line the allowlist drains."""
    # shape A, both spellings
    assert _reads_catalog_bib_state(
        '    return ((e.get("bib") or {}).get("state")) or "none"')
    assert _reads_catalog_bib_state('    bib_state = row["bib"]["state"]')
    # shape B — the two-line bound-local form (three of the four offenders)
    assert _reads_catalog_bib_state(
        '        bib = e.get("bib") or {}\n'
        '        return bib.get("state", "none")\n'
    )
    # the compliant form, and a near-miss that reads a DIFFERENT bib field
    assert not _reads_catalog_bib_state('    state = resolve_bib_state(library, ck)')
    assert not _reads_catalog_bib_state(
        '    bib = entry.get("bib") or {}\n'
        '    if not bib.get("imported"):\n'
    )
    # a whole-line comment is not a read
    assert not _reads_catalog_bib_state('    # e.get("bib").get("state") is retired')


def test_census_allowlist_entries_still_excuse_something():
    """A stale exemption is a standing licence for the next private read."""
    root = Path(__file__).resolve().parent.parent
    for name in _CATALOG_STATE_READ_ALLOWED:
        p = root / name
        assert p.exists(), f"allowlisted script is gone: {name}"
        assert _reads_catalog_bib_state(p.read_text()), (
            f"{name} no longer reads a catalog bib.state — drop its exemption"
        )


def _run_standalone() -> int:
    """Run the suite without pytest (it isn't installed everywhere).

    Same shape as `test_references_bib_upsert.py`'s runner — the TS shim in
    `library/lib/__tests__/bib-state-read-door-python.test.ts` drives this so
    the contract is gated by the same `npx vitest run` as everything else.
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
