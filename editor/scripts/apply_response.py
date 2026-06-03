#!/usr/bin/env python3
"""Atomically apply a skill's response to a Virgil paper folder.

The single sanctioned writeback path (EDITOR_SKILLS_V1 §12). It owns the
atomic *card-write + .tex edit + status/result flip + sibling comment +
notification + version-bump + pen-acquire/release* transaction. Skills do not
write files directly; they hand `apply_response.py` a payload describing what
should land, and it commits every file all-or-nothing while holding the
editing pen.

CLI surface
-----------
Named subcommands (v1):

  apply_response.py <doc> write-silent       <op-json> [--synthesize-task]
  apply_response.py <doc> write-with-comment <op-json> [--synthesize-task]
  apply_response.py <doc> complete-task      <op-json> [--propose] [--synthesize-task]
  apply_response.py <doc> complete-only      <id|op-json> [--note N] [--result R] [--synthesize-task]
  apply_response.py <doc> revert             <id>

Safety-level mapping (skills read `safetyLevel` on the Task and dispatch):
  1 → write-silent          (result: silent-applied)
  2 → write-with-comment    (result: auto-applied)
  3 → complete-task --propose  (drafts a proposal; Task left awaiting review)
A direct create the user opted into → complete-task (result: direct-created).

Legacy surface (preserved verbatim for un-migrated skills — find-citation,
the answer-* family, draft-quotation, style-merge, …):

  apply_response.py <doc> <op-json>                         # default apply
  apply_response.py <doc> --revert <request-id>             # undo
  apply_response.py <doc> --complete-only <id> [--note N]   # flip, no card

`op-json` is an inline JSON string or a `@/path/to/file.json` reference.
Schema (v1 superset — every field optional unless noted):

  { "requestId": "...",        // ai-requests.json id, or "virtual:<panel>:<cardId>".
                               //   optional when --synthesize-task is passed.
    "panel":     "notes" | "todos" | "cutter" | "revisions" |
                 "footnotes" | "citations" | "quotations",
    "card":      { ...full card object to insert into <panel>.json },
    "texEdit":   { "anchorUuid": "3301",                 // paragraph %!v: marker
                   "insert": "\\vfid{f8}\\footnote{…}",  // text to splice
                   "mode": "end-of-paragraph" | "after-selected",
                   "selectedText": "…" },                // for after-selected
    "comment":   { "panel": "notes", "card": {…} },      // sibling comment (L2)
    "summary":   "<one-line description for the toast>",
    "clearSourceFlag": true,   // clear aiRequest on the linkedTo/virtual source
    // --synthesize-task only (build the Task on the fly):
    "kind": "footnote", "text": "…", "paragraphIds": ["3301"], "safetyLevel": 1 }

`texEdit` is kind-agnostic: the consumer composes the exact insert string (e.g.
`\\vfid{<id>}\\footnote{<body>}` for a footnote); this script just splices it at
the paragraph anchor. That keeps the writeback contract free of any per-kind
knowledge — the next card kind is a new consumer, not a change here.

A write subcommand commits, atomically and under the pen:
  - virgil/<panel>.json        (new card appended; duplicate id rejected)
  - the root .tex              (texEdit spliced — only for write/complete-task)
  - virgil/<comment-panel>.json (sibling comment — write-with-comment only)
  - virgil/ai-requests.json    (status + result set, resultId pointer; or a
                                synthesized Task appended)
  - the linkedTo/virtual source sidecar (aiRequest flag cleared, if asked)
  - virgil/notifications.json  (new entry)
  - virgil/version.txt         (bumped — committed last so it trails a
                                consistent on-disk state)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path

from _common import (
    commit_under_pen,
    die,
    find_tex_file,
    json_dumps,
    notification_appended,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
    version_bumped,
)

# Map panel names to (filename, list-key) for new-card insertion.
# notes uses list-key "cards" (NotesState = { cards: NoteCardItem[] } in
# src/lib/types.ts) — the previous "notes" key was a latent bug (a note written
# via apply_response landed under a dead key the browser never reads). Fixed
# here; surfaced by the footnote slice's Level-2 sibling-comment path.
PANEL_TO_SIDECAR = {
    "notes": ("notes.json", "cards"),
    "todos": ("todos.json", "items"),
    "cutter": ("cutter.json", "cards"),
    "revisions": ("revisions.json", "cards"),
    "footnotes": ("footnotes.json", "footnotes"),
    "citations": ("citations.json", "citations"),
    "quotations": ("quotations.json", "groups"),
}

# --- Two-field status / result vocabulary (EDITOR_SKILLS_V1 §7) ------------
STATUS_PENDING = "pending"
STATUS_IN_PROGRESS = "in-progress"
STATUS_COMPLETE = "complete"
STATUS_FAILED = "failed"

# Outcomes; set only on a terminal status (complete / failed).
RESULT_ACCEPTED = "accepted"
RESULT_REJECTED = "rejected"
RESULT_AUTO_APPLIED = "auto-applied"
RESULT_SILENT_APPLIED = "silent-applied"
RESULT_DIRECT_CREATED = "direct-created"
RESULT_REFUSED = "refused"
RESULT_IMPOSSIBLE = "impossible"
RESULT_ERRORED = "errored"
FAIL_RESULTS = {RESULT_REFUSED, RESULT_IMPOSSIBLE, RESULT_ERRORED}
ALL_RESULTS = {
    RESULT_ACCEPTED, RESULT_REJECTED, RESULT_AUTO_APPLIED, RESULT_SILENT_APPLIED,
    RESULT_DIRECT_CREATED, RESULT_REFUSED, RESULT_IMPOSSIBLE, RESULT_ERRORED,
}

SUBCOMMANDS = {"complete-task", "write-with-comment", "write-silent", "complete-only", "revert"}

# Skills use this to pick a subcommand from a Task's safetyLevel (spec §8).
SAFETY_LEVEL_SUBCOMMAND = {1: "write-silent", 2: "write-with-comment", 3: "complete-task"}


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


def _gen_request_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Transaction accumulator
#
# Collects every file mutation in memory, then hands a single ordered write-set
# to commit_under_pen (one atomic, pen-wrapped commit). JSON sidecars are
# loaded once and mutated in place (so multiple concerns touching the same file
# compose); only files actually mutated (`dirty`) are written. Raw writes (the
# .tex, notifications, version) are appended in order so version.txt lands last.
# ---------------------------------------------------------------------------


class _Txn:
    def __init__(self, doc: Path):
        self.doc = doc
        self._loaded: dict[Path, object] = {}
        self._dirty: set[Path] = set()
        self._raw: list[tuple[Path, str | None]] = []

    def jget(self, path: Path, default):
        if path not in self._loaded:
            self._loaded[path] = read_json(path, default)
        return self._loaded[path]

    def mark(self, path: Path):
        self._dirty.add(path)

    def add_raw(self, path: Path, content: str | None):
        self._raw.append((path, content))

    def append_card(self, panel: str, card: dict):
        if panel not in PANEL_TO_SIDECAR:
            die(f"unknown panel: {panel}")
        filename, list_key = PANEL_TO_SIDECAR[panel]
        path = sidecar(self.doc, filename)
        state = self.jget(path, {list_key: []})
        if not isinstance(state, dict):
            die(f"{filename} malformed")
        if list_key not in state or not isinstance(state[list_key], list):
            state[list_key] = []
        if card.get("id") and any(c.get("id") == card.get("id") for c in state[list_key]):
            die(f"card id already present in {filename}: {card.get('id')}")
        state[list_key].append(card)
        self.mark(path)

    def remove_card(self, card_id: str) -> str | None:
        """Remove a card by id from whichever panel holds it. Returns the panel
        name it was found in, or None."""
        for panel, (filename, list_key) in PANEL_TO_SIDECAR.items():
            path = sidecar(self.doc, filename)
            if not path.exists():
                continue
            state = self.jget(path, None)
            if not isinstance(state, dict):
                continue
            cards = state.get(list_key, [])
            kept = [c for c in cards if c.get("id") != card_id]
            if len(kept) != len(cards):
                state[list_key] = kept
                self.mark(path)
                return panel
        return None

    def clear_source_flag(self, linked: dict):
        panel = linked.get("panel")
        card_id = linked.get("cardId")
        if panel not in PANEL_TO_SIDECAR or not card_id:
            return
        filename, list_key = PANEL_TO_SIDECAR[panel]
        path = sidecar(self.doc, filename)
        state = self.jget(path, None)
        if not isinstance(state, dict):
            return
        for c in state.get(list_key, []) or []:
            if c.get("id") == card_id and c.get("aiRequest"):
                c["aiRequest"] = False
                self.mark(path)
                break

    def writes(self) -> list[tuple[Path, str | None]]:
        out: list[tuple[Path, str | None]] = [
            (p, json_dumps(self._loaded[p])) for p in self._loaded if p in self._dirty
        ]
        out.extend(self._raw)
        return out


# ---------------------------------------------------------------------------
# .tex splicing (kind-agnostic)
# ---------------------------------------------------------------------------


def _tex_splice(doc: Path, te: dict) -> tuple[Path, str]:
    """Compute the new .tex content with `te.insert` spliced at the anchor.
    Returns (tex_path, new_text); dies if the anchor can't be located."""
    insert = te.get("insert")
    if not insert:
        die("texEdit.insert is required")
    tex_path = find_tex_file(doc)
    text = tex_path.read_text(encoding="utf-8")
    mode = te.get("mode") or "end-of-paragraph"

    if mode == "after-selected" and te.get("selectedText"):
        sel = te["selectedText"]
        i = text.find(sel)
        if i != -1:
            pos = i + len(sel)
            return tex_path, text[:pos] + insert + text[pos:]
        # Selected text not found verbatim → fall back to end-of-paragraph.

    anchor = te.get("anchorUuid")
    if not anchor:
        die("texEdit.anchorUuid is required for an end-of-paragraph splice")
    marker = f"%!v:{anchor}"
    i = text.find(marker)
    if i == -1:
        die(f"anchor marker not found in .tex: {marker}")
    # Splice immediately after the paragraph's terminal token, before the
    # trailing whitespace + marker (house style: anchor adjacent to a token).
    j = i
    while j > 0 and text[j - 1] in " \t":
        j -= 1
    return tex_path, text[:j] + insert + text[j:]


