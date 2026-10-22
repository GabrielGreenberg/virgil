#!/usr/bin/env python3
r"""An answer lands where the card it answers is pinned (task 1230).

Eight skills promise "a Task already filed on a selection keeps its span
without --range". Before this task only the proposal path (suggestion /
comment) inherited the source card's anchor; a note / todo / report answering a
phrase-pinned card landed on the whole paragraph. Now ONE resolver
(`create_card._resolve_anchor`) decides the anchor for every create. Pinned here
through the real CLI:

  1. INHERIT — a note / todo / report answering a Task bridged from a Mode-B
     card, with no --range, carries the source's `linkedRange` anchor (same
     anchorId) and the .tex is byte-unchanged (no second \vlid pair).
  2. AIM ELSEWHERE — --anchor <other paragraph> → Mode A there.
  3. DORMANT — a source whose only link is archived is not inherited.
  4. VIRTUAL — a virtual card-flag id whose --anchor is the source's own
     paragraph (how the responders resolve it) inherits too.
  5. SHARED PAIR — moving one of two cards sharing a range id leaves the pair
     for the other (fresh id for the mover on a range→range move).
  6. SPAN HOLDS ORIGINAL (task 1235) — a suggestion inherits the span only when
     its --original lies inside it; otherwise Mode A at the same paragraph,
     reported as `anchorDegraded`. An explicit --range that misses is refused.

Run from anywhere, no pytest:
    python3 editor/scripts/tests/test_range_inherit.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


TEX = (
    "\\documentclass{article}\n"
    "\\begin{document}\n"
    "The reader underlines a phrase and then brackets the argument. %!v:aaaa\n\n"
    "A second paragraph with free words. %!v:bbbb\n"
    "\\end{document}\n"
)


def make_doc(tmp: str) -> Path:
    doc = Path(tmp) / "paper"
    (doc / "virgil").mkdir(parents=True)
    (doc / "paper.tex").write_text(TEX)
    return doc


def run(script, *args):
    return subprocess.run([sys.executable, script, *args], capture_output=True, text=True,
                          env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def save(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


def tex(doc):
    return (doc / "paper.tex").read_text()


def body(tmp, text):
    p = Path(tmp) / f"b{abs(hash(text))}.txt"
    p.write_text(text)
    return "@" + str(p)


def pinned_note(doc, tmp):
    """The user's own note, pinned to «underlines a phrase» (Mode B)."""
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "aaaa", "--body", "What does this mean?",
            "--range", body(tmp, "underlines a phrase"))
    assert r.returncode == 0, r.stderr
    card = load(doc, "notes.json")["cards"][-1]
    return card["id"], card["links"][0]["anchor"]


def file_task(doc, rid, kind, card_id, panel="notes"):
    ar = load(doc, "ai-requests.json") or {"requests": []}
    ar["requests"].append({
        "id": rid, "kind": kind, "text": "please answer", "paragraphIds": ["aaaa"],
        "status": "pending", "createdAt": "2026-10-21T00:00:00.000Z",
        "linkedTo": {"panel": panel, "cardId": card_id},
    })
    save(doc, "ai-requests.json", ar)


def first_anchor(doc, sc, key):
    return load(doc, sc)[key][-1]["links"][0]["anchor"]


print("\n=== inherit: note / todo / report answering a phrase-pinned note ===")
for kind, extra, sc, key in [
    ("note", [], "notes.json", "cards"),
    ("todo", ["--accept-task-kind", "note"], "todos.json", "items"),
    ("report", ["--title", "R", "--accept-task-kind", "note"], "reports.json", "cards"),
]:
    with tempfile.TemporaryDirectory() as tmp:
        doc = make_doc(tmp)
        cid, src = pinned_note(doc, tmp)
        before_tex = tex(doc)
        file_task(doc, "req-1", "note", cid)
        r = run(CREATE, str(doc), "req-1", f"--kind={kind}", "--body", "An answer.", *extra)
        check(r.returncode == 0, f"{kind} answer succeeds ({r.stderr.strip()[:200]})")
        if r.returncode:
            continue
        a = first_anchor(doc, sc, key)
        check(a.get("targetKind") == "linkedRange" and a.get("textRange") == src.get("textRange")
              and a.get("textObjectIds") == ["aaaa"],
              f"{kind} carries the source's Mode-B anchor (same anchorId)")
        check(tex(doc) == before_tex, f"{kind}: the .tex is byte-unchanged (no second \\vlid pair)")
        if kind == "report":
            check(load(doc, sc)[key][-1].get("selectedText") == "underlines a phrase",
                  "report carries the inherited span as its selectedText")

