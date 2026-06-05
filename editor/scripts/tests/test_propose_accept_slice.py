#!/usr/bin/env python3
r"""End-to-end test of the chip-14 propose-responder migration → chip-13 accept.

The propose-flow responders (draft-suggestion, answer-cutter-comment,
answer-revision-comment path a, and the answer-note/answer-todo doc-edit
branches) now DRAFT a proposal via the contract's L3 propose path
(`apply_response.py complete-task --propose`) instead of legacy default-apply.
The defining difference: legacy default-apply completed the Task immediately
(no L3 lifecycle); propose leaves the Task awaiting review, so the proposal is
CONSUMABLE by chip 13's `accept` op.

This proves the migrated draft → accept loop end to end, on FRESH copies of
samples/annotation-history (never the sample):

  1. Draft a proposal against a REAL pending Task, with `original_text` read
     VERBATIM from the live .tex via get_para_context.py — exactly what a
     migrated responder does. The Task is left `in-progress` (NOT `complete`,
     the legacy behavior), the card lands `pending`, the .tex is untouched.
  2. ACCEPT it (chip 13): the FRESH proposal PASSES the stale guard — because
     `original_text` is the current verbatim span — so the .tex is spliced, the
     card → `accepted`, the Task → `complete`/`accepted`.
  3. propose → REJECT: the card → `rejected`, the Task → `complete`/`rejected`,
     the .tex byte-for-byte unchanged.

Covers the revisions AND cutter panels (the two suggestion homes).

Run from anywhere:  python3 editor/scripts/tests/test_propose_accept_slice.py
"""
import hashlib
import json
import os
import re
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
GETPARA = str(SCRIPTS / "get_para_context.py")

ISO = "2026-06-05T00:00:00.000Z"
PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip14-"))
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


def tex_of(doc):
    return next(doc.glob("*.tex")).read_text(encoding="utf-8")


def card_by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


def req_by_id(doc, rid):
    ar = load(doc, "ai-requests.json") or {}
    return next((r for r in ar.get("requests", []) if r.get("id") == rid), None)


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


def add_request(doc, req):
    """Inject a user-filed Task into ai-requests.json (what the editor bridge
    would have written). The migrated responder drafts against this real id —
    exercising the real-requestId propose path (a pending Task flips to
    in-progress), not --synthesize-task."""
    p = doc / "virgil" / "ai-requests.json"
    st = json.loads(p.read_text())
    st.setdefault("requests", []).append(req)
    p.write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def live_first_sentence(doc, anchor):
    """Read the anchor paragraph from the LIVE .tex via get_para_context.py (the
    same helper a responder calls) and return its first sentence VERBATIM — the
    original_text a migrated responder copies, with the trailing %!v: marker
    excluded (draft-suggestion.md step 2)."""
    para = json.loads(run(GETPARA, str(doc), anchor).stdout)["paragraph"]
    para = re.sub(r"\s*%!v:[0-9a-f]{4}\s*$", "", para).strip()
    m = re.search(r"^.*?\.(?=\s|$)", para, re.S)
    return (m.group(0) if m else para).strip()


def anchor_link(card_id, kind, uuid):
    """The canonical Mode-A textObject anchor link a migrated responder emits
    (SSOT src/links/_shared/types.ts; mirrors create_card._anchor_link). NOT the
    retired {type:"anchor", paragraphIds} shape the old skill markdown showed."""
    return {
        "id": f"link-{card_id}", "kind": "anchor",
        "anchor": {"type": "textObject", "targetKind": "paragraph",
                   "textObjectIds": [uuid], "margin": {"side": "right"}},
        "target": {"type": "card", "ref": {"kind": kind, "id": card_id}},
        "createdAt": ISO,
    }


def draft_proposal(doc, *, panel, card_id, kind_label, task_id, anchor, original, suggested):
    """Draft an L3 proposal exactly as a MIGRATED responder now does: compose the
    suggestion card (original_text verbatim from the .tex, canonical anchor,
    author=ai, status=pending, the aiOriginRequestId back-pointer accept reads)
    and land it via `complete-task --propose` against a REAL pending Task.
    Legacy default-apply would have completed the Task at once; propose leaves it
    awaiting review."""
    card = {
        "kind": "suggestion", "id": card_id, "createdAt": ISO, "author": "ai",
        "original_text": original, "suggested_text": suggested,
        "explanation": "tightened the passage", "user_text": "", "instructions": "tighten this",
        "status": "pending", "selectedText": "",
        "links": [anchor_link(card_id, kind_label, anchor)],
        "aiOriginRequestId": task_id,
    }
    op = {"requestId": task_id, "panel": panel, "card": card,
          "summary": "Drafted a suggestion", "clearSourceFlag": False}
    return run(APPLY, str(doc), "complete-task", json.dumps(op), "--propose")


# ===== revision: propose (real Task) → accept; a FRESH proposal passes the stale guard
print("\n=== revision: migrated responder drafts via complete-task --propose → accept ===")
sb = sandbox()
add_request(sb, {"id": "sug-rev-1", "kind": "suggestion", "text": "tighten the opening",
                 "createdAt": ISO, "status": "pending", "paragraphIds": ["6607"]})
