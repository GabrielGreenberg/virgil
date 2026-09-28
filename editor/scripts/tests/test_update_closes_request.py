#!/usr/bin/env python3
"""Task 816: revising a card in place lands as ONE transaction that also closes
its request.

draft-footnote's act-on-existing branch used to rewrite the footnote with
`update`, then close the work with a SECOND command (`complete-task`, or a
second `update` lowering `aiRequest`). A failure between the two left the
request open over an already-rewritten footnote, so the next review rewrote it
again — and the `complete-task` stamped `direct-created` on an edit that created
nothing. Now `update` carries the `requestId` and `_mutation_commit` completes
the Task (auto-applied) and lowers the SOURCE flag in the same commit.

Pins:
  1. real request → one version bump; footnotes.json + .tex rewritten; Task
     complete/auto-applied; the linked footnote's aiRequest lowered.
  2. virtual:footnotes:<id> → the named footnote's flag lowered, no Task row.
  3. bad cardId / unknown requestId / already-terminal request / injected
     mid-commit failure → nothing changes (byte-identical).
  4. `clearSourceFlag: false` keeps the flag up (the opt-out cmd_write honours).

Run from anywhere:  python3 editor/scripts/tests/test_update_closes_request.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
APPLY = str(ROOT / "editor/scripts/apply_response.py")

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


FID = "f002"
BODY = "A revised footnote body, rewritten once."


def sandbox(*, linked=True, flag=True):
    """The sample paper with footnote FID flagged and the sample's footnote Task
    linked to it (the bridged act-on-existing shape)."""
    d = Path(tempfile.mkdtemp(prefix="t816-")) / "paper"
    shutil.copytree(SAMPLE, d)
    fp = d / "virgil/footnotes.json"
    fn = json.loads(fp.read_text())
    for f in fn["footnotes"]:
        if f["id"] == FID:
            f["aiRequest"] = flag
    fp.write_text(json.dumps(fn, indent=2) + "\n")
    ap = d / "virgil/ai-requests.json"
    ar = json.loads(ap.read_text())
    rid = next(r["id"] for r in ar["requests"] if r.get("kind") == "footnote")
    if linked:
        for r in ar["requests"]:
            if r["id"] == rid:
                r["linkedTo"] = {"panel": "footnotes", "cardId": FID}
    ap.write_text(json.dumps(ar, indent=2) + "\n")
    return d, rid


def run(doc, op, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, APPLY, str(doc), "update", json.dumps(op)],
                          capture_output=True, text=True, env=e)


def load(doc, name):
    return json.loads((doc / "virgil" / name).read_text())


def footnote(doc):
    return next(f for f in load(doc, "footnotes.json")["footnotes"] if f["id"] == FID)


def req(doc, rid):
    return next(r for r in load(doc, "ai-requests.json")["requests"] if r["id"] == rid)


def tex(doc):
    return next(doc.glob("*.tex")).read_text(encoding="utf-8")


def version(doc):
    p = doc / "virgil/version.txt"
    return int(p.read_text().strip() or 0) if p.exists() else 0


def snapshot(doc):
    snap = {}
    for p in sorted((doc / "virgil").glob("*.json")) + sorted(doc.glob("*.tex")):
        if p.name == "collab.json":
            continue  # the pen's own record; restored, not content
        snap[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
    vp = doc / "virgil/version.txt"
    snap["version.txt"] = vp.read_text() if vp.exists() else None
    return snap


print("\n=== real request: edit + Task close + flag lowered, one commit ===")
sb, rid = sandbox()
v0 = version(sb)
r = run(sb, {"cardId": FID, "body": BODY, "requestId": rid, "summary": f"Revised footnote {FID}"})
check(r.returncode == 0, f"update exited 0 (stderr={r.stderr.strip()[:200]})")
check(version(sb) == v0 + 1, "exactly one version bump")
fnc = footnote(sb)
check(json.dumps(fnc.get("content")).find(BODY) >= 0, "footnotes.json content rewritten")
check(f"\\vfid{{{FID}}}\\footnote{{{BODY}}}" in tex(sb), ".tex \\footnote{} body rewritten")
rq = req(sb, rid)
check(rq.get("status") == "complete", "Task complete")
check(rq.get("result") == "auto-applied", f"result auto-applied, not direct-created (got {rq.get('result')})")
check(fnc.get("aiRequest") is False, "linked footnote's aiRequest lowered in the same commit")

print("\n=== second landing on the drained Task is refused, nothing written ===")
before = snapshot(sb)
r = run(sb, {"cardId": FID, "body": "Rewritten AGAIN.", "requestId": rid})
check(r.returncode != 0, "second update on a complete Task exits non-zero")
check("terminal" in (r.stderr + r.stdout), "refusal names the terminal state")
check(snapshot(sb) == before, "byte-identical after the refusal")

print("\n=== virtual id: the named footnote's flag lowered ===")
sb, rid = sandbox(linked=False)
ar_before = (sb / "virgil/ai-requests.json").read_bytes()
r = run(sb, {"cardId": FID, "body": BODY, "requestId": f"virtual:footnotes:{FID}"})
check(r.returncode == 0, f"virtual update exited 0 (stderr={r.stderr.strip()[:200]})")
check(footnote(sb).get("aiRequest") is False, "virtual: footnote aiRequest lowered")
check(f"\\footnote{{{BODY}}}" in tex(sb), "virtual: .tex rewritten")
check((sb / "virgil/ai-requests.json").read_bytes() == ar_before, "virtual: ai-requests.json untouched")

print("\n=== failures change nothing ===")
for label, op, env in [
    ("bad cardId", {"cardId": "nope", "body": BODY, "requestId": None}, None),
    ("unknown requestId", {"cardId": FID, "body": BODY, "requestId": "no-such-request"}, None),
    ("malformed virtual id", {"cardId": FID, "body": BODY, "requestId": "virtual:footnotes"}, None),
    ("injected mid-commit failure", {"cardId": FID, "body": BODY, "requestId": None},
     {"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"}),
]:
    sb, rid = sandbox()
    if op["requestId"] is None:
        op["requestId"] = rid
    before = snapshot(sb)
    r = run(sb, op, env)
    check(r.returncode != 0, f"{label}: exits non-zero")
    check(snapshot(sb) == before, f"{label}: byte-identical (no edit, no Task close, no flag change)")

print("\n=== clearSourceFlag:false keeps the flag up ===")
sb, rid = sandbox()
r = run(sb, {"cardId": FID, "body": BODY, "requestId": rid, "clearSourceFlag": False})
check(r.returncode == 0, "opt-out update exited 0")
check(footnote(sb).get("aiRequest") is True, "flag left up on opt-out")
check(req(sb, rid).get("status") == "complete", "Task still completed")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
