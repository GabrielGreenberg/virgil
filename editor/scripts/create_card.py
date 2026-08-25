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

The responder kinds (comment, the cutter-/revision-suggestion family) are
*responder-skill* outputs, not create-card; the system/derived kinds
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
    die,
    find_bib_file,
    find_paragraph_uuids,
    find_tex_file,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
)

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


def _sidecar_ids(doc: Path, filename: str, list_key: str) -> set[str]:
    st = read_json(sidecar(doc, filename), default={list_key: []})
    out: set[str] = set()
    if isinstance(st, dict):
        for c in st.get(list_key, []) or []:
            if isinstance(c, dict) and c.get("id"):
                out.add(c["id"])
    return out


def _gen_marker_id(doc: Path, macro: str, used: set[str]) -> str:
    r"""A fresh 4-hex id in the `\<macro>{<4hex>}` namespace, colliding with
    neither `used` (existing sidecar ids + any ids allocated earlier this run)
    nor a `\<macro>{}` marker already in the .tex."""
    seen = set(used)
    try:
        tex = find_tex_file(doc).read_text(encoding="utf-8")
        for m in re.finditer(r"\\" + macro + r"\{([0-9a-fA-F]{2,8})\}", tex):
            seen.add(m.group(1))
    except SystemExit:
        pass
    for _ in range(100000):
        cand = secrets.token_hex(2)  # 4 hex chars, matching the doc's f0ac/cc01 style
        if cand not in seen:
            return cand
    die(f"could not allocate a free {macro} id")
    return ""  # unreachable


# ---------------------------------------------------------------------------
# Shared anchor-link + sibling-comment builders (the anchored-card spine —
# docs/workspace/anchoring.md, Mode A textObject Link).
# ---------------------------------------------------------------------------