original = live_first_sentence(sb, "6607")
check(original in tex_of(sb) and original.startswith("The fact that this notation"),
      "original_text read VERBATIM from the live .tex (the responder's copy step)")
suggested = "That this notation endured into the present is no typographic accident."
r = draft_proposal(sb, panel="revisions", card_id="rev-1", kind_label="revision-suggestion",
                   task_id="sug-rev-1", anchor="6607", original=original, suggested=suggested)
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:160]})")
check(out_of(r).get("status") == "in-progress", "propose returns status=in-progress")

# Pre-accept: the defining L3 shape. Legacy default-apply would have set the Task
# `complete` + stamped a result here; propose leaves it awaiting review.
card = card_by_id(sb, "revisions.json", "cards", "rev-1")
check(card is not None and card["status"] == "pending", "card drafted pending in revisions.json")
task = req_by_id(sb, "sug-rev-1")
check(task["status"] == "in-progress", "Task left AWAITING REVIEW (in-progress) — not legacy 'complete'")
check(task.get("result") is None, "Task carries no result yet (non-terminal)")
check(task.get("resultId") == "rev-1", "Task.resultId points at the drafted proposal card")
check(original in tex_of(sb) and suggested not in tex_of(sb), ".tex UNTOUCHED by the proposal")

# accept (chip 13): the fresh proposal passes the stale guard + splices.
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-1"}))
check(r.returncode == 0,
      f"accept exited 0 — the FRESH proposal PASSED the stale guard (stderr={r.stderr.strip()[:160]})")
check(out_of(r).get("result") == "accepted" and out_of(r).get("cardKind") == "revision-suggestion",
      "accept: result=accepted, cardKind=revision-suggestion")
check(suggested in tex_of(sb) and original not in tex_of(sb),
      ".tex spliced: suggested_text landed, original_text gone")
check(card_by_id(sb, "revisions.json", "cards", "rev-1")["status"] == "accepted", "card status → accepted")
task = req_by_id(sb, "sug-rev-1")
check(task["status"] == "complete" and task.get("result") == "accepted", "Task → complete / accepted")

# ===== cutter: the parallel panel migrates identically
print("\n=== cutter: the parallel suggestion panel, same propose → accept loop ===")
sb = sandbox()
add_request(sb, {"id": "sug-cut-1", "kind": "suggestion", "text": "trim this",
                 "createdAt": ISO, "status": "pending", "paragraphIds": ["5505"]})
original = live_first_sentence(sb, "5505")
check(original in tex_of(sb), "cutter original_text read verbatim from the live .tex")
suggested = "The aligned tiers formalize the marginal gloss."
r = draft_proposal(sb, panel="cutter", card_id="cut-1", kind_label="cutter-suggestion",
                   task_id="sug-cut-1", anchor="5505", original=original, suggested=suggested)
check(r.returncode == 0, f"cutter propose exited 0 (stderr={r.stderr.strip()[:160]})")
check(req_by_id(sb, "sug-cut-1")["status"] == "in-progress", "cutter Task awaiting review (in-progress)")
check(card_by_id(sb, "cutter.json", "cards", "cut-1")["status"] == "pending", "cutter card drafted pending")
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "cut-1"}))
check(r.returncode == 0, f"cutter accept exited 0 (stderr={r.stderr.strip()[:160]})")
check(out_of(r).get("cardKind") == "cutter-suggestion", "accept: cardKind=cutter-suggestion")
check(suggested in tex_of(sb), "cutter suggested_text spliced into the .tex")
ct = req_by_id(sb, "sug-cut-1")
check(ct["status"] == "complete" and ct.get("result") == "accepted", "cutter Task → complete / accepted")

# ===== reject: propose → reject; .tex byte-for-byte unchanged
print("\n=== propose → reject: proposal dismissed, Task completed, .tex unchanged ===")
sb = sandbox()
add_request(sb, {"id": "sug-rev-2", "kind": "suggestion", "text": "maybe rephrase",
                 "createdAt": ISO, "status": "pending", "paragraphIds": ["6607"]})
original = live_first_sentence(sb, "6607")
r = draft_proposal(sb, panel="revisions", card_id="rev-2", kind_label="revision-suggestion",
                   task_id="sug-rev-2", anchor="6607", original=original, suggested="never applied")
check(r.returncode == 0, "propose exited 0")
check(req_by_id(sb, "sug-rev-2")["status"] == "in-progress", "Task awaiting review before reject")
tex_before = hashlib.sha256(tex_of(sb).encode()).hexdigest()
r = run(APPLY, str(sb), "reject", json.dumps({"cardId": "rev-2"}))
check(r.returncode == 0, f"reject exited 0 (stderr={r.stderr.strip()[:160]})")
check(card_by_id(sb, "revisions.json", "cards", "rev-2")["status"] == "rejected", "card status → rejected")
task = req_by_id(sb, "sug-rev-2")
check(task["status"] == "complete" and task.get("result") == "rejected", "Task → complete / rejected")
check(hashlib.sha256(tex_of(sb).encode()).hexdigest() == tex_before,
      "document.tex byte-for-byte unchanged (reject never edits the .tex)")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
