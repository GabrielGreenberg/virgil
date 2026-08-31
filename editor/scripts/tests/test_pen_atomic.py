"""Unit test for the atomic multi-file write + the editing pen in _common.py.

Run from anywhere:  python3 editor/scripts/tests/test_pen_atomic.py
"""
import sys, os, json, tempfile, shutil
from pathlib import Path

from _pen_state import pen_released

# editor/scripts is one level up from tests/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _common as C

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
print("atomic happy OK")

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
print("atomic rollback OK")

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
print("pen acquire OK")

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
print("pen release OK")

# --- pen on a doc WITHOUT collab.json: no fabrication ---
d2 = Path(tempfile.mkdtemp())
(d2 / "virgil").mkdir()
C.acquire_pen(d2)
assert C.pen_context_path(d2).exists()
assert not (d2 / "virgil" / "collab.json").exists(), "must NOT fabricate collab.json"
C.release_pen(d2)
assert pen_released(d2)  # renegotiated with the leg above (task 496)
print("pen no-collab OK")

# --- commit_under_pen happy: write lands, pen released, collab restored ---
e = d / "virgil" / "e.json"
C.commit_under_pen(d, [(e, C.json_dumps({"e": 1}))])
assert json.loads(e.read_text()) == {"e": 1}
assert pen_released(d), "pen released after commit"  # 496: released ≠ deleted
assert json.loads((d / "virgil" / "collab.json").read_text())["enabled"] is False
print("commit_under_pen OK")

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
print("commit_under_pen rollback OK")

shutil.rmtree(d)
shutil.rmtree(d2)
print("ALL PEN/ATOMIC TESTS PASSED")
