#!/usr/bin/env python3
r"""Unit + in-situ test of `_common.card_paragraph_ids` — the chip-14 anchor-shape
fix.

chip 13 flagged that this helper read the *stale* anchor shape
(`anchor.type == "anchor"` + `anchor.paragraphIds`), while every real card on
disk uses the canonical `LinkAnchor` shape (`anchor.type == "textObject"` +
`textObjectIds` — SSOT src/links/_shared/types.ts, mirrored by
src/links/links.ts `getLinkedTextObjectIds`). So it returned `[]` for every real
card, silently breaking `cards_for_paragraph.py` (which never matched a card to
its paragraph) and the virtual-request `paragraphIds` in `list_requests.py`.

This test pins the fix: the helper now reads the canonical shape (tolerating the
legacy one), and the real `cards_for_paragraph.py` CLI matches a real anchored
card in the frozen sample.

Run from anywhere:  python3 editor/scripts/tests/test_common_anchor.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
CARDS_FOR_PARA = str(SCRIPTS / "cards_for_paragraph.py")

sys.path.insert(0, str(SCRIPTS))
from _common import card_paragraph_ids  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def anchor_link(uuid, *, target_kind="paragraph", shape="textObject"):
    """A card link whose anchor names `uuid`. `shape` toggles canonical
    (textObject/textObjectIds) vs legacy (anchor/paragraphIds)."""
    if shape == "textObject":
        anchor = {"type": "textObject", "targetKind": target_kind,
                  "textObjectIds": [uuid], "margin": {"side": "right"}}
    else:  # legacy
        anchor = {"type": "anchor", "paragraphIds": [uuid], "margin": {"side": "right"}}
    return {"id": f"link-{uuid}", "kind": "anchor", "anchor": anchor,
            "target": {"type": "card", "ref": {"kind": "comment", "id": "c1"}},
            "createdAt": "2026-06-05T00:00:00.000Z"}


print("\n=== card_paragraph_ids: canonical on-disk shape (the real-card shape) ===")
# Mode A — a paragraph anchor.
check(card_paragraph_ids({"links": [anchor_link("6607")]}) == ["6607"],
      "canonical Mode-A {type:textObject, textObjectIds} → the uuid")
# Mode B — a linkedRange anchor still names its containing paragraph in textObjectIds.
check(card_paragraph_ids({"links": [anchor_link("1101", target_kind="linkedRange")]}) == ["1101"],
      "canonical Mode-B (targetKind=linkedRange) → the containing paragraph uuid")
# Multi-anchor (Mode A allows N>1) — deduped, order-preserving.
multi = {"links": [anchor_link("aaaa"), anchor_link("bbbb"), anchor_link("aaaa")]}
check(card_paragraph_ids(multi) == ["aaaa", "bbbb"],
      "multi-anchor deduped + order-preserving")

print("\n=== card_paragraph_ids: legacy shape still tolerated (round-trips) ===")
check(card_paragraph_ids({"links": [anchor_link("6607", shape="legacy")]}) == ["6607"],
      "legacy {type:anchor, paragraphIds} still read (back-compat tolerance)")
mixed = {"links": [anchor_link("aaaa"), anchor_link("bbbb", shape="legacy")]}
check(card_paragraph_ids(mixed) == ["aaaa", "bbbb"],
      "a card mixing both shapes yields both ids")

print("\n=== card_paragraph_ids: non-anchor links + empties → [] ===")
check(card_paragraph_ids({"links": []}) == [], "no links → []")
check(card_paragraph_ids({}) == [], "missing links key → []")
# An inline-atom link (footnote/citation runtime link) carries no paragraph ids.
atom = {"links": [{"id": "l", "kind": "footnote",
                   "anchor": {"type": "inline-atom", "nodeName": "footnote", "pos": 5},
                   "target": {"type": "card", "ref": {"kind": "footnote", "id": "f1"}},
                   "createdAt": ""}]}
check(card_paragraph_ids(atom) == [], "inline-atom anchor contributes no paragraph id")

print("\n=== in-situ: the real cards_for_paragraph.py CLI now matches a real card ===")
# In the frozen sample, revision comment acf69008 anchors (Mode B) to paragraph
# 1101. Before the fix the CLI matched nothing (the helper returned []); now it
# resolves the canonical anchor. Read-only — safe to run against the sample.
SAMPLE_PARA = "1101"
SAMPLE_CARD = "acf69008-7728-4c02-90a4-181513922bcc"
r = subprocess.run([sys.executable, CARDS_FOR_PARA, str(SAMPLE), SAMPLE_PARA],
                   capture_output=True, text=True, env=dict(os.environ))
check(r.returncode == 0, f"cards_for_paragraph exited 0 (stderr={r.stderr.strip()[:160]})")
rows = [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith("{")]
ids = {row.get("cardId") for row in rows}
check(SAMPLE_CARD in ids,
      f"real card {SAMPLE_CARD[:8]}… anchored to %!v:{SAMPLE_PARA} is now matched "
      f"(was [] under the stale shape)")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
