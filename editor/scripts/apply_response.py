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

Existing-card mutation ops (EDITOR_SKILLS_V1 §10) — the same atomic + pen-wrapped
transaction, but they *mutate* a card that already exists rather than create one.
Each resolves the card via card_by_id.find_card and shares one spine
(`_mutation_commit`: optional Task completion + audit notification + version
bump, committed all-or-nothing under the pen):

  apply_response.py <doc> update   <op-json>   # { cardId, set?:{…}, body?, summary? }
  apply_response.py <doc> archive  <op-json>   # { cardId } → archive.json (origin preserved)
  apply_response.py <doc> restore  <op-json>   # { cardId } archive.json → original panel
  apply_response.py <doc> move     <op-json>   # { cardId, newAnchor } re-anchor (Mode-A only)
  apply_response.py <doc> link     <op-json>   # { cardAId, cardBId, kind? } bidirectional

The mutation ops register **no synthesized Task**: a mechanical card-op has no
`AiRequestKind`, and a fabricated kind leaks `undefined` into the AI window's
PANEL_KIND_MAP (the invariant test_card_kinds_slice.py pins). Their durable
audit record is the notification + version bump — the surface the browser polls.
A real `requestId` (a Task the user filed asking for the op) is completed if
passed, but is not required.

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
                 "footnotes" | "citations" | "reports",
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
    "reports": ("reports.json", "cards"),
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

SUBCOMMANDS = {
    "complete-task", "write-with-comment", "write-silent", "complete-only", "revert",
    # Existing-card mutation ops (§10) — each routes through _mutation_commit.
    "update", "archive", "restore", "move", "link",
}

# Panels whose cards are atom-bearing (the card id *equals* a `.tex` \v*id marker;
# no `links` array — the tie is id equality, anchoring.md). Re-anchoring or
# archiving these means moving / orphaning the marker in the .tex, an atom edit
# that's out of scope for the sidecar-level mutation ops — they refuse + flag.
ATOM_BEARING_PANELS = {"footnotes", "citations"}

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


def _jsoncontent(body: str) -> dict:
    """Wrap plain body text as a Tiptap JSONContent doc (one paragraph). Mirrors
    create_card._jsoncontent — kept local so the contract carries no create-card
    import (create_card imports *this* module)."""
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": body}]}],
    }


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

    # --- existing-card mutation primitives (used by the §10 ops) -----------

    def card_ref(self, filename: str, list_key: str, card_id: str) -> dict | None:
        """Return the *live* (txn-loaded) card dict for `card_id`, so in-place
        mutations land in the committed write-set. Two refs into the same file
        (e.g. link-cards on two notes) share one loaded dict, so both edits land
        in a single write. None if the card isn't present."""
        path = sidecar(self.doc, filename)
        state = self.jget(path, None)
        if not isinstance(state, dict):
            return None
        for c in state.get(list_key, []) or []:
            if isinstance(c, dict) and c.get("id") == card_id:
                return c
        return None

    def add_snippet(self, snippet: dict):
        """Append an ArchivedSnippet to archive.json (duplicate id rejected).
        archive.json is intentionally NOT a PANEL_TO_SIDECAR row (writeback-exempt
        — tools/check-coherence Check 5), so archive/restore touch it directly
        here rather than through append_card."""
        path = sidecar(self.doc, "archive.json")
        state = self.jget(path, {"snippets": []})
        if not isinstance(state, dict):
            state = {"snippets": []}
            self._loaded[path] = state
        if "snippets" not in state or not isinstance(state["snippets"], list):
            state["snippets"] = []
        if snippet.get("id") and any(s.get("id") == snippet.get("id") for s in state["snippets"]):
            die(f"snippet id already present in archive.json: {snippet.get('id')}")
        state["snippets"].append(snippet)
        self.mark(path)

    def remove_snippet(self, card_id: str) -> bool:
        """Drop a snippet from archive.json by id. Returns whether one was removed."""
        path = sidecar(self.doc, "archive.json")
        state = self.jget(path, None)
        if not isinstance(state, dict):
            return False
        snippets = state.get("snippets", []) or []
        kept = [s for s in snippets if s.get("id") != card_id]
        if len(kept) != len(snippets):
            state["snippets"] = kept
            self.mark(path)
            return True
        return False

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


