#!/usr/bin/env python3
"""Task 942: a `virtual:<panel>:<cardId>` request id is PARSED once and FAILS
CLOSED.

The card-flag address used to be split by hand in four places, none of which
checked the panel or that the card existed — so `virtual:note:x` (singular),
`virtual:notes:` or a deleted card id landed the answer, lowered no flag and
exited 0, and the next drain re-emitted the same request.

Pins:
  1. `_common.parse_virtual_request_id` — the panel vocabulary is the routing
     manifest's linkPanels + `examples`; `citations` is NOT in it.
  2. cmd_write (`complete-task`): `virtual:note:<id>`, `virtual:notes:`,
     `virtual:notes:<missing>`, `virtual:citations:<id>` each exit non-zero
     with every byte unchanged; a valid id lands the card and lowers the flag.
  3. the mutation tail (`update`): a missing source card refuses, byte-identical.
  4. task 1234: an ALREADY-ANSWERED virtual id (flag down) — create_card no-ops
     (ONE proposal / ONE answer after two runs) and the write door + mutation
     tail refuse, byte-identical.

Run from anywhere:  python3 editor/scripts/tests/test_virtual_request_id.py
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
APPLY = str(SCRIPTS / "apply_response.py")
sys.path.insert(0, str(SCRIPTS))

import _common  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def dies(fn, *args):
    try:
        fn(*args)
    except SystemExit as e:
        return e.code != 0
    return False


print("=== parse_virtual_request_id: one parser, one vocabulary ===")
routing = json.loads((SCRIPTS / "ai_request_routing.json").read_text())["routing"]
check(_common.AI_REQUEST_LINK_PANELS == {r["linkPanel"] for r in routing.values()},
      "link panels are exactly the routing manifest's linkPanels")
check("citations" not in _common.VIRTUAL_ID_PANELS, "citations is not an addressable panel")
check("examples" in _common.VIRTUAL_ID_PANELS, "examples (create_card's own virtual) is")
check(_common.parse_virtual_request_id("virtual:notes:a:b") == {"panel": "notes", "cardId": "a:b"},
      "a card id may itself contain ':'")
for bad in ["virtual:note:x", "virtual:notes:", "virtual::x", "virtual:notes",
            "virtual:citations:x", "virtuals:notes:x"]:
    check(dies(_common.parse_virtual_request_id, bad), f"{bad!r} dies")

NID = "ea4d5253-406d-499e-85b6-8055956c9f95"  # a note in the sample


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="t942-")) / "paper"
    shutil.copytree(SAMPLE, d)
    np = d / "virgil/notes.json"
    notes = json.loads(np.read_text())
    for c in notes["cards"]:
        if c["id"] == NID:
            c["aiRequest"] = True
    np.write_text(json.dumps(notes, indent=2) + "\n")
    return d


def snapshot(doc):
    snap = {}
    for p in sorted((doc / "virgil").glob("*.json")) + sorted(doc.glob("*.tex")):
        if p.name == "collab.json":
            continue
        snap[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
    vp = doc / "virgil/version.txt"
    snap["version.txt"] = vp.read_text() if vp.exists() else None
    return snap


def note(doc, cid=NID):
    return next((c for c in json.loads((doc / "virgil/notes.json").read_text())["cards"]
                 if c["id"] == cid), None)


def write(doc, rid, answer_id):
    op = {
        "requestId": rid,
        "panel": "notes",
        "card": {"kind": "note", "id": answer_id, "text": "An answer.", "aiRequest": False},
    }
    return subprocess.run([sys.executable, APPLY, str(doc), "complete-task", json.dumps(op)],
                          capture_output=True, text=True)


print("\n=== cmd_write: a bad virtual id writes nothing ===")
for rid in [f"virtual:note:{NID}", "virtual:notes:", "virtual:notes:no-such-card",
            f"virtual:citations:{NID}"]:
    sb = sandbox()
    before = snapshot(sb)
    r = write(sb, rid, "answer-1")
    check(r.returncode != 0, f"{rid}: exits non-zero")
    check(snapshot(sb) == before, f"{rid}: byte-identical (no answer card, no notification)")

print("\n=== cmd_write: a valid virtual id lands and lowers the flag ===")
sb = sandbox()
r = write(sb, f"virtual:notes:{NID}", "answer-2")
check(r.returncode == 0, f"valid id exits 0 {r.stderr.strip()[:200]}")
check(note(sb, "answer-2") is not None, "answer card landed")
check(note(sb).get("aiRequest") is False, "source flag lowered")

print("\n=== mutation tail: a missing source card refuses ===")
sb = sandbox()
before = snapshot(sb)
r = subprocess.run([sys.executable, APPLY, str(sb), "update",
                    json.dumps({"cardId": NID, "body": "Rewritten.",
                                "requestId": "virtual:notes:no-such-card"})],
                   capture_output=True, text=True)
check(r.returncode != 0, "update with a missing virtual source exits non-zero")
check(snapshot(sb) == before, "update with a missing virtual source is byte-identical")

# ---------------------------------------------------------------- task 1234
# A virtual id's ONLY state is its source card's `aiRequest` flag. Once an
# earlier landing lowered it, a re-run or a racing dispatch must not land a
# second answer: create_card no-ops before building one, and the write door
# refuses (byte-identical) when a caller goes around create_card.
CREATE = str(SCRIPTS / "create_card.py")
CUT_COMMENT = "582f061d-311f-4ef0-adcd-bff13a86d71b"  # cutter.json comment at 2202


def scratch(text):
    f = Path(tempfile.mkdtemp(prefix="t1234-")) / "arg.txt"
    f.write_text(text)
    return f"@{f}"


def create(doc, *args):
    r = subprocess.run([sys.executable, CREATE, str(doc), *args], capture_output=True, text=True)
    out = {}
    if r.returncode == 0 and r.stdout.strip():
        out = json.loads(r.stdout.strip().splitlines()[-1])
    return r, out


def cards(doc, fname):
    return json.loads((doc / "virgil" / fname).read_text())["cards"]


print("\n=== task 1234: a virtual suggestion re-run is a no-op (ONE proposal) ===")
sb = sandbox()
cp = sb / "virgil/cutter.json"
cs = json.loads(cp.read_text())
for c in cs["cards"]:
    if c["id"] == CUT_COMMENT:
        c["aiRequest"] = True
cp.write_text(json.dumps(cs, indent=2) + "\n")
n_before = len(cards(sb, "cutter.json"))
sug = ("--kind=suggestion", "--original", scratch("pre-glossed for purchasers"),
       "--suggested", scratch(""), "--explanation", "cut it")
r1, o1 = create(sb, f"virtual:cutter:{CUT_COMMENT}", *sug)
check(r1.returncode == 0 and not o1.get("noop"), f"first run lands (stderr={r1.stderr.strip()[-200:]})")
mid = snapshot(sb)
r2, o2 = create(sb, f"virtual:cutter:{CUT_COMMENT}", *sug)
check(r2.returncode == 0 and o2.get("noop") is True
      and o2.get("reason") == "request already answered", f"second run is the idempotent no-op ({o2})")
check(len(cards(sb, "cutter.json")) == n_before + 1, "cutter.json holds ONE proposal")
check(snapshot(sb) == mid, "the no-op wrote nothing")

print("\n=== task 1234: a virtual carded answer (note) re-run is a no-op ===")
sb = sandbox()
n_before = len(cards(sb, "notes.json"))
args = (f"virtual:notes:{NID}", "--kind=note", "--body", "Re: flagged.", "--anchor", "4402")
r1, o1 = create(sb, *args)
check(r1.returncode == 0 and not o1.get("noop"), f"first run lands (stderr={r1.stderr.strip()[-200:]})")
mid = snapshot(sb)
r2, o2 = create(sb, *args)
check(r2.returncode == 0 and o2.get("noop") is True, f"second run is the no-op ({o2})")
check(len(cards(sb, "notes.json")) == n_before + 1, "notes.json holds ONE answer")
check(snapshot(sb) == mid, "the no-op wrote nothing")

print("\n=== task 1234: the write door refuses an already-answered virtual id ===")
sb = sandbox()
check(write(sb, f"virtual:notes:{NID}", "answer-a").returncode == 0, "first direct write lands")
before = snapshot(sb)
r = write(sb, f"virtual:notes:{NID}", "answer-b")
check(r.returncode != 0 and "answered by an earlier landing" in r.stderr,
      f"second direct write refuses ({r.stderr.strip()[-160:]})")
check(snapshot(sb) == before and note(sb, "answer-b") is None, "…byte-identical")
r = subprocess.run([sys.executable, APPLY, str(sb), "update",
                    json.dumps({"cardId": NID, "body": "Rewritten.",
                                "requestId": f"virtual:notes:{NID}"})],
                   capture_output=True, text=True)
check(r.returncode != 0 and snapshot(sb) == before,
      "mutation tail (update) on an already-answered virtual id refuses, byte-identical")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
