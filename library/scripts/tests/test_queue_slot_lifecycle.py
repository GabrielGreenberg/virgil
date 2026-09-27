"""The queue SLOT LIFECYCLE, Python half (task 618).

A user's request could vanish from `.virgil/queue/` without a word:

  1. a request written next to a `<slot>.done` from an EARLIER run of the same
     kind was skipped by `drain_queue` as "already-done", forever;
  2. triage re-queued a re-dropped source as `index` into exactly that trap;
  3. `index` and `authenticate` shared `<citekey>.json` — last writer won;
  4. `triage_apply` ignored a refused queue write and reported "triaged".

`queue_slot.py` is the one contract. These legs pin each member through the
real callers (`drain_queue._list_pending`, `triage_apply.apply_row`,
`backfill_auth`'s door), plus the contract's own edges.

Run: python3 library/scripts/tests/test_queue_slot_lifecycle.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import drain_queue  # noqa: E402
import queue_slot  # noqa: E402
import triage_apply  # noqa: E402


def _qdir(lib: Path) -> Path:
    q = lib / ".virgil" / "queue"
    q.mkdir(parents=True, exist_ok=True)
    return q


def _put(path: Path, **entry) -> None:
    path.write_text(json.dumps(entry, indent=2) + "\n")


def _read(path: Path) -> dict:
    return json.loads(path.read_text())


def _pending_names(lib: Path) -> list[str]:
    return sorted(e["_path"].name for e in drain_queue._list_pending(lib))


# ── member 1: a stale same-kind .done never hides a new request ──────────

def test_drain_processes_new_request_beside_stale_same_kind_done(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "smith2020-bibedit.done", kind="bib-edit", status="requested",
         citekey="smith2020", requestedAt="2026-01-01T00:00:00Z", attempts=0)
    _put(q / "smith2020-bibedit.json", kind="bib-edit", status="requested",
         citekey="smith2020", requestedAt="2026-09-01T00:00:00Z", attempts=0)
    assert _pending_names(tmp_path) == ["smith2020-bibedit.json"]
    # The stale marker was rotated out of the slot, not left to bite again.
    assert not (q / "smith2020-bibedit.done").exists()
    assert list(q.glob("smith2020-bibedit.bib-edit.*.done"))


def test_drain_still_skips_the_retirement_of_this_very_request(tmp_path):
    q = _qdir(tmp_path)
    entry = dict(kind="index", status="requested", citekey="a",
                 requestedAt="2026-09-01T00:00:00Z", attempts=0)
    _put(q / "a.json", **entry)
    _put(q / "a.done", **entry)  # `_mark_done` copied it; the unlink was refused
    skips: dict[str, int] = {}
    assert drain_queue._list_pending(tmp_path, skip_counts=skips) == []
    assert skips.get("already-done") == 1


def test_empty_done_marker_is_judged_by_age(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="requested", citekey="a",
         requestedAt="2026-09-01T00:00:00Z", attempts=0)
    (q / "a.done").write_text("")  # `_mark_done` fallback, written AFTER
    assert _pending_names(tmp_path) == []
    # An empty marker OLDER than the request is stale.
    (q / "b.done").write_text("")
    old = time.time() - 3600
    import os
    os.utime(q / "b.done", (old, old))
    _put(q / "b.json", kind="index", status="requested", citekey="b",
         requestedAt="2026-09-01T00:00:00Z", attempts=0)
    assert _pending_names(tmp_path) == ["b.json"]


def test_writer_retires_done_on_write(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.done", kind="index", status="requested", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0)
    result, path = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.WRITTEN
    assert path.name == "a.json"
    assert not (q / "a.done").exists()
    assert _pending_names(tmp_path) == ["a.json"]


def test_mark_done_then_new_request_then_drain(tmp_path):
    """The full cycle: run, retire, re-request — the second request drains."""
    q = _qdir(tmp_path)
    queue_slot.write_request(tmp_path, "index", "a")
    drain_queue._mark_done(q / "a.json")
    assert _pending_names(tmp_path) == []
    time.sleep(1.1)  # distinct requestedAt (second resolution)
    result, _ = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.WRITTEN
    assert _pending_names(tmp_path) == ["a.json"]


# ── member 2: triage re-queues a re-dropped source ───────────────────────

def _triage_lib(tmp_path: Path, citekey: str = "smith2020") -> dict:
    (tmp_path / "unsorted").mkdir()
    (tmp_path / "unsorted" / "smith.docx").write_bytes(b"x")
    (tmp_path / "master.bib").write_text(
        f"@article{{{citekey},\n  title = {{T}},\n  year = {{2020}},\n}}\n"
    )
    return {
        "filename": "smith.docx",
        "extension": "docx",
        "flags": [],
        "proposedCitekey": citekey,
        "proposedType": "article",
        "proposedFields": {"title": "T", "year": "2020"},
    }


def test_triage_requeue_beside_old_index_done_is_drained(tmp_path):
    row = _triage_lib(tmp_path)
    q = _qdir(tmp_path)
    _put(q / "smith2020.done", kind="index", status="requested",
         citekey="smith2020", requestedAt="2026-01-01T00:00:00Z", attempts=0)
    result = triage_apply.apply_row(row, tmp_path)
    assert result["status"] == "triaged", result
    assert _read(q / "smith2020.json")["kind"] == "index"
    assert _pending_names(tmp_path) == ["smith2020.json"]


# ── member 3: kinds coexist; running is never clobbered ──────────────────

def test_index_and_authenticate_coexist(tmp_path):
    q = _qdir(tmp_path)
    assert queue_slot.write_request(tmp_path, "authenticate", "a")[0] == queue_slot.WRITTEN
    assert queue_slot.write_request(tmp_path, "index", "a")[0] == queue_slot.WRITTEN
    assert _read(q / "a.json")["kind"] == "index"
    assert _read(q / "a-auth.json")["kind"] == "authenticate"
    assert _pending_names(tmp_path) == ["a-auth.json", "a.json"]


def test_running_entry_is_never_overwritten(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="running", citekey="a",
         requestedAt="2026-09-01T00:00:00Z", attempts=0)
    result, _ = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.IN_FLIGHT
    assert _read(q / "a.json")["status"] == "running"


def test_pending_same_kind_is_left_alone(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="requested", citekey="a",
         requestedAt="2026-09-01T00:00:00Z", attempts=0, note="keep me")
    result, _ = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.ALREADY_QUEUED
    assert _read(q / "a.json")["note"] == "keep me"


def test_legacy_authenticate_in_bare_slot_is_migrated_not_clobbered(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="authenticate", status="requested", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0, note="legacy")
    result, _ = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.WRITTEN
    assert _read(q / "a.json")["kind"] == "index"
    assert _read(q / "a-auth.json")["note"] == "legacy"
    assert queue_slot.find_request(tmp_path, "authenticate", "a") == q / "a-auth.json"


def test_legacy_running_authenticate_refuses_the_bare_slot(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="authenticate", status="running", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0)
    result, _ = queue_slot.write_request(tmp_path, "index", "a")
    assert result == queue_slot.OCCUPIED
    assert _read(q / "a.json")["kind"] == "authenticate"


def test_find_request_sees_legacy_bare_authenticate(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="authenticate", status="requested", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0)
    assert queue_slot.find_request(tmp_path, "authenticate", "a") == q / "a.json"
    assert queue_slot.find_request(tmp_path, "index", "a") is None


# ── member 4: a refused write is REPORTED ─────────────────────────────────

def test_triage_reports_refused_index_request(tmp_path):
    row = _triage_lib(tmp_path)
    q = _qdir(tmp_path)
    _put(q / "smith2020.json", kind="index", status="running",
         citekey="smith2020", requestedAt="2026-01-01T00:00:00Z", attempts=0)
    result = triage_apply.apply_row(row, tmp_path)
    assert result["status"] == "triaged-unqueued", result
    assert "NOT queued" in result["summary"]
    inbox = _read(tmp_path / ".virgil" / "notifications" / "inbox.json")
    items = inbox.get("items", inbox) if isinstance(inbox, dict) else inbox
    assert any("NOT queued" in (i.get("summary") or "") for i in items)


def test_triage_writer_returns_the_door_result(tmp_path):
    assert triage_apply._write_queue_entry(tmp_path, "a", kind="index") == queue_slot.WRITTEN
    assert triage_apply._write_queue_entry(tmp_path, "a", kind="index") == queue_slot.ALREADY_QUEUED
    # A different kind no longer collides with the index slot.
    assert triage_apply._write_queue_entry(tmp_path, "a", kind="authenticate") == queue_slot.WRITTEN


# ── contract edges ────────────────────────────────────────────────────────

def test_slot_table_and_suffixes():
    assert queue_slot.slot_filename("index", "k") == "k.json"
    assert queue_slot.slot_filename("reindex", "k") == "k.json"
    assert queue_slot.slot_filename("authenticate", "k") == "k-auth.json"
    assert queue_slot.slot_filename("richIndex", "k") == "k-deepindex.json"
    sfx = queue_slot.slot_suffixes()
    for s in (".json", ".done", "-auth.json", "-bibedit.done", "-richindex.json"):
        assert s in sfx, s
    try:
        queue_slot.slot_filename("bogus", "k")
    except ValueError:
        pass
    else:
        raise AssertionError("unknown kind accepted")


def test_cli_write_and_retire(tmp_path, capsys):
    assert queue_slot.main(["write", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "written"
    assert queue_slot.main(["retire", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "retired"
    q = _qdir(tmp_path)
    assert not (q / "a.json").exists() and (q / "a.done").exists()
    _put(q / "a.json", kind="index", status="running", citekey="a",
         requestedAt="x", attempts=0)
    assert queue_slot.main(["write", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 3



# ── task 794: ONE answer to "what does the queue hold?" ──────────────────

def _manifest(q: Path) -> None:
    (q / "pending-reviews.json").write_text(json.dumps(
        {"pendingReviews": [{"citekey": "smith2020"}], "updatedAt": "x"}))


def _run_drain(lib: Path, capsys) -> str:
    argv = sys.argv
    sys.argv = ["drain_queue.py", "--library", str(lib)]
    try:
        drain_queue.main()
    finally:
        sys.argv = argv
    return capsys.readouterr().out


def test_manifest_alone_drains_to_queue_empty(tmp_path, capsys):
    _manifest(_qdir(tmp_path))
    assert _pending_names(tmp_path) == []
    out = _run_drain(tmp_path, capsys)
    assert out.strip() == "queue empty", out


def test_manifest_plus_authenticate_defers_one_with_no_blank_row(tmp_path, capsys):
    q = _qdir(tmp_path)
    _manifest(q)
    _put(q / "smith2020-auth.json", kind="authenticate", status="requested",
         citekey="smith2020", requestedAt="2026-09-01T00:00:00Z", attempts=0,
         note="check the year")
    assert _pending_names(tmp_path) == ["smith2020-auth.json"]
    out = _run_drain(tmp_path, capsys)
    assert "1 deferred-to-skill" in out, out
    assert "kind=''" not in out and "- for " not in out, out
    assert "- authenticate for smith2020 [note]" in out, out


def test_triage_stub_is_named_by_its_file(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "_triage-foo.json", kind="triage", status="requested",
         filename="foo.pdf", requestedAt="x", attempts=0)
    out = _run_drain(tmp_path, capsys)
    assert "- triage for foo.pdf" in out, out


def test_pending_native_count_ignores_deferred_failed_poisoned_manifest(tmp_path, capsys):
    q = _qdir(tmp_path)
    _manifest(q)
    base = dict(requestedAt="2026-09-01T00:00:00Z", attempts=0)
    _put(q / "a.json", kind="index", status="requested", citekey="a", **base)
    _put(q / "b.json", kind="reindex", status="requested", citekey="b", **base)
    _put(q / "c.json", kind="index", status="failed", citekey="c", **base)
    _put(q / "d.json", kind="index", status="poisoned", citekey="d", **base)
    _put(q / "e-auth.json", kind="authenticate", status="requested", citekey="e", **base)
    _put(q / "f-richindex.json", kind="richIndex", status="requested", citekey="f", **base)
    _put(q / "g.done.json", kind="index", status="requested", citekey="g", **base)
    # retired: .done sibling records this very request
    _put(q / "h.json", kind="index", status="requested", citekey="h", **base)
    _put(q / "h.done", kind="index", status="requested", citekey="h", **base)

    native = queue_slot.pending_requests(q, native_only=True)
    assert sorted(e["_path"].name for e in native) == ["a.json", "b.json"]
    every = queue_slot.pending_requests(q)
    assert sorted(e["_path"].name for e in every) == [
        "a.json", "b.json", "e-auth.json", "f-richindex.json"]
    assert {e["kind"] for e in every} == {"index", "reindex", "authenticate", "deepIndex"}

    assert queue_slot.main(["pending", "--native", "--count",
                            "--library", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "2"
    assert queue_slot.main(["pending", "--library", str(tmp_path)]) == 0
    lines = [json.loads(x) for x in capsys.readouterr().out.splitlines()]
    assert [x["file"] for x in lines] == [
        "a.json", "b.json", "e-auth.json", "f-richindex.json"]


def test_drain_skips_running_and_retries_failed(tmp_path):
    q = _qdir(tmp_path)
    base = dict(requestedAt="2026-09-01T00:00:00Z", attempts=1)
    _put(q / "a.json", kind="index", status="running", citekey="a", **base)
    _put(q / "b.json", kind="index", status="failed", citekey="b", **base)
    skips: dict = {}
    names = sorted(e["_path"].name for e in drain_queue._list_pending(tmp_path, skips))
    assert names == ["b.json"]
    assert skips.get("running") == 1


def test_retire_finds_legacy_richindex_slot(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "a-richindex.json", kind="richIndex", status="requested",
         citekey="a", requestedAt="x", attempts=0)
    assert queue_slot.main(["retire", "--kind", "deepIndex", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "retired"
    assert not (q / "a-richindex.json").exists()
    assert (q / "a-richindex.done").exists()


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
