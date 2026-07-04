#!/usr/bin/env python3
"""List every open AI request in a Virgil paper folder.

Walks three sources and emits a single JSONL stream — one line per open
request — that the `/editor/review` umbrella consumes:

  1. `virgil/ai-requests.json` — entries with an open status (anything that
     is not a terminal `complete` / `failed`; legacy `draft` / `submitted` and
     v1 `pending` / `in-progress` are all open).
  2. `virgil/bib-review-requests.json` — entries with status == "pending".
  3. The card-flag sidecars (notes / highlights / todos / cutter / revisions /
     reports / footnotes). Cards whose `aiRequest: true` flag has no matching
     `linkedTo` entry in `ai-requests.json` are emitted as virtual entries so
     the skill can still pick them up. This covers two cases: libraries created
     before the bridge landed (transitional), AND a bridge-write that silently
     failed (the bridge is best-effort — it swallows I/O errors), so the request
     survives to the drain either way. Footnotes (#55b) join this fallback:
     their flag lives in `footnotes.json` (not a panel card list), and a
     bridge failure would otherwise drop the request entirely — the fallback
     guarantees it still surfaces (as `kind: "footnote"`).

     The fallback's wire kind + panel per card kind are read from the
     registry-derived manifest `ai_request_routing.json` (the same routing the
     TS bridge uses), joined with the STORAGE_ADAPTER below (the on-disk shape
     each kind lives in). So the drain and the bridge can't disagree about kinds
     or coverage: a new flag-bearing kind added to CARD_REGISTRY regenerates the
     manifest, and the STORAGE_ADAPTER coverage test forces its storage row in.

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


# The registry-derived routing manifest (projection of CARD_REGISTRY[kind].
# aiRequest). `_ROUTING[cardKind] == {"kind": <wire kind>, "linkPanel": <panel>}`,
# byte-identical to what the TS bridge writes. Pinned to the registry by
# ai-request-routing-manifest.test.ts, so the drain can't drift from the bridge.
from pathlib import Path as _Path

_ROUTING: dict[str, dict[str, str]] = json.loads(
    (_Path(__file__).with_name("ai_request_routing.json")).read_text(encoding="utf-8")
)["routing"]


# The on-disk shape each flag-bearing card kind lives in — the storage half the
# registry doesn't (and shouldn't) hold. Keyed by the SAME card kinds as the
# manifest; `list_unbridged_card_flags` joins the two. Each row:
#   file        the sidecar filename under virgil/
#   list_key    the array key inside it
#   match       (field, allowed_values, allow_absent) to select THIS kind's rows
#               from a shared file (notes.json holds note+highlight; cutter/
#               revisions hold comment+suggestion; reports hold report+
#               report-request) — or None to take every row (single-kind files).
#   summary     the field to summarize from (footnote flattens rich JSON instead)
#   rich        True → `summary` is a rich JSONContent body to flatten, not a
#               plain field.
# The `_ROUTING`-vs-adapter key parity is pinned by test_unbridged_flag_fallback.py.
STORAGE_ADAPTER: dict[str, dict] = {
    # notes.json holds BOTH note and highlight cards under `cards`, discriminated
    # by `kind`. (The pre-manifest table read the wrong list_key "notes" and
    # emitted every row as "note" — the note/highlight fallback was DEAD and
    # highlights never surfaced with their own wire kind.)
    "note": {
        "file": "notes.json", "list_key": "cards",
        "match": ("kind", ("note",), True), "summary": "title", "rich": False,
    },
    "highlight": {
        "file": "notes.json", "list_key": "cards",
        "match": ("kind", ("highlight",), False), "summary": "title", "rich": False,
    },
    "todo": {
        "file": "todos.json", "list_key": "items",
        "match": None, "summary": "text", "rich": False,
    },
    "cutter-comment": {
        "file": "cutter.json", "list_key": "cards",
        "match": ("kind", ("comment",), False), "summary": "text", "rich": False,
    },
    "revision-comment": {
        "file": "revisions.json", "list_key": "cards",
        "match": ("kind", ("comment",), False), "summary": "text", "rich": False,
    },
    "report-request": {
        "file": "reports.json", "list_key": "cards",
        "match": ("kind", ("report-request",), False), "summary": "text", "rich": False,
    },
    # #55b: footnotes' flag lives in footnotes.json (FootnoteRef.aiRequest); the
    # body is rich JSONContent and they carry no `links` array, so the anchor
    # can't come from card_paragraph_ids (it lives in the .tex `\footnote`
    # position). A footnote AI request is ALWAYS bridged on toggle WITH
    # paragraphIds; this fallback exists ONLY for the bridge-write-failure case,
    # so the request still surfaces (paragraphIds may be empty in that degraded
    # case — the skill then re-derives an anchor rather than losing the request).
    "footnote": {
        "file": "footnotes.json", "list_key": "footnotes",
        "match": None, "summary": "content", "rich": True,
    },
}


def _card_matches(card: dict, match: tuple | None) -> bool:
    """True if `card` belongs to the kind selected by `match` (field, values,
    allow_absent) — or if `match` is None (single-kind file, take every row)."""
    if match is None:
        return True
    field, values, allow_absent = match
    v = card.get(field)
    if v is None:
        return allow_absent
    return v in values


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
    """Surface `aiRequest: true` cards that have no matching bridged entry.

    For each flag-bearing card kind (the manifest's keys), read its storage
    sidecar, select this kind's rows (STORAGE_ADAPTER `match`), and emit any
    flagged-but-unbridged one with the registry-declared wire kind + panel — so
    the fallback labels a request exactly as the bridge would have. Multiple
    kinds share a file (note+highlight in notes.json; comment in cutter/
    revisions; report-request in reports.json); each is read under its own
    discriminator, so one file is walked once per kind that lives in it."""
    rows: list[dict] = []
    # Cache each sidecar's parse so a shared file (notes.json) isn't re-read.
    file_cache: dict[str, dict | None] = {}
    for card_kind, route in _ROUTING.items():
        adapter = STORAGE_ADAPTER.get(card_kind)
        if adapter is None:
            # A manifest kind with no storage row can't be drained from the
            # fallback — surface it loudly rather than dropping it silently.
            print(
                f"# warning: no STORAGE_ADAPTER row for flag-bearing kind "
                f"'{card_kind}'; its unbridged flags won't surface",
                file=sys.stderr,
            )
            continue
        wire_kind = route["kind"]
        panel = route["linkPanel"]
        filename = adapter["file"]
        if filename not in file_cache:
            file_cache[filename] = read_json(sidecar(doc, filename), default=None)
        state = file_cache[filename]
        if not isinstance(state, dict):
            continue
        cards = state.get(adapter["list_key"], []) or []
        for c in cards:
            if not c.get("aiRequest"):
                continue
            if not _card_matches(c, adapter["match"]):
                continue
            cid = c.get("id")
            if not cid:
                continue
            # Dedupe against the bridged entries — keyed on (panel, cardId), the
            # same wire link the bridge writes.
            if (panel, cid) in bridged:
                continue
            raw_summary = c.get(adapter["summary"])
            summary = (
                _rich_json_to_text(raw_summary) if adapter["rich"] else raw_summary
            )
            rows.append(
                {
                    "source": "card-flag",
                    "kind": wire_kind,
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