def _strip_footnote_from_tex(text: str, fid: str) -> str | None:
    r"""Remove a `\vfid{<fid>}\footnote{...}` (or `\thanks{...}`) span. Returns
    the new text, or None if the `\vfid{<fid>}` marker isn't present."""
    anchor = "\\vfid{" + fid + "}"
    i = text.find(anchor)
    if i == -1:
        return None
    j = i + len(anchor)
    m = re.match(r"\\(footnote|thanks)\{", text[j:])
    if not m:
        return text[:i] + text[j:]  # strip just the orphan marker
    p = j + m.end()  # just past the opening brace
    depth = 1
    while p < len(text) and depth > 0:
        ch = text[p]
        if ch == "\\":
            p += 2  # skip an escaped char (e.g. \{ \})
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        p += 1
    return text[:i] + text[p:]


# ---------------------------------------------------------------------------
# The unified write transaction
# ---------------------------------------------------------------------------


def cmd_write(
    doc: Path,
    op: dict,
    *,
    status: str,
    result: str | None,
    apply_tex: bool,
    comment: bool,
    synthesize: bool,
) -> dict:
    """The one card-write transaction behind every write path.

    write-silent / write-with-comment / complete-task(direct) all land the card
    and the .tex edit, differing only in `result` and whether a sibling comment
    rides along. complete-task --propose passes apply_tex=False (the .tex change
    is the *proposal*, not yet applied) and a non-terminal status. The legacy
    default-apply op is just this with result=None (no outcome stamped).
    """
    summary = op.get("summary") or "AI request complete"
    panel = op.get("panel")
    card = op.get("card")
    request_id = op.get("requestId")
    is_virtual = isinstance(request_id, str) and request_id.startswith("virtual:")

    txn = _Txn(doc)

    # 1. The card itself → its panel sidecar.
    if panel and card is not None:
        txn.append_card(panel, card)

    # 2. The sibling comment (Level 2) → its panel sidecar.
    if comment:
        c = op.get("comment")
        if not isinstance(c, dict) or not c.get("panel") or c.get("card") is None:
            die("write-with-comment requires op.comment = { panel, card }")
        txn.append_card(c["panel"], c["card"])

    # 3. The Task entry → ai-requests.json (synthesize, mutate, or virtual).
    linked = None
    ar_path = sidecar(doc, "ai-requests.json")
    if synthesize:
        ar = txn.jget(ar_path, {"requests": []})
        if not isinstance(ar, dict) or not isinstance(ar.get("requests"), list):
            ar = {"requests": []}
            txn._loaded[ar_path] = ar
        new_id = request_id if (request_id and not is_virtual) else _gen_request_id()
        req: dict = {
            "id": new_id,
            "kind": op.get("kind") or "footnote",
            "text": op.get("text") or summary,
            "createdAt": now_iso(),
            "status": status,
        }
        if op.get("paragraphIds"):
            req["paragraphIds"] = op["paragraphIds"]
        if op.get("selectedText"):
            req["selectedText"] = op["selectedText"]
        if op.get("safetyLevel") is not None:
            req["safetyLevel"] = op["safetyLevel"]
        if result is not None:
            req["result"] = result
        if card is not None and card.get("id"):
            req["resultId"] = card["id"]
        ar["requests"].append(req)
        txn.mark(ar_path)
        request_id = new_id
    elif not is_virtual:
        if not request_id:
            die("op missing requestId (or pass --synthesize-task to create the Task)")
        ar = txn.jget(ar_path, None)
        if not isinstance(ar, dict) or "requests" not in ar:
            die("ai-requests.json missing or malformed")
        idx, req = find_request(ar, request_id)
        if req is None:
            die(f"request id not found: {request_id}")
        req["status"] = status
        if result is not None:
            req["result"] = result
        else:
            req.pop("result", None)
        if card is not None and card.get("id"):
            req["resultId"] = card["id"]
        ar["requests"][idx] = req
        txn.mark(ar_path)
        linked = req.get("linkedTo")
    else:
        parts = request_id.split(":", 2)
        if len(parts) != 3:
            die(f"malformed virtual request id: {request_id}")
        linked = {"panel": parts[1], "cardId": parts[2]}

    # 4. Clear the source card's aiRequest flag if asked.
    if op.get("clearSourceFlag", True) and isinstance(linked, dict):
        txn.clear_source_flag(linked)

    # 5. The .tex edit (only when applying — not for a proposal).
    if apply_tex and op.get("texEdit"):
        tex_path, new_tex = _tex_splice(doc, op["texEdit"])
        txn.add_raw(tex_path, new_tex)

    # 6. Notification + version (version last → trails a consistent state).
    notif_path, notif_content = notification_appended(
        doc,
        {"kind": "ai-request-complete", "at": now_iso(), "summary": summary, "requestId": request_id},
    )
    txn.add_raw(notif_path, notif_content)
    vpath, vcontent, vnum = version_bumped(doc)
    txn.add_raw(vpath, vcontent)

    commit_under_pen(doc, txn.writes())
    return {"ok": True, "version": vnum, "requestId": request_id, "status": status, "result": result}