print("\n=== aim elsewhere: --anchor <other paragraph> is Mode A there ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, _ = pinned_note(doc, tmp)
    file_task(doc, "req-1", "note", cid)
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--anchor", "bbbb", "--body", "Elsewhere.")
    a = first_anchor(doc, "notes.json", "cards")
    check(r.returncode == 0 and a == {"type": "textObject", "targetKind": "paragraph",
                                      "textObjectIds": ["bbbb"]},
          f"--anchor bbbb lands Mode A at bbbb ({r.stderr.strip()[:160]})")

print("\n=== an explicit --range still wins the inheritance ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, src = pinned_note(doc, tmp)
    file_task(doc, "req-1", "note", cid)
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--body", "x",
            "--range", body(tmp, "brackets the argument"))
    a = first_anchor(doc, "notes.json", "cards")
    rid = (a.get("textRange") or {}).get("anchorId")
    check(r.returncode == 0 and rid and rid != src["textRange"]["anchorId"]
          and f"\\vlid{{{rid}}}brackets the argument\\vlidend{{{rid}}}" in tex(doc),
          f"--range pins the answer to its own span ({r.stderr.strip()[:160]})")

print("\n=== dormant: an archived link is not inherited ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, _ = pinned_note(doc, tmp)
    notes = load(doc, "notes.json")
    notes["cards"][-1]["links"][0]["archivedWith"] = "snip-1"
    save(doc, "notes.json", notes)
    file_task(doc, "req-1", "note", cid)
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--body", "x")
    a = first_anchor(doc, "notes.json", "cards")
    check(r.returncode == 0 and a == {"type": "textObject", "targetKind": "paragraph",
                                      "textObjectIds": ["aaaa"]},
          f"a dormant source link → Mode A at the Task's paragraph ({r.stderr.strip()[:160]})")

print("\n=== virtual card-flag id at the source's paragraph: span inherited ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, src = pinned_note(doc, tmp)
    r = run(CREATE, str(doc), f"virtual:notes:{cid}", "--kind=note", "--anchor", "aaaa", "--body", "x")
    a = first_anchor(doc, "notes.json", "cards")
    check(r.returncode == 0 and a.get("textRange") == src.get("textRange"),
          f"virtual id → inherited Mode-B anchor ({r.stderr.strip()[:160]})")

print("\n=== shared pair: moving one card leaves the other's span ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, src = pinned_note(doc, tmp)
    rid = src["textRange"]["anchorId"]
    file_task(doc, "req-1", "note", cid)
    r = run(CREATE, str(doc), "req-1", "--kind=note", "--body", "An answer.")
    ans = json.loads(r.stdout)["cardId"]
    r = run(APPLY, str(doc), "move", json.dumps({"cardId": ans, "newAnchor": "bbbb"}))
    check(r.returncode == 0 and f"\\vlid{{{rid}}}underlines a phrase\\vlidend{{{rid}}}" in tex(doc),
          f"range→paragraph move of the answer keeps the source's pair ({r.stderr.strip()[:160]})")
    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "bbbb",
                                                 "newRange": "free words"}))
    t = tex(doc)
    a = next(c for c in load(doc, "notes.json")["cards"] if c["id"] == cid)["links"][0]["anchor"]
    check(r.returncode == 0 and "underlines a phrase\\vlidend" not in t
          and f"\\vlid{{{rid}}}free words\\vlidend{{{rid}}}" in t,
          "once unshared, a range→range move reuses the id and drops the old pair")

with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, src = pinned_note(doc, tmp)
    rid = src["textRange"]["anchorId"]
    file_task(doc, "req-1", "note", cid)
    run(CREATE, str(doc), "req-1", "--kind=note", "--body", "An answer.")
    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "bbbb",
                                                 "newRange": "free words"}))
    t = tex(doc)
    a = next(c for c in load(doc, "notes.json")["cards"] if c["id"] == cid)["links"][0]["anchor"]
    nid = (a.get("textRange") or {}).get("anchorId")
    check(r.returncode == 0 and nid and nid != rid
          and f"\\vlid{{{rid}}}underlines a phrase\\vlidend{{{rid}}}" in t
          and f"\\vlid{{{nid}}}free words\\vlidend{{{nid}}}" in t,
          f"a shared range→range move keeps the shared pair and mints a fresh id ({r.stderr.strip()[:160]})")

