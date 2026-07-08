#!/usr/bin/env python3
r"""Lifecycle test: an ANSWERED AI request stops recycling — for every responder
shape. Proves the closing half of the AI-request loop (task 2026-07-03-019): once
a request is answered, a fresh `list_requests.py` run must NOT re-emit it.

The single drain-side invariant under test (list_requests.list_ai_requests):

    open == not-terminal  AND  not (in-progress WITH a non-empty resultId)

plus its twin, the source-card flag clear (apply_response.clear_source_flag,
default-on) that closes the unbridged-card-flag fallback leg. BOTH legs must
close, because once the drain hides an answered ai-request row it also stops
adding that row to the `bridged` dedup set — so a still-flagged source card
would resurface through the fallback if its flag weren't cleared.

Responder shapes covered (answer → not-re-listed), on FRESH copies of
samples/annotation-history (never the sample):

  * L1 / write-silent           (safetyLevel 1)  → status complete
  * L2 / write-with-comment      (safetyLevel 2)  → status complete
  * direct create                (no safetyLevel)  → status complete
  * L3 / complete-task --propose (safetyLevel 3)  → in-progress WITH resultId
  * bridged L3 propose            → also clears the linked source card's flag
  * negative control: in-progress WITHOUT a resultId stays OPEN (still listed)

This EXTENDS the terminal-case coverage already in test_footnote_slice.py
(:205-216, the L1 completed-request-drops case) to the L2/direct/L3 shapes and
the source-flag leg. Run from anywhere:

    python3 editor/scripts/tests/test_request_resolve_slice.py
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
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")
LIST = str(SCRIPTS / "list_requests.py")

ISO = "2026-07-03T00:00:00.000Z"
BODY = "Bayle was an exiled Huguenot polemicist at Rotterdam."
PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="resolve-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=e)


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def write_json(doc, name, data):
    (doc / "virgil" / name).write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def footnote_req_id(doc):
    ar = load(doc, "ai-requests.json")
    return next(r["id"] for r in ar["requests"] if r.get("kind") == "footnote")


def set_safety(doc, req_id, level):
    ar = load(doc, "ai-requests.json")
    for r in ar["requests"]:
        if r["id"] == req_id:
            r["safetyLevel"] = level
    write_json(doc, "ai-requests.json", ar)


def listed_ids(doc):
    """The set of request ids `list_requests.py` currently emits as open."""
    r = run(LIST, str(doc))
    ids = set()
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            ids.add(json.loads(line).get("id"))
    return ids


def card_by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


# ============================================================ shape matrix
# One footnote request, answered four ways; each answered form must drop from
# the drain. (Footnote is the convenient carrier — the drain rule keys on
# status/resultId, which are kind-agnostic.)

print("\n=== baseline: an unanswered request IS listed ===")
sb = sandbox()
rid = footnote_req_id(sb)
check(rid in listed_ids(sb), "open footnote request (status submitted) is listed")

print("\n=== L1 / write-silent (safety 1) → complete → not re-listed ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 1)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
check(load(sb, "ai-requests.json") and
      next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == rid)["status"] == "complete",
      "request flipped to complete")
check(rid not in listed_ids(sb), "answered L1 request NOT re-listed")

print("\n=== L2 / write-with-comment (safety 2) → complete → not re-listed ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 2)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
check(rid not in listed_ids(sb), "answered L2 request NOT re-listed")

print("\n=== direct create (no safety) → complete → not re-listed ===")
sb = sandbox(); rid = footnote_req_id(sb)  # request carries no safetyLevel
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
check(rid not in listed_ids(sb), "answered direct-create request NOT re-listed")

print("\n=== L3 / complete-task --propose (safety 3) → in-progress+resultId → not re-listed ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 3)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == rid)
check(req["status"] == "in-progress", "L3 Task deliberately left in-progress (awaiting review)")
check(req.get("resultId"), "L3 Task carries a resultId (the drafted proposal card)")
check(rid not in listed_ids(sb),
      "drafted L3 proposal NOT re-listed — the user owns accept/reject, drain never re-nags")

print("\n=== negative control: in-progress WITHOUT a resultId stays OPEN ===")
# Locks the gate to resultId specifically — an L3 Task that has NOT yet drafted
# its card (no resultId) is still an open drain item; only the resultId stamp
# closes it. Guards against a blanket "hide all in-progress" regression.
sb = sandbox()
ar = load(sb, "ai-requests.json")
ar["requests"].append({"id": "inprog-no-result", "kind": "note", "text": "half-done",
                       "createdAt": ISO, "status": "in-progress"})
write_json(sb, "ai-requests.json", ar)
check("inprog-no-result" in listed_ids(sb),
      "in-progress row with NO resultId is still listed (open)")
# now stamp a resultId → it must drop
ar = load(sb, "ai-requests.json")
next(x for x in ar["requests"] if x["id"] == "inprog-no-result")["resultId"] = "somecard"
write_json(sb, "ai-requests.json", ar)
check("inprog-no-result" not in listed_ids(sb),
      "same row drops the moment a resultId is stamped")

# ============================================================ source-flag leg
# The sample ships a bridged L3 fixture: a `suggestion` request linked to a
# flagged todo card (aiRequest:true). Answering it via propose must (a) hide the
# ai-request row (resultId gate) AND (b) clear the todo's flag — otherwise the
# now-unshielded todo resurfaces through the unbridged-card-flag fallback.
SUG_REQ = "b5c93b58-33be-4ab5-bc9e-4507fa16e33a"
TODO_ID = "ea401798-8d6b-4b4e-9b58-c48ae02437e2"


def draft_suggestion_proposal(doc, *, clear_source_flag):
    card = {
        "kind": "suggestion", "id": "rev-resolve-1", "createdAt": ISO, "author": "ai",
        "original_text": "orig", "suggested_text": "tighter", "explanation": "tightened",
        "user_text": "", "instructions": "tighten this", "status": "pending", "selectedText": "",
        "links": [{
            "id": "link-rev-resolve-1", "kind": "anchor",
            "anchor": {"type": "textObject", "targetKind": "paragraph",
                       "textObjectIds": ["6612"], "margin": {"side": "right"}},
            "target": {"type": "card", "ref": {"kind": "revision-suggestion", "id": "rev-resolve-1"}},
            "createdAt": ISO,
        }],
        "aiOriginRequestId": SUG_REQ,
    }
    op = {"requestId": SUG_REQ, "panel": "revisions", "card": card,
          "summary": "Drafted a suggestion", "clearSourceFlag": clear_source_flag}
    return run(APPLY, str(doc), "complete-task", json.dumps(op), "--propose")


print("\n=== bridged L3 propose → hides the row AND clears the source todo flag ===")
sb = sandbox()
check(SUG_REQ in listed_ids(sb), "pre: bridged suggestion request is listed")
check(card_by_id(sb, "todos.json", "items", TODO_ID).get("aiRequest") is True,
      "pre: linked todo carries aiRequest:true")
r = draft_suggestion_proposal(sb, clear_source_flag=True)
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:160]})")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == SUG_REQ)
check(req["status"] == "in-progress" and req.get("resultId") == "rev-resolve-1",
      "request left in-progress with resultId → drain-hidden")
check(card_by_id(sb, "todos.json", "items", TODO_ID).get("aiRequest") is False,
      "source todo flag CLEARED (default-on clearSourceFlag)")
ids = listed_ids(sb)
check(SUG_REQ not in ids, "answered request NOT re-listed (ai-request leg closed)")
check(f"virtual:todos:{TODO_ID}" not in ids,
      "source todo NOT resurfaced via the unbridged-card-flag fallback (source-flag leg closed)")

print("\n=== twin-leg coupling: if the flag is NOT cleared, the fallback re-nags ===")
# Demonstrates WHY both legs must close: with clearSourceFlag:false the row is
# still drain-hidden (resultId), but the still-flagged todo — no longer shielded
# in the `bridged` dedup set — resurfaces. (No real responder passes false here;
# this pins the mechanism the default protects against.)
sb = sandbox()
r = draft_suggestion_proposal(sb, clear_source_flag=False)
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:160]})")
check(card_by_id(sb, "todos.json", "items", TODO_ID).get("aiRequest") is True,
      "flag left set (clearSourceFlag:false)")
ids = listed_ids(sb)
check(SUG_REQ not in ids, "ai-request row still hidden by the resultId gate")
check(f"virtual:todos:{TODO_ID}" in ids,
      "un-cleared todo RESURFACES via the fallback — the recycle the default clear prevents")

print("\n=== archive TERMINATES an answered-L3 row (in-progress+resultId) — task 093 ===")
# A toggle-off deliberately PRESERVES an answered-L3 row's resultId (task 043),
# but archive means the card is *gone* — a terminal transition. cmd_archive
# passes force=True to close_linked_request, which must flip the lingering
# in-progress+resultId row to `complete` (not leave it dangling, which the inbox
# would then paint OPEN — GAP 1). This is the Python twin of the UI bridge's
# "terminate" mode.
sb = sandbox()
r = draft_suggestion_proposal(sb, clear_source_flag=True)
check(r.returncode == 0, f"pre: propose exited 0 (stderr={r.stderr.strip()[:160]})")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == SUG_REQ)
check(req["status"] == "in-progress" and req.get("resultId") == "rev-resolve-1",
      "pre: SUG_REQ is answered-L3 (in-progress+resultId), lingering after propose")
r = run(APPLY, str(sb), "archive", json.dumps({"cardId": TODO_ID}))
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:160]})")
check(card_by_id(sb, "todos.json", "items", TODO_ID) is None, "linked todo removed from todos.json")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == SUG_REQ)
check(req["status"] == "complete",
      "answered-L3 row TERMINATED to complete on archive (force=True) — no longer lingering")
check(req.get("result") == "auto-applied", "terminal result stamped auto-applied")
check(req.get("resultId") == "rev-resolve-1", "resultId pointer preserved (audit trail intact)")
check(SUG_REQ not in listed_ids(sb), "terminated row stays drain-hidden")
# Control for the 043 protection (force=False must NOT terminate answered-L3) is
# already proven above: after `propose` — an answer path, not an archive — the
# same SUG_REQ row stays `in-progress`+`resultId` (":210"), untouched.

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
