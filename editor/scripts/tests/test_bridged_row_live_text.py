#!/usr/bin/env python3
r"""Task 955 — a bridged row's drain `text` is the LINKED CARD's current text.

A bridged `ai-requests.json` row's `text` is a SNAPSHOT taken when the bridge
fired: the first committed fragment of a cutter / revision comment or report
request (whatever was typed before the first 250 ms typing pause), or a note's
title at the moment its AI box was ticked. No later edit rewrites it. The
responder triages on the drain's `text` (`_ask-shape.md` §1) and stamps it
into `instructions`, so `list_requests.py` derives it from the card — the SSOT
— through the same per-kind summary the unbridged fallback uses, and keeps the
stored row text only when the link does not resolve.

Run from anywhere:  python3 editor/scripts/tests/test_bridged_row_live_text.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIST = str(ROOT / "editor/scripts/list_requests.py")

PASS, FAIL = 0, 0

FRAGMENT = "Is this"
FULL = "Is this claim actually sourced?"


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def make_doc(sidecars: dict, ai_requests: list):
    d = Path(tempfile.mkdtemp(prefix="bridged-live-"))
    (d / "document.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n"
    )
    v = d / "virgil"
    v.mkdir()
    for name, data in sidecars.items():
        (v / name).write_text(json.dumps(data, indent=2))
    (v / "ai-requests.json").write_text(json.dumps({"requests": ai_requests}, indent=2))
    return d


def list_rows(doc):
    r = subprocess.run(
        [sys.executable, LIST, str(doc)],
        capture_output=True, text=True, env=dict(os.environ),
    )
    assert r.returncode == 0, f"list_requests failed: {r.stderr}"
    return [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith("{")]


def bridged(rid, kind, panel, card_id, text=FRAGMENT):
    return {
        "id": rid, "kind": kind, "text": text, "status": "pending",
        "createdAt": "2026-10-05T00:00:00.000Z",
        "linkedTo": {"panel": panel, "cardId": card_id},
    }


def text_of(rows, rid):
    hit = [r for r in rows if r["id"] == rid]
    return hit[0].get("text") if hit else None


def comment(cid, text, kind="comment"):
    return {"id": cid, "kind": kind, "text": text, "aiRequest": True,
            "createdAt": "2026-10-05T00:00:00.000Z", "links": []}


print("\n=== comments + report request: bridged on a fragment, edited since ===")
doc = make_doc(
    {
        "cutter.json": {"cards": [comment("cc1", FULL)]},
        "revisions.json": {"cards": [comment("rc1", FULL)]},
        "reports.json": {"cards": [comment("rr1", FULL, kind="report-request")]},
    },
    [
        bridged("q-cut", "suggestion", "cutter", "cc1"),
        bridged("q-rev", "suggestion", "revisions", "rc1"),
        bridged("q-rep", "report", "reports", "rr1"),
    ],
)
rows = list_rows(doc)
check(text_of(rows, "q-cut") == FULL, "cutter comment: drain reads the full current body")
check(text_of(rows, "q-rev") == FULL, "revision comment: drain reads the full current body")
check(text_of(rows, "q-rep") == FULL, "report request: drain reads the full current body")

print("\n=== note ticked for AI, then retitled ===")
doc = make_doc(
    {"notes.json": {"cards": [
        {"id": "n1", "kind": "note", "title": "Check the dating of the gloss",
         "aiRequest": True, "links": []},
    ]}},
    [bridged("q-note", "note", "notes", "n1", text="Check")],
)
check(text_of(list_rows(doc), "q-note") == "Check the dating of the gloss",
      "note: drain reads the CURRENT title, not the toggle-time snapshot")

print("\n=== the (wire kind, panel) PAIR picks the card kind ===")
# note and highlight share notes.json; a highlight row must not read a note's
# title (or vice versa) just because the ids collide on the panel.
doc = make_doc(
    {"notes.json": {"cards": [
        {"id": "h1", "kind": "highlight", "aiRequest": True, "links": [
            {"anchor": {"textRange": {"textSnapshot": "the marginal gloss"}}},
        ]},
    ]}},
    [bridged("q-hl", "highlight", "notes", "h1", text="stale")],
)
check(text_of(list_rows(doc), "q-hl") == "the marginal gloss",
      "highlight: drain reads its Mode-B anchor text (TS highlightContext twin)")

print("\n=== fallbacks: the stored row text stands when the link does not resolve ===")
doc = make_doc(
    {"cutter.json": {"cards": [comment("cc-empty", "")]}},
    [
        bridged("q-gone", "suggestion", "cutter", "deleted-card"),
        bridged("q-empty", "suggestion", "cutter", "cc-empty"),
        {"id": "q-free", "kind": "note", "text": "free-form ask", "status": "pending",
         "createdAt": "2026-10-05T00:00:00.000Z"},
    ],
)
rows = list_rows(doc)
check(text_of(rows, "q-gone") == FRAGMENT, "card deleted → stored row text, no crash")
check(text_of(rows, "q-empty") == FRAGMENT, "card body emptied → stored row text")
check(text_of(rows, "q-free") == "free-form ask", "unlinked composer row → its own text")

doc = make_doc({}, [bridged("q-nofile", "suggestion", "cutter", "cc1")])
check(text_of(list_rows(doc), "q-nofile") == FRAGMENT,
      "sidecar missing → stored row text, no crash")

doc = make_doc({}, [bridged("q-odd", "mystery", "nowhere", "x1")])
check(text_of(list_rows(doc), "q-odd") == FRAGMENT,
      "unroutable (kind, panel) pair → stored row text, no crash")

print("\n=== reflect.py reads the same live text — terminal rows too (task 980) ===")
sys.path.insert(0, str(ROOT / "editor/scripts"))
import reflect  # noqa: E402

done_row = {**bridged("q-done", "suggestion", "cutter", "cc1"), "status": "complete"}
doc = make_doc(
    {"cutter.json": {"cards": [comment("cc1", FULL)]}},
    [bridged("q-cut", "suggestion", "cutter", "cc1"), done_row,
     bridged("q-gone", "suggestion", "cutter", "missing")],
)
check(reflect._read_task(doc, "q-cut")["text"] == FULL, "reflect: open bridged row → live card text")
check(reflect._read_task(doc, "q-done")["text"] == FULL,
      "reflect: terminal row (absent from the drain) → live card text")
check(reflect._read_task(doc, "q-gone")["text"] == FRAGMENT,
      "reflect: unresolvable link → the stored row text stands")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
