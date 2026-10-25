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


def _as_library(root: Path) -> Path:
    """Make `root` pass the one validated library resolver (task 896)."""
    (root / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    for f, body in ((root / ".virgil" / "catalog.json", "{}"), (root / "master.bib", "")):
        if not f.exists():
            f.write_text(body)
    return root


def _cli(argv: list[str]) -> int:
    """`queue_slot.main`, with its `--library` made a real library first."""
    _as_library(Path(argv[argv.index("--library") + 1]))
    return queue_slot.main(argv)


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
    _put(q / "a.done", **entry)  # retired; the unlink was refused
    skips: dict[str, int] = {}
    assert drain_queue._list_pending(tmp_path, skip_counts=skips) == []
    assert skips.get("already-done") == 1


def test_empty_done_marker_is_judged_by_age(tmp_path):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="requested", citekey="a",
         requestedAt="2026-09-01T00:00:00Z", attempts=0)
    (q / "a.done").write_text("")  # an empty marker, written AFTER
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
    claimed = queue_slot.claim_request(q / "a.json")
    assert queue_slot.retire_claimed(q / "a.json", claimed)
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
    assert _cli(["write", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "written"
    assert _cli(["retire", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "retired"
    q = _qdir(tmp_path)
    assert not (q / "a.json").exists() and (q / "a.done").exists()
    _put(q / "a.json", kind="index", status="running", citekey="a",
         requestedAt="x", attempts=0)
    assert _cli(["write", "--kind", "index", "--citekey", "a",
                            "--library", str(tmp_path)]) == 3



# ── task 794: ONE answer to "what does the queue hold?" ──────────────────

def _manifest(q: Path) -> None:
    (q / "pending-reviews.json").write_text(json.dumps(
        {"pendingReviews": [{"citekey": "smith2020"}], "updatedAt": "x"}))


def _run_drain(lib: Path, capsys) -> str:
    _as_library(lib)
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

    assert _cli(["pending", "--native", "--count",
                            "--library", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "2"
    assert _cli(["pending", "--library", str(tmp_path)]) == 0
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
    assert _cli(["retire", "--kind", "deepIndex", "--citekey", "a",
                            "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "retired"
    assert not (q / "a-richindex.json").exists()
    assert (q / "a-richindex.done").exists()


# ── task 809: the deep-index door carries the app's companion rule ───────

def _write(lib: Path, capsys, *extra: str) -> tuple[int, dict]:
    code = _cli(["write", "--kind", "deepIndex", "--citekey", "a",
                            "--library", str(lib), *extra])
    return code, json.loads(capsys.readouterr().out)


def test_deep_index_on_unindexed_paper_plants_companion_index(tmp_path, capsys):
    q = _qdir(tmp_path)
    code, out = _write(tmp_path, capsys, "--note", "  fix the footnotes ")
    assert code == 0 and out["result"] == "written"
    assert out["companion"] == {"result": "written", "file": "a.json"}
    deep = _read(q / "a-deepindex.json")
    assert deep["kind"] == "deepIndex" and deep["status"] == "requested"
    assert deep["note"] == "fix the footnotes"
    idx = _read(q / "a.json")
    assert idx["kind"] == "index" and idx["companionOf"] == "deepIndex"
    assert idx["status"] == "requested"


def test_deep_index_leaves_an_existing_index_untouched(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="requested", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0)
    code, out = _write(tmp_path, capsys)
    assert code == 0 and out["companion"]["result"] == "already-queued"
    idx = _read(q / "a.json")
    assert "companionOf" not in idx and idx["requestedAt"] == "2026-01-01T00:00:00Z"


def test_deep_index_on_indexed_paper_plants_no_companion(tmp_path, capsys):
    q = _qdir(tmp_path)
    (tmp_path / "papers" / "a").mkdir(parents=True)
    (tmp_path / "papers" / "a" / "main.tex").write_text("x")
    code, out = _write(tmp_path, capsys)
    assert code == 0 and out["result"] == "written" and "companion" not in out
    assert not (q / "a.json").exists()
    assert "note" not in _read(q / "a-deepindex.json")


def test_deep_index_refuses_an_in_flight_slot(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "a-deepindex.json", kind="deepIndex", status="running", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=1)
    code, out = _write(tmp_path, capsys)
    assert code == 3 and out["result"] == "in-flight" and "companion" not in out
    assert _read(q / "a-deepindex.json")["status"] == "running"
    assert not (q / "a.json").exists()


# ── task 1291: a worker CLAIMS, and retires only what it claimed ─────────

class _stub_index_paper:
    """Stand in for the `index_paper.py` subprocess (and the catalog
    classifier) for the with-block; `on_run` fires mid-run. A context manager
    rather than a `monkeypatch` leg — `_standalone` supplies no monkeypatch."""

    def __init__(self, on_run=None, returncode=0):
        self.on_run, self.returncode = on_run, returncode

    def __enter__(self):
        import subprocess as sp

        def fake_run(*_a, **_k):
            if self.on_run:
                self.on_run()
            return sp.CompletedProcess([], self.returncode, stdout="", stderr="boom")

        self.saved = (drain_queue.subprocess.run, drain_queue._classify_entry)
        drain_queue.subprocess.run = fake_run
        drain_queue._classify_entry = lambda *_a: (" ", "authenticated")
        return self

    def __exit__(self, *_exc):
        drain_queue.subprocess.run, drain_queue._classify_entry = self.saved


def _entry(lib: Path, name: str) -> dict:
    e = _read(_qdir(lib) / name)
    e["_path"] = _qdir(lib) / name
    return e


def test_drain_claims_the_slot_while_it_works(tmp_path):
    q = _qdir(tmp_path)
    queue_slot.write_request(tmp_path, "index", "a")
    seen = {}

    def mid_run():
        seen["status"] = _read(q / "a.json")["status"]
        # Both writers refuse a claimed slot (the guard task 618 built).
        seen["write"] = queue_slot.write_request(tmp_path, "reindex", "a")[0]

    with _stub_index_paper(mid_run):
        result = drain_queue._process_one(_entry(tmp_path, "a.json"), tmp_path)
    assert result["status"] == "ok"
    assert seen == {"status": "running", "write": queue_slot.IN_FLIGHT}
    assert not (q / "a.json").exists() and _read(q / "a.done")["status"] == "done"


def test_request_queued_mid_drain_is_not_retired_unworked(tmp_path):
    """The app (which cannot see the claim before it lands) overwrites the
    slot mid-run: the drain must retire only its own request."""
    q = _qdir(tmp_path)
    queue_slot.write_request(tmp_path, "index", "a")

    def app_overwrites():
        _put(q / "a.json", kind="reindex", status="requested", citekey="a",
             requestedAt="2099-01-01T00:00:00Z", attempts=0)

    with _stub_index_paper(app_overwrites):
        result = drain_queue._process_one(_entry(tmp_path, "a.json"), tmp_path)
    assert result["status"] == "ok" and "left queued" in result["summary"]
    assert _read(q / "a.json")["requestedAt"] == "2099-01-01T00:00:00Z"
    assert not (q / "a.done").exists()
    assert _pending_names(tmp_path) == ["a.json"]


def test_failure_mid_drain_does_not_charge_the_newer_request(tmp_path):
    q = _qdir(tmp_path)
    queue_slot.write_request(tmp_path, "index", "a")

    def app_overwrites():
        _put(q / "a.json", kind="index", status="requested", citekey="a",
             requestedAt="2099-01-01T00:00:00Z", attempts=0)

    with _stub_index_paper(app_overwrites, returncode=1):
        drain_queue._process_one(_entry(tmp_path, "a.json"), tmp_path)
    cur = _read(q / "a.json")
    assert cur["status"] == "requested" and cur["attempts"] == 0


def test_failure_releases_the_claim_as_failed_then_poisoned(tmp_path):
    q = _qdir(tmp_path)
    queue_slot.write_request(tmp_path, "index", "a")
    with _stub_index_paper(returncode=1):
        for want in ("failed", "failed", "poisoned"):
            drain_queue._process_one(_entry(tmp_path, "a.json"), tmp_path)
            cur = _read(q / "a.json")
            assert cur["status"] == want and "startedAt" not in cur


def test_an_abandoned_claim_is_reclaimable_and_overwritable(tmp_path):
    q = _qdir(tmp_path)
    old = "2000-01-01T00:00:00Z"
    _put(q / "a.json", kind="index", status="running", citekey="a",
         requestedAt=old, startedAt=old, attempts=0)
    assert not queue_slot.is_in_flight(_read(q / "a.json"))
    assert _pending_names(tmp_path) == ["a.json"]
    assert queue_slot.claim_request(q / "a.json") is not None
    # A fresh claim is in flight again: no second claimant, no overwrite.
    assert queue_slot.claim_request(q / "a.json") is None
    assert queue_slot.write_request(tmp_path, "index", "a")[0] == queue_slot.IN_FLIGHT


def test_find_request_is_live_only_and_slot_kind_aware(tmp_path):
    q = _qdir(tmp_path)
    for status in ("failed", "poisoned", "done"):
        _put(q / "a.json", kind="index", status=status, citekey="a",
             requestedAt="x", attempts=0)
        assert queue_slot.find_request(tmp_path, "index", "a") is None, status
    _put(q / "a.json", kind="reindex", status="requested", citekey="a",
         requestedAt="x", attempts=0)
    assert queue_slot.find_request(tmp_path, "index", "a") == q / "a.json"
    assert queue_slot.slot_kinds("index") == ("index", "reindex")
    assert queue_slot.slot_kinds("authenticate") == ("authenticate",)


def test_deep_index_over_a_pending_reindex_plants_no_companion(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="reindex", status="requested", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=0)
    code, out = _write(tmp_path, capsys)
    assert code == 0 and out["companion"]["result"] == "already-queued"
    assert _read(q / "a.json")["kind"] == "reindex"
    assert "companionOf" not in _read(q / "a.json")


def test_deep_index_over_a_poisoned_index_plants_the_companion(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "a.json", kind="index", status="poisoned", citekey="a",
         requestedAt="2026-01-01T00:00:00Z", attempts=3)
    code, out = _write(tmp_path, capsys)
    assert code == 0 and out["companion"] == {"result": "written", "file": "a.json"}
    assert _read(q / "a.json")["companionOf"] == "deepIndex"


def test_cli_claim_then_retire_leaves_a_superseding_request(tmp_path, capsys):
    q = _qdir(tmp_path)
    assert _cli(["write", "--kind", "deepIndex", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    capsys.readouterr()
    assert _cli(["claim", "--kind", "deepIndex", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    claimed = json.loads(capsys.readouterr().out)
    assert claimed["result"] == "claimed"
    assert _read(q / "a-deepindex.json")["status"] == "running"
    # A second claim finds it in flight.
    assert _cli(["claim", "--kind", "deepIndex", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "nothing-claimable"
    # The user re-requests with a new note while the skill works.
    _put(q / "a-deepindex.json", kind="deepIndex", status="requested", citekey="a",
         requestedAt="2099-01-01T00:00:00Z", attempts=0, note="again")
    assert _cli(["retire", "--kind", "deepIndex", "--citekey", "a",
                 "--requested-at", claimed["requestedAt"],
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "superseded"
    assert _read(q / "a-deepindex.json")["note"] == "again"
    # Retiring the claimed request itself works.
    assert _cli(["retire", "--kind", "deepIndex", "--citekey", "a",
                 "--requested-at", "2099-01-01T00:00:00Z",
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "retired"


def test_cli_claim_with_nothing_queued(tmp_path, capsys):
    assert _cli(["claim", "--kind", "index", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result"] == "nothing-claimable"


# ── task 1041: the review manifest has a door on the Python side ─────────

def _review_rows(lib: Path) -> list:
    return _read(_qdir(lib) / "pending-reviews.json")["pendingReviews"]


def test_authenticate_write_adds_manifest_row(tmp_path, capsys):
    assert _cli(["write", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    capsys.readouterr()
    rows = _review_rows(tmp_path)
    assert [r["citekey"] for r in rows] == ["a"]
    assert rows[0]["requestedAt"] == _read(_qdir(tmp_path) / "a-auth.json")["requestedAt"]
    # Another kind's write leaves the manifest alone.
    assert _cli(["write", "--kind", "index", "--citekey", "b",
                 "--library", str(tmp_path)]) == 0
    assert [r["citekey"] for r in _review_rows(tmp_path)] == ["a"]


def test_authenticate_retire_drops_only_its_row(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "pending-reviews.json", pendingReviews=[
        {"citekey": "a", "requestedAt": "x"},
        {"citekey": "b", "requestedAt": "y"},
    ], updatedAt="z")
    _put(q / "a-auth.json", kind="authenticate", status="requested",
         citekey="a", requestedAt="x", attempts=0)
    assert _cli(["retire", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out == {"result": "retired", "file": "a-auth.done", "manifest": "removed"}
    assert _review_rows(tmp_path) == [{"citekey": "b", "requestedAt": "y"}]


def test_retire_cleans_a_stale_row_with_nothing_queued(tmp_path, capsys):
    q = _qdir(tmp_path)
    _put(q / "pending-reviews.json", pendingReviews=[{"citekey": "a", "requestedAt": "x"}])
    assert _cli(["retire", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out == {"result": "nothing-queued", "manifest": "removed"}
    assert _review_rows(tmp_path) == []
    # No manifest at all: nothing is created.
    q2 = _qdir(tmp_path / "other")
    assert _cli(["retire", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path / "other")]) == 0
    assert json.loads(capsys.readouterr().out)["manifest"] == "absent"
    assert not (q2 / "pending-reviews.json").exists()


def test_apostrophe_citekey_goes_through_argv(tmp_path, capsys):
    key = "o'neill2020"
    q = _qdir(tmp_path)
    _put(q / "pending-reviews.json", pendingReviews=[{"citekey": key, "requestedAt": "x"}])
    assert _cli(["retire", "--kind", "authenticate", "--citekey", key,
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["manifest"] == "removed"
    assert _review_rows(tmp_path) == []


def test_malformed_rows_are_kept_not_raised_on(tmp_path, capsys):
    q = _qdir(tmp_path)
    junk = [None, 3, "s", {"requestedAt": "no-citekey"}]
    _put(q / "pending-reviews.json", pendingReviews=[*junk, {"citekey": "a", "requestedAt": "x"}])
    assert _cli(["retire", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["manifest"] == "removed"
    assert _review_rows(tmp_path) == junk


def test_unreadable_manifest_is_left_byte_identical(tmp_path, capsys):
    q = _qdir(tmp_path)
    (q / "pending-reviews.json").write_text("{not json")
    _put(q / "a-auth.json", kind="authenticate", status="requested",
         citekey="a", requestedAt="x", attempts=0)
    assert _cli(["retire", "--kind", "authenticate", "--citekey", "a",
                 "--library", str(tmp_path)]) == 0
    out = json.loads(capsys.readouterr().out)
    # The request is still retired; the shadow's damage does not block it.
    assert out["result"] == "retired" and out["manifest"] == "unreadable"
    assert (q / "pending-reviews.json").read_text() == "{not json"


def test_concurrent_add_under_the_lock_survives_a_removal(tmp_path):
    """A writer holding the manifest lock adds a row; a removal that starts
    meanwhile waits, then reads the FRESH file — the add is not lost."""
    import threading

    _as_library(tmp_path)
    q = _qdir(tmp_path)
    path = q / "pending-reviews.json"
    _put(path, pendingReviews=[{"citekey": "a", "requestedAt": "x"}])
    held, release = threading.Event(), threading.Event()

    def other_writer():
        with queue_slot._flock_path(path.with_name(path.name + ".lock")):
            held.set()
            release.wait(5)
            doc = _read(path)
            doc["pendingReviews"].append({"citekey": "b", "requestedAt": "y"})
            _put(path, **doc)

    t = threading.Thread(target=other_writer)
    t.start()
    assert held.wait(5)
    result: list = []
    r = threading.Thread(target=lambda: result.append(
        queue_slot.remove_pending_review(tmp_path, "a")))
    r.start()
    time.sleep(0.1)
    assert result == []  # blocked on the lock
    release.set()
    t.join(5)
    r.join(5)
    assert result == ["removed"]
    assert [x["citekey"] for x in _review_rows(tmp_path)] == ["b"]


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
