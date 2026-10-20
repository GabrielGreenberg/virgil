#!/usr/bin/env python3
r"""Skills pin a card to a SPAN of text, not only a paragraph (task 1197).

The app anchors a note / todo / report / revision / cutter card to a text span
with a Mode-B `linkedRange` anchor: `\vlid{id}…\vlidend{id}` in the .tex plus a
sidecar link `{targetKind:"linkedRange", textObjectIds:[paragraph],
textRange:{anchorId:id, textSnapshot}}`. Before this task every skill writer
built Mode A only and `move` refused a range. Pinned here, through the real CLI:

  1. CREATE — `create_card.py --range` lands the pair around exactly the span
     and the Mode-B link, in one commit, for every range-capable kind (and the
     responder suggestion — whose pair lands even though the proposal is L3).
  2. REFUSE — absent / ambiguous / out-of-range occurrence / cuts a command /
     inside a group or math / unbalanced / overlaps an existing range / an
     atom kind: nothing written, .tex and sidecars byte-identical.
  3. MOVE — range→range (id reused, old pair gone), range→paragraph (pair
     gone, Mode A), paragraph→range (fresh id).
  4. NO RANGE — byte-identical Mode A behaviour.

Run from anywhere, no pytest:
    python3 editor/scripts/tests/test_range_anchor.py
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
    "The reader underlines a phrase and then the reader brackets the argument. %!v:aaaa\n\n"
    "A gloss with \\emph{emphatic words} and $x + y$ math sits here. %!v:bbbb\n\n"
    "Already \\vlid{ab12}pinned words\\vlidend{ab12} live next to free words. %!v:cccc\n"
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


def snap(doc: Path) -> dict:
    return {p.name: p.read_text() for p in sorted(doc.rglob("*")) if p.is_file()
            and p.name not in ("notifications.json", "version.txt", "collab.json")
            and ".virgil" not in p.parts}


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def tex(doc):
    return (doc / "paper.tex").read_text()


def pairs_balanced(text):
    opens = re.findall(r"\\vlid\{([^}]*)\}", text)
    closes = re.findall(r"\\vlidend\{([^}]*)\}", text)
    return sorted(opens) == sorted(closes) and len(set(opens)) == len(opens)


def body(tmp, text):
    p = Path(tmp) / f"b{abs(hash(text))}.txt"
    p.write_text(text)
    return "@" + str(p)


print("\n=== create: a note pinned to a span ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "aaaa", "--body", "About this phrase.",
            "--range", body(tmp, "underlines a phrase"))
    check(r.returncode == 0, f"create note --range succeeds ({r.stderr.strip()[:200]})")
    out = json.loads(r.stdout) if r.returncode == 0 else {}
    t = tex(doc)
    m = re.search(r"\\vlid\{([0-9a-f]{4})\}underlines a phrase\\vlidend\{\1\}", t)
    check(m is not None, "the .tex wraps EXACTLY the span in a \\vlid pair")
    rid = m.group(1) if m else None
    check(rid != "ab12", "the minted range id avoids the \\vlid id already in the .tex")
    check(pairs_balanced(t), "every \\vlid pair is balanced and unique")
    check(t.replace(f"\\vlid{{{rid}}}", "").replace(f"\\vlidend{{{rid}}}", "") == TEX,
          "…and nothing else in the .tex changed")
    note = (load(doc, "notes.json") or {}).get("cards", [{}])[-1]
    a = (note.get("links") or [{}])[0].get("anchor", {})
    check(a.get("targetKind") == "linkedRange" and a.get("textObjectIds") == ["aaaa"],
          "the sidecar link is Mode B on the containing paragraph")
    check(a.get("textRange") == {"anchorId": rid, "textSnapshot": "underlines a phrase"},
          "textRange.anchorId is the \\vlid id; the snapshot is the span's text")
    check(out.get("cardId") == note.get("id"), "the result names the card")

print("\n=== create: every range-capable kind; atom kinds refuse ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    for kind, extra, sc, key in [
        ("todo", [], "todos.json", "items"),
        ("report", ["--title", "R"], "reports.json", "cards"),
        ("report-request", [], "reports.json", "cards"),
    ]:
        span = {"todo": "brackets the argument", "report": "free words",
                "report-request": "sits here"}[kind]
        anchor = {"todo": "aaaa", "report": "cccc", "report-request": "bbbb"}[kind]
        r = run(CREATE, str(doc), f"--kind={kind}", "--anchor", anchor, "--body", "x", *extra,
                "--range", body(tmp, span))
        card = (load(doc, sc) or {}).get(key, [{}])[-1]
        a = (card.get("links") or [{}])[0].get("anchor", {})
        rid = (a.get("textRange") or {}).get("anchorId")
        check(r.returncode == 0 and a.get("targetKind") == "linkedRange" and rid
              and f"\\vlid{{{rid}}}{span}\\vlidend{{{rid}}}" in tex(doc),
              f"{kind} --range lands a Mode-B link + its \\vlid pair ({r.stderr.strip()[:120]})")
        if kind.startswith("report"):
            check(card.get("selectedText") == span, f"{kind} carries the span as its selectedText")
    check(pairs_balanced(tex(doc)), "three ranges in, every pair still balanced")
    before = snap(doc)
    for kind, extra in [("footnote", []), ("citation", ["--citekey", "k"])]:
        r = run(CREATE, str(doc), f"--kind={kind}", "--anchor", "aaaa", "--body", "x", *extra,
                "--range", body(tmp, "The reader"))
        check(r.returncode != 0 and "--range does not apply" in r.stderr, f"{kind} --range refuses")
    check(snap(doc) == before, "…and nothing was written")

print("\n=== refuse: the span locator ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    before = snap(doc)
    cases = [
        ("aaaa", "underlines a phrasing", None, "not found verbatim"),
        ("aaaa", "reader", None, "occurs 2 times"),
        ("aaaa", "reader", "3", "out of range"),
        ("bbbb", "mph{emphatic", None, "cuts through a LaTeX command"),
        ("bbbb", "with \\emph", None, "argument lies outside"),
        ("bbbb", "emphatic words", None, "inside a {…} group"),
        ("bbbb", "words} and", None, "inside a {…} group"),
        ("bbbb", "with \\emph{emphatic", None, "do not balance"),
        ("bbbb", "+ y", None, "inside $…$ math"),
        ("bbbb", "and $x", None, "does not close"),
        ("cccc", "pinned words", None, "overlaps an existing anchored range"),
        ("cccc", "words\\vlidend{ab12} live", None, "existing \\vlid range marker"),
        ("aaaa", "argument. %!v:aaaa", None, "contains `%`"),
        ("zzzz", "anything", None, "not found"),
    ]
    for anchor, span, occ, needle in cases:
        args = [CREATE, str(doc), "--kind=note", "--anchor", anchor, "--body", "x",
                "--range", body(tmp, span)]
        if occ:
            args += ["--range-occurrence", occ]
        r = run(*args)
        check(r.returncode != 0 and needle in r.stderr, f"refuses «{span}» — {needle}"
              + ("" if needle in r.stderr else f" (got: {r.stderr.strip()[:160]})"))
    check(snap(doc) == before, "every refusal wrote nothing")
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "aaaa", "--body", "x",
            "--range", body(tmp, "reader"), "--range-occurrence", "2")
    t = tex(doc)
    check(r.returncode == 0 and re.search(r"and then the \\vlid\{\w+\}reader\\vlidend", t),
          "--range-occurrence 2 pins the SECOND hit")
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "cccc", "--body", "x",
            "--range", body(tmp, "live next to"))
    check(r.returncode == 0 and pairs_balanced(tex(doc)), "an ADJACENT range is fine (balanced)")
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "bbbb", "--body", "x",
            "--range", body(tmp, "\\emph{emphatic words} and $x + y$ math"))
    check(r.returncode == 0, "a span that holds a whole command + whole formula pins")
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
    check(a["textRange"]["textSnapshot"] == "emphatic words and $x + y$ math",
          "its snapshot is the reading text (markup stripped)")

print("\n=== no range: Mode A, byte-identical .tex ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "aaaa", "--body", "Paragraph-level.")
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
    check(r.returncode == 0 and a == {"type": "textObject", "targetKind": "paragraph",
                                      "textObjectIds": ["aaaa"]}, "the link is the Mode-A shape")
    check(tex(doc) == TEX, "the .tex is untouched")

print("\n=== move: range→range, range→paragraph, paragraph→range ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    r = run(CREATE, str(doc), "--kind=note", "--anchor", "aaaa", "--body", "x",
            "--range", body(tmp, "underlines a phrase"))
    cid = json.loads(r.stdout)["cardId"]
    rid = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]["textRange"]["anchorId"]

    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "bbbb",
                                                 "newRange": "math sits here"}))
    t = tex(doc)
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
    check(r.returncode == 0, f"range→range move succeeds ({r.stderr.strip()[:160]})")
    check("underlines a phrase\\vlidend" not in t and f"\\vlid{{{rid}}}math sits here\\vlidend{{{rid}}}" in t,
          "the old pair is gone and the new span is wrapped (id reused)")
    check(a["textObjectIds"] == ["bbbb"] and a["textRange"] == {"anchorId": rid, "textSnapshot": "math sits here"},
          "the link follows: new paragraph, same range id, new snapshot")
    check(pairs_balanced(t), "pairs balanced after the move")

    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "aaaa"}))
    t = tex(doc)
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
    check(r.returncode == 0 and f"\\vlid{{{rid}}}" not in t and f"\\vlidend{{{rid}}}" not in t,
          "range→paragraph removes the pair")
    check(a == {"type": "textObject", "targetKind": "paragraph", "textObjectIds": ["aaaa"]},
          "…and the link is Mode A")
    check(t == TEX, "…leaving the .tex exactly as it started")

    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "cccc",
                                                 "newRange": "free words"}))
    t = tex(doc)
    a = load(doc, "notes.json")["cards"][-1]["links"][0]["anchor"]
    nid = (a.get("textRange") or {}).get("anchorId")
    check(r.returncode == 0 and nid and nid != "ab12"
          and f"\\vlid{{{nid}}}free words\\vlidend{{{nid}}}" in t,
          f"paragraph→range wraps the span with a fresh id ({r.stderr.strip()[:160]})")
    before = snap(doc)
    r = run(APPLY, str(doc), "move", json.dumps({"cardId": cid, "newAnchor": "cccc",
                                                 "newRange": "pinned words"}))
    check(r.returncode != 0 and "overlaps" in r.stderr and snap(doc) == before,
          "a move onto an existing range refuses and writes nothing")

print("\n=== responder: a suggestion pinned to its span (L3 — the pair still lands) ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    r = run(CREATE, str(doc), "--kind=suggestion", "--anchor", "aaaa", "--synthesize",
            "--original", body(tmp, "a phrase"), "--suggested", body(tmp, "a sentence"),
            "--range", body(tmp, "underlines a phrase"))
    check(r.returncode == 0, f"suggestion --range succeeds ({r.stderr.strip()[:200]})")
    card = load(doc, "revisions.json")["cards"][-1] if r.returncode == 0 else {}
    a = (card.get("links") or [{}])[0].get("anchor", {})
    rid = (a.get("textRange") or {}).get("anchorId")
    check(a.get("targetKind") == "linkedRange" and rid
          and f"\\vlid{{{rid}}}underlines a phrase\\vlidend{{{rid}}}" in tex(doc),
          "the proposal's anchor pair is in the .tex while the rewrite itself waits")
    check("a sentence" not in tex(doc), "…and the proposed rewrite has NOT been applied")
    r = run(APPLY, str(doc), "accept", json.dumps({"cardId": card.get("id")}))
    t = tex(doc)
    check(r.returncode == 0 and f"\\vlid{{{rid}}}underlines a sentence\\vlidend{{{rid}}}" in t,
          f"accept splices INSIDE the pair — the card stays pinned ({r.stderr.strip()[:160]})")
    before = snap(doc)
    r = run(CREATE, str(doc), "--kind=suggestion", "--anchor", "bbbb", "--synthesize",
            "--original", body(tmp, "sits here"), "--suggested", body(tmp, "lives here"),
            "--range", body(tmp, "math sits"))
    check(r.returncode != 0 and "must contain --original" in r.stderr and snap(doc) == before,
          "a range that does not contain original_text refuses")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