def _replace_footnote_body_in_tex(text: str, fid: str, new_body: str) -> str | None:
    r"""Replace the body inside `\vfid{<fid>}\footnote{...}` (brace-matched, so a
    `{…}` group inside the body is preserved). Returns the new text, or None if
    the marker / `\footnote{` isn't found. A footnote's body lives in *two*
    places — `footnotes.json` `content` and the `.tex` `\footnote{}` — so an
    edit must patch both to keep them in sync (the one bit of footnote-specific
    .tex knowledge the contract carries, alongside _strip_footnote_from_tex)."""
    anchor = "\\vfid{" + fid + "}"
    i = text.find(anchor)
    if i == -1:
        return None
    j = i + len(anchor)
    m = re.match(r"\\(footnote|thanks)\{", text[j:])
    if not m:
        return None
    body_start = j + m.end()  # just past the opening brace
    p = body_start
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
    body_end = p - 1  # index of the matching closing brace
    return text[:body_start] + new_body + text[body_end:]


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
# Existing-card mutation ops (EDITOR_SKILLS_V1 §10)
#
# update / archive / restore / move / link all *mutate a card that already
# exists*. They reuse chip 3's atomic-write + pen spine and chip 8's anchor
# lookup, and share one tail — `_mutation_commit` — so there is a single
# atomic+pen+audit path with op-specific handlers, not five bespoke scripts.
# Each resolves its card(s) through card_by_id.find_card (the shared §13 lookup,
# imported lazily so apply_response stays import-cycle-free).
# ---------------------------------------------------------------------------


def _mutation_commit(
    doc: Path,
    txn: "_Txn",
    *,
    summary: str,
    request_id: str | None = None,
    result: str | None = None,
    extra: dict | None = None,
) -> dict:
    """The shared atomic + pen + audit tail for every §10 mutation op.

    Optionally completes a real Task (`request_id` — a request the user filed
    asking for the op); always appends the audit notification + bumps version;
    commits the whole write-set all-or-nothing under the pen. No Task is
    *synthesized* for a mechanical op (a card-op has no AiRequestKind — a
    fabricated one leaks `undefined` into the AI window; the notification +
    version bump is the durable audit surface)."""
    if request_id and not str(request_id).startswith("virtual:"):
        ar_path = sidecar(doc, "ai-requests.json")
        ar = txn.jget(ar_path, None)
        if isinstance(ar, dict) and isinstance(ar.get("requests"), list):
            idx, req = find_request(ar, request_id)
            if req is not None:
                req["status"] = STATUS_COMPLETE
                req["result"] = result or RESULT_AUTO_APPLIED
                ar["requests"][idx] = req
                txn.mark(ar_path)

    notif_path, notif_content = notification_appended(
        doc,
        {"kind": "ai-request-complete", "at": now_iso(), "summary": summary, "requestId": request_id},
    )
    txn.add_raw(notif_path, notif_content)
    vpath, vcontent, vnum = version_bumped(doc)
    txn.add_raw(vpath, vcontent)

    commit_under_pen(doc, txn.writes())
    out = {"ok": True, "version": vnum, "summary": summary}
    if extra:
        out.update(extra)
    return out


# --- update ----------------------------------------------------------------
#
# A plain-text `--body` lands in a different field per kind, and a footnote body
# is atom-coupled (lives in the .tex `\footnote{}` too). This compact per-kind
# map is the only kind knowledge the otherwise kind-agnostic contract carries
# for editing — justified because the body field genuinely differs by kind.
# Named-field edits (`set`) stay fully generic. Kinds absent from all three sets
# have no single editable plain body (highlight / citation / the suggestion
# family / example) → `--body` is refused; edit their named fields with `--field`.
_BODY_PLAIN = {"todo"}                                            # → `text`
_BODY_RICH_ONLY = {"note", "footnote"}                            # → `content`
_BODY_RICH_MIRROR = {"report", "report-request", "comment", "cutter-comment"}  # → `content` + `text`


