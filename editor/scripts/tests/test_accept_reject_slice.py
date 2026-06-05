#!/usr/bin/env python3
r"""End-to-end test of the chip-13 L3 consummation ops (accept / reject) on the
apply_response v1 contract — closing the propose→review→apply loop.

Exercises the full Level-3 lifecycle: draft a proposal (complete-task --propose,
the .tex untouched + Task awaiting review), then ACCEPT it (the generic
replace-span splice + card status→accepted + Task result=accepted, all one atomic
pen commit) or REJECT it (status→rejected + Task result=rejected, .tex untouched).
Plus the stale-proposal guard (refuse a proposal whose original_text no longer
matches) and the atomicity proof (a fault between the splice and the card/Task
update rolls EVERYTHING back).

Runs the real CLIs against fresh copies of samples/annotation-history (never
mutating the sample). Handles revision-suggestion AND cutter-suggestion.

Run from anywhere:  python3 editor/scripts/tests/test_accept_reject_slice.py
"""
import hashlib
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

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip13-"))
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
    texs = list(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""


def card_by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


def req_by_id(doc, rid):
    ar = load(doc, "ai-requests.json") or {}
    return next((r for r in ar.get("requests", []) if r.get("id") == rid), None)


def version(doc):
    p = doc / "virgil/version.txt"
    return p.read_text().strip() if p.exists() else None


def pen_gone(doc):
    return not (doc / ".virgil/pen-context.json").exists()


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


# Verbatim sentences from samples/annotation-history/document.tex (frozen).
REV_ORIGINAL = ("The fact that this notation has survived from the late nineteenth century "
                "into the present is not an accident of typography.")
REV_SUGGESTED = ("That this notation has endured from the late nineteenth century into the "
                 "present is no typographic accident.")
# A pre-existing in-sample cutter suggestion (Mode-B, anchor 5505, pending, author ai).
SAMPLE_CUTTER = "fe55c27a-5c73-42f2-aed6-c81329f2655f"
SAMPLE_CUTTER_SUGGESTED = "The aligned tiers formalize what a marginal gloss does"


def anchor_link(card_id, kind, uuid):
    """A Mode-A textObject anchor link (the on-disk shape suggestion cards use)."""
    return {
        "id": f"link-{card_id}",
        "kind": "anchor",
        "anchor": {"type": "textObject", "targetKind": "paragraph",
                   "textObjectIds": [uuid], "margin": {"side": "right"}},
        "target": {"type": "card", "ref": {"kind": kind, "id": card_id}},
        "createdAt": "2026-06-05T00:00:00.000Z",
    }


def propose(doc, *, panel, card_id, kind_label, task_id, anchor, original, suggested):
    """Draft an L3 proposal exactly as a legacy responder would, via the v1
    propose path (complete-task --propose --synthesize-task): the card lands,
    the .tex stays untouched, the synthesized Task is left awaiting review."""
    card = {
        "kind": "suggestion", "id": card_id, "createdAt": "2026-06-05T00:00:00.000Z",
        "author": "ai", "original_text": original, "suggested_text": suggested,
        "explanation": "test proposal", "user_text": "", "instructions": "test",
        "status": "pending", "selectedText": original,
        "links": [anchor_link(card_id, kind_label, anchor)],
        "aiOriginRequestId": task_id,
    }
    op = {
        "requestId": task_id, "panel": panel, "card": card,
        "kind": "suggestion", "text": "please revise", "paragraphIds": [anchor],
        "safetyLevel": 3, "summary": "Drafted a suggestion", "clearSourceFlag": False,
    }
    return run(APPLY, str(doc), "complete-task", json.dumps(op), "--propose", "--synthesize-task")


# ===================================================== accept: the L3 lifecycle
print("\n=== accept (revision): propose → review → apply, one atomic splice ===")
sb = sandbox()
r = propose(sb, panel="revisions", card_id="rev-acc-1", kind_label="revision-suggestion",
            task_id="rev-prop-1", anchor="6607", original=REV_ORIGINAL, suggested=REV_SUGGESTED)
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:160]})")

# --- pre-state: the proposal is DRAFTED but NOT applied (L3's defining shape) ---
draft = card_by_id(sb, "revisions.json", "cards", "rev-acc-1")
check(draft is not None and draft["status"] == "pending", "suggestion card drafted, status=pending")
task = req_by_id(sb, "rev-prop-1")
check(task is not None and task["status"] == "in-progress", "Task awaiting review (status=in-progress)")
check(task.get("result") is None and task.get("resultId") == "rev-acc-1",
      "Task has no result yet, resultId points at the proposal card")
