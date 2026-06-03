#!/usr/bin/env python3
"""Mechanically create a card of a given kind at an anchor, through the
apply_response.py contract (EDITOR_SKILLS_V1 §10).

This is the v1 `create-card` mechanical primitive. The body is user/chat
supplied — this script composes no content; it builds the sidecar entry, the
.tex atom marker (for atom-bearing kinds), and routes the write to the right
apply_response subcommand based on the Task's safety level.

  Safety level → subcommand (spec §8):
    1 → write-silent          (footnote lands silently; result: silent-applied)
    2 → write-with-comment    (footnote lands + a sibling note; result: auto-applied)
    3 → complete-task --propose (footnote proposed, .tex untouched; awaiting review)
    none → complete-task      (direct create the user opted into; result: direct-created)

Kinds: the --kind dispatch is generic; v1 implements ONLY `footnote`. The other
kinds (note / todo / citation / quotation / example / annotation) are explicit
TODOs — each is a small addition (build its sidecar entry + any atom marker)
on top of this same contract, not a re-think.

Workflow A (a Task already exists — the UI-initiated path):
  create_card.py <docPath> <requestId> --kind=footnote --body "<text>"
    Anchor + safetyLevel are read from the request.

Workflow B (chat-initiated — no pre-existing Task):
  create_card.py <docPath> --kind=footnote --body "<text>" --anchor <uuid> \
      [--safety-level N] [--task-text "<the user's ask>"]
    The Task is synthesized on the fly (apply_response --synthesize-task).
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import sys
import uuid
from pathlib import Path

import apply_response as AR
from _common import (
    die,
    find_paragraph_uuids,
    find_tex_file,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
)

ALL_KINDS = {"footnote", "note", "todo", "citation", "quotation", "example", "annotation"}
IMPLEMENTED_KINDS = {"footnote"}


def _jsoncontent(body: str) -> dict:
    """Wrap plain body text as a Tiptap JSONContent doc (one paragraph)."""
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": body}]}],
    }


def _gen_footnote_id(doc: Path) -> str:
    """A fresh 4-hex footnote id (the `\\vfid{<4hex>}` namespace), not colliding
    with any existing footnotes.json id or `\\vfid{}` marker already in the .tex."""
    used: set[str] = set()
    fn = read_json(sidecar(doc, "footnotes.json"), default={"footnotes": []})
    if isinstance(fn, dict):
        for f in fn.get("footnotes", []) or []:
            if f.get("id"):
                used.add(f["id"])
    try:
        tex = find_tex_file(doc).read_text(encoding="utf-8")
        for m in re.finditer(r"\\vfid\{([0-9a-fA-F]{2,8})\}", tex):
            used.add(m.group(1))
    except SystemExit:
        pass
    for _ in range(100000):
        cand = secrets.token_hex(2)  # 4 hex chars, matching the doc's f0ac/f003 style
        if cand not in used:
            return cand
    die("could not allocate a free footnote id")
    return ""  # unreachable


def _comment_note_card(anchor_uuid: str, body: str) -> dict:
    r"""A Level-2 sibling comment: a Virgil-authored note anchored to the same
    paragraph as the footnote. Built against the current card/link schema
    (UserNote + a kind:"anchor" textObject Link, src/links/_shared/types.ts);
    a vertical-slice extraction — revisit if the card-system refactor changes
    UserNote or Link."""
    note_id = str(uuid.uuid4())
    summary = body if len(body) <= 80 else body[:80] + "…"
    return {
        "kind": "note",
        "id": note_id,
        "title": "Virgil added a footnote",
        "content": _jsoncontent(f"Added a footnote here: {summary}"),
        "createdAt": now_iso(),
        "aiRequest": False,
        "links": [
            {
                "id": str(uuid.uuid4()),
                "kind": "anchor",
                "anchor": {
                    "type": "textObject",
                    "targetKind": "paragraph",
                    "textObjectIds": [anchor_uuid],
                    "margin": {"side": "right"},
                },
                "target": {"type": "card", "ref": {"kind": "note", "id": note_id}},
                "createdAt": now_iso(),
            }
        ],
    }


def _build_footnote_op(
    doc: Path,
    *,
    request_id: str | None,
    anchor: str,
    body: str,
    safety_level: int | None,
    synthesize: bool,
    task_text: str | None,
    selected_text: str | None,
) -> tuple[str, dict]:
    """Build the apply_response op-json for a footnote create. Returns
    (footnoteId, op)."""
    fid = _gen_footnote_id(doc)
    insert = "\\vfid{" + fid + "}\\footnote{" + body + "}"
    snippet = body if len(body) <= 60 else body[:60] + "…"

    op: dict = {
        "panel": "footnotes",
        "card": {"id": fid, "content": _jsoncontent(body), "createdAt": now_iso()},
        "texEdit": {
            "anchorUuid": anchor,
            "insert": insert,
            "mode": "after-selected" if selected_text else "end-of-paragraph",
        },
        "summary": f"Drafted footnote: {snippet}",
        # A footnote request carries no card-flag source to clear.
        "clearSourceFlag": False,
    }
    if selected_text:
        op["texEdit"]["selectedText"] = selected_text
    if request_id:
        op["requestId"] = request_id
    if synthesize:
        op["kind"] = "footnote"
        op["text"] = task_text or f"Add a footnote: {snippet}"
        op["paragraphIds"] = [anchor]
        if selected_text:
            op["selectedText"] = selected_text
        if safety_level is not None:
            op["safetyLevel"] = safety_level
    if safety_level == 2:
        op["comment"] = {"panel": "notes", "card": _comment_note_card(anchor, body)}
    return fid, op


def _footnote(doc: Path, a: argparse.Namespace) -> dict:
    body = a.body
    if not body:
        die("--body is required for --kind=footnote (chat composes the content)")

    request_id = a.request
    anchor = a.anchor
    safety = a.safety_level
    selected_text = None
    synthesize = bool(a.synthesize)

    if request_id and not synthesize:
        # Workflow A: an existing Task. Read its anchor + safety level.
        ar = read_json(sidecar(doc, "ai-requests.json"), default={"requests": []})
        reqs = ar.get("requests", []) if isinstance(ar, dict) else []
        req = next((r for r in reqs if r.get("id") == request_id), None)
        if req is None:
            die(f"request id not found: {request_id}")
        if req.get("kind") != "footnote":
            die(f"request {request_id} is kind={req.get('kind')!r}, not footnote")
        if req.get("status") in ("complete", "failed"):
            # Idempotent: re-running on a terminal Task is a no-op.
            return {"ok": True, "noop": True, "reason": "request already terminal", "requestId": request_id}
        if not anchor:
            pids = req.get("paragraphIds") or []
            if not pids:
                die("request has no paragraphIds; cannot anchor the footnote (pass --anchor)")
            anchor = pids[0]
        if safety is None and req.get("safetyLevel") is not None:
            safety = req.get("safetyLevel")
        selected_text = req.get("selectedText")
    else:
        # Workflow B: chat-initiated. Synthesize the Task; anchor must be given.
        synthesize = True
        if not anchor:
            die("--anchor <uuid> is required when there is no existing request")

    # Minimal anchor lookup: the paragraph UUID must exist in the .tex.
    tex = find_tex_file(doc).read_text(encoding="utf-8")
    known = {u["uuid"] for u in find_paragraph_uuids(tex)}
    if anchor not in known:
        die(f"anchor paragraph not found in .tex: %!v:{anchor}")

    fid, op = _build_footnote_op(
        doc,
        request_id=request_id,
        anchor=anchor,
        body=body,
        safety_level=safety,
        synthesize=synthesize,
        task_text=a.task_text,
        selected_text=selected_text,
    )

    # Safety level → subcommand. No level ⇒ footnote is a direct-create kind.
    if safety is None:
        sub, propose = "complete-task", False
    else:
        sub = AR.SAFETY_LEVEL_SUBCOMMAND[safety]
        propose = safety == 3

    result = AR.run_write_subcommand(doc, sub, op, propose=propose, synthesize=synthesize)
    result["footnoteId"] = fid
    result["subcommand"] = sub
    return result


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="create_card.py")
    p.add_argument("doc")
    p.add_argument("request", nargs="?", help="requestId (Workflow A); omit for chat-initiated")
    p.add_argument("--kind", required=True)
    p.add_argument("--body", help="card body (user/chat supplied)")
    p.add_argument("--anchor", help="paragraph UUID to anchor at (required for the chat path)")
    p.add_argument("--safety-level", type=int, choices=[1, 2, 3], dest="safety_level")
    p.add_argument("--synthesize", action="store_true", help="synthesize the Task (chat path)")
    p.add_argument("--task-text", dest="task_text", help="the user's ask, recorded on a synthesized Task")
    a = p.parse_args(argv[1:])

    doc = resolve_doc(a.doc)
    if a.kind not in ALL_KINDS:
        die(f"unknown --kind: {a.kind} (one of {sorted(ALL_KINDS)})")
    if a.kind not in IMPLEMENTED_KINDS:
        die(f"--kind={a.kind} is not implemented in this chip — footnote is the v1 slice; "
            f"{sorted(ALL_KINDS - IMPLEMENTED_KINDS)} are TODO (each builds its sidecar entry "
            f"+ any atom marker on the same apply_response contract).")

    try:
        if a.kind == "footnote":
            result = _footnote(doc, a)
        else:  # unreachable given the guard above
            die(f"--kind={a.kind} not implemented")
            result = {}
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        die(f"{type(e).__name__}: {e}")

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
