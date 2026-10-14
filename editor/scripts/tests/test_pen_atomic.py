"""Unit test for the atomic multi-file write + the editing pen in _common.py.

Run from anywhere:  python3 editor/scripts/tests/test_pen_atomic.py
"""
import sys, os, json, tempfile, shutil
from pathlib import Path

from _pen_state import pen_released

# editor/scripts is one level up from tests/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _common as C

# Each leg below is a straight run of asserts that raises on failure; `_leg`
# records the ones that got through so the file ends on a `<n>/<n> passed`
# tally the repo's ONE python-suite runner can read (task 622 —
# scripts/lib/python-suites.mjs fails a suite that exits 0 printing none).
_legs: list[str] = []


def _leg(name: str) -> None:
    _legs.append(name)
    print(f"{name} OK")



def _crash_holding_pen(doc: Path, *, ttl: int = C.PEN_TTL_SECONDS, stamp: bool = True) -> None:
    """A REAL crash: a separate skill process acquires the pen and is killed
    before it releases (task 1111 — an in-process "crash" is a live hold, by
    construction). `stamp=False` kills it between the record write and the
    collab.json stamp."""
    import subprocess
    code = f"""
import os, sys
sys.path.insert(0, {str(Path(C.__file__).parent)!r})
import _common as C
if not {stamp!r}:
    real = C.atomic_write
    def die_on_stamp(writes, **k):
        if any(p.name == "collab.json" for p, _ in writes):
            os._exit(9)
        return real(writes, **k)
    C.atomic_write = die_on_stamp
C.acquire_pen(__import__("pathlib").Path({str(doc)!r}), ttl={ttl!r})
os._exit(9)
"""
    r = subprocess.run([sys.executable, "-c", code])
    assert r.returncode == 9, r


def _collab(doc: Path) -> dict:
    return json.loads((doc / "virgil" / "collab.json").read_text())


def _ctx(doc: Path) -> dict:
    return json.loads(C.pen_context_path(doc).read_text())


d = Path(tempfile.mkdtemp())
(d / "virgil").mkdir()
collab0 = {
    "enabled": False,
    "participants": [
        {"name": "Gabriel", "color": "#14b8a6", "firstSeen": "x"},
        {"name": "Claude", "color": "#6366f1", "firstSeen": "x"},
    ],
    "pen": {"holder": None, "since": None, "lastHeartbeat": None, "lastActivity": None, "requestedBy": []},
    "presence": {},
}
(d / "virgil" / "collab.json").write_text(json.dumps(collab0, indent=2) + "\n")

# --- atomic happy path (multi-file) ---
a = d / "virgil" / "a.json"
b = d / "virgil" / "b.json"
C.atomic_write([(a, C.json_dumps({"x": 1})), (b, C.json_dumps({"y": 2}))])
assert json.loads(a.read_text()) == {"x": 1}
assert json.loads(b.read_text()) == {"y": 2}
_leg("atomic happy")

# --- rollback on injected mid-commit fault ---
c = d / "virgil" / "c.json"
os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"] = "1"  # commit 1, then raise
try:
    C.atomic_write([(a, C.json_dumps({"x": 99})), (b, C.json_dumps({"y": 99})), (c, C.json_dumps({"z": 99}))])
    assert False, "should have raised"
except RuntimeError:
    pass
del os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"]
assert json.loads(a.read_text()) == {"x": 1}, "a must roll back"
assert json.loads(b.read_text()) == {"y": 2}, "b untouched"
assert not c.exists(), "c must not exist"
assert not any(p.name.endswith(".tmp") for p in (d / "virgil").iterdir()), "no leftover temps"
_leg("atomic rollback")

# --- pen acquire flips collab.json + writes pen-context ---
ctx = C.acquire_pen(d)
pcp = C.pen_context_path(d)
assert pcp.exists(), "pen-context not written"
pen_ctx = json.loads(pcp.read_text())
assert pen_ctx["holder"] == "claude", pen_ctx
assert pen_ctx["prior_collab_enabled"] is False
assert pen_ctx["collab_existed"] is True
collab_now = json.loads((d / "virgil" / "collab.json").read_text())
assert collab_now["enabled"] is True, "collab must be enabled on acquire"
assert collab_now["pen"]["holder"] == "Claude", collab_now["pen"]
assert collab_now["pen"]["since"] is not None
assert collab_now["pen"]["lastHeartbeat"] is not None
assert len(collab_now["participants"]) == 2, "participants preserved"
_leg("pen acquire")