def cmd_complete_only(
    doc: Path,
    target: str,
    *,
    note: str | None,
    result: str | None,
    synthesize: bool,
) -> dict:
    """Flip a Task's status (and optional result) without creating a card.
    Used by bib reviews, .tex-only skills (style-merge), and failure cases."""
    if result is not None and result not in ALL_RESULTS:
        die(f"unknown result: {result}")
    status = STATUS_FAILED if result in FAIL_RESULTS else STATUS_COMPLETE
    if synthesize:
        op = parse_op_json(target)
        op.setdefault("summary", note or "AI request complete")
        return cmd_write(
            doc, op, status=status, result=result,
            apply_tex=False, comment=False, synthesize=True,
        )
    op = {"requestId": target, "summary": note or "AI request complete"}
    return cmd_write(
        doc, op, status=status, result=result,
        apply_tex=False, comment=False, synthesize=False,
    )


def cmd_revert(doc: Path, request_id: str) -> dict:
    """Undo a landed response: remove the result card, strip its footnote span
    from the .tex (if any), and reopen the Task (status → pending, result and
    resultId cleared). Atomic + pen-wrapped."""
    txn = _Txn(doc)
    ar_path = sidecar(doc, "ai-requests.json")
    ar = txn.jget(ar_path, None)
    if not isinstance(ar, dict):
        die("ai-requests.json missing or malformed")
    idx, req = find_request(ar, request_id)
    if req is None:
        die(f"request id not found: {request_id}")

    result_id = req.get("resultId")
    if result_id:
        panel = txn.remove_card(result_id)
        # If it was a footnote, also strip its \vfid{}\footnote{} from the .tex.
        if panel == "footnotes":
            tex_path = find_tex_file(doc)
            text = tex_path.read_text(encoding="utf-8")
            new_text = _strip_footnote_from_tex(text, result_id)
            if new_text is not None and new_text != text:
                txn.add_raw(tex_path, new_text)

    req["status"] = STATUS_PENDING
    req.pop("result", None)
    req.pop("resultId", None)
    ar["requests"][idx] = req
    txn.mark(ar_path)

    notif_path, notif_content = notification_appended(
        doc,
        {"kind": "ai-request-failed", "at": now_iso(), "summary": f"Reverted request {request_id}", "requestId": request_id},
    )
    txn.add_raw(notif_path, notif_content)
    vpath, vcontent, vnum = version_bumped(doc)
    txn.add_raw(vpath, vcontent)

    commit_under_pen(doc, txn.writes())
    return {"ok": True, "reverted": True, "version": vnum}