def _anchor_link(card_kind: str, card_id: str, anchor_uuid: str) -> dict:
    """A Mode-A paragraph anchor: a `kind:"anchor"` textObject Link from the
    card to the anchor paragraph (src/links/_shared/types.ts).

    NOTE (task 205): the anchor carries NO `margin: {side}`. Which side a
    card's margin chrome sits on is a live function of where its panel is
    docked, resolved at read time by `src/lib/margin-side.ts`; the app deleted
    the stored field along with its one reader, so writing it here would put a
    key on disk that nothing reads and that cannot be right after the user
    re-docks a panel."""
    return {
        "id": str(uuid.uuid4()),
        "kind": "anchor",
        "anchor": {
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
        "title": f"Virgil added a {label}",
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
    fid = _gen_marker_id(doc, "vfid", _sidecar_ids(doc, "footnotes.json", "footnotes"))
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
    cid = _gen_marker_id(doc, "vcid", _sidecar_ids(doc, "citations.json", "citations"))
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
    {kind:"note", id, title, content, createdAt, aiRequest, links}."""
    body = _require_body(a, "note")
    nid = str(uuid.uuid4())
    return KindBuild(
        panel="notes",
        card={
            "kind": "note",
            "id": nid,
            "title": a.title or "",
            "content": _jsoncontent(body),
            "createdAt": now_iso(),
            "aiRequest": False,
            "links": [_anchor_link("note", nid, ctx.anchor)],
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
    {id, text, notes, done, aiRequest, createdAt, links} (no `kind` field)."""
    body = _require_body(a, "todo")
    tid = str(uuid.uuid4())
    return KindBuild(
        panel="todos",
        card={
            "id": tid,
            "text": body,
            "notes": a.notes or "",
            "done": False,
            "aiRequest": False,
            "createdAt": now_iso(),
            "links": [_anchor_link("todo", tid, ctx.anchor)],
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
    reports.json · cards, ReportCard {kind, id, createdAt, author, title, text,
    content, selectedText?, links}. A skill-authored report is author="ai"."""
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
            "title": a.title or "",
            "text": body,
            "content": _jsoncontent(body),
            "selectedText": ctx.selected_text or "",
            "links": [_anchor_link("report", rid, ctx.anchor)],
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
            "selectedText": ctx.selected_text or "",
            "links": [_anchor_link("report-request", rid, ctx.anchor)],
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


def _resolve_context(doc: Path, a: argparse.Namespace, *, accept_task_kinds: set[str]) -> "Ctx | dict":
    """Resolve the anchor / safety level / selection for a carded create.

    Workflow A (a requestId, no --synthesize): read them off the existing Task.
    Workflow B (no requestId, or --synthesize): synthesize the Task; --anchor
    is required. Returns a Ctx, or — for an already-terminal Task — the
    idempotent no-op result dict (re-running a completed create is a no-op)."""
    request_id = a.request
    anchor = a.anchor
    safety = a.safety_level
    selected_text = None
    synthesize = bool(a.synthesize)

    # A virtual card-flag id (virtual:<panel>:<cardId>) — a pre-bridge flag with
    # no ai-requests.json Task to read (list_requests.py emits these for papers
    # created before the bridge landed). It's a direct create against the source
    # card's own paragraph: the anchor comes from --anchor (the responder
    # resolves it from the source card), and the virtual id still flows to
    # apply_response, which splits it into {panel, cardId} to clear the source
    # card's aiRequest flag (no Task row is mutated, so a safety level / result
    # isn't persisted — a card-flag reply lands directly).
    if request_id and request_id.startswith("virtual:") and not synthesize:
        if not anchor:
            die("--anchor <uuid> is required for a virtual (card-flag) request id "
                "(resolve it from the source card)")
        return Ctx(request_id=request_id, anchor=anchor, safety=safety,
                   selected_text=None, synthesize=False, is_virtual=True)

    if request_id and not synthesize:
        ar = read_json(sidecar(doc, "ai-requests.json"), default={"requests": []})
        reqs = ar.get("requests", []) if isinstance(ar, dict) else []
        req = next((r for r in reqs if r.get("id") == request_id), None)
        if req is None:
            die(f"request id not found: {request_id}")
        if accept_task_kinds and req.get("kind") not in accept_task_kinds:
            die(f"request {request_id} is kind={req.get('kind')!r}, not {a.kind} "
                f"(expected one of {sorted(accept_task_kinds)})")
        if req.get("status") in ("complete", "failed"):
            return {"ok": True, "noop": True, "reason": "request already terminal", "requestId": request_id}
        if not anchor:
            pids = req.get("paragraphIds") or []
            if not pids:
                die("request has no paragraphIds; cannot anchor the card (pass --anchor)")
            anchor = pids[0]
        if safety is None and req.get("safetyLevel") is not None:
            safety = req.get("safetyLevel")
        selected_text = req.get("selectedText")
    else:
        synthesize = True
        if not anchor:
            die("--anchor <uuid> is required when there is no existing request")

    return Ctx(request_id=request_id, anchor=anchor, safety=safety,
               selected_text=selected_text, synthesize=synthesize)


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
    if isinstance(ctx, dict):  # already-terminal Task → idempotent no-op
        return ctx
    _require_anchor(doc, ctx.anchor)

    build = CARDED_BUILDERS[a.kind](doc, a, ctx)

    # Tie a result card back to the Task it answers, so the editor can surface
    # Accept / Reject / Redo (the aiOriginRequestId affordance — editor/AGENTS.md
    # "Future work"). Stamped uniformly here rather than per-skill: every
    # sidecar-only carded kind (note / todo / report / report-request —
    # build.insert is None) created from a *real* Task carries the back-pointer.
    # Atom-bearing kinds (footnote / citation) are id-equality atoms whose refs
    # carry no such field, so they're excluded; a virtual card-flag id has no
    # ai-requests.json Task to point back at, so it's excluded too.
    if ctx.request_id and not ctx.is_virtual and build.insert is None:
        build.card["aiOriginRequestId"] = ctx.request_id

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
    if ctx.request_id:
        op["requestId"] = ctx.request_id
    if ctx.synthesize:
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
# example — the one tex-only kind.
#
# An example *is* a TextObject in the .tex (expex `\vexid{}\ex…\xe`, or `\pex`
# with `\vxid{}\a` rows); examples.json is an app-derived metadata *shadow*
# (useExamples.syncFromEditor regenerates it on every parse), so the skill
# writes ONLY the .tex — no card append, and `examples` is intentionally absent
# from apply_response.PANEL_TO_SIDECAR. example has no Task lifecycle
# (docs/workspace/cards.md → lifecycle "none"), so the splice rides the
# contract's virtual-requestId path and synthesizes no Task.
#
# Abstraction note (flagged, not fixed here — the contract is reused as-is): a
# block-level TextObject wants to land *after* the anchor paragraph, but the
# contract's texEdit splices inline. We place it via `after-selected` on the
# paragraph's own `%!v:` marker (a placement landmark — not a hand-authored
# marker). A dedicated `block-after-paragraph` texEdit mode, and a Task-less
# tex-only subcommand, would be the cleaner long-term shape.
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
    anchor = a.anchor
    if not anchor:
        die("--anchor <uuid> is required for --kind=example")
    _require_anchor(doc, anchor)

    exid = _gen_marker_id(doc, "vexid", _sidecar_ids(doc, "examples.json", "examples"))
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
            "mode": "after-selected",
            "selectedText": f"%!v:{anchor}",  # land the block AFTER the paragraph marker
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
    p.add_argument("--body", help="card body / example text (user/chat supplied)")
    p.add_argument("--anchor", help="paragraph UUID to anchor at (required for the chat path)")
    p.add_argument("--safety-level", type=int, choices=[1, 2, 3], dest="safety_level")
    p.add_argument("--synthesize", action="store_true", help="synthesize the Task (chat path)")
    p.add_argument("--task-text", dest="task_text", help="the user's ask, recorded on a synthesized Task")
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
    p.add_argument("--title", help="card title (note, report)")
    # todo
    p.add_argument("--notes", help="secondary notes field (todo)")
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
    p.add_argument("--item", action="append", help="an example row (repeatable → \\pex/\\a list)")
    a = p.parse_args(argv[1:])

    doc = resolve_doc(a.doc)
    if a.kind not in ALL_KINDS:
        die(f"unknown --kind: {a.kind} (one of {sorted(ALL_KINDS)})")

    try:
        if a.kind in TEX_ONLY_KINDS:
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
