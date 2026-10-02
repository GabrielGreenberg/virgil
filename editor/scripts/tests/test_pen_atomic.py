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
C.acquire_pen(d3)  # ... and the process dies here: no release
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

shutil.rmtree(d)
shutil.rmtree(d2)
print("ALL PEN/ATOMIC TESTS PASSED")
print(f"{len(_legs)}/{len(_legs)} passed")
