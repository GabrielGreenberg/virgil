#!/usr/bin/env python3
"""List every card across panel sidecars anchored to a paragraph UUID.

Directly answers "what cards live around this paragraph?" — the question
editor skills ask before drafting a response. Walks every card-hosting
sidecar through `card_by_id.iter_cards` (the one reader of which list lives
inside which sidecar, driven by `apply_response.ALL_CARD_SIDECARS`), so a new
panel is covered without touching this script.

A card is on the paragraph when:
  - its `links` anchor names the paragraph (link-anchored panels), or
  - its `.tex` atom marker (`\\vfid` / `\\vcid` / `\\vexid`) sits inside the
    paragraph (marker-anchored panels — `card_by_id.MARKER_ANCHORED_PANELS`).

Usage:  python3 cards_for_paragraph.py <docPath> <uuid>

Emits one JSON line per matched card:
  { "panel": <ALL_CARD_SIDECARS key — "notes" | "todos" | "cutter" |
             "revisions" | "reports" | "footnotes" | "citations" |
             "examples" | "archive">,
    "cardId": "...",
    "kind":  <on-disk kind — the card's `kind` field, or the single kind its
              panel holds: "note" | "highlight" | "todo" | "comment" |
              "suggestion" | "report" | "report-request" | "footnote" |
              "citation" | "example" | "archive">,
    "cardKind": <registry CardKind — card_by_id.card_kind>,
    "summary": <short text of the card body>,
    "aiRequest": <bool — false when unflagged>,
    "archived": <bool — true for an archived snippet>,
    "status": <todos: "done" | "open"; suggestions: their status>?
  }

Plus a `# matched <N> in <doc>` summary line on stderr.
"""

from __future__ import annotations

import json
import sys

from _common import (
    card_paragraph_ids,
    card_text_anchor,
    die,
    find_tex_file,
    marker_paragraph_ids,
    resolve_doc,
    rich_json_to_text,
)
from card_by_id import MARKER_ANCHORED_PANELS, _SINGLE_KIND_PANEL, card_kind, iter_cards

# Body fields to summarize from, in preference order. `content` is a rich
# TipTap body (footnotes, archive snippets) and is flattened.
SUMMARY_FIELDS = ("title", "text", "explanation", "original_text", "notes",
                  "command", "label", "tag", "content")


def emit(row: dict) -> None:
    print(json.dumps(row, ensure_ascii=False))


def summarize(card: dict) -> str:
    for f in SUMMARY_FIELDS:
        v = card.get(f)
        text = rich_json_to_text(v) if isinstance(v, (str, dict, list)) else ""
        if text:
            return text[:140]
    # A highlight carries no body — its text is the quoted range.
    return (card_text_anchor(card) or "")[:140]


def _marker_maps(doc) -> dict[str, dict[str, str]]:
    """{panel: {marker id: paragraph uuid}} for every marker-anchored panel,
    from ONE read of the .tex. A paper with no .tex maps nothing."""
    if not any(f.suffix == ".tex" for f in doc.iterdir()):
        return {panel: {} for panel in MARKER_ANCHORED_PANELS}
    text = find_tex_file(doc).read_text(encoding="utf-8")
    return {panel: marker_paragraph_ids(text, cmd) for panel, cmd in MARKER_ANCHORED_PANELS.items()}


def walk(doc, uuid: str) -> int:
    matched = 0
    markers = _marker_maps(doc)
    for hit in iter_cards(doc):
        card = hit.card
        on_para = uuid in card_paragraph_ids(card)
        if not on_para and hit.panel in markers:
            on_para = markers[hit.panel].get(card.get("id")) == uuid
        if not on_para:
            continue
        disk_kind = card.get("kind") or _SINGLE_KIND_PANEL.get(hit.panel) or hit.panel
        row = {
            "panel": hit.panel,
            "cardId": card.get("id"),
            "kind": disk_kind,
            "cardKind": card_kind(hit),
            "summary": summarize(card),
            "aiRequest": bool(card.get("aiRequest")),
            "archived": hit.archived,
        }
        if hit.panel == "todos":
            row["status"] = "done" if card.get("done") else "open"
        elif disk_kind == "suggestion":
            row["status"] = card.get("status", "pending")
        emit(row)
        matched += 1
    return matched


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        die("usage: cards_for_paragraph.py <docPath> <uuid>")
    doc = resolve_doc(argv[1])
    uuid = argv[2].strip()
    if not uuid:
        die("uuid is empty")
    n = walk(doc, uuid)
    print(f"# matched {n} in {doc.name} for paragraph {uuid}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
