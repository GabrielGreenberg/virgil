"""Every claim is SETTLED on every exit, and only by its owner (task 1622).

The claim contract (task 1291) says a request a worker claims is retired on
success and released on failure. Three places broke it:

  1. `drain_queue._process_one` classified a SUCCESSFUL index (a catalog read
     that may refuse) before retiring it, and caught only TimeoutExpired — a
     refused catalog or an OSError stranded the request `running` for the
     abandon TTL, and the paper was re-indexed an hour later;
  2. `write_request` read the slot, decided, then wrote — outside the lock the
     claim takes — so a claim landing in between was overwritten;
  3. a run outliving the TTL could settle a SECOND worker's re-claim, because
     the identity it checked (kind + requestedAt) named the request, not the
     claim.

Run: python3 library/scripts/tests/test_claim_settle.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "library/scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import drain_queue  # noqa: E402
import queue_slot  # noqa: E402

OLD = "2000-01-01T00:00:00Z"


def _qdir(lib: Path) -> Path:
    q = lib / ".virgil" / "queue"
    q.mkdir(parents=True, exist_ok=True)
    return q


def _put(path: Path, **entry) -> None:
    path.write_text(json.dumps(entry, indent=2) + "\n")


def _read(path: Path) -> dict:
    return json.loads(path.read_text())


def _index_request(lib: Path, citekey: str = "a") -> Path:
    path = _qdir(lib) / f"{citekey}.json"
    _put(path, kind="index", status="requested", citekey=citekey,
         requestedAt="r1", attempts=0)
    return path


class _Patched:
    """Swap module attributes for the duration of a `with`."""

    def __init__(self, module, **attrs):
        self.module, self.attrs, self.saved = module, attrs, {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.saved[k] = getattr(self.module, k)
            setattr(self.module, k, v)

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            setattr(self.module, k, v)


def _ok_run(*a, **k):
    return subprocess.CompletedProcess(a[0] if a else [], 0, "", "")


# ── member 1: the drain settles every claim ────────────────────────────


def test_a_successful_index_is_retired_even_when_the_catalog_refuses(tmp_path):
    path = _index_request(tmp_path)

    def refused(library, citekey):
        raise queue_slot.StateFileUnreadable("catalog.json is a placeholder")

    with _Patched(drain_queue.subprocess, run=_ok_run), \
            _Patched(drain_queue, _classify_entry=refused):
        result = drain_queue._process_one({**_read(path), "_path": path}, tmp_path)
    assert result["status"] == "ok", result
    assert "catalog unreadable" in result["summary"], result
    assert not path.exists()  # retired, never left `running`
    assert path.with_suffix(".done").exists()


def test_an_oserror_from_the_run_releases_the_claim(tmp_path):
    path = _index_request(tmp_path)

    def boom(*a, **k):
        raise OSError("fork failed")

    with _Patched(drain_queue.subprocess, run=boom):
        try:
            drain_queue._process_one({**_read(path), "_path": path}, tmp_path)
        except OSError:
            pass
        else:
            raise AssertionError("the OSError must still surface")
    cur = _read(path)
    assert cur["status"] == "failed", cur
    assert "fork failed" in cur["lastError"]
    assert cur["attempts"] == 1


def test_the_scope_releases_a_body_that_forgets_to_settle(tmp_path):
    path = _index_request(tmp_path)
    with queue_slot.claimed(path) as claim:
        assert claim is not None
    cur = _read(path)
    assert cur["status"] == "failed" and "without settling" in cur["lastError"]


def test_the_scope_settles_once(tmp_path):
    path = _index_request(tmp_path)
    with queue_slot.claimed(path) as claim:
        assert claim.retire()
        assert claim.release("late") is None  # first settle wins
    assert not path.exists() and path.with_suffix(".done").exists()


def test_the_scope_yields_none_when_nothing_is_claimable(tmp_path):
    path = _qdir(tmp_path) / "a.json"
    _put(path, kind="index", status="running", citekey="a", requestedAt="r1",
         attempts=0, startedAt=queue_slot._now(), claimId="other")
    before = path.read_text()
    with queue_slot.claimed(path) as claim:
        assert claim is None
    assert path.read_text() == before


# ── member 2: write_request decides and writes under the claim lock ────


def test_write_request_holds_the_slot_lock_across_read_and_write(tmp_path):
    """A claim racing a write either lands before (the write sees it in
    flight) or after (it claims the fresh request) — never between, where the
    write would overwrite a live claim with `requested`."""
    # A per-kind slot (no legacy bare-slot migration read before the lock).
    path = _qdir(tmp_path) / queue_slot.slot_filename("deepIndex", "a")
    _put(path, kind="deepIndex", status="failed", citekey="a", requestedAt="r0",
         attempts=1)
    entered, release = threading.Event(), threading.Event()
    real_read = queue_slot._read
    claim_result: dict = {}

    def slow_read(p):
        cur = real_read(p)
        if p == path and threading.current_thread().name == "writer":
            entered.set()
            release.wait(2)
        return cur

    def writer():
        queue_slot.write_request(tmp_path, "deepIndex", "a", replace_requested=True)

    def claimer():
        claim_result["entry"] = queue_slot.claim_request(path)

    with _Patched(queue_slot, _read=slow_read):
        tw = threading.Thread(target=writer, name="writer")
        tw.start()
        assert entered.wait(2)
        tc = threading.Thread(target=claimer, name="claimer")
        tc.start()
        tc.join(0.3)
        assert tc.is_alive(), "the claim must wait for the write's lock"
        release.set()
        tw.join(2)
        tc.join(2)
    cur = _read(path)
    # The claim ran after the write: it claimed the FRESH request.
    assert cur["status"] == "running", cur
    assert claim_result["entry"]["requestedAt"] == cur["requestedAt"] != "r0"


# ── member 3: a stale claimant cannot settle a re-claim ────────────────


def _lapse(path: Path) -> None:
    cur = _read(path)
    cur["startedAt"] = OLD
    path.write_text(json.dumps(cur))


def test_a_lapsed_claimant_cannot_settle_the_reclaim(tmp_path):
    path = _index_request(tmp_path)
    a = queue_slot.claim_request(path)
    _lapse(path)  # run A outlived the TTL
    b = queue_slot.claim_request(path)
    assert b is not None and b["claimId"] != a["claimId"]
    assert queue_slot.release_claimed(path, a, "A gave up") is None
    assert not queue_slot.retire_claimed(path, a)
    assert not queue_slot.renew_claim(path, a)
    cur = _read(path)
    assert cur["status"] == "running" and cur["claimId"] == b["claimId"]
    assert queue_slot.retire_claimed(path, b)


def test_renew_keeps_a_long_claim_in_flight(tmp_path):
    path = _index_request(tmp_path)
    a = queue_slot.claim_request(path)
    _lapse(path)
    assert queue_slot.renew_claim(path, a)
    assert queue_slot.is_in_flight(_read(path))
    assert queue_slot.claim_request(path) is None  # no second claimant


def test_a_released_claim_cannot_be_settled_again(tmp_path):
    path = _index_request(tmp_path)
    a = queue_slot.claim_request(path)
    assert queue_slot.release_claimed(path, a, "x") == "failed"
    assert queue_slot.release_claimed(path, a, "x") is None  # no double charge
    assert _read(path)["attempts"] == 1


def _lib(root: Path) -> Path:
    (root / ".virgil" / "scripts").mkdir(parents=True, exist_ok=True)
    for f, body in ((root / ".virgil" / "catalog.json", "{}"), (root / "master.bib", "")):
        if not f.exists():
            f.write_text(body)
    return root


def _cli(capsys, *argv) -> dict:
    capsys.readouterr()
    assert queue_slot.main(list(argv)) == 0
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_cli_claim_id_round_trip(tmp_path, capsys):
    lib = str(_lib(tmp_path))
    path = _index_request(tmp_path)
    a = _cli(capsys, "claim", "--kind", "index", "--citekey", "a", "--library", lib)
    assert a["result"] == "claimed" and a["claimId"]
    _lapse(path)
    b = _cli(capsys, "claim", "--kind", "index", "--citekey", "a", "--library", lib)
    assert b["result"] == "claimed" and b["claimId"] != a["claimId"]
    common = ["--kind", "index", "--citekey", "a", "--library", lib,
              "--requested-at", a["requestedAt"]]
    assert _cli(capsys, "renew", *common, "--claim-id", a["claimId"])["result"] == "lost"
    assert _cli(capsys, "release", *common, "--claim-id", a["claimId"],
                "--error", "A stopped")["result"] == "superseded"
    assert _cli(capsys, "retire", *common, "--claim-id", a["claimId"])["result"] == "superseded"
    assert _read(path)["claimId"] == b["claimId"]
    assert _cli(capsys, "renew", *common, "--claim-id", b["claimId"])["result"] == "renewed"
    assert _cli(capsys, "retire", *common, "--claim-id", b["claimId"])["result"] == "retired"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
