#!/usr/bin/env python3
"""List every open AI request in a Virgil paper folder.

Walks three sources and emits a single JSONL stream — one line per open
request — that the `/editor/review` umbrella consumes:

  1. `virgil/ai-requests.json` — entries with an open status (anything that
     is not a terminal `complete` / `failed`; legacy `draft` / `submitted` and
     v1 `pending` / `in-progress` are all open).
  2. `virgil/bib-review-requests.json` — entries with status == "pending".
  3. The card-flag panels (notes / todos / cutter / revisions / footnotes).
     Cards whose `aiRequest: true` flag has no matching `linkedTo` entry
     in `ai-requests.json` are emitted as virtual entries so the skill can
     still pick them up. This covers two cases: libraries created before the
     bridge landed (transitional), AND a bridge-write that silently failed
     (the bridge is best-effort — it swallows I/O errors), so the request
     survives to the drain either way. Footnotes (#55b) join this fallback:
     their flag lives in `footnotes.json` (not a panel card list), and a
     bridge failure would otherwise drop the request entirely — the fallback
     guarantees it still surfaces (as `kind: "footnote"`).

Each row is a JSON object with at minimum:
  { "source": "ai-requests" | "bib-review" | "card-flag",
    "kind":   <subskill key>,
    "id":     <request id, bibKey, or virtual:<panel>:<cardId>>,
    "text":   <user instruction or context summary>,
    "paragraphIds": [...]?,
    "linkedTo": { "panel", "cardId" }?,
    "extra":  { ... source-specific fields }
  }

Usage:  python3 list_requests.py <docPath>
"""

from __future__ import annotations

import json
import sys

from _common import (
    card_paragraph_ids,
    card_text_anchor,
    die,
    read_json,
    resolve_doc,
    sidecar,
)


def emit(row: dict) -> None:
    print(json.dumps(row, ensure_ascii=False))


def list_ai_requests(doc) -> tuple[list[dict], set[tuple[str, str]]]:
    """Returns (rows, bridged_links) where bridged_links is the set of
    (panel, cardId) pairs already represented by an ai-requests entry."""
    state = read_json(sidecar(doc, "ai-requests.json"), default={"requests": []})
    if not isinstance(state, dict):
        return [], set()
    rows: list[dict] = []
    bridged: set[tuple[str, str]] = set()
    for r in state.get("requests", []) or []:
        # Open == not terminal. `complete` and `failed` are the v1 terminal
        # statuses; legacy `draft`/`submitted` and v1 `pending`/`in-progress`
        # (and a status-absent row) all stay open.
        if r.get("status") in ("complete", "failed"):
            continue
        linked = r.get("linkedTo")
        if isinstance(linked, dict) and linked.get("panel") and linked.get("cardId"):
            bridged.add((linked["panel"], linked["cardId"]))
        rows.append(
            {
                "source": "ai-requests",
                "kind": r.get("kind", "unknown"),
                "id": r.get("id"),
                "text": r.get("text", ""),
                "paragraphIds": r.get("paragraphIds") or [],
                "selectedText": r.get("selectedText"),
                "linkedTo": linked,
                "extra": {
                    "status": r.get("status"),
                    # Two-field vocab (§7) + the safety level the responder routes
                    # on: the umbrella surfaces these and the dispatched subskill
                    # reads safetyLevel off the Task (create_card.py picks the
                    # subcommand from it: 1→silent, 2→+comment, 3→propose, none→
                    # direct). `result` is set only on a terminal row (so it's
                    # null for an open one) — carried for symmetry.
                    "result": r.get("result"),
                    "safetyLevel": r.get("safetyLevel"),
                    "createdAt": r.get("createdAt"),
                    "resultId": r.get("resultId"),
                    "payload": r.get("payload"),
                },
            }
        )
    return rows, bridged


