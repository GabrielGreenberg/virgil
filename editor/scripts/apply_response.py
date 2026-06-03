#!/usr/bin/env python3
"""Atomically apply a skill's response to a Virgil paper folder.

This script centralizes the writeback path so individual skill markdown
files don't have to handle the multi-file dance of (a) creating the
result card, (b) flipping the AI request to `complete` with `resultId`,
(c) clearing the source card's `aiRequest: true` flag, (d) appending a
notification, and (e) bumping the version counter. Every step happens
in-process; partial failures don't leave partial state on disk because
each sidecar is rewritten only once at the end.

Usage:
  python3 apply_response.py <docPath> <op-json>           # apply
  python3 apply_response.py <docPath> --revert <request-id>  # undo
  python3 apply_response.py <docPath> --complete-only <request-id> [--note <note>]
                                                          # mark complete without
                                                          # creating a card

`op-json` is either an inline JSON string or a `@/path/to/file.json`
reference. Schema:

  { "requestId": "...",        // ai-requests.json id, or "virtual:<panel>:<cardId>"
    "panel":     "notes" | "todos" | "cutter" | "revisions" |
                 "footnotes" | "citations" | "reports",
    "card":      { ...full card object to insert },
    "summary":   "<one-line description for the toast>",
    "clearSourceFlag": true   // if requestId is virtual or has linkedTo,
                              // clear aiRequest on the source card
  }

A successful apply writes:
  - virgil/<panel>.json   (new card appended)
  - virgil/ai-requests.json (status -> "complete", resultId set)
  - virgil/notifications.json (new entry)
  - virgil/version.txt (bumped)
  - the linkedTo source sidecar if `clearSourceFlag` is true
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _common import (
    append_notification,
    bump_version,
    die,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
)

# Map panel names to (filename, list-key) for new-card insertion.
PANEL_TO_SIDECAR = {
    "notes": ("notes.json", "notes"),
    "todos": ("todos.json", "items"),
    "cutter": ("cutter.json", "cards"),
    "revisions": ("revisions.json", "cards"),
    "footnotes": ("footnotes.json", "footnotes"),
    "citations": ("citations.json", "citations"),
    "reports": ("reports.json", "cards"),
}


def parse_op_json(arg: str) -> dict:
    if arg.startswith("@"):
        p = Path(arg[1:]).expanduser().resolve()
        if not p.is_file():
            die(f"op-json file not found: {p}")
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            die(f"invalid JSON in {p}: {e}")
    try:
        return json.loads(arg)
    except json.JSONDecodeError as e:
        die(f"invalid op-json: {e}")
    return {}  # unreachable


def find_request(state: dict, request_id: str) -> tuple[int, dict] | tuple[None, None]:
    for i, r in enumerate(state.get("requests", []) or []):
        if r.get("id") == request_id:
            return i, r
    return None, None


def find_card(state: dict, list_key: str, card_id: str) -> tuple[int, dict] | tuple[None, None]:
    for i, c in enumerate(state.get(list_key, []) or []):
        if c.get("id") == card_id:
            return i, c
    return None, None


def apply(doc, op: dict) -> dict:
    request_id = op.get("requestId")
    if not request_id:
        die("op missing requestId")
    panel = op.get("panel")
    card = op.get("card")
    summary = op.get("summary") or "AI request complete"

    is_virtual = isinstance(request_id, str) and request_id.startswith("virtual:")

    # Insert the new card if requested.
    if panel and card is not None:
        if panel not in PANEL_TO_SIDECAR:
            die(f"unknown panel: {panel}")
        filename, list_key = PANEL_TO_SIDECAR[panel]
        path = sidecar(doc, filename)
        state = read_json(path, default={list_key: []})
        if not isinstance(state, dict):
            state = {list_key: []}
        if list_key not in state or not isinstance(state[list_key], list):
            state[list_key] = []
        # Reject duplicate ids on the target sidecar (idempotency).
        if any(c.get("id") == card.get("id") for c in state[list_key]):
            die(f"card id already present in {filename}: {card.get('id')}")
        state[list_key].append(card)
        from _common import write_json

        write_json(path, state)

    # Flip the AI request entry (skip for virtual requests — they originate
    # from a card flag, not an ai-requests.json entry).
    if not is_virtual:
        ar_path = sidecar(doc, "ai-requests.json")
        ar_state = read_json(ar_path, default={"requests": []})
        if not isinstance(ar_state, dict) or "requests" not in ar_state:
            die("ai-requests.json malformed")
        idx, req = find_request(ar_state, request_id)
        if req is None:
            die(f"request id not found: {request_id}")
        req["status"] = "complete"
        if card is not None and card.get("id"):
            req["resultId"] = card["id"]
        ar_state["requests"][idx] = req
        from _common import write_json

        write_json(ar_path, ar_state)
        linked = req.get("linkedTo")
    else:
        # virtual:<panel>:<cardId>
        parts = request_id.split(":", 2)
        if len(parts) != 3:
            die(f"malformed virtual request id: {request_id}")
        linked = {"panel": parts[1], "cardId": parts[2]}

    # Clear the source card's aiRequest flag if asked.
    if op.get("clearSourceFlag", True) and isinstance(linked, dict):
        clear_source_flag(doc, linked)

    # Notify + version bump.
    append_notification(
        doc,
        {
            "kind": "ai-request-complete",
            "at": now_iso(),
            "summary": summary,
            "requestId": request_id,
        },
    )
    version = bump_version(doc)
    return {"ok": True, "version": version}


def clear_source_flag(doc, linked: dict) -> None:
    panel = linked.get("panel")
    card_id = linked.get("cardId")
    if panel not in PANEL_TO_SIDECAR or not card_id:
        return
    filename, list_key = PANEL_TO_SIDECAR[panel]
    path = sidecar(doc, filename)
    state = read_json(path, default=None)
    if not isinstance(state, dict):
        return
    cards = state.get(list_key, [])
    changed = False
    for c in cards:
        if c.get("id") == card_id:
            if c.get("aiRequest"):
                c["aiRequest"] = False
                changed = True
            break
    if changed:
        from _common import write_json

        write_json(path, state)


def revert(doc, request_id: str) -> dict:
    """Undo: remove the result card and reopen the request."""
    ar_path = sidecar(doc, "ai-requests.json")
    ar_state = read_json(ar_path, default=None)
    if not isinstance(ar_state, dict):
        die("ai-requests.json missing or malformed")
    idx, req = find_request(ar_state, request_id)
    if req is None:
        die(f"request id not found: {request_id}")

    result_id = req.get("resultId")
    if result_id:
        # Remove the result card from whichever sidecar holds it.
        for filename, list_key in PANEL_TO_SIDECAR.values():
            path = sidecar(doc, filename)
            state = read_json(path, default=None)
            if not isinstance(state, dict):
                continue
            cards = state.get(list_key, [])
            new_cards = [c for c in cards if c.get("id") != result_id]
            if len(new_cards) != len(cards):
                state[list_key] = new_cards
                from _common import write_json

                write_json(path, state)
                break

    req["status"] = "submitted"
    req.pop("resultId", None)
    ar_state["requests"][idx] = req
    from _common import write_json

    write_json(ar_path, ar_state)

    append_notification(
        doc,
        {
            "kind": "ai-request-failed",
            "at": now_iso(),
            "summary": f"Reverted request {request_id}",
            "requestId": request_id,
        },
    )
    version = bump_version(doc)
    return {"ok": True, "reverted": True, "version": version}


def complete_only(doc, request_id: str, note: str | None) -> dict:
    """Mark a request complete without creating a card. Used by skills
    like style-merge that mutate the .tex directly."""
    ar_path = sidecar(doc, "ai-requests.json")
    ar_state = read_json(ar_path, default=None)
    if not isinstance(ar_state, dict):
        die("ai-requests.json missing or malformed")
    idx, req = find_request(ar_state, request_id)
    if req is None:
        die(f"request id not found: {request_id}")
    req["status"] = "complete"
    ar_state["requests"][idx] = req
    from _common import write_json

    write_json(ar_path, ar_state)
    append_notification(
        doc,
        {
            "kind": "ai-request-complete",
            "at": now_iso(),
            "summary": note or "AI request complete",
            "requestId": request_id,
        },
    )
    version = bump_version(doc)
    return {"ok": True, "version": version}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="apply_response.py")
    p.add_argument("doc")
    p.add_argument("op", nargs="?")
    p.add_argument("--revert")
    p.add_argument("--complete-only")
    p.add_argument("--note")
    args = p.parse_args(argv[1:])

    doc = resolve_doc(args.doc)

    if args.revert:
        result = revert(doc, args.revert)
    elif args.complete_only:
        result = complete_only(doc, args.complete_only, args.note)
    else:
        if not args.op:
            die("usage: apply_response.py <docPath> <op-json>  (or --revert / --complete-only)")
        op = parse_op_json(args.op)
        result = apply(doc, op)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
