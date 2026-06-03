#!/usr/bin/env python3
"""End-to-end test of the footnote slice through the apply_response v1 contract.
Runs the real CLIs against fresh copies of samples/annotation-history (never
mutating the sample).

Run from anywhere:  python3 editor/scripts/tests/test_footnote_slice.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import hashlib
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")
LIST = str(SCRIPTS / "list_requests.py")

PASS, FAIL = 0, 0
def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")

def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip3-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst

def run(*args, env=None):
    e = dict(os.environ)
    if env: e.update(env)
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=e)

def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None

def tex_of(doc):
    texs = list(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""

def footnote_req_id(doc):
    ar = load(doc, "ai-requests.json")
    return next(r["id"] for r in ar["requests"] if r.get("kind") == "footnote")

def req_by_kind(doc, kind):
    ar = load(doc, "ai-requests.json")
    return next((r for r in ar["requests"] if r.get("kind") == kind), None)

def set_safety(doc, req_id, level):
    p = doc / "virgil" / "ai-requests.json"
    ar = json.loads(p.read_text())
    for r in ar["requests"]:
        if r["id"] == req_id:
            r["safetyLevel"] = level
    p.write_text(json.dumps(ar, indent=2) + "\n")

ANCHOR = "3301"
BODY = "Bayle was an exiled Huguenot polemicist at Rotterdam."
ORIG_NOTES = len(json.loads((SAMPLE / "virgil/notes.json").read_text())["cards"])

print("\n=== sanity: anchor 3301 present in sample .tex ===")
sb = sandbox()
check(f"%!v:{ANCHOR}" in tex_of(sb), f"sample .tex carries %!v:{ANCHOR}")

# ---------------------------------------------------------------- L1 silent
print("\n=== L1 / write-silent ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 1)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
out = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
fid = out.get("footnoteId")
fns = load(sb, "footnotes.json")["footnotes"]
check(any(f["id"] == fid for f in fns), "footnotes.json gained the entry")
entry = next((f for f in fns if f["id"] == fid), {})
check(entry.get("content", {}).get("content", [{}])[0].get("content", [{}])[0].get("text") == BODY, "footnote content carries the body")
tex = tex_of(sb)
check(f"\\vfid{{{fid}}}\\footnote{{{BODY}}} %!v:{ANCHOR}" in tex, "tex spliced \\vfid{}\\footnote{} right before the marker")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == rid)
check(req["status"] == "complete", "request status=complete")
check(req.get("result") == "silent-applied", f"request result=silent-applied (got {req.get('result')})")
check(req.get("resultId") == fid, "request resultId points at the footnote")
check(len(load(sb, "notes.json")["cards"]) == ORIG_NOTES, "no sibling comment for L1 (notes count unchanged)")
notifs = load(sb, "notifications.json")["items"]
check(len(notifs) == 1 and notifs[0]["kind"] == "ai-request-complete", "one ai-request-complete notification")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version.txt bumped to 1")
check(not (sb / ".virgil/pen-context.json").exists(), "pen-context.json gone (pen released)")
collab = load(sb, "collab.json")
check(collab["enabled"] is False and collab["pen"]["holder"] is None, "collab.json restored (off, free pen)")

# ---------------------------------------------------------------- L2 comment
print("\n=== L2 / write-with-comment ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 2)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
out = json.loads(r.stdout); fid = out.get("footnoteId")
tex = tex_of(sb)
check(f"\\vfid{{{fid}}}\\footnote{{{BODY}}}" in tex, "tex spliced the footnote")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == rid)
check(req.get("result") == "auto-applied", f"request result=auto-applied (got {req.get('result')})")
cards = load(sb, "notes.json")["cards"]
check(len(cards) == ORIG_NOTES + 1, f"exactly one sibling note appended (got {len(cards)}, expected {ORIG_NOTES + 1})")
new_note = cards[-1]  # appended last
check(new_note["kind"] == "note" and new_note.get("aiRequest") is False, "sibling is a Virgil-authored note (aiRequest=false)")
link = (new_note.get("links") or [{}])[0]
anc = link.get("anchor", {})
check(anc.get("type") == "textObject" and anc.get("textObjectIds") == [ANCHOR], "comment note anchored to the paragraph (textObject link)")

# ---------------------------------------------------------------- L3 propose
print("\n=== L3 / complete-task --propose ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 3)
tex_before = tex_of(sb)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
out = json.loads(r.stdout); fid = out.get("footnoteId")
check(tex_of(sb) == tex_before, "tex UNCHANGED (proposal does not place the anchor)")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == rid)
check(req["status"] == "in-progress", f"request status=in-progress / awaiting review (got {req['status']})")
check("result" not in req or req.get("result") is None, "no terminal result while awaiting review")
check(req.get("resultId") == fid, "resultId points at the drafted footnote (reviewable artifact)")
check(any(f["id"] == fid for f in load(sb, "footnotes.json")["footnotes"]), "drafted footnote present in footnotes.json")

# ---------------------------------------------------------------- direct create (no safety level)
print("\n=== direct create (no safetyLevel → complete-task / direct-created) ===")
sb = sandbox(); rid = footnote_req_id(sb)  # request carries no safetyLevel
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
out = json.loads(r.stdout); fid = out.get("footnoteId")
check(out.get("subcommand") == "complete-task", "dispatched to complete-task")
check(f"\\vfid{{{fid}}}" in tex_of(sb), "tex spliced (direct create lands the artifact)")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == rid)
check(req.get("result") == "direct-created", f"result=direct-created (got {req.get('result')})")

# ---------------------------------------------------------------- synthesize (chat path)
print("\n=== chat path / --synthesize-task ===")
sb = sandbox()
n_before = len(load(sb, "ai-requests.json")["requests"])
r = run(CREATE, str(sb), "--kind=footnote", "--body", "CHAT FOOTNOTE", "--anchor", ANCHOR, "--safety-level", "1", "--task-text", "add a bayle footnote")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:160]})")
out = json.loads(r.stdout); fid = out.get("footnoteId")
reqs = load(sb, "ai-requests.json")["requests"]
check(len(reqs) == n_before + 1, "a new Task was synthesized")
syn = next((r for r in reqs if r.get("resultId") == fid), None)
check(syn is not None, "synthesized Task present")
if syn:
    check(syn["kind"] == "footnote" and syn["status"] == "complete" and syn.get("result") == "silent-applied", "synthesized Task: footnote / complete / silent-applied")
    check(syn.get("paragraphIds") == [ANCHOR] and syn.get("safetyLevel") == 1, "synthesized Task carries paragraphIds + safetyLevel")
check(f"\\vfid{{{fid}}}\\footnote{{CHAT FOOTNOTE}}" in tex_of(sb), "footnote spliced via the chat path")

# ---------------------------------------------------------------- atomicity
print("\n=== atomicity: injected mid-write failure rolls everything back ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 1)
def snapshot(doc):
    snap = {}
    for name in ["footnotes.json", "ai-requests.json", "notifications.json", "version.txt", "collab.json"]:
        p = doc / "virgil" / name
        snap[name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    texs = list(doc.glob("*.tex"))
    snap["__tex__"] = hashlib.sha256(texs[0].read_bytes()).hexdigest()
    return snap
before = snapshot(sb)
r = run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY, env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "create_card exited non-zero on injected failure")
after = snapshot(sb)
check(before == after, "every target file is byte-identical (full rollback, nothing partial landed)")
check(before["version.txt"] is None and not (sb / "virgil/version.txt").exists(), "version.txt was NOT created (rolled back)")
check(not (sb / ".virgil/pen-context.json").exists(), "pen released even though the write failed")
check(load(sb, "collab.json")["enabled"] is False, "collab.json restored after the failed write")

# ---------------------------------------------------------------- legacy un-migrated path
print("\n=== back-compat: legacy default-apply (an un-migrated skill) still works ===")
sb = sandbox()
cit = req_by_kind(sb, "citation")
check(cit is not None, "sample has a citation request")
legacy_op = {
    "requestId": cit["id"],
    "panel": "citations",
    "card": {"id": "ctest9", "command": "\\citep{smith2020}", "keys": ["smith2020"], "createdAt": "2026-06-03T00:00:00.000Z"},
    "summary": "Added citation Smith 2020",
    "clearSourceFlag": False,
}
r = run(APPLY, str(sb), json.dumps(legacy_op))
check(r.returncode == 0, f"legacy apply exited 0 (stderr={r.stderr.strip()[:160]})")
cits = load(sb, "citations.json")["citations"]
check(any(c["id"] == "ctest9" for c in cits), "legacy: citation card landed")
creq = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == cit["id"])
check(creq["status"] == "complete", "legacy: request flipped to complete")
check(creq.get("resultId") == "ctest9", "legacy: resultId set")
check("result" not in creq, "legacy: NO outcome enum stamped (preserves old behavior)")
check(len(load(sb, "notes.json")["cards"]) == ORIG_NOTES, "legacy: no spurious comment (notes count unchanged)")
check((sb / "virgil/version.txt").read_text().strip() == "1", "legacy: version bumped")
check(not (sb / ".virgil/pen-context.json").exists(), "legacy: pen released")

# ---------------------------------------------------------------- list_requests back-compat
print("\n=== back-compat: list_requests filters open vs terminal ===")
sb = sandbox()
r = run(LIST, str(sb))
ids_open = [json.loads(l)["id"] for l in r.stdout.splitlines() if l.strip().startswith("{")]
rid = footnote_req_id(sb)
check(rid in ids_open, "open footnote request is listed (status submitted)")
# complete it, then it should disappear; a failed one should also be hidden
set_safety(sb, rid, 1)
run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY)
r2 = run(LIST, str(sb))
ids2 = [json.loads(l)["id"] for l in r2.stdout.splitlines() if l.strip().startswith("{")]
check(rid not in ids2, "completed request no longer listed")

# ---------------------------------------------------------------- revert
print("\n=== revert: undo a landed footnote ===")
sb = sandbox(); rid = footnote_req_id(sb); set_safety(sb, rid, 1)
out = json.loads(run(CREATE, str(sb), rid, "--kind=footnote", "--body", BODY).stdout)
fid = out["footnoteId"]
check(f"\\vfid{{{fid}}}" in tex_of(sb), "pre-revert: footnote in tex")
r = run(APPLY, str(sb), "revert", rid)
check(r.returncode == 0, f"revert exited 0 (stderr={r.stderr.strip()[:160]})")
check(f"\\vfid{{{fid}}}" not in tex_of(sb), "post-revert: \\vfid stripped from tex")
check(not any(f["id"] == fid for f in load(sb, "footnotes.json")["footnotes"]), "post-revert: footnote removed from footnotes.json")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == rid)
check(req["status"] == "pending" and "result" not in req and "resultId" not in req, "post-revert: Task reopened (pending, no result/resultId)")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
