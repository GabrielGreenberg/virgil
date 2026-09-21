#!/usr/bin/env python3
r"""The CLOSE arity of the terminate path, and the Python status vocabulary
behind it (task 2026-09-20-680).

`apply_response._Txn.close_linked_request` is the Python half of the UI
bridge's `"terminate"` mode (`src/lib/ai-request-bridge.ts`): archiving or
deleting a flagged card must close EVERY non-terminal `ai-requests.json` row
linked to it. Task 253 established that arity in TypeScript because a single
card can legitimately carry TWO non-terminal linked rows at once —

  * an answered-L3 row (`in-progress` + `resultId`), which the drain already
    counts closed and which task 043 protects from a plain toggle-off; plus
  * a fresh re-toggled `pending` row.

The Python twin stopped at the first match (`return True` inside the loop), so
`/editor/*`'s `cmd_archive` closed one and left the other OPEN — and the next
`/editor/review` drain re-served a request for a card that no longer exists.
That is the whole point of this suite: the arity, driven end-to-end through the
real `archive` op, not asserted over source text.

It also pins the vocabulary those guards read — `_common.is_terminal_status` /
`is_request_open`, the Python mirror of TS `isTerminalStatus` / `isRequestOpen`
— now that the four hand-copied `("complete", "failed")` literals are folded
onto them.

Run from anywhere:  python3 editor/scripts/tests/test_close_linked_arity.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
APPLY = str(SCRIPTS / "apply_response.py")
LIST = str(SCRIPTS / "list_requests.py")

sys.path.insert(0, str(SCRIPTS))
import _common as C  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="close-arity-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args):
    return subprocess.run(
        [sys.executable, *args], capture_output=True, text=True, env=dict(os.environ)
    )


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def write(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


def rows_by_id(doc):
    return {r["id"]: r for r in load(doc, "ai-requests.json")["requests"]}


def listed_ids(doc):
    r = run(LIST, str(doc))
    assert r.returncode == 0, f"list_requests failed: {r.stderr}"
    return {
        json.loads(line)["id"]
        for line in r.stdout.splitlines()
        if line.strip().startswith("{")
    }


def a_todo(doc):
    """The first todo card in the sandbox, flagged, so archive has a real
    linked card to terminate."""
    state = load(doc, "todos.json")
    item = state["items"][0]
    item["aiRequest"] = True
    write(doc, "todos.json", state)
    return item["id"]


ISO = "2026-09-20T00:00:00.000Z"


def two_row_fixture(doc, card_id):
    """The task-253 shape: ONE card, TWO non-terminal linked rows — an
    answered-L3 (`in-progress`+`resultId`) plus a fresh re-toggled `pending` —
    alongside an already-terminal row (idempotence control) and a row linked to
    a DIFFERENT card (blast-radius control)."""
    link = {"panel": "todos", "cardId": card_id}
    write(doc, "ai-requests.json", {"requests": [
        {"id": "r-answered", "kind": "todo", "status": "in-progress",
         "resultId": "rev-1", "linkedTo": link, "text": "answered L3",
         "paragraphIds": [], "createdAt": ISO, "safetyLevel": 3},
        {"id": "r-fresh", "kind": "todo", "status": "pending",
         "linkedTo": link, "text": "re-toggled", "paragraphIds": [],
         "createdAt": ISO},
        {"id": "r-done", "kind": "todo", "status": "complete",
         "result": "accepted", "linkedTo": link, "text": "already closed",
         "paragraphIds": [], "createdAt": ISO},
        {"id": "r-other", "kind": "todo", "status": "pending",
         "linkedTo": {"panel": "todos", "cardId": "some-other-card"},
         "text": "different card", "paragraphIds": [], "createdAt": ISO},
    ]})


print("\n=== archive closes EVERY non-terminal linked row, not just the first ===")
sb = sandbox()
todo_id = a_todo(sb)
two_row_fixture(sb, todo_id)
# Pre-condition: the drain hides the answered-L3 row but serves the fresh one,
# which is exactly why both must close — otherwise the surviving row is
# re-served for a card that no longer exists.
pre = listed_ids(sb)
check("r-fresh" in pre, "pre: the fresh pending row is OPEN to the drain")
check("r-answered" not in pre, "pre: the answered-L3 row is already drain-hidden")

r = run(APPLY, str(sb), "archive", json.dumps({"cardId": todo_id}))
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:200]})")

after = rows_by_id(sb)
check(after["r-answered"]["status"] == "complete",
      "answered-L3 row closed to complete (force=True defeats the 043 hold)")
check(after["r-answered"].get("result") == "auto-applied",
      "answered-L3 row stamped result=auto-applied")
check(after["r-answered"].get("resultId") == "rev-1",
      "answered-L3 resultId preserved (audit trail intact)")
check(after["r-fresh"]["status"] == "complete",
      "THE BUG: the SECOND non-terminal row is closed too, not left open")
check(after["r-fresh"].get("result") == "auto-applied",
      "second row stamped result=auto-applied as well")
check(after["r-done"].get("result") == "accepted",
      "an already-terminal row is untouched (its own result survives)")
check(after["r-other"]["status"] == "pending",
      "a row linked to a DIFFERENT card is untouched")
check(listed_ids(sb).isdisjoint({"r-answered", "r-fresh"}),
      "neither row is re-served by the drain after the card is gone")

print("\n=== the close is idempotent and writes nothing without a match ===")
sb2 = sandbox()
todo2 = a_todo(sb2)
write(sb2, "ai-requests.json", {"requests": [
    {"id": "r-done-only", "kind": "todo", "status": "complete",
     "result": "accepted", "linkedTo": {"panel": "todos", "cardId": todo2},
     "text": "already closed", "paragraphIds": [], "createdAt": ISO},
]})
before = (sb2 / "virgil" / "ai-requests.json").read_text()
r = run(APPLY, str(sb2), "archive", json.dumps({"cardId": todo2}))
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:200]})")
check((sb2 / "virgil" / "ai-requests.json").read_text() == before,
      "no matching non-terminal row ⇒ ai-requests.json is not rewritten")

print("\n=== _common status vocabulary (the Python twin of ai-request-open.ts) ===")
check(C.TERMINAL_STATUSES == ("complete", "failed"),
      "TERMINAL_STATUSES is the frozen { complete, failed } set")
for s, want in [("complete", True), ("failed", True), ("pending", False),
                ("in-progress", False), ("draft", False), ("submitted", False),
                (None, False)]:
    check(C.is_terminal_status(s) is want, f"is_terminal_status({s!r}) is {want}")
check(C.is_request_open({"status": "in-progress", "resultId": "x"}) is False,
      "is_request_open: answered-L3 (in-progress + resultId) is CLOSED")
check(C.is_request_open({"status": "in-progress"}) is True,
      "is_request_open: in-progress WITHOUT a resultId is OPEN")
check(C.is_request_open({"status": "in-progress", "resultId": ""}) is True,
      "is_request_open: an empty-string resultId is falsy, so the row is OPEN")
check(C.is_request_open({"status": "complete"}) is False,
      "is_request_open: a terminal row is CLOSED")
check(C.is_request_open({}) is True,
      "is_request_open: a status-absent row is OPEN")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
