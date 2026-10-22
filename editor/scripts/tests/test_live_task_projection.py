#!/usr/bin/env python3
r"""The drain and the writer door read ONE live projection of a Task (task 1232).

A bridged `ai-requests.json` row's `text` / `paragraphIds` / `selectedText`
are a SNAPSHOT from bridge time. The drain (`list_requests.py`) already read
the live `text` (task 955), but the writer door (`create_card.py`) read the raw
row — so a proposal stamped the stale ask as `instructions`, and after the
user MOVED the flagged card, the skills' "one call shape"
`--anchor <paragraphIds[0]>` defeated task 1230's inheritance. Now both read
`list_requests.project_task_row`. Pinned through the real CLIs:

  1. MOVED CARD — a Task whose phrase-pinned todo was moved to bbbb (row still
     says aaaa): the drain emits bbbb; an answer with --anchor aaaa (the stale
     snapshot), with --anchor bbbb (the drain's), or with none, inherits the
     todo's live Mode-B anchor at bbbb.
  2. GONE PARAGRAPH — the same with aaaa deleted from the .tex still succeeds.
  3. PARITY — the drain row's paragraphIds[0] is where the door lands.
  4. LIVE ASK — a proposal answering a bridged comment edited since bridging
     stamps the comment's CURRENT text as `instructions`.

Run from anywhere, no pytest:
    python3 editor/scripts/tests/test_live_task_projection.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
LIST = str(SCRIPTS / "list_requests.py")

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


P_A = "The reader underlines a phrase and then brackets the argument. %!v:aaaa\n\n"
P_B = "A second paragraph with free words. %!v:bbbb\n"


def tex_with(*paras):
    return "\\documentclass{article}\n\\begin{document}\n" + "".join(paras) + "\\end{document}\n"


def make_doc(tmp: str) -> Path:
    doc = Path(tmp) / "paper"
    (doc / "virgil").mkdir(parents=True)
    (doc / "paper.tex").write_text(tex_with(P_A, P_B))
    return doc


def run(script, *args):
    return subprocess.run([sys.executable, script, *args], capture_output=True, text=True,
                          env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def save(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


def at(tmp, text):
    p = Path(tmp) / f"b{abs(hash(text))}.txt"
    p.write_text(text)
    return "@" + str(p)


def drain(doc, rid):
    r = run(LIST, str(doc))
    rows = [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith("{")]
    return next((x for x in rows if x.get("id") == rid), None)


def moved_todo(doc, tmp):
    """The user's todo, pinned to «free words» at bbbb — but the Task row was
    bridged while it still sat at aaaa (the bridge does not re-derive on a move)."""
    r = run(CREATE, str(doc), "--kind=todo", "--anchor", "bbbb", "--body", "Check this",
            "--range", at(tmp, "free words"))
    assert r.returncode == 0, r.stderr
    todo = load(doc, "todos.json")["items"][-1]
    todo["aiRequest"] = True
    ar = {"requests": [{
        "id": "req-1", "kind": "todo", "text": "Check this", "paragraphIds": ["aaaa"],
        "status": "pending", "createdAt": "2026-10-22T00:00:00.000Z",
        "linkedTo": {"panel": "todos", "cardId": todo["id"]},
    }]}
    save(doc, "ai-requests.json", ar)
    return todo["links"][0]["anchor"]


print("\n=== moved card: the answer inherits the todo's LIVE span ===")
for label, anchor_args in [("stale --anchor aaaa", ["--anchor", "aaaa"]),
                           ("drain's --anchor bbbb", ["--anchor", "bbbb"]),
                           ("no --anchor", [])]:
    with tempfile.TemporaryDirectory() as tmp:
        doc = make_doc(tmp)
        src = moved_todo(doc, tmp)
        row = drain(doc, "req-1")
        check(row is not None and row["paragraphIds"] == ["bbbb"]
              and row.get("selectedText") == "free words",
              f"[{label}] drain emits the todo's live paragraph + span ({row and row.get('paragraphIds')})")
        r = run(CREATE, str(doc), "req-1", "--kind=note", "--accept-task-kind", "todo",
                "--body", "Done.", *anchor_args)
        check(r.returncode == 0, f"[{label}] answer succeeds ({r.stderr.strip()[:200]})")
        if r.returncode == 0:
            a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
            check(a.get("textObjectIds") == ["bbbb"] and a.get("textRange") == src.get("textRange"),
                  f"[{label}] lands at bbbb sharing the todo's anchorId (drain/door parity)")

print("\n=== moved card + its old paragraph deleted: still lands ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    src = moved_todo(doc, tmp)
    t = (doc / "paper.tex").read_text()
    (doc / "paper.tex").write_text(t.replace(P_A, ""))
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--accept-task-kind", "todo",
            "--anchor", "aaaa", "--body", "Done.")
    check(r.returncode == 0, f"stale --anchor at a deleted paragraph does not die ({r.stderr.strip()[:200]})")
    if r.returncode == 0:
        a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
        check(a.get("textRange") == src.get("textRange"), "…and inherits the live span at bbbb")

print("\n=== aiming elsewhere still means elsewhere ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = (Path(tmp) / "paper")
    (doc / "virgil").mkdir(parents=True)
    (doc / "paper.tex").write_text(tex_with(P_A, P_B, "A third one. %!v:cccc\n"))
    moved_todo(doc, tmp)
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--accept-task-kind", "todo",
            "--anchor", "cccc", "--body", "Done.")
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"] if r.returncode == 0 else None
    check(a == {"type": "textObject", "targetKind": "paragraph", "textObjectIds": ["cccc"]},
          f"--anchor <a third paragraph> → Mode A there ({r.stderr.strip()[:160]})")

print("\n=== live ask: a proposal stamps the comment's CURRENT text ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    save(doc, "revisions.json", {"cards": [{
        "id": "rc1", "kind": "comment", "text": "Is this claim actually sourced?", "aiRequest": True,
        "createdAt": "2026-10-22T00:00:00.000Z",
        "links": [{"anchor": {"type": "textObject", "targetKind": "paragraph",
                              "textObjectIds": ["aaaa"]}}],
    }]})
    save(doc, "ai-requests.json", {"requests": [{
        "id": "req-2", "kind": "suggestion", "text": "Is this", "paragraphIds": ["aaaa"],
        "status": "pending", "createdAt": "2026-10-22T00:00:00.000Z",
        "linkedTo": {"panel": "revisions", "cardId": "rc1"},
    }]})
    row = drain(doc, "req-2")
    r = run(CREATE, str(doc), "req-2", "--kind=suggestion", "--anchor", "aaaa",
            "--original", at(tmp, "brackets the argument"),
            "--suggested", at(tmp, "frames the argument"), "--explanation", "tighter")
    check(r.returncode == 0, f"proposal lands ({r.stderr.strip()[:200]})")
    if r.returncode == 0:
        sug = next(c for c in load(doc, "revisions.json")["cards"] if c.get("kind") == "suggestion")
        check(sug.get("instructions") == "Is this claim actually sourced?" == (row or {}).get("text"),
              f"instructions = the live ask = the drain's text ({sug.get('instructions')!r})")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
