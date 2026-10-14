#!/usr/bin/env python3
r"""A card id resolves to exactly ONE card, or refuses (task 1112).

`\vfid` / `\vcid` / `\vexid` marker ids are card ids, 4-hex, and were minted in
separate per-kind namespaces — so a footnote and a citation could both be
`ab12`. `card_by_id.find_card` returned the first hit in ALL_CARD_SIDECARS order
(footnotes before citations), and every existing-card op (update / archive /
move / link / accept / reject, and create-card's source lookup) aimed at the
citation silently mutated the footnote.

Two halves, both pinned here:

  1. RESOLUTION — an id naming cards in two sidecars REFUSES, naming the panels;
     a panel qualifier (`find_card(..., panel)`, `--panel`, `op.panel`,
     `op.panelA`/`panelB`) picks the one meant.
  2. MINTING — create-card mints footnote / citation / example ids in ONE
     namespace: every marker-anchored sidecar's ids + every card-marker macro
     in the .tex, so new collisions stop.

Run from anywhere, no pytest:
    python3 editor/scripts/tests/test_card_id_namespace.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
sys.path.insert(0, str(SCRIPTS))

import create_card as CC  # noqa: E402
from card_by_id import MARKER_ANCHORED_PANELS, find_card, find_cards  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def dies(fn):
    """(died?, message) — `_common.die` raises SystemExit after printing."""
    try:
        fn()
    except SystemExit:
        return True
    return False


def make_doc(tmp: str) -> Path:
    doc = Path(tmp) / "paper"
    (doc / "virgil").mkdir(parents=True)
    (doc / "paper.tex").write_text(
        "\\begin{document}\n"
        "Claim.\\vfid{ab12}\\footnote{A note.} %!v:abcd\n\n"
        "As \\vcid{ab12}\\citet{smith} says. %!v:beef\n"
        "\\end{document}\n"
    )
    (doc / "virgil" / "footnotes.json").write_text(json.dumps(
        {"footnotes": [{"id": "ab12", "content": "A note.", "createdAt": ""}]}))
    (doc / "virgil" / "citations.json").write_text(json.dumps(
        {"citations": [{"id": "ab12", "command": "\\citet{smith}", "keys": ["smith"], "createdAt": ""}]}))
    return doc


print("\n=== resolution: a cross-sidecar id refuses; a panel qualifier picks one ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    check(len(find_cards(doc, "ab12")) == 2, "find_cards sees BOTH the footnote and the citation")
    check(dies(lambda: find_card(doc, "ab12")), "find_card(ab12) with no panel REFUSES (no first-match guess)")
    hit = find_card(doc, "ab12", "citations")
    check(hit is not None and hit.panel == "citations" and hit.card.get("keys") == ["smith"],
          "find_card(ab12, panel=citations) resolves the citation")
    hit = find_card(doc, "ab12", "footnotes")
    check(hit is not None and hit.panel == "footnotes", "find_card(ab12, panel=footnotes) resolves the footnote")
    check(find_card(doc, "ab12", "notes") is None, "a panel that holds no such id → not found")
    check(dies(lambda: find_card(doc, "ab12", "nonsense")), "an unknown panel name refuses")

    cli = [sys.executable, str(SCRIPTS / "card_by_id.py"), str(doc), "ab12"]
    r = subprocess.run(cli, capture_output=True, text=True)
    check(r.returncode != 0 and "ambiguous" in (r.stderr + r.stdout) and "citations" in (r.stderr + r.stdout),
          "CLI without --panel refuses and names the panels")
    r = subprocess.run(cli + ["--panel", "citations"], capture_output=True, text=True)
    out = json.loads(r.stdout) if r.returncode == 0 else {}
    check(out.get("panel") == "citations" and out.get("cardKind") == "citation", "CLI --panel citations resolves it")

    # The op door threads op.panel: an archive aimed at the bare id refuses
    # rather than touching either card; footnotes.json is unchanged.
    before = (doc / "virgil" / "footnotes.json").read_text()
    ar = [sys.executable, str(SCRIPTS / "apply_response.py"), str(doc), "update",
          json.dumps({"cardId": "ab12", "body": "x"})]
    r = subprocess.run(ar, capture_output=True, text=True)
    check(r.returncode != 0 and "ambiguous" in (r.stderr + r.stdout), "apply_response update on the bare id refuses")
    check((doc / "virgil" / "footnotes.json").read_text() == before, "…and mutates nothing")

print("\n=== minting: ONE namespace across every marker-anchored card kind ===")
with tempfile.TemporaryDirectory() as tmp:
    doc = make_doc(tmp)
    macros, used = CC._card_marker_namespace(doc)
    check(set(macros) == set(MARKER_ANCHORED_PANELS.values()),
          "the namespace spans every card-marker macro (derived from MARKER_ANCHORED_PANELS)")
    check("ab12" in used, "a citation's id is in the namespace a footnote mints against")

    # Every 4-hex id but one is taken across the KINDS: a footnote id in the
    # citations sidecar, a citation id only as a \vexid marker in the .tex.
    all_ids = [f"{i:04x}" for i in range(0x10000)]
    free = "c0de"
    taken = [x for x in all_ids if x != free]
    half = len(taken) // 2
    (doc / "virgil" / "citations.json").write_text(json.dumps(
        {"citations": [{"id": x} for x in taken[:half]]}))
    (doc / "paper.tex").write_text(
        "\\begin{document}\n" + "".join(f"\\vexid{{{x}}}" for x in taken[half:]) + "\n\\end{document}\n")
    macros, used = CC._card_marker_namespace(doc)
    check(CC._gen_marker_id(doc, macros, used) == free,
          "a footnote mint with every other id held by OTHER kinds returns the one free id")
    check(dies(lambda: CC._gen_marker_id(doc, macros, used | {free})), "a full namespace refuses")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