# --- pen release restores collab + REWRITES pen-context as released ---
#
# RENEGOTIATED (task 496). This leg used to read `assert not pcp.exists()` —
# it pinned the DEFECT as the contract. The release deleted the record through
# `atomic_write`'s bare `os.remove`, and on a mount that refuses deletion (the
# reported cloud/Dropbox one) the raise fired AFTER the collab restore had
# committed: the rollback put collab.json back to acquire-time (enabled: true,
# Claude-held) and wedged the paper read-only, while the exception escaped
# `commit_under_pen`'s finally and reported exit 2 on an already-landed write.
# The release is a rewrite now, and released-ness is `pen_released` — absent OR
# `holder: null`, which the app's ladder reads as free INSTANTLY rather than
# after the 60 s TTL a delete-then-expire leaves open.
C.release_pen(d)
assert pen_released(d), "pen not released"
assert pcp.exists(), "the record is REWRITTEN, not deleted"
assert json.loads(pcp.read_text())["holder"] is None, "released record names no holder"
collab_after = json.loads((d / "virgil" / "collab.json").read_text())
assert collab_after["enabled"] is False, "collab must be restored to off"
assert collab_after["pen"]["holder"] is None, collab_after["pen"]
assert len(collab_after["participants"]) == 2
_leg("pen release")

# --- pen on a doc WITHOUT collab.json: no fabrication ---
d2 = Path(tempfile.mkdtemp())
(d2 / "virgil").mkdir()
C.acquire_pen(d2)
assert C.pen_context_path(d2).exists()
assert not (d2 / "virgil" / "collab.json").exists(), "must NOT fabricate collab.json"
C.release_pen(d2)
assert pen_released(d2)  # renegotiated with the leg above (task 496)
_leg("pen no-collab")

# --- commit_under_pen happy: write lands, pen released, collab restored ---
e = d / "virgil" / "e.json"
C.commit_under_pen(d, [(e, C.json_dumps({"e": 1}))])
assert json.loads(e.read_text()) == {"e": 1}
assert pen_released(d), "pen released after commit"  # 496: released ≠ deleted
assert json.loads((d / "virgil" / "collab.json").read_text())["enabled"] is False
_leg("commit_under_pen")

# --- commit_under_pen fault: main write rolls back, pen STILL released ---
f = d / "virgil" / "f.json"
os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"] = "1"
try:
    C.commit_under_pen(d, [(e, C.json_dumps({"e": 2})), (f, C.json_dumps({"f": 1}))])
    assert False, "should have raised"
except RuntimeError:
    pass
del os.environ["VIRGIL_TEST_FAIL_AFTER_WRITES"]
assert json.loads(e.read_text()) == {"e": 1}, "e must roll back"
assert not f.exists(), "f must not exist"
assert pen_released(d), "pen released even on failure"  # 496: released ≠ deleted
assert json.loads((d / "virgil" / "collab.json").read_text())["enabled"] is False, "collab restored even on failure"
_leg("commit_under_pen rollback")

# --- task 886: a CRASHED hold (acquired, never released) must not become the
# next acquire's restore target. Original state: collab off, user holds the pen.
d3 = Path(tempfile.mkdtemp())
(d3 / "virgil").mkdir()
user_pen = {"holder": "Gabriel", "since": "t0", "lastHeartbeat": "t0", "lastActivity": "t0", "requestedBy": []}
collab3 = dict(collab0, enabled=False, pen=user_pen)
(d3 / "virgil" / "collab.json").write_text(json.dumps(collab3, indent=2) + "\n")
_crash_holding_pen(d3)  # a skill run acquires ... and dies: no release
crashed = json.loads((d3 / "virgil" / "collab.json").read_text())
assert crashed["enabled"] is True and crashed["pen"]["holder"] == "Claude"
C.acquire_pen(d3)
ctx3 = json.loads((d3 / ".virgil" / "pen-context.json").read_text())
assert ctx3["prior_collab_enabled"] is False, "inherits the crashed hold's prior, not its writes"
assert ctx3["prior_pen"] == user_pen
C.release_pen(d3)
after = json.loads((d3 / "virgil" / "collab.json").read_text())
assert after["enabled"] is False, "release restores the ORIGINAL enabled"
assert after["pen"] == user_pen, "release restores the ORIGINAL pen"
assert pen_released(d3)
_leg("crashed hold not inherited as prior")

# --- task 886: Claude's own pen is never a restore target, even with no
# pen-context to inherit from (e.g. the record was lost with the crash).
(d3 / ".virgil" / "pen-context.json").unlink()
claude_pen = {"holder": "Claude", "since": "t1", "lastHeartbeat": "t1", "lastActivity": "t1", "requestedBy": []}
(d3 / "virgil" / "collab.json").write_text(json.dumps(dict(collab0, pen=claude_pen), indent=2) + "\n")
C.acquire_pen(d3)
C.release_pen(d3)
after = json.loads((d3 / "virgil" / "collab.json").read_text())
assert after["pen"] == C.FREE_PEN, "a Claude-held prior pen normalises to free"
_leg("claude pen never restored")
shutil.rmtree(d3)

# --- task 1111: the pen is a LEASE ------------------------------------------