check(REV_ORIGINAL in tex_of(sb) and REV_SUGGESTED not in tex_of(sb),
      ".tex UNTOUCHED by the proposal (original present, suggested absent)")
check(version(sb) == "1", "version bumped by the proposal (=1)")

# --- accept: splice + status + Task completion, all together ---
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-acc-1"}))
check(r.returncode == 0, f"accept exited 0 (stderr={r.stderr.strip()[:160]})")
o = out_of(r)
check(o.get("op") == "accept" and o.get("cardKind") == "revision-suggestion"
      and o.get("result") == "accepted", "accept result: op=accept, cardKind=revision-suggestion, result=accepted")
tex = tex_of(sb)
check(REV_SUGGESTED in tex, ".tex spliced: suggested_text landed")
check(REV_ORIGINAL not in tex, ".tex spliced: original_text replaced (gone)")
check(card_by_id(sb, "revisions.json", "cards", "rev-acc-1")["status"] == "accepted",
      "suggestion card status → accepted")
task = req_by_id(sb, "rev-prop-1")
check(task["status"] == "complete" and task.get("result") == "accepted",
      "originating Task → complete / accepted")
check(version(sb) == "2", "version bumped again by the accept (=2)")
check(pen_gone(sb), "pen released")

# --- the rest of the paragraph + its marker survive the span replacement ---
check("%!v:6607" in tex and "bibliographic infrastructure" in tex,
      "anchor marker + trailing sentences preserved (only the matched span changed)")

# ===================================================== accept: the other kind
print("\n=== accept (cutter): the parallel kind is handled uniformly ===")
sb = sandbox()
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": SAMPLE_CUTTER}))
check(r.returncode == 0, f"accept exited 0 (stderr={r.stderr.strip()[:160]})")
check(out_of(r).get("cardKind") == "cutter-suggestion", "cutter suggestion accepts as cardKind=cutter-suggestion")
check(SAMPLE_CUTTER_SUGGESTED in tex_of(sb), "cutter suggested_text spliced into the .tex")
check(card_by_id(sb, "cutter.json", "cards", SAMPLE_CUTTER)["status"] == "accepted",
      "cutter suggestion card status → accepted")

# ===================================================== reject: .tex UNTOUCHED
print("\n=== reject: dismiss a proposal, Task completed, .tex byte-for-byte unchanged ===")
sb = sandbox()
r = propose(sb, panel="cutter", card_id="cut-rej-1", kind_label="cutter-suggestion",
            task_id="cut-prop-1", anchor="5505", original="anything", suggested="never applied")
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:160]})")
tex_before = hashlib.sha256(tex_of(sb).encode()).hexdigest()
r = run(APPLY, str(sb), "reject", json.dumps({"cardId": "cut-rej-1"}))
check(r.returncode == 0, f"reject exited 0 (stderr={r.stderr.strip()[:160]})")
check(out_of(r).get("op") == "reject" and out_of(r).get("result") == "rejected",
      "reject result: op=reject, result=rejected")
check(card_by_id(sb, "cutter.json", "cards", "cut-rej-1")["status"] == "rejected",
      "suggestion card status → rejected")
task = req_by_id(sb, "cut-prop-1")
check(task["status"] == "complete" and task.get("result") == "rejected",
      "originating Task → complete / rejected")
check(hashlib.sha256(tex_of(sb).encode()).hexdigest() == tex_before,
      "document.tex byte-for-byte unchanged (reject never edits the .tex)")
check(pen_gone(sb), "pen released")

# ===================================================== stale-proposal guard
print("\n=== stale guard: a proposal whose original_text no longer matches is REFUSED ===")
sb = sandbox()
# Draft a proposal, then mutate the anchored paragraph out from under it (as if
# the user edited the text after the proposal was drafted).
r = propose(sb, panel="revisions", card_id="rev-stale", kind_label="revision-suggestion",
            task_id="rev-stale-task", anchor="6607", original=REV_ORIGINAL, suggested=REV_SUGGESTED)
check(r.returncode == 0, "propose exited 0")
tex_path = next(sb.glob("*.tex"))
tex_path.write_text(tex_of(sb).replace(REV_ORIGINAL, "A wholly rewritten opening sentence."), encoding="utf-8")
tex_after_edit = hashlib.sha256(tex_of(sb).encode()).hexdigest()
ver_after_edit = version(sb)
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-stale"}))
check(r.returncode != 0, "accept exits non-zero on a stale proposal")
check("stale" in r.stderr.lower() and "replace-span" in r.stderr,
      "the refusal names it a stale proposal (clear failure message)")
