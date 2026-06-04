#!/usr/bin/env python3
r"""Fetch any card by id across every card sidecar (EDITOR_SKILLS_V1 §13).

The shared lookup behind all five existing-card mutation ops (`update` /
`archive` / `restore` / `move` / `link` in apply_response.py). Given a card id,
walk every card-hosting sidecar and return the card together with **where it
lives** — the panel, the file, the list-key, and whether it's archived.

The set of sidecars searched is the `apply_response.PANEL_TO_SIDECAR` writeback
panels (the single source of truth for panel→file→list-key) **plus** the two
card-hosting sidecars that are intentionally writeback-exempt (so they have no
`PANEL_TO_SIDECAR` row — see tools/check-coherence.mjs Check 5):

  - `archive.json` · `snippets`  — `restore-card` reads it; `archive-card` lands here.
  - `examples.json` · `examples` — an app-derived `.tex` shadow; surfaced for
    completeness (read-only — the mutation ops refuse to touch it).

CLI:
  card_by_id.py <docPath> <cardId>
    → prints {"found": bool, "cardId", "panel", "filename", "listKey",
              "archived", "cardKind", "card"} as JSON (exit 0 if found, 1 if not).

As a module:
  from card_by_id import find_card, card_kind   # find_card → CardHit | None

`find_card` reads each sidecar fresh (detached from any open write transaction),
so a caller can safely use `hit.card` as a snapshot and mutate through a `_Txn`
separately.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from _common import die, read_json, resolve_doc, sidecar

# Import the single source of truth for the writeback panels. apply_response
# does NOT import this module at load time (its mutation handlers import
# find_card lazily), so this top-level import is cycle-free.
from apply_response import PANEL_TO_SIDECAR

# Card-hosting sidecars that are NOT apply_response writeback targets
# (WRITEBACK_EXEMPT_PANELS in tools/check-coherence.mjs) but are still real card
# stores we must be able to resolve a card in. Kept tiny + local so it can't be
# mistaken for a second writeback registry.
EXTRA_CARD_SIDECARS = {
    "archive": ("archive.json", "snippets"),
    "examples": ("examples.json", "examples"),
}

# The full search order. PANEL_TO_SIDECAR first (the common, mutable case), then
# the exempt stores. A card id is unique across all of them (v4 entity ids /
# 4-hex marker ids), so first-match-wins is unambiguous.
ALL_CARD_SIDECARS: dict[str, tuple[str, str]] = {**PANEL_TO_SIDECAR, **EXTRA_CARD_SIDECARS}

# Registry CardKind from a card's home panel + on-disk discriminator (the
# two-taxonomy rule, docs/workspace/cards.md): single-kind panels carry no
# `kind` field, so the panel names the kind; the polymorphic panels qualify the
# coarse on-disk `kind` by sidecar file.
_SINGLE_KIND_PANEL = {
    "footnotes": "footnote",
    "citations": "citation",
    "todos": "todo",
    "archive": "archive",
    "examples": "example",
}


@dataclass
class CardHit:
    """A located card + where it lives."""

    card: dict          # the card object (a detached snapshot)
    panel: str          # ALL_CARD_SIDECARS key (e.g. "notes", "footnotes", "archive")
    filename: str       # sidecar filename (e.g. "notes.json")
    list_key: str       # array key inside the …State wrapper (e.g. "cards")
    index: int          # position in that array

    @property
    def archived(self) -> bool:
        return self.panel == "archive"


def find_card(doc: Path, card_id: str) -> CardHit | None:
    """Return the CardHit for `card_id`, or None if no sidecar holds it."""
    for panel, (filename, list_key) in ALL_CARD_SIDECARS.items():
        state = read_json(sidecar(doc, filename), default=None)
        if not isinstance(state, dict):
            continue
        items = state.get(list_key)
        if not isinstance(items, list):
            continue
        for i, c in enumerate(items):
            if isinstance(c, dict) and c.get("id") == card_id:
                return CardHit(card=c, panel=panel, filename=filename, list_key=list_key, index=i)
    return None


def card_kind(hit: CardHit) -> str:
    """The registry CardKind for a located card (the two-taxonomy resolution)."""
    if hit.panel in _SINGLE_KIND_PANEL:
        return _SINGLE_KIND_PANEL[hit.panel]
    disk = hit.card.get("kind")
    if hit.panel == "notes":      # note | highlight
        return disk or "note"
    if hit.panel == "reports":    # report | report-request
        return disk or "report"
    if hit.panel == "cutter":     # comment → cutter-comment | suggestion → cutter-suggestion
        return "cutter-suggestion" if disk == "suggestion" else "cutter-comment"
    if hit.panel == "revisions":  # comment → comment | suggestion → revision-suggestion
        return "revision-suggestion" if disk == "suggestion" else "comment"
    return disk or hit.panel


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="card_by_id.py")
    p.add_argument("doc")
    p.add_argument("card_id", help="the card id (v4 entity id, or a 4-hex \\v*id marker id)")
    a = p.parse_args(argv[1:])

    doc = resolve_doc(a.doc)
    hit = find_card(doc, a.card_id)
    if hit is None:
        print(json.dumps({"found": False, "cardId": a.card_id}, ensure_ascii=False))
        return 1
    print(json.dumps(
        {
            "found": True,
            "cardId": a.card_id,
            "panel": hit.panel,
            "filename": hit.filename,
            "listKey": hit.list_key,
            "archived": hit.archived,
            "cardKind": card_kind(hit),
            "card": hit.card,
        },
        ensure_ascii=False,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