def _apply_body(doc: Path, txn: "_Txn", card: dict, kind: str, panel: str, body: str) -> None:
    if kind in _BODY_PLAIN:
        card["text"] = body
        return
    if kind in _BODY_RICH_ONLY or kind in _BODY_RICH_MIRROR:
        card["content"] = _jsoncontent(body)
        if kind in _BODY_RICH_MIRROR:
            card["text"] = body  # keep the plain mirror in sync (sidecars.md rule 2)
        if panel == "footnotes":
            tex_path = find_tex_file(doc)
            text = tex_path.read_text(encoding="utf-8")
            new_text = _replace_footnote_body_in_tex(text, card["id"], body)
            if new_text is None:
                die(f"could not find \\vfid{{{card['id']}}}\\footnote{{…}} in the .tex to edit")
            if new_text != text:
                txn.add_raw(tex_path, new_text)
        return
    die(f"--body is not editable for kind={kind}; edit its named fields with --field "
        f"(e.g. highlightColor, status, suggested_text)")


def cmd_update(doc: Path, op: dict) -> dict:
    """Edit a card's body and/or named fields, in place, atomically."""
    from card_by_id import find_card, card_kind

    card_id = op.get("cardId")
    if not card_id:
        die("update requires op.cardId")
    sets = op.get("set") or {}
    body = op.get("body")
    if not sets and body is None:
        die("update is a no-op: pass op.body and/or op.set {field: value}")

    hit = find_card(doc, card_id)
    if hit is None:
        die(f"card not found: {card_id}")
    if hit.panel == "archive":
        die(f"card {card_id} is archived — restore it before editing")
    if hit.panel == "examples":
        die("an example lives in the .tex (\\ex…\\xe), not a mutable card — edit the document block")
    kind = card_kind(hit)

    txn = _Txn(doc)
    card = txn.card_ref(hit.filename, hit.list_key, card_id)
    if card is None:
        die(f"card vanished while opening the transaction: {card_id}")
    for k, v in sets.items():
        card[k] = v
    if body is not None:
        _apply_body(doc, txn, card, kind, hit.panel, body)
    txn.mark(sidecar(doc, hit.filename))

    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Edited {kind} {card_id}",
        request_id=op.get("requestId"),
        extra={"op": "update", "cardId": card_id, "cardKind": kind},
    )


# --- archive / restore ------------------------------------------------------


def _archive_title(card: dict, kind: str) -> str:
    t = card.get("title") or card.get("text") or ""
    t = t if len(t) <= 80 else t[:80] + "…"
    return t or f"Archived {kind}"


def cmd_archive(doc: Path, op: dict) -> dict:
    """Move a panel card to archive.json, preserving its origin so restore is
    lossless. `archive.json`'s documented `ArchivedSnippet { id, title, content,
    createdAt, links }` has no origin field, so we add `originalPanel` + the
    verbatim `originalCard` as a deliberate, forward-compatible extension."""
    from card_by_id import find_card, card_kind

    card_id = op.get("cardId")
    if not card_id:
        die("archive requires op.cardId")
    hit = find_card(doc, card_id)
    if hit is None:
        die(f"card not found: {card_id}")
    kind = card_kind(hit)
    if hit.panel == "archive":
        die(f"card {card_id} is already archived")
    if hit.panel in ATOM_BEARING_PANELS:
        die(f"archive-card on a {kind} (atom-bearing) is not supported: its id is its \\v*id "
            f"marker, so archiving would orphan the .tex atom. Delete the atom in-document instead.")
    if hit.panel == "examples":
        die("an example lives in the .tex, not a card store — it can't be archived")

    original = hit.card  # a detached snapshot (read by card_by_id, not the txn)
    txn = _Txn(doc)
    panel = txn.remove_card(card_id)
    if panel is None:
        die(f"could not remove {card_id} from {hit.panel}.json")
    snippet = {
        "id": card_id,
        "title": _archive_title(original, kind),
        "content": original.get("content") or _jsoncontent(original.get("text") or ""),
        "createdAt": now_iso(),
        "links": original.get("links") or [],
        # --- origin preservation (the lossless-restore extension) ---
        "originalPanel": panel,
        "originalCard": original,
        "archivedAt": now_iso(),
    }
    txn.add_snippet(snippet)

    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Archived {kind} {card_id}",
        request_id=op.get("requestId"),
        extra={"op": "archive", "cardId": card_id, "originalPanel": panel},
    )