# ---------------------------------------------------------------------------
# Subcommand semantics (shared by the CLI and the create-card consumer)
# ---------------------------------------------------------------------------


def run_write_subcommand(
    doc: Path, sub: str, op: dict, *, propose: bool = False, synthesize: bool = False
) -> dict:
    """Map a write subcommand name → its (status, result, apply_tex, comment)
    semantics and run it. One place owns the mapping, so the CLI dispatcher and
    create_card.py (which picks the subcommand from a Task's safetyLevel) can't
    drift apart."""
    if sub == "write-silent":
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_SILENT_APPLIED,
                         apply_tex=True, comment=False, synthesize=synthesize)
    if sub == "write-with-comment":
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_AUTO_APPLIED,
                         apply_tex=True, comment=True, synthesize=synthesize)
    if sub == "complete-task":
        if propose:
            # Level 3: the change is the *proposal* — draft the card, don't
            # touch the .tex, leave the Task open (in-progress) awaiting review.
            return cmd_write(doc, op, status=STATUS_IN_PROGRESS, result=None,
                             apply_tex=False, comment=False, synthesize=synthesize)
        # Direct create the user opted into: land the artifact now.
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_DIRECT_CREATED,
                         apply_tex=True, comment=False, synthesize=synthesize)
    die(f"not a write subcommand: {sub}")
    return {}  # unreachable