def _fresh(enabled=False, pen=None) -> Path:
    p = Path(tempfile.mkdtemp())
    (p / "virgil").mkdir()
    c = dict(collab0, enabled=enabled, pen=pen or dict(C.FREE_PEN))
    (p / "virgil" / "collab.json").write_text(json.dumps(c, indent=2) + "\n")
    return p

# (a) a kill BETWEEN the record write and the collab stamp: collab never
# changed, so the next acquire snapshots the user's real state.
d4 = _fresh(enabled=False)
_crash_holding_pen(d4, stamp=False)
assert _collab(d4)["enabled"] is False, "the stamp never landed"
assert _ctx(d4)["holder"] == "claude", "…but the record did (written FIRST)"
C.release_pen(d4, C.acquire_pen(d4, wait=0))
assert _collab(d4)["enabled"] is False and _collab(d4)["pen"] == C.FREE_PEN
_leg("crash between writes is inert")

# (a') the PRE-1111 crash shape — collab stamped, record lost: collab
# enabled:true + Claude pen with nothing stamping it. Release must restore
# enabled:false (task 886 normalised only the pen).
(d4 / "virgil" / "collab.json").write_text(json.dumps(dict(
    collab0, enabled=True,
    pen={"holder": "Claude", "since": "t9", "lastHeartbeat": "t9", "lastActivity": "t9", "requestedBy": []},
)))
C.pen_context_path(d4).unlink()
C.release_pen(d4, C.acquire_pen(d4, wait=0))
assert _collab(d4)["enabled"] is False, "unstamped Claude-held collab never restores enabled:true"
assert _collab(d4)["pen"] == C.FREE_PEN
_leg("unstamped claude hold restores collab off")
shutil.rmtree(d4)

# (b) a stale crashed hold, then the USER acts (takes the pen, collab on):
# a later acquire must snapshot the user's state, not the pre-crash one.
d5 = _fresh(enabled=False)
_crash_holding_pen(d5, ttl=-1)
user_on = {"holder": "Gabriel", "since": "t5", "lastHeartbeat": "t5", "lastActivity": "t5", "requestedBy": []}
(d5 / "virgil" / "collab.json").write_text(json.dumps(dict(collab0, enabled=True, pen=user_on)))
ctx5 = C.acquire_pen(d5, wait=0)
assert ctx5["prior_collab_enabled"] is True and ctx5["prior_pen"] == user_on, ctx5
C.release_pen(d5, ctx5)
assert _collab(d5)["enabled"] is True and _collab(d5)["pen"] == user_on, "the user's toggle survives"
_leg("stale hold + user action: user's state survives")

# (b') the user takes over MID-hold: release leaves collab as the user set it.
ctx5 = C.acquire_pen(d5, wait=0)
(d5 / "virgil" / "collab.json").write_text(json.dumps(dict(collab0, enabled=False, pen=user_on)))
C.release_pen(d5, ctx5)
assert _collab(d5)["enabled"] is False and _collab(d5)["pen"] == user_on
assert pen_released(d5)
_leg("take-over mid-hold survives release")
shutil.rmtree(d5)

# (c) exclusivity: a live hold owned by another run refuses a second acquire.
d6 = _fresh(enabled=False)
first = C.acquire_pen(d6, wait=0)
live = dict(_ctx(d6), pid=os.getppid() or 1)  # a live process that isn't us
C.pen_context_path(d6).write_text(json.dumps(live))
try:
    C.acquire_pen(d6, wait=0.3)
    assert False, "a second concurrent acquire must refuse"
except C.PenBusy:
    pass
assert _ctx(d6)["lease_id"] == first["lease_id"], "the refusal wrote nothing"
# …and a run whose lease is no longer on disk releases NOTHING.
stranger = dict(first, lease_id="not-ours")
C.release_pen(d6, stranger)
assert _ctx(d6)["holder"] == "claude" and _collab(d6)["enabled"] is True, "a foreign release is a no-op"
C.release_pen(d6, first)
assert pen_released(d6) and _collab(d6)["enabled"] is False
_leg("second concurrent acquire refuses")

# (c') commit_under_pen turns a refusal into a clean die — nothing written.
C.pen_context_path(d6).write_text(json.dumps(live))
g = d6 / "virgil" / "g.json"
C.PEN_WAIT_SECONDS, _w = 0.0, C.PEN_WAIT_SECONDS
import io, contextlib
try:
    with contextlib.redirect_stderr(io.StringIO()) as err:
        C.commit_under_pen(d6, [(g, C.json_dumps({"g": 1}))])
    assert False, "commit_under_pen must die on a busy pen"
except SystemExit:
    pass
finally:
    C.PEN_WAIT_SECONDS = _w
assert not g.exists(), "nothing written under someone else's pen"
assert "held by another skill run" in err.getvalue(), err.getvalue()
_leg("commit_under_pen refuses a busy pen")
shutil.rmtree(d6)

shutil.rmtree(d)
shutil.rmtree(d2)
print("ALL PEN/ATOMIC TESTS PASSED")
print(f"{len(_legs)}/{len(_legs)} passed")