check(card_by_id(sb, "revisions.json", "cards", "rev-stale")["status"] == "pending",
      "the proposal card stays pending (NOT consumed — re-draftable)")
check(req_by_id(sb, "rev-stale-task")["status"] == "in-progress",
      "the Task stays awaiting review (untouched)")
check(hashlib.sha256(tex_of(sb).encode()).hexdigest() == tex_after_edit,
      "the .tex is untouched by the refused accept (no blind splice)")
check(version(sb) == ver_after_edit, "no version bump on a refusal (nothing committed)")

# ===================================================== idempotency + terminal refusals
print("\n=== idempotency + opposite-terminal-state refusals ===")
sb = sandbox()
run(APPLY, str(sb), "accept", json.dumps({"cardId": SAMPLE_CUTTER}))          # accept once
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": SAMPLE_CUTTER}))      # accept again
check(r.returncode == 0 and out_of(r).get("noop") is True, "re-accepting an accepted card is an idempotent no-op")
r = run(APPLY, str(sb), "reject", json.dumps({"cardId": SAMPLE_CUTTER}))
check(r.returncode != 0 and "already accepted" in r.stderr, "rejecting an accepted card is refused (opposite terminal state)")
sb = sandbox()
run(APPLY, str(sb), "reject", json.dumps({"cardId": SAMPLE_CUTTER}))          # reject once
r = run(APPLY, str(sb), "reject", json.dumps({"cardId": SAMPLE_CUTTER}))      # reject again
check(r.returncode == 0 and out_of(r).get("noop") is True, "re-rejecting a rejected card is an idempotent no-op")
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": SAMPLE_CUTTER}))
check(r.returncode != 0 and "already rejected" in r.stderr, "accepting a rejected card is refused (opposite terminal state)")
# A non-suggestion card can't be accepted/rejected.
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "ea4d5253-406d-499e-85b6-8055956c9f95"}))
check(r.returncode != 0 and "suggestion" in r.stderr, "accept refuses a non-suggestion card (a note)")

# ===================================================== ATOMICITY (the headline proof)
# A fault between the .tex splice and the card/Task update rolls BOTH back. The
# accept write-set order is: revisions.json(card) #1, ai-requests.json(Task) #2,
# document.tex(splice) #3, notifications #4, version #5.
SNAP = ["revisions.json", "ai-requests.json", "notifications.json", "version.txt", "collab.json"]


def snapshot(doc):
    snap = {}
    for name in SNAP:
        p = doc / "virgil" / name
        snap[name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    snap["__tex__"] = hashlib.sha256(next(doc.glob("*.tex")).read_bytes()).hexdigest()
    return snap


print("\n=== atomicity: fault AFTER the card+Task commit but BEFORE the .tex → all roll back ===")
sb = sandbox()
propose(sb, panel="revisions", card_id="rev-atom", kind_label="revision-suggestion",
        task_id="rev-atom-task", anchor="6607", original=REV_ORIGINAL, suggested=REV_SUGGESTED)
before = snapshot(sb)
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-atom"}),
        env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "accept exited non-zero on the injected fault (after 2 commits)")
check(before == snapshot(sb), "every target file byte-identical — card + Task rolled back, .tex never written")
check(card_by_id(sb, "revisions.json", "cards", "rev-atom")["status"] == "pending", "card back to pending")
check(req_by_id(sb, "rev-atom-task")["status"] == "in-progress", "Task back to in-progress")
check(REV_ORIGINAL in tex_of(sb) and REV_SUGGESTED not in tex_of(sb), ".tex untouched (no splice)")
check(pen_gone(sb), "pen released even though the write failed")

print("\n=== atomicity: fault AFTER the .tex splice commit → the splice rolls back too ===")
sb = sandbox()
propose(sb, panel="revisions", card_id="rev-atom2", kind_label="revision-suggestion",
        task_id="rev-atom2-task", anchor="6607", original=REV_ORIGINAL, suggested=REV_SUGGESTED)
before = snapshot(sb)
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-atom2"}),
        env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "3"})
check(r.returncode != 0, "accept exited non-zero on the injected fault (after 3 commits — the .tex landed)")
check(before == snapshot(sb), "full rollback — the committed .tex splice was restored along with the card + Task")
check(REV_ORIGINAL in tex_of(sb) and REV_SUGGESTED not in tex_of(sb), "original text restored in the .tex")
check(pen_gone(sb), "pen released even though the write failed")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
