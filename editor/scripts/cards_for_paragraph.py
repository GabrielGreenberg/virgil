#!/usr/bin/env python3
"""List every card across panel sidecars anchored to a paragraph UUID.

Directly answers "what cards live around this paragraph?" — the question
editor skills ask before drafting a response. Walks all panel sidecars
in one pass; on a paper with hundreds of cards this still completes in
~10 ms because each file is small.

Usage:  python3 cards_for_paragraph.py <docPath> <uuid>

Emits one JSON line per matched card:
  { "panel": "notes" | "todos" | "cutter" | "revisions" | "citations" |
             "quotations" | "footnotes" | "examples",
    "cardId": "...",
    "kind":  <card kind>,
    "summary": <short text of the card body>,
    "aiRequest": <bool, only on flag-bearing kinds>?,
    "status": <if applicable, e.g. suggestion status>?
  }

Plus a `# matched <N> in <doc>` summary line on stderr.
"""

from __future__ import annotations

import json
import sys

from _common import card_paragraph_ids, die, read_json, resolve_doc, sidecar


def emit(row: dict) -> None:
    print(json.dumps(row, ensure_ascii=False))


def matches(card: dict, uuid: str) -> bool:
    return uuid in card_paragraph_ids(card)


def summarize(card: dict, fields: list[str]) -> str:
    for f in fields:
        v = card.get(f)
        if isinstance(v, str) and v.strip():
            return v.strip()[:140]
    return ""


def walk(doc, uuid: str) -> int:
    matched = 0

    # Notes
    notes = read_json(sidecar(doc, "notes.json"), default={"notes": []})
    if isinstance(notes, dict):
        for n in notes.get("notes", []) or []:
            if matches(n, uuid):
                emit(
                    {
                        "panel": "notes",
                        "cardId": n.get("id"),
                        "kind": "note",
                        "summary": summarize(n, ["title", "text"]),
                        "aiRequest": bool(n.get("aiRequest")),
                    }
                )
                matched += 1

    # Todos
    todos = read_json(sidecar(doc, "todos.json"), default={"items": []})
    if isinstance(todos, dict):
        for t in todos.get("items", []) or []:
            if matches(t, uuid):
                emit(
                    {
                        "panel": "todos",
                        "cardId": t.get("id"),
                        "kind": "todo",
                        "summary": summarize(t, ["text", "notes"]),
                        "aiRequest": bool(t.get("aiRequest")),
                        "status": "done" if t.get("done") else "open",
                    }
                )
                matched += 1

    # Cutter (comments + suggestions)
    cutter = read_json(sidecar(doc, "cutter.json"), default={"cards": []})
    if isinstance(cutter, dict):
        for c in cutter.get("cards", []) or []:
            if matches(c, uuid):
                row = {
                    "panel": "cutter",
                    "cardId": c.get("id"),
                    "kind": c.get("kind"),
                    "summary": summarize(c, ["text", "explanation", "original_text"]),
                }
                if c.get("kind") == "comment":
                    row["aiRequest"] = bool(c.get("aiRequest"))
                if c.get("kind") == "suggestion":
                    row["status"] = c.get("status", "pending")
                emit(row)
                matched += 1

    # Revisions (comments + suggestions)
    revs = read_json(sidecar(doc, "revisions.json"), default={"cards": []})
    if isinstance(revs, dict):
        for c in revs.get("cards", []) or []:
            if matches(c, uuid):
                row = {
                    "panel": "revisions",
                    "cardId": c.get("id"),
                    "kind": c.get("kind"),
                    "summary": summarize(c, ["text", "explanation", "original_text"]),
                }
                if c.get("kind") == "comment":
                    row["aiRequest"] = bool(c.get("aiRequest"))
                if c.get("kind") == "suggestion":
                    row["status"] = c.get("status", "pending")
                emit(row)
                matched += 1

    # Quotations (group cards with their own links)
    quotes = read_json(sidecar(doc, "quotations.json"), default={"groups": []})
    if isinstance(quotes, dict):
        for q in quotes.get("groups", []) or []:
            if matches(q, uuid):
                emit(
                    {
                        "panel": "quotations",
                        "cardId": q.get("id"),
                        "kind": "quotation",
                        "summary": summarize(q, ["title", "text"]),
                    }
                )
                matched += 1

    # Citations (atoms — pos-anchored, but some carry links via migrations)
    cits = read_json(sidecar(doc, "citations.json"), default={"citations": []})
    if isinstance(cits, dict):
        for c in cits.get("citations", []) or []:
            if matches(c, uuid):
                emit(
                    {
                        "panel": "citations",
                        "cardId": c.get("id"),
                        "kind": "citation",
                        "summary": (c.get("command") or "")[:140],
                    }
                )
                matched += 1

    # Examples (also have anchor links in some migrations)
    exs = read_json(sidecar(doc, "examples.json"), default={"examples": []})
    if isinstance(exs, dict):
        for e in exs.get("examples", []) or []:
            if matches(e, uuid):
                emit(
                    {
                        "panel": "examples",
                        "cardId": e.get("id"),
                        "kind": "example",
                        "summary": summarize(e, ["title", "tag", "label"]),
                    }
                )
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
