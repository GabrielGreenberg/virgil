#!/usr/bin/env python3
"""List every card across panel sidecars anchored to a paragraph UUID — or,
with `--doc`, every card in the paper.

Directly answers "what cards live around this paragraph?" — the question
editor skills ask before drafting a response — and, doc-wide, "which card
does the user mean?", the question the front door must answer before it
dispatches a CARD-bound skill (`accept-suggestion`, `archive-card`, … — the
catalog's `requiredCardIds`, task 1415). A card id is never invented or
first-picked: the lister narrows, the caller asks when more than one is left. Walks every card-hosting
sidecar through `card_by_id.iter_cards` (the one reader of which list lives
inside which sidecar, driven by `apply_response.ALL_CARD_SIDECARS`), so a new
panel is covered without touching this script.

A card is on the paragraph when:
  - its `links` anchor names the paragraph (link-anchored panels), or
  - its `.tex` atom marker (`\\vfid` / `\\vcid` / `\\vexid`) sits inside the
    paragraph (marker-anchored panels — `card_by_id.MARKER_ANCHORED_PANELS`).

Usage:  python3 cards_for_paragraph.py <docPath> <uuid>   [filters]
        python3 cards_for_paragraph.py <docPath> --doc     [filters]

Filters (each narrows; combine freely):
  --kind <k>      on-disk `kind` OR registry `cardKind` equals <k>
                  (e.g. `suggestion`, `note`, `revision-suggestion`)
  --status <s>    the row's `status` equals <s> (e.g. `pending`, `open`)
  --archived      only archived snippets (what `restore-card` takes)
  --live          only non-archived cards

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
    "status": <todos: "done" | "open"; suggestions: their status>?,
    "paragraphs": <--doc only: the paragraph uuid(s) the card sits on>
  }

Plus a `# matched <N> in <doc>` summary line on stderr.
"""

from __future__ import annotations

import argparse
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


def walk(doc, uuid: str | None, kind: str | None = None, status: str | None = None,
         archived: bool | None = None) -> int:
    """Emit every matching card. `uuid=None` is the doc-wide mode: no
    paragraph filter, and each row names the paragraph(s) it sits on."""
    matched = 0
    markers = _marker_maps(doc)
    for hit in iter_cards(doc):
        card = hit.card
        paras = list(card_paragraph_ids(card))
        if hit.panel in markers:
            marker_para = markers[hit.panel].get(card.get("id"))
            if marker_para and marker_para not in paras:
                paras.append(marker_para)
        if uuid is not None and uuid not in paras:
            continue
        if archived is not None and hit.archived != archived:
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
        if kind is not None and kind not in (row["kind"], row["cardKind"]):
            continue
        if status is not None and row.get("status") != status:
            continue
        if uuid is None:
            row["paragraphs"] = paras
        emit(row)
        matched += 1
    return matched


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="cards_for_paragraph.py", add_help=True)
    ap.add_argument("docPath")
    ap.add_argument("uuid", nargs="?")
    ap.add_argument("--doc", action="store_true", help="every card in the paper")
    ap.add_argument("--kind")
    ap.add_argument("--status")
    scope = ap.add_mutually_exclusive_group()
    scope.add_argument("--archived", action="store_const", const=True, dest="archived")
    scope.add_argument("--live", action="store_const", const=False, dest="archived")
    args = ap.parse_args(argv[1:])
    if args.doc == (args.uuid is not None):
        die("usage: cards_for_paragraph.py <docPath> (<uuid> | --doc) "
            "[--kind <k>] [--status <s>] [--archived | --live]")
    doc = resolve_doc(args.docPath)
    uuid = None
    if not args.doc:
        uuid = args.uuid.strip()
        if not uuid:
            die("uuid is empty")
    n = walk(doc, uuid, args.kind, args.status, args.archived)
    where = "the whole doc" if uuid is None else f"paragraph {uuid}"
    print(f"# matched {n} in {doc.name} for {where}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