def list_bib_reviews(doc) -> list[dict]:
    state = read_json(
        sidecar(doc, "bib-review-requests.json"), default={"requests": []}
    )
    if not isinstance(state, dict):
        return []
    rows: list[dict] = []
    # Tolerate either { requests: [] } or { reviews: [] } on disk.
    items = state.get("requests") or state.get("reviews") or []
    for r in items:
        if r.get("status") in ("complete", "failed"):
            continue
        bibkey = r.get("bibKey") or r.get("citekey")
        if not bibkey:
            continue
        rows.append(
            {
                "source": "bib-review",
                "kind": "bib-review",
                "id": bibkey,
                "text": r.get("requestNotes") or r.get("note") or "",
                "extra": {
                    "type": r.get("type", "fields"),
                    "status": r.get("status", "pending"),
                    "requestedAt": r.get("requestedAt"),
                },
            }
        )
    return rows


PANEL_FILES = {
    "notes": ("notes.json", "notes", "title", "note"),
    "todos": ("todos.json", "items", "text", "todo"),
    "cutter": ("cutter.json", "cards", "text", "suggestion"),
    "revisions": ("revisions.json", "cards", "text", "suggestion"),
    # #55b: footnotes join the unbridged-flag fallback. Their flag lives in
    # footnotes.json (FootnoteRef.aiRequest), the body is rich JSONContent (not a
    # plain field), and they carry no `links` array — so the summary is extracted
    # from the JSON below, and the paragraph anchor can't come from card_paragraph_ids
    # (it lives in the .tex `\footnote` position, only known to the editor that bridged
    # it). A footnote AI request is ALWAYS bridged on toggle WITH paragraphIds; this
    # fallback exists ONLY for the best-effort bridge-write-failure case, so the request
    # still surfaces to the drain (its paragraphIds may be empty in that degraded case —
    # the skill then asks for / re-derives an anchor rather than losing the request).
    "footnotes": ("footnotes.json", "footnotes", "content", "footnote"),
}


def _rich_json_to_text(value) -> str:
    """Flatten a TipTap JSONContent body (or a plain string) into plain text.
    Mirrors `richJsonToPlainText` in src/lib/footnote-content.ts just enough to
    produce a legible inbox summary for a footnote's rich `content`."""
    if isinstance(value, str):
        return value.strip()
    out: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            if isinstance(node.get("text"), str):
                out.append(node["text"])
            for child in node.get("content", []) or []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    return " ".join(s for s in (t.strip() for t in out) if s).strip()


def list_unbridged_card_flags(doc, bridged: set[tuple[str, str]]) -> list[dict]:
    rows: list[dict] = []
    for panel, (filename, list_key, summary_key, kind) in PANEL_FILES.items():
        state = read_json(sidecar(doc, filename), default=None)
        if not isinstance(state, dict):
            continue
        cards = state.get(list_key, []) or []
        for c in cards:
            if not c.get("aiRequest"):
                continue
            # cutter/revisions: only the comment subkind carries aiRequest.
            if panel in ("cutter", "revisions") and c.get("kind") != "comment":
                continue
            cid = c.get("id")
            if not cid:
                continue
            if (panel, cid) in bridged:
                continue
            # Footnote bodies are rich JSONContent (not a plain field) — flatten
            # to text for the summary. The others use a plain `summary_key` field.
            raw_summary = c.get(summary_key)
            summary = (
                _rich_json_to_text(raw_summary)
                if panel == "footnotes"
                else raw_summary
            )
            rows.append(
                {
                    "source": "card-flag",
                    "kind": kind,
                    "id": f"virtual:{panel}:{cid}",
                    "text": summary or f"<{panel} card>",
                    "paragraphIds": card_paragraph_ids(c),
                    "selectedText": c.get("selectedText") or card_text_anchor(c),
                    "linkedTo": {"panel": panel, "cardId": cid},
                    "extra": {"createdAt": c.get("createdAt")},
                }
            )
    return rows


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        die("usage: list_requests.py <docPath>")
    doc = resolve_doc(argv[1])
    ai_rows, bridged = list_ai_requests(doc)
    bib_rows = list_bib_reviews(doc)
    flag_rows = list_unbridged_card_flags(doc, bridged)
    for row in ai_rows + bib_rows + flag_rows:
        emit(row)
    # Brief summary on stderr so a piping skill can show counts at a glance.
    counts = {
        "ai-requests": len(ai_rows),
        "bib-review": len(bib_rows),
        "unbridged-card-flags": len(flag_rows),
    }
    print(
        f"# {sum(counts.values())} open: " + " ".join(f"{k}={v}" for k, v in counts.items()),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