def cmd_restore(doc: Path, op: dict) -> dict:
    """Move a card back from archive.json to the panel it came from."""
    from card_by_id import find_card

    card_id = op.get("cardId")
    if not card_id:
        die("restore requires op.cardId")
    hit = find_card(doc, card_id)
    if hit is None:
        die(f"card not found: {card_id}")
    if hit.panel != "archive":
        die(f"card {card_id} is not archived (it's in {hit.panel}) — nothing to restore")
    snippet = hit.card
    original_panel = snippet.get("originalPanel")
    original_card = snippet.get("originalCard")
    if not original_panel or not isinstance(original_card, dict):
        die(f"archived snippet {card_id} carries no originalPanel/originalCard — it wasn't "
            f"archived via archive-card, so its origin is unknown. Restore it by hand.")
    if original_panel not in PANEL_TO_SIDECAR:
        die(f"snippet {card_id} names an unknown originalPanel: {original_panel!r}")

    txn = _Txn(doc)
    if not txn.remove_snippet(card_id):
        die(f"could not remove snippet {card_id} from archive.json")
    txn.append_card(original_panel, original_card)

    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Restored {card_id} → {original_panel}",
        request_id=op.get("requestId"),
        extra={"op": "restore", "cardId": card_id, "panel": original_panel},
    )


# --- move -------------------------------------------------------------------


def cmd_move(doc: Path, op: dict) -> dict:
    """Re-anchor a Mode-A (paragraph-anchored) card to a new paragraph by
    rewriting its `links[*].anchor.textObjectIds`. Atom-bearing cards
    (footnote/citation) and Mode-B (text-range) anchors are deferred + flagged —
    re-anchoring those means relocating a `.tex` marker, not a sidecar edit."""
    from card_by_id import find_card, card_kind
    from _common import find_paragraph_uuids

    card_id = op.get("cardId")
    new_anchor = op.get("newAnchor")
    if not card_id or not new_anchor:
        die("move requires op.cardId and op.newAnchor")
    hit = find_card(doc, card_id)
    if hit is None:
        die(f"card not found: {card_id}")
    kind = card_kind(hit)
    if hit.panel in ATOM_BEARING_PANELS:
        die(f"move-card on a {kind} (atom-bearing) is deferred: re-anchoring means relocating its "
            f"\\v*id marker + \\footnote/\\cite in the .tex (an atom move), not a sidecar edit. "
            f"anchoring.md: \"the paragraph anchor follows the Atom\" — move the atom in-document.")
    if hit.panel in ("archive", "examples"):
        die(f"move-card does not apply to {hit.panel} cards")

    tex = find_tex_file(doc).read_text(encoding="utf-8")
    known = {u["uuid"] for u in find_paragraph_uuids(tex)}
    if new_anchor not in known:
        die(f"anchor paragraph not found in .tex: %!v:{new_anchor}")

    txn = _Txn(doc)
    card = txn.card_ref(hit.filename, hit.list_key, card_id)
    if card is None:
        die(f"card vanished while opening the transaction: {card_id}")
    links = card.get("links")
    if not isinstance(links, list) or not links:
        die(f"{kind} {card_id} has no anchor links to move")
    moved = 0
    for link in links:
        anchor = link.get("anchor") if isinstance(link, dict) else None
        if not isinstance(anchor, dict) or anchor.get("type") != "textObject":
            continue
        if anchor.get("targetKind") == "linkedRange":
            die(f"{kind} {card_id} is a Mode-B text-range anchor; re-anchoring a range needs a new "
                f"linkedAnchor mark in the .tex — deferred. move-card handles Mode-A paragraph anchors.")
        anchor["textObjectIds"] = [new_anchor]
        anchor["targetKind"] = anchor.get("targetKind") or "paragraph"
        moved += 1
    if moved == 0:
        die(f"{kind} {card_id} has no Mode-A paragraph anchor to move")
    txn.mark(sidecar(doc, hit.filename))

    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Moved {kind} {card_id} → %!v:{new_anchor}",
        request_id=op.get("requestId"),
        extra={"op": "move", "cardId": card_id, "newAnchor": new_anchor, "anchorsMoved": moved},
    )


