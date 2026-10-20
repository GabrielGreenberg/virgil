#!/usr/bin/env python3
r"""Task 1193 — DORMANT links ("archived with its text"), the script half.

A Link carrying `archivedWith: <snippet id>` names text that sits inside an
archive snippet: its uuid / mark is absent from the .tex ON PURPOSE and comes
back when the snippet is restored. The app's owner is src/links/dormant.ts; the
scripts' twin is `_common.is_dormant_link`. This pins that every script reader
treats such a link as "in the archive" — never as the card's live paragraph,
never as a movable anchor — and that the archive/restore doors round-trip the
fields untouched.

Run from anywhere:  python3 editor/scripts/tests/test_dormant_links.py
"""
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
APPLY = str(SCRIPTS / "apply_response.py")
CBID = str(SCRIPTS / "card_by_id.py")

sys.path.insert(0, str(SCRIPTS))
from _common import (  # noqa: E402
    card_archived_with,
    card_paragraph_ids,
    card_text_anchor,
    is_dormant_link,
)

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def link(uuid, *, dormant=None, anchor_id=None, text=None):
    anchor = {"type": "textObject", "targetKind": "paragraph", "textObjectIds": [uuid]}
    if anchor_id:
        anchor["targetKind"] = "linkedRange"
        anchor["textRange"] = {"anchorId": anchor_id, "textSnapshot": text or ""}
    out = {"id": f"l-{uuid}", "kind": "anchor", "anchor": anchor,
           "target": {"type": "card", "ref": {"kind": "note", "id": "n1"}},
           "createdAt": "2026-10-20T00:00:00Z"}
    if dormant:
        out["archivedWith"] = dormant
    return out


print("\n=== the predicate ===")
check(is_dormant_link(link("P1", dormant="snip")), "a link with archivedWith is dormant")
check(not is_dormant_link(link("P1")), "a live link is not")
check(not is_dormant_link(link("P1", dormant="")), "an empty archivedWith is not")
check(card_archived_with({"archivedWith": "snip"}) == "snip", "card_archived_with names the snippet")
check(card_archived_with({}) is None, "…and None for an ordinary card")

print("\n=== readers see only live links ===")
card = {"links": [link("P1", dormant="snip"), link("P2"),
                  link("P3", dormant="snip", anchor_id="A3", text="archived words")]}
check(card_paragraph_ids(card) == ["P2"], "card_paragraph_ids skips dormant pids")
check(card_text_anchor(card) is None, "card_text_anchor skips a dormant highlight")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="dormant-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def op(sb, sub, payload):
    return subprocess.run([sys.executable, APPLY, str(sb), sub, json.dumps(payload)],
                          capture_output=True, text=True, env=dict(os.environ))


def load(doc, name):
    return json.loads((doc / "virgil" / name).read_text())


def save(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


def by_id(doc, name, key, cid):
    return next((c for c in load(doc, name).get(key, []) if c.get("id") == cid), None)


TODO = "ab7e7930-78cb-4d4c-b400-9ac04906a8fd"   # todos.json, anchor 3301, Mode A


def make_dormant(sb):
    st = load(sb, "todos.json")
    for c in st["items"]:
        if c["id"] == TODO:
            for l in c["links"]:
                l["archivedWith"] = "snip-1"
            c["archived"] = True
            c["archivedWith"] = "snip-1"
    save(sb, "todos.json", st)
    return by_id(sb, "todos.json", "items", TODO)


print("\n=== move refuses a card archived with its text, and leaves it byte-identical ===")
sb = sandbox()
before = make_dormant(sb)
r = op(sb, "move", {"cardId": TODO, "newAnchor": "1101"})
check(r.returncode != 0 and "archived with its text" in r.stderr,
      f"move refuses, naming the archive (stderr={r.stderr.strip()[:120]})")
check(by_id(sb, "todos.json", "items", TODO) == before, "the dormant card is untouched")

print("\n=== card_by_id reports archivedWith ===")
r = subprocess.run([sys.executable, CBID, str(sb), TODO], capture_output=True, text=True)
out = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
check(out.get("archivedWith") == "snip-1", "card_by_id surfaces the snippet id")

print("\n=== archive → restore round-trips the dormant fields untouched ===")
sb = sandbox()
before = make_dormant(sb)
r = op(sb, "archive", {"cardId": TODO})
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:120]})")
r = op(sb, "restore", {"cardId": TODO})
check(r.returncode == 0, f"restore exited 0 (stderr={r.stderr.strip()[:120]})")
check(by_id(sb, "todos.json", "items", TODO) == before,
      "restored card keeps archivedWith on the card and on every link")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
