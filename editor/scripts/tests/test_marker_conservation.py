#!/usr/bin/env python3
r"""Marker conservation across a suggestion splice — the PYTHON half (task 1426).

A suggestion's identity markers (`\vcid` / `\vfid` / `\vlid`…) had three
answers: the skill doctrine said carry them through, the browser applicator
refused any, and the script doors checked nothing — so a replacement that
dropped `\vfid{f002}\footnote{…}` deleted the user's footnote prose on accept.
Now every door asks ONE predicate. This suite holds the Python twin to:

  1. the shared golden corpus
     src/lib/__tests__/fixtures/marker-conservation-corpus.json (TS reader:
     marker-conservation-parity.test.ts);
  2. the REAL apply_response.py doors, end to end on fresh copies of
     samples/annotation-history: propose refuses an unconserving revision and
     a footnote-dropping cut (nothing written), accepts a conserving one, and
     accept — reached by a card that skipped propose — refuses too, leaving
     the .tex byte-identical.

Runs from anywhere, no pytest:
    python3 editor/scripts/tests/test_marker_conservation.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
APPLY = str(SCRIPTS / "apply_response.py")
CORPUS = ROOT / "src/lib/__tests__/fixtures/marker-conservation-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402

ISO = "2026-11-02T00:00:00.000Z"
PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


# ---------------------------------------------------------------------------
# 1. Corpus parity
# ---------------------------------------------------------------------------
print("\n=== the shared corpus, answered by the Python twin ===")
corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
for c in corpus["cases"]:
    got = C.marker_conservation_violation(c["matched"], c["replacement"], c["wholeCut"],
                                         c.get("humanAuthored", False))
    check(got == c["expected"], f"{c['name']}: {got} == {c['expected']}")
    if c["expected"]:
        call = "\\" + c["expected"]["command"] + "{" + c["expected"]["id"] + "}"
        check(call in C.describe_marker_violation(c["expected"]),
              f"{c['name']}: the refusal names {call}")


# ---------------------------------------------------------------------------
# 2. The real doors
# ---------------------------------------------------------------------------
def sandbox():
    d = Path(tempfile.mkdtemp(prefix="t1426-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True,
                          env=dict(os.environ))


def tex_path(doc):
    return next(doc.glob("*.tex"))


def vbytes(doc, name):
    return (doc / "virgil" / name).read_bytes()


def add_request(doc, req):
    p = doc / "virgil" / "ai-requests.json"
    st = json.loads(p.read_text())
    st.setdefault("requests", []).append(req)
    p.write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def card(card_id, kind_label, anchor, original, suggested, task_id=None):
    c = {
        "kind": "suggestion", "id": card_id, "createdAt": ISO, "author": "ai",
        "original_text": original, "suggested_text": suggested,
        "explanation": "x", "user_text": "", "instructions": "", "status": "pending",
        "selectedText": "",
        "links": [{
            "id": f"link-{card_id}", "kind": "anchor",
            "anchor": {"type": "textObject", "targetKind": "paragraph",
                       "textObjectIds": [anchor], "margin": {"side": "right"}},
            "target": {"type": "card", "ref": {"kind": kind_label, "id": card_id}},
            "createdAt": ISO,
        }],
    }
    if task_id:
        c["aiOriginRequestId"] = task_id
    return c


def propose(doc, panel, c, task_id):
    op = {"requestId": task_id, "panel": panel, "card": c,
          "summary": "Drafted a suggestion", "clearSourceFlag": False}
    return run(APPLY, str(doc), "complete-task", json.dumps(op), "--propose")


CITED = r"adapted from a remark in \vcid{cc03}\citet{slights2001}, on Renaissance printers'"
FOOTED = (r"polemical asides\vfid{f002}\footnote{The standard study is \vcid{cc02}\citet{jackson2001}, "
          r"which traces the migration of marginalia from manuscript to print to the Romantic "
          r"notebook. Jackson's central insight is that marginalia are the \emph{only} reliable "
          r"evidence we have of what readers actually \underline{did} with their books.}.")

print("\n=== propose: a revision that DROPS \\vcid is refused, nothing written ===")
sb = sandbox()
assert CITED in tex_path(sb).read_text(encoding="utf-8"), "fixture span drifted from the sample"
add_request(sb, {"id": "t-rev-a", "kind": "suggestion", "text": "tighten",
                 "createdAt": ISO, "status": "pending", "paragraphIds": ["2202"]})
rev_before, ar_before = vbytes(sb, "revisions.json"), vbytes(sb, "ai-requests.json")
r = propose(sb, "revisions",
            card("rev-drop", "revision-suggestion", "2202", CITED,
                 r"borrowed from \citet{slights2001}, on Renaissance printers'", "t-rev-a"),
            "t-rev-a")
check(r.returncode != 0 and "\\vcid{cc03}" in r.stderr,
      f"propose REFUSED naming \\vcid{{cc03}} (rc={r.returncode}, stderr={r.stderr.strip()[:200]})")
check(vbytes(sb, "revisions.json") == rev_before, "revisions.json byte-unchanged")
check(vbytes(sb, "ai-requests.json") == ar_before, "ai-requests.json byte-unchanged")

print("\n=== propose → accept: a revision that CARRIES \\vcid lands ===")
suggested = r"borrowed from a remark in \vcid{cc03}\citet{slights2001}, on Renaissance printers'"
r = propose(sb, "revisions",
            card("rev-keep", "revision-suggestion", "2202", CITED, suggested, "t-rev-a"),
            "t-rev-a")
check(r.returncode == 0, f"conserving propose exited 0 (stderr={r.stderr.strip()[:200]})")
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-keep"}))
check(r.returncode == 0, f"conserving accept exited 0 (stderr={r.stderr.strip()[:200]})")
tex = tex_path(sb).read_text(encoding="utf-8")
check(suggested in tex and tex.count("\\vcid{cc03}") == 1,
      "the .tex holds the rewrite with \\vcid{cc03} exactly once")

print("\n=== propose: a Cutter cut that drops \\vfid is refused ===")
sb = sandbox()
assert FOOTED in tex_path(sb).read_text(encoding="utf-8"), "fixture span drifted from the sample"
add_request(sb, {"id": "t-cut-a", "kind": "suggestion", "text": "cut",
                 "createdAt": ISO, "status": "pending", "paragraphIds": ["2201"]})
cut_before = vbytes(sb, "cutter.json")
r = propose(sb, "cutter", card("cut-fn", "cutter-suggestion", "2201", FOOTED, "", "t-cut-a"),
            "t-cut-a")
check(r.returncode != 0 and "\\vfid{f002}" in r.stderr,
      f"cut REFUSED naming \\vfid{{f002}} (rc={r.returncode}, stderr={r.stderr.strip()[:200]})")
check(vbytes(sb, "cutter.json") == cut_before, "cutter.json byte-unchanged")

print("\n=== accept: a card that skipped propose and drops \\vfid is refused ===")
sb = sandbox()
p = sb / "virgil" / "revisions.json"
st = json.loads(p.read_text())
st["cards"].append(card("rev-sneak", "revision-suggestion", "2201", FOOTED, "polemical asides."))
p.write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
tex_before = tex_path(sb).read_bytes()
rev_before = vbytes(sb, "revisions.json")
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-sneak"}))
check(r.returncode != 0 and "\\vfid{f002}" in r.stderr,
      f"accept REFUSED naming \\vfid{{f002}} (rc={r.returncode}, stderr={r.stderr.strip()[:200]})")
check(tex_path(sb).read_bytes() == tex_before, ".tex byte-identical — the footnote prose survives")
check(vbytes(sb, "revisions.json") == rev_before, "card NOT flipped to accepted")

print("\n=== accept: a HUMAN's own text (user_text) may leave a citation out ===")
sb = sandbox()
p = sb / "virgil" / "revisions.json"
st = json.loads(p.read_text())
human = card("rev-human", "revision-suggestion", "2202", CITED, r"adapted from \citet{slights2001}")
human["user_text"] = "adapted from an old remark, on Renaissance printers'"
st["cards"].append(human)
p.write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
r = run(APPLY, str(sb), "accept", json.dumps({"cardId": "rev-human"}))
check(r.returncode == 0, f"human-text accept exited 0 (stderr={r.stderr.strip()[:200]})")
check(human["user_text"] in tex_path(sb).read_text(encoding="utf-8"), "the human's text landed")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