# --- link -------------------------------------------------------------------
#
# The manifest defines no card↔card relationship field — `links: Link[]` is
# strictly the card→TextObject anchor (a rigid discriminated union the browser
# migrates/validates), and atom-linked cards carry no `links` at all. So a
# bidirectional card link is stored in a NEW, dedicated `relatedCards` field
# (NOT `links`), reusing the Link vocabulary (`{ id, kind, target:{type:"card",
# ref:{kind,id}}, createdAt }`) minus the text anchor. This works uniformly for
# every kind — including footnotes/citations, which can't take a `links` entry.
# Flagged as a contract-shape strain / manifest gap (no browser renderer yet —
# a forward-compatible record, like OriginalAnchor).


def _add_relationship(card: dict, rel: str, other_kind: str, other_id: str) -> None:
    rels = card.get("relatedCards")
    if not isinstance(rels, list):
        rels = []
        card["relatedCards"] = rels
    for r in rels:  # idempotent: don't double-add the same (target, kind) pair
        if (isinstance(r, dict)
                and r.get("kind") == rel
                and (r.get("target") or {}).get("ref", {}).get("id") == other_id):
            return
    rels.append({
        "id": str(uuid.uuid4()),
        "kind": rel,
        "target": {"type": "card", "ref": {"kind": other_kind, "id": other_id}},
        "createdAt": now_iso(),
    })


def cmd_link(doc: Path, op: dict) -> dict:
    """Add a bidirectional relationship record to both cards' `relatedCards`."""
    from card_by_id import find_card, card_kind

    a_id = op.get("cardAId")
    b_id = op.get("cardBId")
    if not a_id or not b_id:
        die("link requires op.cardAId and op.cardBId")
    if a_id == b_id:
        die("cannot link a card to itself")
    rel = op.get("kind") or "related"

    hit_a = find_card(doc, a_id)
    if hit_a is None:
        die(f"card not found: {a_id}")
    hit_b = find_card(doc, b_id)
    if hit_b is None:
        die(f"card not found: {b_id}")
    kind_a, kind_b = card_kind(hit_a), card_kind(hit_b)

    txn = _Txn(doc)
    card_a = txn.card_ref(hit_a.filename, hit_a.list_key, a_id)
    card_b = txn.card_ref(hit_b.filename, hit_b.list_key, b_id)
    if card_a is None or card_b is None:
        die("a card vanished while opening the transaction")
    _add_relationship(card_a, rel, kind_b, b_id)
    _add_relationship(card_b, rel, kind_a, a_id)
    txn.mark(sidecar(doc, hit_a.filename))
    txn.mark(sidecar(doc, hit_b.filename))

    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Linked {kind_a} {a_id} ↔ {kind_b} {b_id} ({rel})",
        request_id=op.get("requestId"),
        extra={"op": "link", "cardAId": a_id, "cardBId": b_id, "kind": rel},
    )


# Op name → handler. One uniform spine (_mutation_commit), five op-specific
# handlers — the family is "existing-card mutations through one contract".
MUTATION_OPS = {
    "update": cmd_update,
    "archive": cmd_archive,
    "restore": cmd_restore,
    "move": cmd_move,
    "link": cmd_link,
}


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

    if sub in MUTATION_OPS:
        p = argparse.ArgumentParser(prog=f"apply_response.py <doc> {sub}")
        p.add_argument("op", help="op-json string or @file")
        a = p.parse_args(sub_argv)
        return MUTATION_OPS[sub](doc, parse_op_json(a.op))

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
