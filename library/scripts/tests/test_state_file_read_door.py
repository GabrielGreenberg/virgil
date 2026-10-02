"""Task 893 — an unreadable library state file is a REFUSAL, never an empty model.

`read_catalog` used to return an empty catalog when `catalog.json` was missing
OR malformed, and every catalog writer is a locked read-modify-write — so one
Dropbox conflict / truncated sync / hand-edit typo became "the library has no
papers", and the next triage/index/authenticate wrote back a catalog holding
only the row it touched. `append_inbox_item` and the alias map had the same
shape. Now ONE door (`_tools.read_json_state`) keeps the three outcomes apart:

  * missing → the default (first run);
  * present but unreadable → `StateFileUnreadable`, the file left
    byte-identical, the bad bytes also preserved aside (content-addressed);
  * ok → the parsed object.

This suite pins the door, each state file's writer refusing through it, the
hand-rolled twins delegating to it, and a static census so a new
`json.loads` + swallow + write-back of these files can't reappear.

Run: python3 library/scripts/tests/test_state_file_read_door.py [--standalone]
"""
import contextlib
import json
import re
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import dedup_index  # noqa: E402
import drain_queue  # noqa: E402
import triage_apply  # noqa: E402
import triage_batch  # noqa: E402
from _tools import (  # noqa: E402
    StateFileUnreadable,
    append_inbox_item,
    read_catalog,
    read_json_state,
    update_catalog_entry,
)

THREE_ROWS_BROKEN = (
    '{"version": 1, "entries": [\n'
    '  {"citekey": "a2001x"},\n'
    '  {"citekey": "b2002y"},\n'
    '  {"citekey": "c2003z"},\n'  # trailing comma — the hand-edit typo
    "]}\n"
)


@contextlib.contextmanager
def _raises(exc_type):
    """`pytest.raises` for the standalone runner (no pytest in CI's python)."""
    try:
        yield
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def _library(root: Path) -> Path:
    (root / ".virgil" / "notifications").mkdir(parents=True, exist_ok=True)
    (root / "papers").mkdir(parents=True, exist_ok=True)
    (root / "master.bib").write_text("")
    return root


def _preserved(path: Path) -> list[Path]:
    return sorted(path.parent.glob(path.name + ".unreadable-*"))


# ── the door ──────────────────────────────────────────────────────────


def test_missing_file_reads_as_the_default(tmp_path):
    assert read_json_state(tmp_path / "nope.json", lambda: {"x": []}) == {"x": []}
    assert not list(tmp_path.iterdir())


def test_ok_file_reads_as_its_object(tmp_path):
    p = tmp_path / "s.json"
    p.write_text('{"entries": [1]}')
    assert read_json_state(p, dict, shape={"entries": list}) == {"entries": [1]}
    assert _preserved(p) == []


def test_bad_json_wrong_root_and_wrong_shape_all_refuse(tmp_path):
    for i, text in enumerate(['{"entries": [', "[1, 2]", '{"entries": {}}', "\xff\xfe"]):
        p = tmp_path / f"s{i}.json"
        p.write_bytes(text.encode("latin-1"))
        with _raises(StateFileUnreadable):
            read_json_state(p, dict, shape={"entries": list})
        assert p.read_bytes() == text.encode("latin-1")


def test_preservation_is_content_addressed_one_copy_per_bad_bytes(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{oops")
    for _ in range(3):
        try:
            read_json_state(p, dict)
        except StateFileUnreadable as e:
            assert e.preserved is not None and e.preserved.read_text() == "{oops"
            assert str(p) in str(e)
    assert len(_preserved(p)) == 1


# ── catalog.json ──────────────────────────────────────────────────────


def test_malformed_catalog_refuses_every_writer_and_stays_byte_identical(tmp_path):
    lib = _library(tmp_path)
    cat = lib / ".virgil" / "catalog.json"
    cat.write_text(THREE_ROWS_BROKEN)
    with _raises(StateFileUnreadable):
        read_catalog(lib)
    with _raises(StateFileUnreadable):
        update_catalog_entry(lib, "d2004w", {"title": "new"})
    # The hand-rolled twins delegate to the same door.
    for twin in (triage_batch._read_catalog, drain_queue._read_catalog):
        with _raises(StateFileUnreadable):
            twin(lib)
    assert cat.read_text() == THREE_ROWS_BROKEN
    kept = _preserved(cat)
    assert len(kept) == 1 and kept[0].read_text() == THREE_ROWS_BROKEN


def test_missing_catalog_is_still_created_by_a_writer(tmp_path):
    lib = _library(tmp_path)
    cat = read_catalog(lib)
    assert cat["entries"] == [] and cat["version"] == 1


# ── notifications/inbox.json ─────────────────────────────────────────


def test_malformed_inbox_refuses_the_append_and_stays_byte_identical(tmp_path):
    lib = _library(tmp_path)
    inbox = lib / ".virgil" / "notifications" / "inbox.json"
    broken = '{"items": [{"kind": "triaged"},]}'
    inbox.write_text(broken)
    with _raises(StateFileUnreadable):
        append_inbox_item(lib, {"kind": "triaged", "citekey": "x"})
    assert inbox.read_text() == broken
    assert len(_preserved(inbox)) == 1


def test_missing_inbox_starts_fresh(tmp_path):
    lib = _library(tmp_path)
    append_inbox_item(lib, {"kind": "triaged", "citekey": "x"})
    items = json.loads((lib / ".virgil" / "notifications" / "inbox.json").read_text())["items"]
    assert [i["citekey"] for i in items] == ["x"]


# ── aliases.json ──────────────────────────────────────────────────────


def test_malformed_aliases_are_never_rewritten_by_a_fold(tmp_path):
    lib = _library(tmp_path)
    ap = lib / dedup_index.ALIASES_REL
    ap.parent.mkdir(parents=True, exist_ok=True)
    broken = '{"old2001": {"survivor": "new2001"},}'
    ap.write_text(broken)
    with _raises(StateFileUnreadable):
        dedup_index.load_aliases(lib)
    # triage's alias record is best-effort: it may skip, it may not clobber.
    triage_apply._record_alias(lib, "loser2002", "winner2002", object())
    assert ap.read_text() == broken


# ── census ────────────────────────────────────────────────────────────

_STATE_FILES = ("catalog.json", "inbox.json", "aliases.json")
_WRITES = re.compile(r"\b(write_catalog|save_aliases|_atomic_write_text|_atomic_write)\(")


def test_no_writer_script_hand_reads_a_state_file():
    """A script that WRITES library state may not parse a state file itself
    and SWALLOW the failure (`json.loads` + `except` → a default) — that is
    the read-as-empty-then-write-back shape. It reads through the door, which
    refuses. (Read-only reporters may still read tolerantly; they write
    nothing back.)"""
    problems = []
    for f in sorted(_SCRIPTS.glob("*.py")):
        if f.name == "_tools.py" or f.name.startswith("test_"):
            continue
        text = f.read_text()
        if not _WRITES.search(text):
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if not any(name in line for name in _STATE_FILES):
                continue
            window = "\n".join(lines[i:i + 6])
            if "json.loads(" in window and re.search(r"^\s*except\b", window, re.M):
                problems.append(f"{f.name}:{i + 1}")
    assert problems == [], f"hand-rolled state-file reads in writer scripts: {problems}"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