print("\n=== suggestion: an inherited span must contain --original (task 1235) ===")
for original, inside in [("underlines a phrase", True), ("a phrase", True),
                         ("brackets the argument", False)]:
    with tempfile.TemporaryDirectory() as tmp:
        doc = make_doc(tmp)
        cid, src = pinned_note(doc, tmp)
        before_tex = tex(doc)
        file_task(doc, "req-1", "note", cid)
        r = run(CREATE, str(doc), "req-1", "--kind=suggestion", "--accept-task-kind", "note",
                "--original", body(tmp, original), "--suggested", body(tmp, "a rewrite"))
        check(r.returncode == 0, f"suggestion on «{original}» succeeds ({r.stderr.strip()[:200]})")
        if r.returncode:
            continue
        out = json.loads(r.stdout)
        card = load(doc, "revisions.json")["cards"][-1]
        a = card["links"][0]["anchor"]
        check(tex(doc) == before_tex, f"«{original}»: the .tex is byte-unchanged (no \\vlid change)")
        if inside:
            check(a.get("textRange") == src.get("textRange") and "anchorDegraded" not in out,
                  f"«{original}» inside the span → inherits the source's Mode-B anchor")
        else:
            check(a == {"type": "textObject", "targetKind": "paragraph", "textObjectIds": ["aaaa"]},
                  f"«{original}» outside the span → Mode A at the same paragraph")
            check(out.get("anchorDegraded") == "original outside inherited span",
                  f"the result reports the degrade ({out.get('anchorDegraded')!r})")
            check(card.get("selectedText") != "underlines a phrase",
                  "the degraded card does not quote the source's selected words")

with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    cid, _ = pinned_note(doc, tmp)
    before_tex = tex(doc)
    file_task(doc, "req-1", "note", cid)
    r = run(CREATE, str(doc), "req-1", "--kind=suggestion", "--accept-task-kind", "note",
            "--original", body(tmp, "brackets the argument"), "--suggested", body(tmp, "x"),
            "--range", body(tmp, "underlines a phrase"))
    check(r.returncode != 0 and "--range must contain --original" in r.stderr
          and tex(doc) == before_tex and not load(doc, "revisions.json"),
          "an explicit --range that misses --original is still REFUSED, nothing written")

print("\n=== skill prose: no skill says move refuses a Mode-B range ===")
SKILLS = ROOT / "editor/skills"
stale = []
for md in sorted(SKILLS.glob("*.md")):
    for i, line in enumerate(md.read_text().splitlines(), 1):
        if re.search(r"\bmove\b", line, re.I) \
                and re.search(r"refuses?[^,.;|]*(Mode[- ]B|text[- ]range|\brange\b)", line, re.I):
            stale.append(f"{md.name}:{i}")
check(not stale, f"move handles Mode B (task 1197) — no skill says it refuses one {stale}")
inherit = [md.name for md in SKILLS.glob("*.md") if "keeps its span" in md.read_text()
           or "copies that\n  anchor" in md.read_text() or "copies that anchor" in md.read_text()]
check(len(inherit) >= 6, f"the inheritance promise is still stated where answers are drafted ({inherit})")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
