#!/usr/bin/env python3
r"""`cards_for_paragraph.py` answers "what cards are on this paragraph?" for
EVERY card-hosting panel (task 616).

It used to hand-copy its own sidecar → list-key table, read notes.json under
the dead key "notes" (the key is "cards"), and never walked footnotes — so a
responder skill checking for existing cards silently missed the user's notes.
Now every walk goes through `card_by_id.iter_cards`, driven by the one panel
table `apply_response.ALL_CARD_SIDECARS`, and atom-bearing cards (no `links`)
are placed by where their `.tex` marker sits.

The table-iteration leg builds one card per panel, so a new panel is covered
(or fails loudly) without editing this test.

Run from anywhere:  python3 editor/scripts/tests/test_cards_for_paragraph.py
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
CLI = str(SCRIPTS / "cards_for_paragraph.py")

sys.path.insert(0, str(SCRIPTS))
from _common import VIRGIL_MARKER_COMMANDS, marker_paragraph_ids  # noqa: E402
from apply_response import ATOM_BEARING_PANELS  # noqa: E402
from card_by_id import ALL_CARD_SIDECARS, MARKER_ANCHORED_PANELS, find_card, iter_cards  # noqa: E402
import list_requests as LR  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def run(doc, uuid):
    r = subprocess.run([sys.executable, CLI, str(doc), uuid], capture_output=True, text=True)
    rows = [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith("{")]
    return r, rows


print("\n=== the frozen sample: notes, footnotes and citations are found ===")
r, rows = run(SAMPLE, "2201")
check(r.returncode == 0, f"exit 0 (stderr={r.stderr.strip()[:120]})")
by_panel = {row["panel"]: row for row in rows}
check("ea4d5253-406d-499e-85b6-8055956c9f95" in {x["cardId"] for x in rows},
      "para 2201 lists its note (notes.json is read under `cards`)")
check(by_panel.get("notes", {}).get("kind") == "note", "the note row carries kind=note")
check(by_panel.get("footnotes", {}).get("cardId") == "f002", "para 2201 lists footnote f002 (by its \\vfid marker)")
check(by_panel.get("citations", {}).get("cardId") == "cc02", "para 2201 lists citation cc02 (by its \\vcid marker)")
r, rows = run(SAMPLE, "1101")
ids = {x["cardId"] for x in rows}
check({"f001", "cc01", "2a382717-c99c-4c86-9a61-51c3388c117d"} <= ids,
      "para 1101 lists footnote f001, the citation nested in it, and its highlight")
hl = next((x for x in rows if x["kind"] == "highlight"), {})
check(bool(hl.get("summary")), "a body-less highlight summarizes from its quoted text")
check(any(x["archived"] for x in rows), "an archived snippet anchored to 1101 is listed, flagged archived")
r, rows = run(SAMPLE, "0a22")
check([x["cardId"] for x in rows] == ["f0ac"], "a \\thanks footnote in the author line resolves to its paragraph")

print("\n=== table iteration: one card per ALL_CARD_SIDECARS panel, all found ===")
PARA, OTHER = "abcd", "beef"
with tempfile.TemporaryDirectory() as tmp:
    doc = Path(tmp) / "paper"
    (doc / "virgil").mkdir(parents=True)
    tex = [r"\begin{document}"]
    for p_i, (panel, (filename, list_key)) in enumerate(ALL_CARD_SIDECARS.items()):
        cards = []
        for i, uuid in enumerate((PARA, OTHER)):
            cid = f"{i}{p_i:03x}"
            card = {"id": cid, "text": f"{panel} on {uuid}"}
            if panel in MARKER_ANCHORED_PANELS:
                tex.append(f"Text \\{MARKER_ANCHORED_PANELS[panel]}{{{cid}}}here. %!v:{uuid}\n")
            else:
                card["links"] = [{"id": "l", "kind": "anchor",
                                  "anchor": {"type": "textObject", "targetKind": "paragraph",
                                             "textObjectIds": [uuid]}}]
            cards.append(card)
        (doc / "virgil" / filename).write_text(json.dumps({list_key: cards}))
    tex.append(r"\end{document}")
    (doc / "paper.tex").write_text("\n".join(tex))

    r, rows = run(doc, PARA)
    got = sorted(x["panel"] for x in rows)
    check(got == sorted(ALL_CARD_SIDECARS), f"every panel reports exactly its one card on {PARA} (got {got})")
    check(all(x["summary"] == f"{x['panel']} on {PARA}" for x in rows), "no card from the other paragraph leaks in")
    walked = {h.panel for h in iter_cards(doc)}
    check(walked == set(ALL_CARD_SIDECARS), "iter_cards walks every panel's list")
    some = next(iter_cards(doc))
    check(find_card(doc, some.card["id"]).panel == some.panel, "find_card resolves through the same walker")

    # A doc with no .tex still lists its link-anchored cards.
    (doc / "paper.tex").unlink()
    r, rows = run(doc, PARA)
    check(r.returncode == 0 and len(rows) == len(ALL_CARD_SIDECARS) - len(MARKER_ANCHORED_PANELS),
          "no .tex → link-anchored cards still listed, marker cards skipped")

print("\n=== pins: the marker-panel map agrees with the other SSOTs ===")
check(set(MARKER_ANCHORED_PANELS) <= set(ALL_CARD_SIDECARS), "every marker-anchored panel is a card sidecar")
check(ATOM_BEARING_PANELS <= set(MARKER_ANCHORED_PANELS), "every atom-bearing panel is marker-anchored")
check(all(c in VIRGIL_MARKER_COMMANDS for c in MARKER_ANCHORED_PANELS.values()),
      "every marker command is a VIRGIL_MARKER_COMMANDS entry")
check(all((row["file"], row["list_key"]) == ALL_CARD_SIDECARS[row["panel"]]
          for row in LR.STORAGE_ADAPTER.values()),
      "list_requests' storage rows derive file + list key from the panel table")

print("\n=== no script hand-copies a (sidecar file, list key) pair ===")
pairs = {f'"{f}", "{k}"' for f, k in ALL_CARD_SIDECARS.values()}
pair_re = re.compile(r'"(\w+\.json)",\s*"(\w+)"')
offenders = []
for py in SCRIPTS.glob("*.py"):
    for n, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
        if py.name == "apply_response.py" and re.match(r'\s*"\w+": \("\w+\.json", "\w+"\),', line):
            continue  # the table itself
        m = pair_re.search(line)
        if m and f'"{m.group(1)}", "{m.group(2)}"' in pairs:
            offenders.append(f"{py.name}:{n}")
check(not offenders, f"only ALL_CARD_SIDECARS names file/list-key pairs (offenders: {offenders})")

print("\n=== marker_paragraph_ids ===")
text = ("A \\vfid{aa01}\\footnote{x} b. %!v:1111\n"
        "Comment. %!v:2222\n"
        "\n"
        "\\vexid{ee01}\\ex block\n\\xe\n"
        "\n"
        "C \\vfid{aa02}\\footnote{y}\n"
        "continues. %!v:3333\n"
        "\n"
        "Orphan \\vfid{aa03}\\footnote{z}\n"
        "\n"
        "Later. %!v:4444\n")
m = marker_paragraph_ids(text, "vfid")
check(m.get("aa01") == "1111", "the nearest following %!v in a multi-block slab")
check(m.get("aa02") == "3333", "a marker whose paragraph spans lines")
check("aa03" not in m, "a blank line bounds the search (no leak into the next paragraph)")
check(marker_paragraph_ids(text, "vexid") == {}, "an example block with no %!v maps to nothing")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
