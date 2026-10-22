#!/usr/bin/env python3
r"""Mechanically create a card of a given kind at an anchor, through the
apply_response.py contract (EDITOR_SKILLS_V1 §10).

This is the `create-card` mechanical primitive. The body/key is user/chat
supplied — this script composes no content; per kind it builds the sidecar
entry, the .tex atom marker (for atom-bearing kinds), and routes the write to
the right apply_response subcommand based on the Task's safety level.

  Safety level → subcommand (spec §8, owned by apply_response):
    1 → write-silent            (lands silently; result: silent-applied)
    2 → write-with-comment      (lands + a sibling note; result: auto-applied)
    3 → complete-task --propose (proposed, .tex untouched; awaiting review)
    none → complete-task        (direct create the user opted into; direct-created)

Kinds — the create-able CardKind set (SSOT: docs/workspace/cards.md, the
createable-kind taxonomy). Each is a small, uniform addition on the *same*
apply_response contract; the only per-kind variation is the card shape and
whether a `.tex` marker rides along:

  - sidecar-append, anchored (no .tex marker):  note · todo · report · report-request
  - sidecar-append, atom-bearing (.tex marker): footnote (\vfid) · citation (\vcid)
  - tex-only (sidecar is an app-derived shadow): example (\vexid + expex \ex…\xe)

The responder outputs (a suggestion proposal, a Revisions sibling comment) are
built here too — `--kind=suggestion|comment`, the proposal-family door (task
1044, `_create_proposal` below) — but they are the responder skills' calls,
outside the create-able ALL_KINDS set; the system/derived kinds
(ai, error, archive, bib, highlight) are not create-card targets either — see
docs/workspace/cards.md for the full reasoning and docs/architecture/
check-coherence.SKETCH.md Check 5 for the absent-panel allowlist.

Workflow A (a Task already exists — the UI-initiated path):
  create_card.py <docPath> <requestId> --kind=<k> [--body "<text>" | …]
    Anchor + safetyLevel are read from the request. A sidecar-only carded card
    (note/todo/report/report-request) is stamped with an `aiOriginRequestId`
    back-pointer to the Task (the editor's Accept/Reject/Redo affordance —
    AGENTS.md "Future work"). To answer a Task whose kind differs from the card
    kind (a `note` answering a `todo`), pass --accept-task-kind <taskKind>. A
    `virtual:<panel>:<cardId>` requestId (a pre-bridge card flag with no Task
    row) is a direct create against --anchor; the id flows through to clear the
    source card's aiRequest flag (no Task row is read or mutated).

Workflow B (chat-initiated — no pre-existing Task):
  create_card.py <docPath> --kind=<k> [--body "<text>" | …] --anchor <uuid> \
      [--safety-level N] [--task-text "<the user's ask>"]
    The Task is synthesized on the fly (apply_response --synthesize-task).
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import secrets
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import apply_response as AR
from bib_family import (
    cite_command_for,
    classify_cite_family,
    resolve_bib_family,
)
from _common import (
    is_dormant_link,
    is_virtual_request_id,
    parse_virtual_request_id,
    die,
    find_bib_file,
    find_paragraph_uuids,
    find_tex_file,
    is_request_open,
    is_terminal_status,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
    text_arg,
    title_fields,
)
from list_requests import _CardIndex, project_task_row

# ---------------------------------------------------------------------------
# The create-able CardKind set.
#
# SSOT: docs/workspace/cards.md (the createable-kind taxonomy). MUST stay a
# flat literal set — tools/check-coherence.mjs Check 5 regex-parses this exact
# `ALL_KINDS = { … }` literal and asserts every member is a real `CardKind`
# (src/panels/_shared/types.ts). The module-level assert below pins it to what
# this script actually implements, so the two can't drift.
# ---------------------------------------------------------------------------
ALL_KINDS = {"footnote", "citation", "note", "todo", "report", "report-request", "example"}

# example is tex-only (no card append); every other create-able kind appends a
# card to a PANEL_TO_SIDECAR panel. (Kept here so ALL_KINDS can't silently drift
# from the implemented dispatch.)
TEX_ONLY_KINDS = {"example"}


def _jsoncontent(body: str) -> dict:
    """Wrap plain body text as a Tiptap JSONContent doc (one paragraph)."""
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": body}]}],
    }


def _snippet(s: str | None, n: int = 60) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + "…"


# ---------------------------------------------------------------------------
# Id allocation
#
# .tex markers (\vfid \vcid \vexid \vxid) are 4-hex short ids; a sidecar card
# for an atom-bearing kind carries that same id (id equality *is* the Atom link
# — docs/workspace/identity.md). Anchored kinds (note/todo/report/…) carry a v4
# entity id with no .tex presence. Mint short ids collision-free against BOTH
# the sidecar ids and the markers already in the .tex.
# ---------------------------------------------------------------------------


def _sidecar_ids(doc: Path, panel: str) -> set[str]:
    filename, list_key = AR.ALL_CARD_SIDECARS[panel]
    st = read_json(sidecar(doc, filename), default={list_key: []})
    out: set[str] = set()
    if isinstance(st, dict):
        for c in st.get(list_key, []) or []:
            if isinstance(c, dict) and c.get("id"):
                out.add(c["id"])
    return out


def _gen_marker_id(doc: Path, macro: str | tuple[str, ...], used: set[str]) -> str:
    r"""A fresh 4-hex id colliding with neither `used` (existing sidecar ids +
    any ids allocated earlier this run) nor a `\<macro>{}` marker already in
    the .tex — for every macro named when `macro` is a tuple (a shared
    namespace, `_card_marker_namespace`)."""
    macros = (macro,) if isinstance(macro, str) else macro
    seen = set(used)
    try:
        tex = find_tex_file(doc).read_text(encoding="utf-8")
        for m in re.finditer(r"\\(?:" + "|".join(macros) + r")\{([0-9a-fA-F]{2,8})\}", tex):
            seen.add(m.group(1))
    except SystemExit:
        pass
    for _ in range(1000):
        cand = secrets.token_hex(2)  # 4 hex chars, matching the doc's f0ac/cc01 style
        if cand not in seen:
            return cand
    # A crowded namespace can defeat random draws while ids remain free; sweep
    # it before refusing, so "no free id" is a fact, not a bad run of luck.
    for i in range(0x10000):
        cand = f"{i:04x}"
        if cand not in seen:
            return cand
    die(f"could not allocate a free {'/'.join(macros)} id")
    return ""  # unreachable


def _card_marker_namespace(doc: Path) -> tuple[tuple[str, ...], set[str]]:
    r"""The ONE id namespace every marker-anchored CARD shares (task 1112):
    `\vfid` / `\vcid` / `\vexid` ids are card ids, and `card_by_id` resolves a
    card by id across every sidecar — so a footnote minted `ab12` while a
    citation already holds `ab12` makes that id name two cards. Returns
    (every card-marker macro, every id already held in their sidecars), for
    `_gen_marker_id`. Derived from `card_by_id.MARKER_ANCHORED_PANELS`, so a new
    marker-anchored panel joins the namespace with no edit here."""
    from card_by_id import MARKER_ANCHORED_PANELS

    used: set[str] = set()
    for panel in MARKER_ANCHORED_PANELS:
        used |= _sidecar_ids(doc, panel)
    return tuple(MARKER_ANCHORED_PANELS.values()), used


def _range_anchor_ids(doc: Path) -> set[str]:
    """Every `textRange.anchorId` any card sidecar already holds (the archive
    included) — a range id names one span, live or archived."""
    out: set[str] = set()

    def walk(n):
        if isinstance(n, dict):
            tr = n.get("textRange")
            if isinstance(tr, dict) and isinstance(tr.get("anchorId"), str):
                out.add(tr["anchorId"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    for filename in {f for f, _ in AR.ALL_CARD_SIDECARS.values()}:
        walk(read_json(sidecar(doc, filename), default={}))
    return out


def _gen_range_id(doc: Path) -> str:
    r"""A fresh `\vlid{}` range id (task 1197): the card-marker namespace with
    the range markers joined — collision-free against every card-marker id,
    every `\vlid`/`\vlidend` already in the .tex, and every range id a sidecar
    holds. The ONLY source of a range id; `apply_response.range_anchor` takes
    it as an argument and never mints one."""
    macros, used = _card_marker_namespace(doc)
    return _gen_marker_id(doc, macros + ("vlid", "vlidend"), used | _range_anchor_ids(doc))


# ---------------------------------------------------------------------------
# Shared anchor-link + sibling-comment builders (the anchored-card spine —
# docs/workspace/anchoring.md, Mode A textObject Link).
# ---------------------------------------------------------------------------


def _anchor_link(card_kind: str, card_id: str, anchor_uuid: str,
                 anchor_obj: dict | None = None) -> dict:
    """A Mode-A paragraph anchor: a `kind:"anchor"` textObject Link from the
    card to the anchor paragraph (src/links/_shared/types.ts) — or, given the
    anchor object `_resolve_anchor` settled (a Mode-B span from --range, task
    1197, or the source card's inherited anchor, task 1230), that object.

    NOTE (task 205): the anchor carries NO `margin: {side}`. Which side a
    card's margin chrome sits on is a live function of where its panel is
    docked, resolved at read time by `src/lib/margin-side.ts`; the app deleted
    the stored field along with its one reader, so writing it here would put a
    key on disk that nothing reads and that cannot be right after the user
    re-docks a panel."""
    return {
        "id": str(uuid.uuid4()),
        "kind": "anchor",
        "anchor": copy.deepcopy(anchor_obj) if anchor_obj else {
            "type": "textObject",
            "targetKind": "paragraph",
            "textObjectIds": [anchor_uuid],
        },
        "target": {"type": "card", "ref": {"kind": card_kind, "id": card_id}},
        "createdAt": now_iso(),
    }


def _comment_note_card(anchor_uuid: str, detail: str, label: str) -> dict:
    """A Level-2 sibling comment: a Virgil-authored note anchored to the same
    paragraph as the card just written, explaining what landed."""
    note_id = str(uuid.uuid4())
    return {
        "kind": "note",
        "id": note_id,
        # A supplied (non-blank) title → `titleAuto: False`, "keep, always".
        # This one is composed by Virgil rather than typed, but the bit is not
        # "who wrote it" — it is "may the loader DISCARD it?", and this title
        # is the card's only label. See `_common.title_fields`.
        **title_fields("note", f"Virgil added a {label}"),
        "content": _jsoncontent(f"Added a {label} here: {_snippet(detail, 80)}"),
        "createdAt": now_iso(),
        "aiRequest": False,
        "links": [_anchor_link("note", note_id, anchor_uuid)],
    }


def _require_body(a: argparse.Namespace, kind: str) -> str:
    if not a.body:
        die(f"--body <text> is required for --kind={kind} (content is composed upstream, not here)")
    return a.body  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Per-kind card/insert builders. Each returns a KindBuild; the generic carded
# flow (below) assembles the op and dispatches by safety level. The card shapes
# mirror src/lib/types.ts field-for-field (docs/workspace/sidecars.md).
# ---------------------------------------------------------------------------


@dataclass
class KindBuild:
    panel: str           # PANEL_TO_SIDECAR key the card is appended to
    card: dict           # the full card object to insert
    insert: str | None   # the .tex splice (atom marker), or None for sidecar-only
    result_id: str       # the card id to surface + use as the Task resultId
    id_key: str          # result-json alias for result_id (back-compat: footnoteId)
    summary: str         # one-line toast / synthesized-Task text
    comment_label: str   # noun used in the L2 sibling comment
    detail: str          # body snippet shown in the L2 sibling comment
    warnings: list[str] = field(default_factory=list)  # surfaced on the result json


def _build_footnote(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    r"""footnote — atom-bearing. id == \vfid marker (footnotes.json · footnotes,
    FootnoteRef {id, content, createdAt}; no links — the tie is id equality)."""
    body = _require_body(a, "footnote")
    fid = _gen_marker_id(doc, *_card_marker_namespace(doc))
    return KindBuild(
        panel="footnotes",
        card={"id": fid, "content": _jsoncontent(body), "createdAt": now_iso()},
        insert="\\vfid{" + fid + "}\\footnote{" + body + "}",
        result_id=fid,
        id_key="footnoteId",
        summary=f"Drafted footnote: {_snippet(body)}",
        comment_label="footnote",
        detail=body,
    )


def _build_citation(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    r"""citation — atom-bearing. id == \vcid marker (citations.json · citations,
    CitationRef {id, command, keys, createdAt}). The citekey(s) must already be
    in references.bib (adding a source is /editor/find-citation's job, not this
    mechanical primitive)."""
    keys = [k.strip() for k in (a.citekey or "").split(",") if k.strip()]
    if not keys:
        die("--citekey <key[,key2…]> is required for --kind=citation")
    _require_bib_keys(doc, keys)

    # The document's bib family is not this script's to choose. Ask the ONE
    # door (bib_family.py: stored `bibPackage` > live preamble load > live cite
    # usage > natbib) and take that family's TEXTUAL command as the default.
    # This used to be the literal `"citet"` — natbib-only, and UNDEFINED under
    # biblatex, so on a biblatex paper this line spliced a non-compiling command
    # straight into the user's `.tex` (task 464).
    family = resolve_bib_family(doc)
    warnings: list[str] = []
    if a.cite_command:
        cmd = a.cite_command.lstrip("\\")
        # An explicit --cite-command still WINS. A family-incompatible one is
        # WARNED, never rewritten — the app's locked decision for this exact
        # question (`reconcileBibFamily`: warn, never rewrite), so a caller who
        # means it can still say it.
        pinned = classify_cite_family(cmd)
        if pinned and pinned != family:
            warnings.append(
                f"\\{cmd} is {pinned}-only but this document resolves to {family}"
                f" — it will not compile here unless the preamble changes."
                f" ({family} textual: \\{cite_command_for(family)})"
            )
    else:
        cmd = cite_command_for(family, "textual")
    command = "\\" + cmd + "{" + ",".join(keys) + "}"
    cid = _gen_marker_id(doc, *_card_marker_namespace(doc))
    return KindBuild(
        panel="citations",
        card={"id": cid, "command": command, "keys": keys, "createdAt": now_iso()},
        insert="\\vcid{" + cid + "}" + command,
        result_id=cid,
        id_key="citationId",
        summary=f"Added citation {command}",
        comment_label="citation",
        detail=command,
        warnings=warnings,
    )


def _build_note(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    """note — anchored, sidecar-only. notes.json · cards, UserNote
    {kind:"note", id, title, titleAuto, content, createdAt, aiRequest, links}."""
    body = _require_body(a, "note")
    nid = str(uuid.uuid4())
    return KindBuild(
        panel="notes",
        card={
            "kind": "note",
            "id": nid,
            **title_fields("note", a.title),
            "content": _jsoncontent(body),
            "createdAt": now_iso(),
            "aiRequest": False,
            "links": [_anchor_link("note", nid, ctx.anchor, ctx.anchor_obj)],
        },
        insert=None,
        result_id=nid,
        id_key="cardId",
        summary=f"Added note: {_snippet(body)}",
        comment_label="note",
        detail=body,
    )


def _build_todo(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    """todo — anchored, sidecar-only. todos.json · items, TodoItem
    {id, text, titleAuto, notes, done, aiRequest, createdAt, links} (no `kind`
    field; for a todo the title-provenance bit governs the body `text`)."""
    body = _require_body(a, "todo")
    tid = str(uuid.uuid4())
    return KindBuild(
        panel="todos",
        card={
            "id": tid,
            # For a todo the "title" IS the body `text` (src/lib/types.ts), and
            # `--body` is required non-blank — so the bit always lands False and
            # the loader's demoted shape heuristic can never empty a body that
            # happens to read "Task 2".
            **title_fields("todo", body),
            "notes": a.notes or "",
            "done": False,
            "aiRequest": False,
            "createdAt": now_iso(),
            "links": [_anchor_link("todo", tid, ctx.anchor, ctx.anchor_obj)],
        },
        insert=None,
        result_id=tid,
        id_key="cardId",
        summary=f"Added todo: {_snippet(body)}",
        comment_label="todo",
        detail=body,
    )


def _build_report(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    """report — anchored, sidecar-only, polymorphic (on-disk kind:"report").
    reports.json · cards, ReportCard {kind, id, createdAt, author, title,
    titleAuto, text, content, selectedText?, links}. A skill-authored report is
    author="ai"."""
    body = _require_body(a, "report")
    author = a.author or "ai"
    if author not in ("human", "ai"):
        die("--author must be 'human' or 'ai'")
    rid = str(uuid.uuid4())
    return KindBuild(
        panel="reports",
        card={
            "kind": "report",
            "id": rid,
            "createdAt": now_iso(),
            "author": author,
            **title_fields("report", a.title),
            "text": body,
            "content": _jsoncontent(body),
            "selectedText": ctx.selected_text or ctx.range_text or "",
            "links": [_anchor_link("report", rid, ctx.anchor, ctx.anchor_obj)],
        },
        insert=None,
        result_id=rid,
        id_key="cardId",
        summary=f"Drafted report: {_snippet(a.title or body)}",
        comment_label="report",
        detail=a.title or body,
    )


def _build_report_request(doc: Path, a: argparse.Namespace, ctx: "Ctx") -> KindBuild:
    """report-request — anchored, sidecar-only, polymorphic (on-disk
    kind:"report-request"). Same reports.json · cards file as `report`, told
    apart only by the on-disk `kind` discriminator (the two-taxonomy rule,
    docs/workspace/cards.md). ReportRequestCard {kind, id, createdAt, text,
    content, aiRequest, selectedText?, links}."""
    body = _require_body(a, "report-request")
    rid = str(uuid.uuid4())
    return KindBuild(
        panel="reports",
        card={
            "kind": "report-request",
            "id": rid,
            "createdAt": now_iso(),
            "text": body,
            "content": _jsoncontent(body),
            "aiRequest": bool(a.ai_request),
            "selectedText": ctx.selected_text or ctx.range_text or "",
            "links": [_anchor_link("report-request", rid, ctx.anchor, ctx.anchor_obj)],
        },
        insert=None,
        result_id=rid,
        id_key="cardId",
        summary=f"Filed report request: {_snippet(body)}",
        comment_label="report request",
        detail=body,
    )


CARDED_BUILDERS = {
    "footnote": _build_footnote,
    "citation": _build_citation,
    "note": _build_note,
    "todo": _build_todo,
    "report": _build_report,
    "report-request": _build_report_request,
}

# AiRequestKind (src/lib/types.ts) to stamp on a synthesized Task / assert on a
# Workflow-A Task. report-request has no native AiRequestKind — it bridges to a
# `report` Task (docs/workspace/cards.md → the Reports panel), so it remaps.
TASK_KIND = {
    "footnote": "footnote",
    "citation": "citation",
    "note": "note",
    "todo": "todo",
    "report": "report",
    "report-request": "report",
}

# Workflow-A: the Task `kind`(s) this create-card kind may drain. A 1:1 native
# AiRequestKind asserts strictly; report-request has none of its own (it is
# chiefly a Workflow-B / direct kind), so it skips the assertion.
WORKFLOW_A_KINDS = {
    "footnote": {"footnote"},
    "citation": {"citation"},
    "note": {"note"},
    "todo": {"todo"},
    "report": {"report"},
    "report-request": set(),
}

# A Task flagged ON an existing card is an act-on-existing ask, and for these
# carded kinds that means REVISE, never CREATE: a footnote / citation is an
# id-equality atom in the .tex, so a create here splices a SECOND
# \vfid{}\footnote{} (or cite) beside the one the user flagged and drains the
# Task as answered (task 1048). Map: carded kind -> the source panel whose link
# makes it a revise, and the door that revises. Deliberately absent: note
# (answer-note-request's sibling note IS the answer), todo / report /
# report-request (their responders answer a flagged card with a NEW card of a
# different shape). The check reads the Task's `linkedTo` or the virtual id's
# panel — the same derivation _create_proposal makes (task 1044).
REVISE_NOT_CREATE = {
    "footnote": ("footnotes", "/editor/draft-footnote branch E (/editor/edit-card <cardId> --body, "
                              "which keeps the .tex \\footnote{} in sync and drains this Task)"),
    "citation": ("citations", "/editor/find-citation (a citation card is coupled to its .tex cite "
                              "and references.bib; it is revised there, never re-cited)"),
}
assert {panel for panel, _ in REVISE_NOT_CREATE.values()} <= AR.ATOM_BEARING_PANELS, \
    "REVISE_NOT_CREATE names a non-atom panel — a sibling card there is a legitimate answer"


def _refuse_create_on_flagged_card(kind: str, request_id: str | None, linked: dict | None) -> None:
    """Refuse a carded create that would duplicate the card the Task is flagged on."""
    rule = REVISE_NOT_CREATE.get(kind)
    if rule is None or not isinstance(linked, dict):
        return
    panel, door = rule
    if linked.get("panel") == panel:
        die(f"request {request_id} is flagged ON an existing {kind} "
            f"({panel}:{linked.get('cardId')}) — it asks to REVISE that card, and "
            f"create-card --kind={kind} would add a duplicate. Use {door}.")


# Pin ALL_KINDS to what this script actually dispatches (carded + tex-only), so
# the coherence-checked literal can't drift from the implementation.
assert ALL_KINDS == set(CARDED_BUILDERS) | TEX_ONLY_KINDS, "ALL_KINDS drifted from the implemented dispatch"


# ---------------------------------------------------------------------------
# Shared Workflow A/B context resolution + anchor validation.
# ---------------------------------------------------------------------------


@dataclass
class Ctx:
    request_id: str | None
    anchor: str
    safety: int | None
    selected_text: str | None
    synthesize: bool
    is_virtual: bool = False
    request: dict | None = None  # the Workflow-A ai-requests.json row, when one was read
    request_text: str | None = None  # …and its LIVE ask (`project_task_row`, task 1232)
    stored_para: str | None = None   # …and the row's STORED paragraphIds[0] (a snapshot)
    linked: dict | None = None   # the source card {panel, cardId} the Task answers, if any
    range_anchor: dict | None = None  # the Mode-B anchor object, when --range pins a span
    range_edit: dict | None = None    # …and its wrap-span `.tex` edit (op.anchorEdit)
    range_text: str | None = None     # …and the span's reading text (its snapshot)
    anchor_obj: dict | None = None    # the card's resolved anchor object (`_resolve_anchor`)


def _resolve_context(doc: Path, a: argparse.Namespace, *, accept_task_kinds: set[str]) -> "Ctx | dict":
    """Resolve the anchor / safety level / selection / Task identity for a create.

    The ONE resolver both create paths (carded and proposal) run, so the three
    questions every create must answer are asked once, whatever the flags
    (task 1110):

      1. Is this Task flagged ON an atom card it must REVISE, not duplicate?
         (`_refuse_create_on_flagged_card`, task 1048) — asked of the Task's
         `linkedTo` or the virtual id's {panel, cardId}, with or without
         --synthesize.
      2. Is the Task already answered? A terminal row, OR an L3 proposal that
         already landed its card (`in-progress` + `resultId` — the ONE
         `is_request_open` predicate the drain uses) returns the idempotent
         no-op naming that card; a re-run never lands a second answer.
      3. Which Task id does the card point back at? A synthesized Task's id is
         minted HERE, so the card's `aiOriginRequestId` and the row
         apply_response appends are the same id (never a virtual id on the
         card and a fresh one on the row).

    Workflow A (a real requestId): read anchor / safety / selection off the
    Task. A virtual card-flag id (`virtual:<panel>:<cardId>`): a direct reply to
    that card, or — with --synthesize — a fresh Task linked to it. Workflow B
    (no requestId): synthesize; --anchor is required. --synthesize with a REAL
    id is refused: that Task already has a row, and synthesizing would append a
    second row with the same id."""
    request_id = a.request
    anchor = a.anchor
    safety = a.safety_level
    synthesize = bool(a.synthesize)

    # A virtual card-flag id (virtual:<panel>:<cardId>) — a pre-bridge flag with
    # no ai-requests.json Task to read (list_requests.py emits these for papers
    # created before the bridge landed). It's a create against the source card's
    # own paragraph: the anchor comes from --anchor (the responder resolves it
    # from the source card). Without --synthesize the virtual id flows to
    # apply_response, which splits it into {panel, cardId} to clear the source
    # card's aiRequest flag (no Task row is mutated). With --synthesize a fresh
    # Task is minted and LINKED to the source card, which lowers the same flag.
    if is_virtual_request_id(request_id):
        linked = parse_virtual_request_id(request_id)  # dies on a malformed / unknown-panel id
        _refuse_create_on_flagged_card(a.kind, request_id, linked)
        if not anchor:
            die("--anchor <uuid> is required for a virtual (card-flag) request id "
                "(resolve it from the source card)")
        if not synthesize:
            return Ctx(request_id=request_id, anchor=anchor, safety=safety,
                       selected_text=None, synthesize=False, is_virtual=True, linked=linked)
        return Ctx(request_id=AR._gen_request_id(), anchor=anchor, safety=safety,
                   selected_text=None, synthesize=True, linked=linked)

    if request_id and synthesize:
        die(f"--synthesize with an existing request id ({request_id}) — that Task already has "
            "a row; synthesizing would append a second row with the same id. Drop --synthesize "
            "to answer it, or drop the id to synthesize a fresh Task.")

    if not request_id:
        if not anchor:
            die("--anchor <uuid> is required when there is no existing request")
        return Ctx(request_id=AR._gen_request_id(), anchor=anchor, safety=safety,
                   selected_text=None, synthesize=True)

    ar = read_json(sidecar(doc, "ai-requests.json"), default={"requests": []})
    reqs = ar.get("requests", []) if isinstance(ar, dict) else []
    req = next((r for r in reqs if r.get("id") == request_id), None)
    if req is None:
        die(f"request id not found: {request_id}")
    if accept_task_kinds and req.get("kind") not in accept_task_kinds:
        die(f"request {request_id} is kind={req.get('kind')!r}, not {a.kind} "
            f"(expected one of {sorted(accept_task_kinds)})")
    if is_terminal_status(req.get("status")):
        return {"ok": True, "noop": True, "reason": "request already terminal", "requestId": request_id}
    if not is_request_open(req):  # an L3 proposal whose card already landed
        return {"ok": True, "noop": True, "reason": "request already answered",
                "requestId": request_id, "cardId": req.get("resultId")}
    linked = req.get("linkedTo") if isinstance(req.get("linkedTo"), dict) else None
    _refuse_create_on_flagged_card(a.kind, request_id, linked)
    # The Task as the DRAIN shows it — text / paragraphIds / selectedText read
    # through the linked card, not the bridge-time snapshot (task 1232) — so
    # the ask a proposal stamps and the paragraph it lands at are the ones the
    # responder was handed.
    live = project_task_row(_CardIndex(doc), req)
    if not anchor:
        pids = live["paragraphIds"]
        if not pids:
            die("request has no paragraphIds; cannot anchor the card (pass --anchor)")
        anchor = pids[0]
    if safety is None and req.get("safetyLevel") is not None:
        safety = req.get("safetyLevel")
    stored = req.get("paragraphIds") or []
    return Ctx(request_id=request_id, anchor=anchor, safety=safety,
               selected_text=live["selectedText"], synthesize=False,
               request=req, request_text=live["text"],
               stored_para=stored[0] if stored else None, linked=linked)


# The kinds a span can pin (task 1197): every sidecar-anchored card the app can
# itself anchor to a range (`LinkedAnchorKind`, src/links/links.ts) — and the
# responder proposals. An atom (footnote / citation) is placed by its marker
# and an example is a block, so neither takes one.
RANGE_KINDS = {"note", "todo", "report", "report-request"} | {"suggestion", "comment"}


def _resolve_range(doc: Path, a: argparse.Namespace, anchor: str, ctx: "Ctx") -> None:
    r"""`--range` → a Mode-B anchor on `ctx` (task 1197), through the contract's
    one primitive (`apply_response.range_anchor`: locate + refuse + build), with
    the id from the one allocator (`_gen_range_id`). No --range → Mode A,
    untouched."""
    if a.range is None:
        if a.range_occurrence is not None:
            die("--range-occurrence needs --range")
        return
    if a.kind not in RANGE_KINDS:
        die(f"--range does not apply to --kind={a.kind}: it pins a margin card to a span "
            f"(one of {sorted(RANGE_KINDS)}); an atom or block is placed by its own marker")
    tex = find_tex_file(doc).read_text(encoding="utf-8")
    AR.locate_range_span(tex, anchor, a.range, a.range_occurrence)  # refuse before allocating
    rid = _gen_range_id(doc)
    ctx.range_anchor, ctx.range_edit = AR.range_anchor(tex, anchor, a.range, a.range_occurrence, rid)
    ctx.range_text = ctx.range_anchor["textRange"]["textSnapshot"]


def _resolve_anchor(doc: Path, a: argparse.Namespace, ctx: "Ctx", explicit_anchor: str | None) -> None:
    r"""WHERE the card lands — the ONE anchor rule both create paths (carded and
    proposal) read, so "a Task already filed on a selection keeps its span" is
    true for every answer, not just a proposal (task 1230). Sets
    `ctx.anchor_obj` (the link's anchor object) and `ctx.anchor` (its paragraph).

      1. `--range` pins THIS card to the span it names (task 1197) — at
         `--anchor`, else the source card's paragraph, else the Task's. The
         caller chose the words, so it wins the inheritance.
      2. Else, a Task linked to a source card (`linkedTo` / a virtual id) whose
         caller did not aim elsewhere (no `--anchor`, or `--anchor` = the
         source's own paragraph) INHERITS the source's first live anchor
         verbatim — Mode A, or Mode B sharing its `textRange.anchorId`. A shared
         range is a second claim on a pair already in the .tex (the app keeps a
         span marked while ANY live card holds its id), so nothing is wrapped and
         the .tex is byte-unchanged. A Mode-B anchor degrades to Mode A at the
         same paragraph when this kind cannot hold a span (`RANGE_KINDS`). A
         dormant (archived) link is never inherited (`_first_anchor`).
      3. Else Mode A at the resolved paragraph."""
    src_anchor = _first_anchor(_source_card(doc, ctx.linked))
    src_para = src_anchor["textObjectIds"][0] if src_anchor else None
    # "Did the caller aim elsewhere?" — not when `--anchor` names the Task's OWN
    # paragraph: the source card's live one, or the row's stored snapshot of it
    # (a responder handed a pre-move row; task 1232). Either way the Task meant
    # its card, and the card now lives at `src_para`.
    own = {p for p in (src_para, ctx.stored_para) if p}
    if a.range is not None:
        if explicit_anchor in own and src_para:
            explicit_anchor = src_para
        anchor_uuid = explicit_anchor or src_para or ctx.anchor
        _require_anchor(doc, anchor_uuid)
        _resolve_range(doc, a, anchor_uuid, ctx)
        anchor_obj = ctx.range_anchor
    elif src_anchor and (not explicit_anchor or explicit_anchor in own):
        anchor_obj = {k: v for k, v in copy.deepcopy(src_anchor).items() if k != "margin"}
        if anchor_obj.get("targetKind") == "linkedRange" or anchor_obj.get("textRange"):
            if a.kind in RANGE_KINDS:
                ctx.range_text = (anchor_obj.get("textRange") or {}).get("textSnapshot")
            else:
                anchor_obj = {"type": "textObject", "targetKind": "paragraph", "textObjectIds": [src_para]}
    else:
        anchor_obj = {"type": "textObject", "targetKind": "paragraph", "textObjectIds": [ctx.anchor]}
    ctx.anchor_obj = anchor_obj
    ctx.anchor = anchor_obj["textObjectIds"][0]
    _require_anchor(doc, ctx.anchor)


def _require_anchor(doc: Path, anchor: str) -> None:
    """The paragraph UUID must exist in the .tex (refuse rather than guess)."""
    tex = find_tex_file(doc).read_text(encoding="utf-8")
    known = {u["uuid"] for u in find_paragraph_uuids(tex)}
    if anchor not in known:
        die(f"anchor paragraph not found in .tex: %!v:{anchor}")


def _require_bib_keys(doc: Path, keys: list[str]) -> None:
    """A citation's key(s) must already be in references.bib — don't fabricate a
    cite for a missing entry (that's /editor/find-citation's job)."""
    bib = find_bib_file(doc)
    if bib is None:
        die("no references.bib found — add the entry first (see /editor/find-citation)")
    text = bib.read_text(encoding="utf-8", errors="replace")
    present = set(re.findall(r"@\w+\s*\{\s*([^,\s]+)", text))
    missing = [k for k in keys if k not in present]
    if missing:
        die(f"citekey(s) not in {bib.name}: {', '.join(missing)} — add them first "
            f"(don't fabricate a cite for a missing entry; see /editor/find-citation)")


# ---------------------------------------------------------------------------
# The generic carded create (footnote / citation / note / todo / report /
# report-request) — one flow, the card shape is the only per-kind variation.
# ---------------------------------------------------------------------------


def _create_carded(doc: Path, a: argparse.Namespace) -> dict:
    # A cross-kind answer: a responder draining one Task kind by emitting a
    # *different* card kind (answer-todo-request answers a `todo` Task with a
    # `note`). The responder declares the extra Task kind(s) it may drain via
    # --accept-task-kind; the default 1:1 set (WORKFLOW_A_KINDS) still applies to
    # plain create-card. No effect on a virtual or synthesized Task (neither
    # reads the kind off an existing ai-requests.json row).
    accept = set(WORKFLOW_A_KINDS.get(a.kind, set()))
    accept |= {k for k in (a.accept_task_kind or [])}
    ctx = _resolve_context(doc, a, accept_task_kinds=accept)
    if isinstance(ctx, dict):  # already-terminal / already-answered Task → idempotent no-op
        return ctx
    _resolve_anchor(doc, a, ctx, a.anchor)

    build = CARDED_BUILDERS[a.kind](doc, a, ctx)

    # Tie a result card back to the Task it answers, so the editor can surface
    # Accept / Reject / Redo (the aiOriginRequestId affordance — editor/AGENTS.md
    # "Future work"). Stamped uniformly here rather than per-skill: every
    # sidecar-only carded kind (note / todo / report / report-request —
    # build.insert is None) created from a *real* Task — an existing one, or one
    # synthesized here (its id was minted by _resolve_context, so the row
    # apply_response appends carries the SAME id) — carries the back-pointer.
    # Atom-bearing kinds (footnote / citation) are id-equality atoms whose refs
    # carry no such field, so they're excluded; a virtual card-flag id has no
    # ai-requests.json Task to point back at, so it's excluded too.
    if ctx.request_id and not ctx.is_virtual and build.insert is None:
        build.card["aiOriginRequestId"] = ctx.request_id
    if ctx.range_text:
        build.summary += f" (pinned to «{_snippet(ctx.range_text, 40)}»)"

    op: dict = {
        "panel": build.panel,
        "card": build.card,
        "summary": build.summary,
    }
    if build.insert:
        op["texEdit"] = {
            "anchorUuid": ctx.anchor,
            "insert": build.insert,
            "mode": "after-selected" if ctx.selected_text else "end-of-paragraph",
        }
        if ctx.selected_text:
            op["texEdit"]["selectedText"] = ctx.selected_text
    if ctx.range_edit:
        op["anchorEdit"] = ctx.range_edit
    if ctx.request_id:
        op["requestId"] = ctx.request_id
    if ctx.synthesize:
        if ctx.linked:  # a Task synthesized over a card flag answers THAT card
            op["linkedTo"] = ctx.linked
        op["kind"] = TASK_KIND[a.kind]
        op["text"] = a.task_text or build.summary
        op["paragraphIds"] = [ctx.anchor]
        if ctx.selected_text:
            op["selectedText"] = ctx.selected_text
        if ctx.safety is not None:
            op["safetyLevel"] = ctx.safety
    if ctx.safety == 2:
        op["comment"] = {
            "panel": "notes",
            "card": _comment_note_card(ctx.anchor, build.detail, build.comment_label),
        }

    # Safety level → subcommand. No level ⇒ a direct create the user opted into.
    if ctx.safety is None:
        sub, propose = "complete-task", False
    else:
        sub = AR.SAFETY_LEVEL_SUBCOMMAND[ctx.safety]
        propose = ctx.safety == 3

    result = AR.run_write_subcommand(doc, sub, op, propose=propose, synthesize=ctx.synthesize)
    result["cardId"] = build.result_id
    result[build.id_key] = build.result_id
    result["subcommand"] = sub
    if build.warnings:
        result["warnings"] = build.warnings
    return result


# ---------------------------------------------------------------------------
# The PROPOSAL family — a responder's suggestion card, and the revision thread's
# sibling comment (task 1044).
#
# These are responder OUTPUTS, not create-able CardKinds (docs/workspace/
# cards.md), so they sit OUTSIDE the coherence-checked ALL_KINDS literal: the
# `--kind` tokens are the on-disk RECORD kinds (`suggestion`, `comment`), and the
# spine kind (revision-/cutter-suggestion, revision-comment) is the PANEL's call,
# which this door derives from the Task rather than taking from the caller.
#
# Before this door, five responder skills each made the model hand-assemble the
# card JSON (ids, timestamps, the self-link, the anchor copy, original_text) and
# pass it to `complete-task --propose` — a schema stated at five callers (task
# 783 had to re-stamp the self-link kind four of them wrote wrong), the panel
# chosen by prose ("unconditionally revisions"), and original_text first checked
# at ACCEPT. Now the caller supplies only the three texts; everything else is
# minted or derived here, and the write door (`_guard_proposal_landing`) refuses
# a proposal its own accept would refuse before any byte lands.
# ---------------------------------------------------------------------------

RESPONDER_KINDS = {"suggestion", "comment"}
assert not (RESPONDER_KINDS & ALL_KINDS), "a responder record kind is not a create-able CardKind"

# The Task kinds a proposal may drain without --accept-task-kind. Both answer a
# `suggestion` Task natively (unbridged, or bridged from a Cutter/Revisions
# comment); a cross-kind answer (a suggestion answering a note/todo/report Task)
# declares itself with --accept-task-kind, exactly like a carded create.
RESPONDER_TASK_KINDS = {"suggestion": {"suggestion"}, "comment": {"suggestion"}}


def _source_card(doc: Path, linked: dict | None) -> dict | None:
    """The card the Task was bridged from (`linkedTo`, or a virtual id's
    {panel, cardId}) — the user's own comment/note/todo — or None."""
    if not isinstance(linked, dict) or not linked.get("cardId"):
        return None
    from card_by_id import find_card

    # The bridge names the source card's panel — the qualifier that keeps a
    # footnote and a citation sharing a 4-hex id apart (task 1112).
    panel = linked.get("panel")
    hit = find_card(doc, linked["cardId"], panel if panel in AR.ALL_CARD_SIDECARS else None)
    return hit.card if hit is not None else None


def _first_anchor(card: dict | None) -> dict | None:
    """A card's first LIVE textObject anchor (Mode A, or Mode B with its
    `textRange`), or None. A dormant link (task 1193 — the card's claim on
    ARCHIVED text) is skipped: it names no paragraph in the live .tex."""
    for link in (card or {}).get("links") or []:
        if not isinstance(link, dict) or is_dormant_link(link):
            continue
        anchor = link.get("anchor")
        if isinstance(anchor, dict) and anchor.get("textObjectIds"):
            return anchor
    return None


def _plain_text(card: dict | None) -> str:
    """A source card's plain text: its `text` mirror, else its rich content's
    text nodes."""
    if not card:
        return ""
    if isinstance(card.get("text"), str) and card["text"].strip():
        return card["text"]
    out: list[str] = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text" and isinstance(n.get("text"), str):
                out.append(n["text"])
            for c in n.get("content") or []:
                walk(c)

    walk(card.get("content"))
    return "".join(out)


def _create_proposal(doc: Path, a: argparse.Namespace) -> dict:
    kind = a.kind
    if kind == "suggestion":
        if a.original is None or a.suggested is None:
            die("--kind=suggestion requires --original <verbatim span> and --suggested <replacement> "
                "(both @<path>; --suggested may be empty only for a Cutter cut)")
    elif not a.body:
        die("--kind=comment requires --body <reply> (@<path>)")

    if is_virtual_request_id(a.request) and not a.anchor:
        # the virtual path needs an anchor; the source card names its own
        # paragraph — and `_resolve_anchor` then inherits its anchor whole
        src_anchor = _first_anchor(_source_card(doc, parse_virtual_request_id(a.request)))
        if src_anchor:
            a.anchor = src_anchor["textObjectIds"][0]

    accept = set(RESPONDER_TASK_KINDS[kind]) | set(a.accept_task_kind or [])
    ctx = _resolve_context(doc, a, accept_task_kinds=accept)
    if isinstance(ctx, dict):  # already-terminal / already-answered Task → idempotent no-op
        return ctx
    linked = ctx.linked
    source = _source_card(doc, linked)
    linked_panel = (linked or {}).get("panel")

    # The panel is the Task's, not the caller's: a Cutter thread's answer goes
    # to cutter.json, everything else to revisions.json.
    if kind == "suggestion":
        panel = "cutter" if linked_panel == "cutter" else "revisions"
    else:
        if linked_panel != "revisions":
            die("--kind=comment is the Revisions thread's sibling reply; this Task is not "
                f"bridged from a Revisions card (linkedTo.panel={linked_panel!r})")
        panel = "revisions"

    # The anchor: the one rule every create reads (`_resolve_anchor`, task 1230).
    # A suggestion's span must still contain the words it rewrites, else the
    # range markers split original_text and accept would refuse it as stale.
    if a.range is not None and kind == "suggestion" and a.original and a.original not in a.range:
        die("--range must contain --original: the span a suggestion rewrites sits inside "
            "the words it is pinned to (else the range markers split original_text and "
            "accept would refuse it as stale)")
    _resolve_anchor(doc, a, ctx, a.anchor)
    anchor_obj, anchor_uuid = ctx.anchor_obj, ctx.anchor

    # Idempotency: a real Task's proposal already on disk is THE answer. The
    # resolver already no-ops a Task whose resultId landed; this catches a
    # proposal whose back-pointer names the Task but whose row lost resultId.
    if ctx.request is not None:
        prior = next((c for c in _panel_cards(doc, panel)
                      if c.get("aiOriginRequestId") == ctx.request_id), None)
        if prior is not None:
            return {"ok": True, "noop": True, "reason": "request already answered",
                    "requestId": ctx.request_id, "cardId": prior.get("id"), "panel": panel}

    # A synthesized Task's id was minted by the resolver, so the card points back at it.
    request_id = ctx.request_id
    if ctx.request is not None:
        instructions = ctx.request_text or ""
    elif ctx.is_virtual:
        instructions = _plain_text(source)
    else:
        instructions = a.task_text or _plain_text(source)
    selected = ctx.selected_text or ctx.range_text or (source or {}).get("selectedText") or ""

    cid = str(uuid.uuid4())
    link = _anchor_link(kind, cid, anchor_uuid)  # ref.kind is re-stamped by the write door
    link["anchor"] = anchor_obj
    if kind == "suggestion":
        card: dict = {
            "kind": "suggestion",
            "id": cid,
            "createdAt": now_iso(),
            "author": "ai",
            "original_text": a.original,
            "suggested_text": a.suggested,
            "explanation": a.explanation or "",
            "user_text": "",
            "instructions": instructions,
            "status": "pending",
        }
        if selected:
            card["selectedText"] = selected
        noun = "cut suggestion" if panel == "cutter" else "suggestion"
        summary = f"Drafted a {noun}: {_snippet(a.explanation or a.suggested)}"
    else:
        card = {
            "kind": "comment",
            "id": cid,
            "createdAt": now_iso(),
            "text": a.body,
            "content": _jsoncontent(a.body),
            "aiRequest": False,
        }
        summary = f"Replied on the revision thread: {_snippet(a.body)}"
    card["links"] = [link]
    if request_id and not ctx.is_virtual:
        card["aiOriginRequestId"] = request_id

    op: dict = {"panel": panel, "card": card, "summary": summary, "clearSourceFlag": True}
    if ctx.range_edit:
        op["anchorEdit"] = ctx.range_edit
    if request_id:
        op["requestId"] = request_id
    if ctx.synthesize:
        if ctx.linked:
            op["linkedTo"] = ctx.linked
        op["kind"] = "suggestion"
        op["text"] = a.task_text or summary
        op["paragraphIds"] = [anchor_uuid]
        if ctx.selected_text:
            op["selectedText"] = ctx.selected_text
        op["safetyLevel"] = 3 if kind == "suggestion" else (ctx.safety or None)
        if op["safetyLevel"] is None:
            op.pop("safetyLevel")

    # A suggestion is ALWAYS an L3 proposal (the .tex waits for accept); a
    # sibling comment is a terminal direct create. The Task's safetyLevel picks
    # nothing here.
    propose = kind == "suggestion"
    result = AR.run_write_subcommand(doc, "complete-task", op, propose=propose,
                                     synthesize=ctx.synthesize)
    result["cardId"] = cid
    result["panel"] = panel
    result["subcommand"] = "complete-task --propose" if propose else "complete-task"
    return result


def _panel_cards(doc: Path, panel: str) -> list[dict]:
    filename, list_key = AR.ALL_CARD_SIDECARS[panel]
    st = read_json(sidecar(doc, filename), default={list_key: []})
    cards = st.get(list_key, []) if isinstance(st, dict) else []
    return [c for c in cards if isinstance(c, dict)]


# ---------------------------------------------------------------------------
# example — the one tex-only kind.
#
# An example *is* a TextObject in the .tex (expex `\vexid{}\ex…\xe`, or `\pex`
# with `\vxid{}\a` rows), and since task 726 it is the ONLY representation: the
# app neither reads nor writes examples.json (that sidecar is retired — see
# `legacy` in src/lib/sidecar-value.ts), so the skill writes ONLY the .tex — no
# card append, and `examples` is intentionally absent from
# apply_response.PANEL_TO_SIDECAR. example has no Task lifecycle
# (docs/workspace/cards.md → lifecycle "none"), so the splice rides the
# contract's virtual-requestId path and synthesizes no Task.
#
# A block-level TextObject lands *after* the anchor paragraph through the
# contract's dedicated `after-paragraph` texEdit mode (task 613 — it used to
# borrow `after-selected` with the marker as the "selection", which broke once
# that mode searched only live paragraph text). A Task-less tex-only
# subcommand would still be the cleaner long-term shape.
# ---------------------------------------------------------------------------


def _create_example(doc: Path, a: argparse.Namespace) -> dict:
    body = a.body
    items = a.item or []
    if not body and not items:
        die("--body <text> (or one or more --item <row>) is required for --kind=example")
    if a.request:
        die("--kind=example is created directly (Task-less — cards.md lifecycle 'none'); "
            "pass --anchor, not a requestId")
    if a.safety_level is not None:
        die("--kind=example is a direct tex-only create; safety levels (which gate card "
            "lifecycle) don't apply — omit --safety-level")
    if a.range is not None:
        die("--range does not apply to --kind=example: an example is a block, placed after "
            "the paragraph")
    anchor = a.anchor
    if not anchor:
        die("--anchor <uuid> is required for --kind=example")
    _require_anchor(doc, anchor)

    exid = _gen_marker_id(doc, *_card_marker_namespace(doc))
    label = ("\\label{" + a.label + "}") if a.label else ""
    if items:
        allocated: set[str] = set()
        rows = []
        for row in items:
            xid = _gen_marker_id(doc, "vxid", allocated)
            allocated.add(xid)
            rows.append("\\vxid{" + xid + "}\\a " + row)
        block = "\\vexid{" + exid + "}\\pex" + label + "\n" + "\n".join(rows) + "\n\\xe"
    else:
        block = "\\vexid{" + exid + "}\\ex" + label + "\n" + body + "\n\\xe"
    insert = "\n\n" + block

    op = {
        "requestId": f"virtual:examples:{exid}",  # virtual → no Task synthesized
        "texEdit": {
            "anchorUuid": anchor,
            "insert": insert,
            "mode": "after-paragraph",  # land the block AFTER the paragraph marker
        },
        "summary": f"Inserted example {a.label or exid}",
        "clearSourceFlag": False,
    }
    result = AR.run_write_subcommand(doc, "complete-task", op, propose=False, synthesize=False)
    result["cardId"] = exid
    result["exampleId"] = exid
    result["subcommand"] = "complete-task"
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="create_card.py")
    p.add_argument("doc")
    p.add_argument("request", nargs="?", help="requestId (Workflow A); omit for chat-initiated")
    p.add_argument("--kind", required=True)
    # Every FREE-TEXT flag (--body/--task-text/--title/--notes/--item) takes
    # `@<path>` (task 815, `_common.text_arg`): a skill writes the prose through
    # a quoted heredoc to $TMPDIR scratch, because inside a double-quoted argv
    # bash eats ``quotes'' and $math$ silently — and a footnote body is spliced
    # straight into the .tex. editor/skills/_op-json.md states the rule.
    p.add_argument("--body", type=text_arg,
                   help="card body / example text (user/chat supplied); @<path> reads a file")
    p.add_argument("--anchor", help="paragraph UUID to anchor at (required for the chat path)")
    p.add_argument("--range", type=text_arg,
                   help="pin the card to this span of the anchor paragraph — VERBATIM source text "
                        "(a Mode-B text-range anchor: \\vlid…\\vlidend in the .tex); @<path> reads a file")
    p.add_argument("--range-occurrence", type=int, dest="range_occurrence",
                   help="which occurrence of --range (1-based) when the span repeats in the paragraph")
    p.add_argument("--safety-level", type=int, choices=[1, 2, 3], dest="safety_level")
    p.add_argument("--synthesize", action="store_true", help="synthesize the Task (chat path)")
    p.add_argument("--task-text", dest="task_text", type=text_arg,
                   help="the user's ask, recorded on a synthesized Task; @<path> reads a file")
    p.add_argument("--accept-task-kind", action="append", dest="accept_task_kind",
                   help="extra Task kind(s) a Workflow-A create may drain (cross-kind answer, "
                        "e.g. a `note` answering a `todo` Task). Repeatable.")
    # Accepted but IGNORED since task 205 — kept only so an agent running a
    # stale skill bundle doesn't crash on an unrecognized flag. The margin side
    # is no longer storable: it is resolved live from the owning panel's dock
    # (src/lib/margin-side.ts), so there is nothing for this to set.
    p.add_argument(
        "--margin",
        choices=["left", "right"],
        default=None,
        help="(deprecated, ignored) the margin side now follows the panel dock",
    )
    # note / report
    p.add_argument("--title", type=text_arg, help="card title (note, report); @<path> reads a file")
    # todo
    p.add_argument("--notes", type=text_arg, help="secondary notes field (todo); @<path> reads a file")
    # report
    p.add_argument("--author", help="report author: human | ai (default ai)")
    # report-request
    p.add_argument("--ai-request", action="store_true", dest="ai_request",
                   help="set the report-request's aiRequest flag (default off)")
    # citation
    p.add_argument("--citekey", help="bib key(s), comma-separated (citation)")
    p.add_argument("--cite-command", dest="cite_command", help="cite command name, e.g. citet/citep; DEFAULTS from the document's bib family (bib_family.py) — citet under natbib, textcite under biblatex")
    # example
    p.add_argument("--label", help="\\label{} for an example block")
    p.add_argument("--item", action="append", type=text_arg,
                   help="an example row (repeatable → \\pex/\\a list); @<path> reads a file")
    # suggestion (the proposal family — task 1044)
    p.add_argument("--original", type=text_arg,
                   help="suggestion: the span to replace, VERBATIM from the anchored paragraph "
                        "(never the %%!v: marker); @<path> reads a file")
    p.add_argument("--suggested", type=text_arg,
                   help="suggestion: the replacement (empty only for a Cutter cut); @<path> reads a file")
    p.add_argument("--explanation", type=text_arg,
                   help="suggestion: one or two sentences on what changed and why; @<path> reads a file")
    a = p.parse_args(argv[1:])

    doc = resolve_doc(a.doc)
    if a.kind not in ALL_KINDS | RESPONDER_KINDS:
        die(f"unknown --kind: {a.kind} (one of {sorted(ALL_KINDS | RESPONDER_KINDS)})")

    try:
        if a.kind in RESPONDER_KINDS:
            result = _create_proposal(doc, a)
        elif a.kind in TEX_ONLY_KINDS:
            result = _create_example(doc, a)
        else:
            result = _create_carded(doc, a)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        die(f"{type(e).__name__}: {e}")

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
