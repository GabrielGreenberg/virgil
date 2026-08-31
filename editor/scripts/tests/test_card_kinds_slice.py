#!/usr/bin/env python3
r"""End-to-end test of the create-card fan-out (note / todo / citation / report /
report-request / example) through the apply_response contract — the sibling of
test_footnote_slice.py, modeled on it. Runs the real CLIs against fresh copies
of samples/annotation-history (never mutating the sample).

Run from anywhere:  python3 editor/scripts/tests/test_card_kinds_slice.py
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
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")

# The 8 AiRequestKind members (src/lib/types.ts) — a synthesized/Workflow-A Task
# must carry a real one (an unknown kind leaks `undefined` into the AI window's
# PANEL_KIND_MAP). This is what report-request→report remap protects.
AI_REQUEST_KINDS = {"footnote", "note", "highlight", "citation", "todo", "suggestion", "report", "style-merge"}

# Released-ness is ONE predicate (task 496): the release REWRITES the pen
# record (`holder: null`) instead of deleting it, so a delete-blocked mount
# cannot roll the collab restore back and report exit 2 on a landed write.
from _pen_state import pen_released  # noqa: E402

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
    d = Path(tempfile.mkdtemp(prefix="chip8-"))
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


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


# Sample baselines + the in-sample Task ids / anchors we drive Workflow A from.
ORIG_NOTES = len(json.loads((SAMPLE / "virgil/notes.json").read_text())["cards"])
ORIG_TODOS = len(json.loads((SAMPLE / "virgil/todos.json").read_text())["items"])
ORIG_CITS = len(json.loads((SAMPLE / "virgil/citations.json").read_text())["citations"])
ORIG_REPORTS = len(json.loads((SAMPLE / "virgil/reports.json").read_text())["cards"])
ORIG_EXAMPLES = len(json.loads((SAMPLE / "virgil/examples.json").read_text())["examples"])
ORIG_REQS = len(json.loads((SAMPLE / "virgil/ai-requests.json").read_text())["requests"])
NOTE_REQ = "826ec44d-3572-4e53-8f4d-6c877fe02715"   # kind=note, anchor 4402
CIT_REQ = "2d92d440-15ad-47ef-a216-de86c78ccae7"    # kind=citation, anchor 6602
KEY = "bringhurst2004"                              # a real key in references.bib


# ---------------------------------------------------------------- note (Workflow A, L1)
print("\n=== note / Workflow A (req 826e, anchor 4402) / L1 silent ===")
sb = sandbox()
set_safety(sb, NOTE_REQ, 1)
BODY = "McKenzie's sociology of texts widens Genette's paratext to the whole material apparatus."
r = run(CREATE, str(sb), NOTE_REQ, "--kind=note", "--body", BODY, "--title", "Sociology of texts")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
nid = out_of(r).get("cardId")
cards = load(sb, "notes.json")["cards"]
check(len(cards) == ORIG_NOTES + 1, f"one note appended (got {len(cards)}, expected {ORIG_NOTES + 1})")
note = next((c for c in cards if c["id"] == nid), {})
check(note.get("kind") == "note" and note.get("title") == "Sociology of texts", "note card: kind+title")
check(note.get("content", {}).get("content", [{}])[0].get("content", [{}])[0].get("text") == BODY, "note content carries the body")
check(note.get("aiRequest") is False, "note aiRequest=false (Virgil-authored)")
anc = (note.get("links") or [{}])[0].get("anchor", {})
check(anc.get("type") == "textObject" and anc.get("textObjectIds") == ["4402"], "note anchored to 4402 (Mode-A textObject link)")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == NOTE_REQ)
check(req["status"] == "complete" and req.get("result") == "silent-applied", "Task complete / silent-applied")
check(req.get("resultId") == nid, "Task resultId → the note")


# ---------------------------------------------------------------- todo (Workflow B synth, L1)
print("\n=== todo / Workflow B synth (anchor 4402) / L1 silent ===")
sb = sandbox()
r = run(CREATE, str(sb), "--kind=todo", "--body", "Cross-check the McKenzie page number.",
        "--notes", "vs Genette", "--anchor", "4402", "--safety-level", "1")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
tid = out_of(r).get("cardId")
items = load(sb, "todos.json")["items"]
check(len(items) == ORIG_TODOS + 1, f"one todo appended (got {len(items)})")
todo = next((c for c in items if c["id"] == tid), {})
check(todo.get("text") == "Cross-check the McKenzie page number." and todo.get("notes") == "vs Genette", "todo text+notes")
check(todo.get("done") is False and todo.get("aiRequest") is False, "todo done=false, aiRequest=false")
check((todo.get("links") or [{}])[0].get("anchor", {}).get("textObjectIds") == ["4402"], "todo anchored to 4402")
syn = next((r for r in load(sb, "ai-requests.json")["requests"] if r.get("resultId") == tid), None)
check(syn is not None and syn["kind"] == "todo", "synthesized Task kind=todo")
check(syn and syn["kind"] in AI_REQUEST_KINDS, "synthesized Task kind is a real AiRequestKind")
check(syn and syn.get("safetyLevel") == 1 and syn.get("paragraphIds") == ["4402"], "synthesized Task carries safetyLevel + paragraphIds")


# ---------------------------------------------------------------- citation (Workflow A direct + atom marker)
print("\n=== citation / Workflow A (req 2d92, anchor 6602) / direct ===")
sb = sandbox()
r = run(CREATE, str(sb), CIT_REQ, "--kind=citation", "--citekey", KEY, "--cite-command", "citep")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
o = out_of(r)
cid = o.get("citationId")
check(o.get("cardId") == cid, "result surfaces cardId == citationId")
cits = load(sb, "citations.json")["citations"]
check(len(cits) == ORIG_CITS + 1, f"one citation appended (got {len(cits)})")
cit = next((c for c in cits if c["id"] == cid), {})
check(cit.get("command") == f"\\citep{{{KEY}}}" and cit.get("keys") == [KEY], "CitationRef command + keys")
tex = tex_of(sb)
check(f"\\vcid{{{cid}}}\\citep{{{KEY}}}" in tex, "tex spliced \\vcid{}\\citep{} (atom marker)")
check(f"\\vcid{{{cid}}}\\citep{{{KEY}}} %!v:6602" in tex, "atom marker spliced right before the 6602 anchor")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == CIT_REQ)
check(req["status"] == "complete" and req.get("result") == "direct-created", "Task complete / direct-created")
check(req.get("resultId") == cid, "Task resultId → the citation")

print("\n=== citation / refuses a citekey not in references.bib (don't fabricate) ===")
sb = sandbox()
r = run(CREATE, str(sb), CIT_REQ, "--kind=citation", "--citekey", "totallyfakekey9999")
check(r.returncode != 0, "create_card refused (non-zero exit)")
check("find-citation" in r.stderr, "error points at find-citation")
check(len(load(sb, "citations.json")["citations"]) == ORIG_CITS, "no citation card landed on refusal")


# ---------------------------------------------------------------- citation L2 (write-with-comment)
print("\n=== citation / Workflow A / L2 write-with-comment (sibling note) ===")
sb = sandbox()
set_safety(sb, CIT_REQ, 2)
r = run(CREATE, str(sb), CIT_REQ, "--kind=citation", "--citekey", KEY, "--cite-command", "citep")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
cid = out_of(r).get("citationId")
check(len(load(sb, "citations.json")["citations"]) == ORIG_CITS + 1, "citation landed")
notes = load(sb, "notes.json")["cards"]
check(len(notes) == ORIG_NOTES + 1, f"exactly one sibling note appended (got {len(notes)})")
sib = notes[-1]
check(sib["kind"] == "note" and sib.get("aiRequest") is False, "sibling is a Virgil-authored note")
check((sib.get("links") or [{}])[0].get("anchor", {}).get("textObjectIds") == ["6602"], "sibling note anchored to 6602")
req = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == CIT_REQ)
check(req.get("result") == "auto-applied", f"Task auto-applied (got {req.get('result')})")


# ---------------------------------------------------------------- report (Workflow B synth, direct)
print("\n=== report / Workflow B synth (anchor 1101) / direct ===")
sb = sandbox()
r = run(CREATE, str(sb), "--kind=report", "--body", "The apparatus out-weighs the base text in the Carolingian copies.",
        "--title", "Apparatus weight", "--anchor", "1101")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
rid = out_of(r).get("cardId")
reps = load(sb, "reports.json")["cards"]
check(len(reps) == ORIG_REPORTS + 1, f"one report appended (got {len(reps)})")
rep = next((c for c in reps if c["id"] == rid), {})
check(rep.get("kind") == "report" and rep.get("author") == "ai", "report card: on-disk kind=report, author=ai")
check(rep.get("title") == "Apparatus weight" and rep.get("text"), "report title + plaintext mirror present")
check((rep.get("links") or [{}])[0].get("anchor", {}).get("textObjectIds") == ["1101"], "report anchored to 1101")
syn = next((r for r in load(sb, "ai-requests.json")["requests"] if r.get("resultId") == rid), None)
check(syn is not None and syn["kind"] == "report", "synthesized Task kind=report")


# ---------------------------------------------------------------- report-request (polymorphic discriminator + Task remap)
print("\n=== report-request / Workflow B synth (anchor 2201) / direct ===")
sb = sandbox()
r = run(CREATE, str(sb), "--kind=report-request", "--body", "Tabulate gloss-to-text ratios across §2.", "--anchor", "2201")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
rid = out_of(r).get("cardId")
reps = load(sb, "reports.json")["cards"]
check(len(reps) == ORIG_REPORTS + 1, "one report-request appended (same reports.json as report)")
rr = next((c for c in reps if c["id"] == rid), {})
check(rr.get("kind") == "report-request", "on-disk discriminator kind=report-request (two-taxonomy rule)")
check(rr.get("aiRequest") is False and "author" not in rr, "report-request: aiRequest field, no author byline")
syn = next((r for r in load(sb, "ai-requests.json")["requests"] if r.get("resultId") == rid), None)
check(syn is not None and syn["kind"] == "report", "synthesized Task kind REMAPPED to report (no native report-request AiRequestKind)")
check(syn and syn["kind"] in AI_REQUEST_KINDS, "remapped Task kind is a real AiRequestKind (no undefined leak)")


# ---------------------------------------------------------------- example single \ex (tex-only)
print("\n=== example / single \\ex (anchor 2207) / tex-only, Task-less ===")
sb = sandbox()
EX_BODY = "A scholion keyed to a lemma by a superscript letter; commentary in the outer margin."
r = run(CREATE, str(sb), "--kind=example", "--body", EX_BODY, "--label", "ex:scholion", "--anchor", "2207")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
o = out_of(r)
exid = o.get("exampleId")
tex = tex_of(sb)
check(f"\\vexid{{{exid}}}\\ex\\label{{ex:scholion}}" in tex, "tex gained \\vexid{}\\ex\\label{} block")
check(EX_BODY in tex and "\\xe" in tex, "example body + \\xe present")
# block landed AFTER the anchor paragraph's marker (block-after-paragraph placement)
i_marker = tex.find("%!v:2207")
i_block = tex.find(f"\\vexid{{{exid}}}")
check(i_marker != -1 and i_block > i_marker, "example block placed AFTER the 2207 paragraph marker")
check(load(sb, "examples.json") == json.loads((SAMPLE / "virgil/examples.json").read_text()), "examples.json UNCHANGED (app-derived shadow, not written)")
ar = load(sb, "ai-requests.json")["requests"]
check(len(ar) == ORIG_REQS, "NO Task synthesized (example lifecycle 'none')")
check(not any(str(x.get("id", "")).startswith("virtual:") for x in ar), "no virtual id leaked into ai-requests.json")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped")
check(pen_released(sb), "pen released")


# ---------------------------------------------------------------- example multi \pex
print("\n=== example / multi \\pex with \\vxid rows (anchor 2208) ===")
sb = sandbox()
r = run(CREATE, str(sb), "--kind=example", "--item", "a marginal gloss;", "--item", "an interlinear correction;",
        "--item", "a manicule.", "--label", "ex:marktypes", "--anchor", "2208")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
exid = out_of(r).get("exampleId")
tex = tex_of(sb)
check(f"\\vexid{{{exid}}}\\pex\\label{{ex:marktypes}}" in tex, "tex gained \\vexid{}\\pex block")
import re as _re
xids = _re.findall(r"\\vxid\{([0-9a-f]{4})\}\\a ", tex)
# the sample already ships 7 \vxid rows; we add 3 unique new ones
check(len(set(xids)) == len(xids), "all \\vxid ids unique (no intra-batch collision)")
check(tex.count("\\vxid") >= 7 + 3, "three new \\vxid{}\\a rows added")


# ---------------------------------------------------------------- example rejections
print("\n=== example / rejects --safety-level and a requestId (direct tex-only) ===")
sb = sandbox()
r = run(CREATE, str(sb), "--kind=example", "--body", "x", "--anchor", "2207", "--safety-level", "1")
check(r.returncode != 0 and "safety" in r.stderr.lower(), "rejects --safety-level for example")
r = run(CREATE, str(sb), CIT_REQ, "--kind=example", "--body", "x", "--anchor", "2207")
check(r.returncode != 0 and "directly" in r.stderr.lower(), "rejects a requestId for example")


# ---------------------------------------------------------------- atomicity (citation create rolls back fully)
print("\n=== atomicity: injected mid-write failure rolls everything back (citation) ===")
sb = sandbox()


def snapshot(doc):
    snap = {}
    for name in ["citations.json", "ai-requests.json", "notifications.json", "version.txt", "collab.json"]:
        p = doc / "virgil" / name
        snap[name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    texs = list(doc.glob("*.tex"))
    snap["__tex__"] = hashlib.sha256(texs[0].read_bytes()).hexdigest()
    return snap


before = snapshot(sb)
r = run(CREATE, str(sb), CIT_REQ, "--kind=citation", "--citekey", KEY, env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "create_card exited non-zero on injected failure")
check(before == snapshot(sb), "every target file byte-identical (full rollback)")
check(not (sb / "virgil/version.txt").exists(), "version.txt NOT created (rolled back)")
check(pen_released(sb), "pen released even though the write failed")


# ---------------------------------------------------------------- back-compat: every carded kind synthesizes a valid AiRequestKind
print("\n=== back-compat: all synthesized Task kinds are valid AiRequestKinds ===")
sb = sandbox()
specs = [
    ("note", ["--body", "n"]),
    ("todo", ["--body", "t"]),
    ("report", ["--body", "r"]),
    ("report-request", ["--body", "rr"]),
    ("citation", ["--citekey", KEY]),
]
ok = True
for kind, extra in specs:
    rr = run(CREATE, str(sb), f"--kind={kind}", *extra, "--anchor", "1101")
    if rr.returncode != 0:
        ok = False
        print(f"    ({kind} failed: {rr.stderr.strip()[:100]})")
ar = load(sb, "ai-requests.json")["requests"]
synth_kinds = {x["kind"] for x in ar if x["id"] not in
               {"ad4a69b1-9207-473b-ae54-7dcfbb80e8b4", NOTE_REQ, CIT_REQ, "b5c93b58-33be-4ab5-bc9e-4507fa16e33a"}}
check(ok, "all five carded kinds created in one doc")
check(synth_kinds <= AI_REQUEST_KINDS, f"all synthesized kinds ⊆ AiRequestKind (got {sorted(synth_kinds)})")


# ---------------------------------------------------------------- aiOriginRequestId back-pointer (chip 11)
print("\n=== aiOriginRequestId: stamped on a Workflow-A note, absent on an atom-bearing footnote ===")
sb = sandbox()
r = run(CREATE, str(sb), NOTE_REQ, "--kind=note", "--body", "A reply note.", "--title", "Re: McKenzie")
check(r.returncode == 0, f"note create exited 0 (stderr={r.stderr.strip()[:120]})")
nid = out_of(r).get("cardId")
note = next((c for c in load(sb, "notes.json")["cards"] if c["id"] == nid), {})
check(note.get("aiOriginRequestId") == NOTE_REQ, "note carries aiOriginRequestId → its Task (Accept/Reject/Redo affordance)")
fn_req = req_by_kind(sb, "footnote")["id"]
r = run(CREATE, str(sb), fn_req, "--kind=footnote", "--body", "A footnote body.")
check(r.returncode == 0, f"footnote create exited 0 (stderr={r.stderr.strip()[:120]})")
fid = out_of(r).get("footnoteId")
fn = next((f for f in load(sb, "footnotes.json")["footnotes"] if f["id"] == fid), {})
check("aiOriginRequestId" not in fn, "footnote (id-equality atom) does NOT carry aiOriginRequestId")
# L2 on a sidecar-only kind: the PRIMARY note is stamped; the L2 sibling comment is NOT.
sb = sandbox()
set_safety(sb, NOTE_REQ, 2)
r = run(CREATE, str(sb), NOTE_REQ, "--kind=note", "--body", "Bodied.", "--title", "T")
check(r.returncode == 0, f"L2 note create exited 0 (stderr={r.stderr.strip()[:120]})")
pid = out_of(r).get("cardId")
cards = load(sb, "notes.json")["cards"]
check(len(cards) == ORIG_NOTES + 2, "L2 note: primary + sibling comment both appended")
primary = next((c for c in cards if c["id"] == pid), {})
sibling = next((c for c in cards if c.get("title") == "Virgil added a note"), {})
check(primary.get("aiOriginRequestId") == NOTE_REQ, "L2 primary note carries aiOriginRequestId")
check("aiOriginRequestId" not in sibling, "L2 sibling 'Virgil added a note' comment is NOT stamped")


# ---------------------------------------------------------------- virtual card-flag id (chip 11)
print("\n=== virtual card-flag id: note create clears the source flag, mutates no Task row ===")
sb = sandbox()
# Simulate a pre-bridge card flag: an existing note with aiRequest=true and NO
# matching ai-requests.json entry (what list_requests emits as virtual:notes:<id>).
notes_path = sb / "virgil" / "notes.json"
ns = json.loads(notes_path.read_text())
src_id = ns["cards"][0]["id"]
ns["cards"][0]["aiRequest"] = True
notes_path.write_text(json.dumps(ns, indent=2) + "\n")
n_reqs_before = len(load(sb, "ai-requests.json")["requests"])
r = run(CREATE, str(sb), f"virtual:notes:{src_id}", "--kind=note", "--body", "Re: the flagged note.",
        "--title", "Re: flagged", "--anchor", "4402")
check(r.returncode == 0, f"virtual note create exited 0 (stderr={r.stderr.strip()[:140]})")
vid = out_of(r).get("cardId")
cards = load(sb, "notes.json")["cards"]
check(any(c["id"] == vid for c in cards), "sibling note landed for the virtual id")
src = next((c for c in cards if c["id"] == src_id), {})
check(src.get("aiRequest") is False, "source note's aiRequest flag cleared (virtual id split to {panel,cardId})")
new = next((c for c in cards if c["id"] == vid), {})
check("aiOriginRequestId" not in new, "virtual-id note carries NO aiOriginRequestId (no real Task to point at)")
check(len(load(sb, "ai-requests.json")["requests"]) == n_reqs_before, "ai-requests.json untouched (no Task row for a virtual id)")
check(out_of(r).get("requestId") == f"virtual:notes:{src_id}", "result echoes the virtual requestId")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped on the virtual create")
check(run(CREATE, str(sb), f"virtual:notes:{src_id}", "--kind=note", "--body", "x").returncode != 0,
      "virtual id with no --anchor is refused (anchor comes from the source card)")


# ---------------------------------------------------------------- cross-kind answer: todo Task → note (chip 11)
print("\n=== --accept-task-kind: a note answers a todo Task (cross-kind, answer-todo-request) ===")
sb = sandbox()
ar_path = sb / "virgil" / "ai-requests.json"
ar = json.loads(ar_path.read_text())
ar["requests"].append({"id": "todo-xk-1", "kind": "todo", "text": "Explain why this matters.",
                       "paragraphIds": ["4402"], "status": "pending"})
ar_path.write_text(json.dumps(ar, indent=2) + "\n")
# Without --accept-task-kind: refused (Task kind=todo ≠ requested note).
r = run(CREATE, str(sb), "todo-xk-1", "--kind=note", "--body", "Because …")
check(r.returncode != 0 and "todo" in r.stderr, "refuses a todo Task for --kind=note without --accept-task-kind")
check(len(load(sb, "notes.json")["cards"]) == ORIG_NOTES, "no note landed on the refusal")
# With --accept-task-kind todo: the note lands and the todo Task completes.
r = run(CREATE, str(sb), "todo-xk-1", "--kind=note", "--accept-task-kind", "todo",
        "--body", "Because it anchors the apparatus claim.", "--title", "Why it matters")
check(r.returncode == 0, f"cross-kind note create exited 0 (stderr={r.stderr.strip()[:140]})")
nid = out_of(r).get("cardId")
check(len(load(sb, "notes.json")["cards"]) == ORIG_NOTES + 1, "note landed for the cross-kind answer")
note = next((c for c in load(sb, "notes.json")["cards"] if c["id"] == nid), {})
check(note.get("aiOriginRequestId") == "todo-xk-1", "cross-kind note back-points at the todo Task")
req = next((r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == "todo-xk-1"), {})
check(req.get("status") == "complete" and req.get("result") == "direct-created", "todo Task completed / direct-created")
check(req.get("resultId") == nid, "todo Task resultId → the answering note")
# A level-3 todo → note is a PROPOSE: the note still lands (sidecar-only, no .tex to
# withhold) but the Task is left in-progress / no terminal result — so answer-todo
# must read the returned status and NOT mark the todo done (the major review finding).
sb = sandbox()
ar = json.loads((sb / "virgil/ai-requests.json").read_text())
ar["requests"].append({"id": "todo-xk-l3", "kind": "todo", "text": "Analyze.",
                       "paragraphIds": ["4402"], "status": "pending", "safetyLevel": 3})
(sb / "virgil/ai-requests.json").write_text(json.dumps(ar, indent=2) + "\n")
o = out_of(run(CREATE, str(sb), "todo-xk-l3", "--kind=note", "--accept-task-kind", "todo",
               "--body", "Because.", "--title", "Why"))
check(o.get("status") == "in-progress" and o.get("result") is None, "L3 todo→note is a proposal (status=in-progress, no terminal result)")
check(any(c["id"] == o.get("cardId") for c in load(sb, "notes.json")["cards"]), "L3 proposal note still lands (sidecar-only)")
l3 = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == "todo-xk-l3")
check(l3["status"] == "in-progress", "L3 todo Task left in-progress — answer-todo must NOT flip done here")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