# ---------------------------------------------------------------------------
# CLI dispatch
# ---------------------------------------------------------------------------


def _dispatch_subcommand(doc: Path, sub: str, sub_argv: list[str]) -> dict:
    if sub in ("complete-task", "write-with-comment", "write-silent"):
        p = argparse.ArgumentParser(prog=f"apply_response.py <doc> {sub}")
        p.add_argument("op", help="op-json string or @file")
        p.add_argument("--synthesize-task", action="store_true", dest="synthesize")
        if sub == "complete-task":
            p.add_argument("--propose", action="store_true",
                           help="Level 3: draft the change as a proposal; leave the Task awaiting review")
        a = p.parse_args(sub_argv)
        op = parse_op_json(a.op)
        return run_write_subcommand(doc, sub, op, propose=getattr(a, "propose", False), synthesize=a.synthesize)

    if sub == "complete-only":
        p = argparse.ArgumentParser(prog="apply_response.py <doc> complete-only")
        p.add_argument("target", help="request id (or op-json with --synthesize-task)")
        p.add_argument("--note")
        p.add_argument("--result")
        p.add_argument("--synthesize-task", action="store_true", dest="synthesize")
        a = p.parse_args(sub_argv)
        return cmd_complete_only(doc, a.target, note=a.note, result=a.result, synthesize=a.synthesize)

    if sub == "revert":
        p = argparse.ArgumentParser(prog="apply_response.py <doc> revert")
        p.add_argument("request", help="request id to reopen")
        a = p.parse_args(sub_argv)
        return cmd_revert(doc, a.request)

    die(f"unknown subcommand: {sub}")
    return {}  # unreachable


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        die("usage: apply_response.py <docPath> <subcommand|op-json> ...")
    doc = resolve_doc(args[0])
    rest = args[1:]

    try:
        if rest and rest[0] in SUBCOMMANDS:
            result = _dispatch_subcommand(doc, rest[0], rest[1:])
        else:
            # Legacy surface: <op-json> | --revert <id> | --complete-only <id>.
            p = argparse.ArgumentParser(prog="apply_response.py")
            p.add_argument("op", nargs="?")
            p.add_argument("--revert")
            p.add_argument("--complete-only")
            p.add_argument("--note")
            a = p.parse_args(rest)
            if a.revert:
                result = cmd_revert(doc, a.revert)
            elif a.complete_only:
                result = cmd_complete_only(
                    doc, a.complete_only, note=a.note, result=None, synthesize=False
                )
            else:
                if not a.op:
                    die("usage: apply_response.py <docPath> <op-json>  (or a subcommand / --revert / --complete-only)")
                op = parse_op_json(a.op)
                # Legacy default-apply == the general write path with no outcome
                # stamped (result=None) and no .tex edit unless the op carries one.
                result = cmd_write(
                    doc, op, status=STATUS_COMPLETE, result=None,
                    apply_tex=True, comment=False, synthesize=False,
                )
    except SystemExit:
        raise  # die() already reported + set the exit code
    except Exception as e:  # noqa: BLE001 — convert to a clean error after rollback
        die(f"{type(e).__name__}: {e}")

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
