#!/usr/bin/env python3
r"""Task 1044 — the proposal family has ONE builder door.

`create_card.py --kind=suggestion` (and `--kind=comment`, the Revisions thread's
sibling reply) builds the card the five responder skills used to hand-assemble:
it mints the ids and timestamps, derives the PANEL from the Task (a Cutter
thread → cutter.json, everything else → revisions.json), copies the source
card's anchor, stamps `instructions` / `aiOriginRequestId`, and lands through
`complete-task --propose`. And the write door refuses — before any byte lands —
a proposal its own accept would refuse: an `original_text` that is not verbatim
in the anchored paragraph (a paraphrase, or one swallowing the `%!v:` marker),
or an empty revision replacement.

Runs on FRESH copies of samples/annotation-history (never the sample):
  python3 editor/scripts/tests/test_proposal_builder.py
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
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")
sys.path.insert(0, str(SCRIPTS))
from _common import anchored_paragraph  # noqa: E402

PASS, FAIL = 0, 0

# The sample's bridged L3 fixture: a `suggestion` Task linked to a flagged todo.
SUG_REQ = "b5c93b58-33be-4ab5-bc9e-4507fa16e33a"
TODO_ID = "ea401798-8d6b-4b4e-9b58-c48ae02437e2"
CUTTER_COMMENT = "4499087b-6809-4234-b49d-01a89a555930"   # cutter.json, anchor 5501
REVISION_COMMENT = "99af2540-25e4-46eb-a044-0fbb8670a503"  # revisions.json, Mode B at 6607
SPAN_6612 = "I have something to add"


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="proposal-builder-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def scratch(text):
    f = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8")
    f.write(text)
    f.close()
    return "@" + f.name


def create(doc, *args):
    r = subprocess.run([sys.executable, CREATE, str(doc), *args],
                       capture_output=True, text=True, env=dict(os.environ))
    out = {}
    if r.returncode == 0 and r.stdout.strip():
        out = json.loads(r.stdout.strip().splitlines()[-1])
    return r, out


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def tex_of(doc):
    return next(doc.glob("*.tex")).read_text(encoding="utf-8")


def card(doc, filename, cid):
    return next((c for c in load(doc, filename)["cards"] if c["id"] == cid), None)


def req(doc, rid):
    return next((r for r in load(doc, "ai-requests.json")["requests"] if r["id"] == rid), None)


def snapshot(doc):
    files = sorted((doc / "virgil").glob("*")) + [next(doc.glob("*.tex"))]
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}


def tail_span(doc, uuid, n=30):
    """The last ~n live characters of a paragraph — a verbatim span to propose against."""
    text = tex_of(doc)
    start, end = anchored_paragraph(text, uuid)
    return text[start:end].rstrip()[-n:].strip()


print("\n=== revision suggestion answering a bridged Task (linkedTo: todos) ===")
sb = sandbox()
r, out = create(sb, SUG_REQ, "--kind=suggestion",
                "--original", scratch(SPAN_6612),
                "--suggested", scratch("I have a thing to add"),
                "--explanation", scratch("Plainer."))
check(r.returncode == 0, f"create exited 0 (stderr={r.stderr.strip()[-200:]})")
cid = out.get("cardId")
c = card(sb, "revisions.json", cid) if cid else None
check(c is not None, "the suggestion landed in revisions.json (panel derived: not a Cutter thread)")
if c:
    check(c["kind"] == "suggestion" and c["author"] == "ai" and c["status"] == "pending"
          and c["user_text"] == "", "record shape: kind/author/status/user_text minted")
    check(c["original_text"] == SPAN_6612 and c["suggested_text"] == "I have a thing to add",
          "the three texts are the caller's, byte-exact")
    check(c["instructions"] == req(sb, SUG_REQ)["text"], "instructions = the Task's text")
    check(c.get("aiOriginRequestId") == SUG_REQ, "aiOriginRequestId stamped (a real Task)")
    link = c["links"][0]
    check(link["target"]["ref"] == {"kind": "revision-suggestion", "id": cid},
          "self-link → spine kind revision-suggestion")
    todo = next(t for t in load(sb, "todos.json")["items"] if t["id"] == TODO_ID)
    src = {k: v for k, v in todo["links"][0]["anchor"].items() if k != "margin"}
    check(link["anchor"] == src, "anchor copied verbatim from the source todo")
    check(todo.get("aiRequest") is False, "the source todo's aiRequest flag is cleared")
t = req(sb, SUG_REQ)
check(t["status"] == "in-progress" and t.get("resultId") == cid, "Task awaiting review, resultId → card")
check(SPAN_6612 in tex_of(sb), ".tex untouched by the proposal")

print("\n=== re-running the same Task is a no-op (the proposal IS the answer) ===")
r2, out2 = create(sb, SUG_REQ, "--kind=suggestion",
                  "--original", scratch(SPAN_6612), "--suggested", scratch("again"))
check(r2.returncode == 0 and out2.get("noop") and out2.get("cardId") == cid,
      f"noop naming the existing card (out={out2})")
check(sum(1 for c in load(sb, "revisions.json")["cards"] if c.get("aiOriginRequestId") == SUG_REQ) == 1,
      "still exactly one proposal for the Task")

print("\n=== the proposal is accept-consumable ===")
r3 = subprocess.run([sys.executable, APPLY, str(sb), "accept", json.dumps({"cardId": cid})],
                    capture_output=True, text=True)
check(r3.returncode == 0, f"accept exited 0 (stderr={r3.stderr.strip()[-200:]})")
check("I have a thing to add" in tex_of(sb), "the replacement is spliced")

print("\n=== Cutter thread → cutter.json; an empty replacement is a cut ===")
sb = sandbox()
ar = load(sb, "ai-requests.json")
ar["requests"].append({"id": "cut-req", "kind": "suggestion", "text": "trim this",
                       "createdAt": "2026-10-10T00:00:00.000Z", "status": "submitted",
                       "paragraphIds": ["5501"],
                       "linkedTo": {"panel": "cutter", "cardId": CUTTER_COMMENT}})
(sb / "virgil/ai-requests.json").write_text(json.dumps(ar, indent=2))
span = tail_span(sb, "5501")
r, out = create(sb, "cut-req", "--kind=suggestion", "--original", scratch(span),
                "--suggested", scratch(""), "--explanation", scratch("Cut the tail."))
check(r.returncode == 0, f"create exited 0 (stderr={r.stderr.strip()[-200:]})")
c = card(sb, "cutter.json", out.get("cardId", "")) if out else None
check(c is not None and out.get("panel") == "cutter", "landed in cutter.json (the Task's panel)")
if c:
    check(c["links"][0]["target"]["ref"]["kind"] == "cutter-suggestion", "self-link → cutter-suggestion")
    check(c["suggested_text"] == "", "an empty Cutter replacement is allowed (it is the cut)")
check(card(sb, "revisions.json", out.get("cardId", "")) is None, "and NOT in revisions.json")

print("\n=== refusals: nothing written ===")
for label, original, suggested in [
    ("paraphrase", "I've got something to add", "x"),
    ("marker-included", SPAN_6612 + "}. %!v:6612", "x"),
    ("empty revision", SPAN_6612, ""),
    ("whitespace revision", SPAN_6612, "  \n "),
]:
    sb = sandbox()
    before = snapshot(sb)
    r, _ = create(sb, SUG_REQ, "--kind=suggestion", "--original", scratch(original),
                  "--suggested", scratch(suggested))
    check(r.returncode != 0 and "refusing to propose" in r.stderr,
          f"[{label}] refused (stderr={r.stderr.strip()[-160:]})")
    check(snapshot(sb) == before, f"[{label}] every sidecar and the .tex byte-identical")

print("\n=== the write door refuses a HAND-BUILT paraphrase too ===")
sb = sandbox()
before = snapshot(sb)
hand = {"kind": "suggestion", "id": "hand-1", "createdAt": "2026-10-10T00:00:00.000Z",
        "author": "ai", "original_text": "not in the paper", "suggested_text": "y",
        "status": "pending", "links": [{"id": "l", "kind": "anchor",
        "anchor": {"type": "textObject", "targetKind": "paragraph", "textObjectIds": ["6612"]},
        "target": {"type": "card", "ref": {"kind": "revision-suggestion", "id": "hand-1"}}}]}
r = subprocess.run([sys.executable, APPLY, str(sb), "complete-task", "--propose",
                    json.dumps({"requestId": SUG_REQ, "panel": "revisions", "card": hand,
                                "summary": "s"})], capture_output=True, text=True)
check(r.returncode != 0 and "not found verbatim" in r.stderr, "complete-task --propose refuses it")
check(snapshot(sb) == before, "nothing written")

print("\n=== virtual id: a sibling comment on a Revisions thread ===")
sb = sandbox()
# The drain emits a virtual id only while the source card's flag is UP (task 1234).
_rp = sb / "virgil" / "revisions.json"
_rs = json.loads(_rp.read_text())
for _c in _rs["cards"]:
    if _c.get("id") == REVISION_COMMENT:
        _c["aiRequest"] = True
_rp.write_text(json.dumps(_rs, indent=2) + "\n")
r, out = create(sb, f"virtual:revisions:{REVISION_COMMENT}", "--kind=comment",
                "--body", scratch("Agreed — see the suggestion below."))
check(r.returncode == 0, f"create exited 0 (stderr={r.stderr.strip()[-200:]})")
c = card(sb, "revisions.json", out.get("cardId", "")) if out else None
check(c is not None and c["kind"] == "comment" and c["text"].startswith("Agreed"), "comment landed")
if c:
    src = card(sb, "revisions.json", REVISION_COMMENT)
    want = {k: v for k, v in src["links"][0]["anchor"].items() if k != "margin"}
    check(c["links"][0]["anchor"] == want and "textRange" in want,
          "Mode-B anchor (textRange) copied verbatim")
    check(c["links"][0]["target"]["ref"]["kind"] == "revision-comment", "self-link → revision-comment")
    check("aiOriginRequestId" not in c, "no back-pointer for a virtual id")

print("\n=== --kind=comment off a Revisions thread is refused ===")
sb = sandbox()
before = snapshot(sb)
r, _ = create(sb, SUG_REQ, "--kind=comment", "--body", scratch("hi"))
check(r.returncode != 0 and "Revisions" in r.stderr, "refused (Task is linked to a todo)")
check(snapshot(sb) == before, "nothing written")

print("\n=== chat path: the Task is synthesized and the card points back at it ===")
sb = sandbox()
r, out = create(sb, "--kind=suggestion", "--anchor", "6612", "--task-text", scratch("tighten"),
                "--original", scratch(SPAN_6612), "--suggested", scratch("I add"))
check(r.returncode == 0, f"create exited 0 (stderr={r.stderr.strip()[-200:]})")
c = card(sb, "revisions.json", out.get("cardId", "")) if out else None
t = req(sb, out.get("requestId", "")) if out else None
check(t is not None and t["kind"] == "suggestion" and t["status"] == "in-progress",
      "synthesized Task: kind suggestion, awaiting review")
check(c is not None and c.get("aiOriginRequestId") == out.get("requestId"),
      "the card's aiOriginRequestId names the synthesized Task")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
