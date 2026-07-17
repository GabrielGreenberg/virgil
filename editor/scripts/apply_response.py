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
  apply_response.py <doc> accept   <op-json>   # { cardId } L3: splice proposal + status→accepted + Task done
  apply_response.py <doc> reject   <op-json>   # { cardId } L3: status→rejected + Task done (.tex untouched)

accept/reject (chip 13) consummate a Level-3 *proposal* — a suggestion card
(revision- or cutter-) that draft-suggestion drafted with the .tex untouched and
the Task left awaiting review. accept splices original_text → suggested_text into
the .tex (the generic `replace-span` texEdit, stale-guarded), flips the card
status → accepted, and completes the originating Task (result=accepted) — all in
ONE commit; it is the one mutation op that also carries a paper write. reject
flips the card status → rejected + completes the Task (result=rejected), .tex
untouched. Both take the originating Task from op.requestId or the card's
`aiOriginRequestId`; both are idempotent (re-accepting an accepted card is a
no-op) and refuse the opposite terminal state (accept on a rejected card).

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
the answer-* family, style-merge, …):

  apply_response.py <doc> <op-json>                         # default apply
  apply_response.py <doc> --revert <request-id>             # undo
  apply_response.py <doc> --complete-only <id> [--note N]   # flip, no card

`op-json` is an inline JSON string or a `@/path/to/file.json` reference.
Schema (v1 superset — every field optional unless noted):

  { "requestId": "...",        // ai-requests.json id, a bib-review-requests.json
                               //   bibKey, or "virtual:<panel>:<cardId>". Optional
                               //   when --synthesize-task is passed, or when the op
                               //   is a writes-only paper edit (carries a *Edit but
                               //   completes no Task — library-sync's .bib swap).
    "panel":     "notes" | "todos" | "cutter" | "revisions" |
                 "footnotes" | "citations" | "reports",
    "card":      { ...full card object to insert into <panel>.json },
    "texEdit":   { "anchorUuid": "3301",                 // paragraph %!v: marker
                   "insert": "\\vfid{f8}\\footnote{…}",  // text to splice
                   "mode": "end-of-paragraph" | "after-selected" | "region-replace" | "replace-span",
                   "selectedText": "…",                  // for after-selected
                   "replacement": "…\\begin{document}\n\n", // region-replace / replace-span substitute
                   "match": "<verbatim span>",            // replace-span: swap this span at anchorUuid (stale-guarded)
                   "endMarker": "\\begin{document}" },   // region-replace boundary
    "bibEdit":   { "mode": "append" | "set-fields" | "replace",
                   "entry":   "@article{key, …}",         // append / replace
                   "citekey": "key",                      // set-fields / replace
                   "fields":  { "doi": "…", "pages": "…" } }, // set-fields
    "renameCitekey":  { "oldKey": "smith99", "newKey": "smith1999" }, // rewrite \\cite*{} in .tex + citations.json
    "settingsEdit":   { "set": { "styleId": "…" } },      // → virgil/document-settings.json
    "annotationEdit": { "bibKey": "key", "text": "…" },   // → virgil/annotations.json
    "bibReviewType":  "fields" | "notes",                 // disambiguate the row to flip
    "comment":   { "panel": "notes", "card": {…} },      // sibling comment (L2)
    "summary":   "<one-line description for the toast>",
    "clearSourceFlag": true,   // clear aiRequest on the linkedTo/virtual source
    // --synthesize-task only (build the Task on the fly):
    "kind": "footnote", "text": "…", "paragraphIds": ["3301"], "safetyLevel": 1 }

The paper-file edits are kind-agnostic capabilities, all spliced under the pen in
the SAME atomic commit (gated by `apply_writes` — applied on a real write, held
back on a Level-3 proposal):
  - `texEdit`     — the consumer composes the exact splice (e.g.
                    `\\vfid{<id>}\\footnote{<body>}`), or, in `region-replace` mode,
                    the whole preamble, or, in `replace-span` mode (chip 13), a
                    verbatim span to swap at an anchor (the L3 accept splice);
                    this script just places it.
  - `bibEdit`     — append a new entry, set fields on an existing citekey, or
                    replace an entry block, in `references.bib` (find_bib_file).
  - `renameCitekey` — rewrite every natbib `\\cite*{}` in the .tex AND every
                    `citations.json` card (its `keys` + `command`) from `oldKey` →
                    `newKey`, reusing rename_citekey.py's pure rewriters (no regex
                    duplicated here). Bundles with a `bibEdit` `replace` so a
                    library-swap of one entry — new .bib body + retargeted cites +
                    retargeted cards — is ONE all-or-nothing op (sync-bib-to-library
                    via answer-bib-review --library-sync). Idempotent: oldKey absent
                    → 0 changes, nothing queued.
  - `settingsEdit`/`annotationEdit` — set keys in the two non-panel JSON sidecars
                    (document settings; per-bibKey annotations).
The contract carries no per-kind knowledge — the next skill that touches the .tex
or .bib is a new *consumer*, not a new write path.

A write subcommand commits, atomically and under the pen:
  - virgil/<panel>.json        (new card appended; duplicate id rejected)
  - the root .tex              (texEdit spliced/region-replaced, or renameCitekey's
                                \\cite*{} retargeted — apply_writes only)
  - references.bib             (bibEdit append/set-fields/replace — apply_writes only)
  - virgil/citations.json      (renameCitekey: cards' keys + command retargeted —
                                apply_writes only; composes if a citation card also
                                lands in the same op)
  - virgil/document-settings.json (settingsEdit — apply_writes only)
  - virgil/annotations.json    (annotationEdit — apply_writes only)
  - virgil/<comment-panel>.json (sibling comment — write-with-comment only)
  - virgil/ai-requests.json    (status + result set, resultId pointer; or a
                                synthesized Task appended) OR
    virgil/bib-review-requests.json (the matching row's status → complete, when the
                                requestId is a bibKey rather than an ai-request id)
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
    NODE_UUID_REGEX,
    commit_under_pen,
    die,
    find_bib_file,
    find_tex_file,
    json_dumps,
    notification_appended,
    now_iso,
    read_json,
    resolve_doc,
    sidecar,
    spawn_reflection,
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
    # accept/reject (chip 13) consummate an L3 proposal (accept also splices the .tex).
    "update", "archive", "restore", "move", "link", "accept", "reject",
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
        # Clears the `aiRequest` flag on the SOURCE card `linked` names — the
        # card the user flagged, i.e. the thing being answered — NEVER the new
        # card a responder produces. "The AI answered this card" MEANS its flag
        # is down: this is what stops the unbridged-card-flag fallback
        # (list_requests.list_unbridged_card_flags) from re-surfacing an
        # already-answered request. cmd_write calls it default-on
        # (op.clearSourceFlag, default True) for every linked-completion path;
        # the one deliberate opt-out is create_card.py's examples block (a
        # virtual id with no distinct source card).
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

    def close_linked_request(self, linked: dict, *, result: str,
                             force: bool = False) -> bool:
        # Flip the FIRST linked `ai-requests.json` row ({panel, cardId}) to a
        # terminal status — the by-`linkedTo` twin of cmd_write's by-`request_id`
        # completion (the task 019 resolve SSOT). Needed by a terminal card
        # transition that carries NO driving requestId (a user-initiated
        # archive): `_mutation_commit` resolves a row by request_id ONLY, so
        # without this the bridged row is left dangling OPEN (Leg A) even after
        # the card is archived.
        #
        # `force` (task 093) selects the closure scope:
        #   - False (default) — mirror list_requests.isRequestOpen: close only a
        #     row the drain still counts OPEN, leaving an answered-L3 row
        #     (`in-progress`+`resultId`) untouched so a toggle-off can't orphan
        #     its `resultId` (the task 043 protection).
        #   - True (archive) — the card is GONE, so terminate the first
        #     non-terminal row REGARDLESS of openness, incl. an answered-L3 row.
        #     `cmd_archive` passes this; the byte-mirror of the UI bridge's
        #     `"terminate"` mode. Already-terminal rows are still skipped, so it
        #     stays idempotent and closes exactly one row.
        # Returns True iff a row was closed — an unflagged / already-resolved
        # card matches nothing and writes no spurious terminal row.
        panel = linked.get("panel")
        card_id = linked.get("cardId")
        if not panel or not card_id:
            return False
        ar_path = sidecar(self.doc, "ai-requests.json")
        ar = self.jget(ar_path, None)
        if not isinstance(ar, dict) or not isinstance(ar.get("requests"), list):
            return False
        for r in ar["requests"]:
            if not isinstance(r, dict):
                continue
            lk = r.get("linkedTo")
            if not (isinstance(lk, dict)
                    and lk.get("panel") == panel
                    and lk.get("cardId") == card_id):
                continue
            status = r.get("status")
            if status in (STATUS_COMPLETE, STATUS_FAILED):
                continue
            if not force and status == STATUS_IN_PROGRESS and r.get("resultId"):
                continue
            r["status"] = STATUS_COMPLETE
            r["result"] = result
            self.mark(ar_path)
            return True
        return False

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
    """Compute the new .tex content for `te`. Returns (tex_path, new_text); dies
    if the anchor / marker can't be located.

    Modes:
      end-of-paragraph (default) — splice `insert` just before the paragraph's
        `%!v:<anchorUuid>` marker.
      after-selected — splice `insert` immediately after `selectedText` (falls
        back to end-of-paragraph if the selection isn't found verbatim).
      region-replace — replace everything from the file start up to and including
        `endMarker` (default `\\begin{document}`) and its trailing newlines with
        `replacement`. The whole-preamble rewrite (style-merge): the consumer's
        `replacement` re-supplies the marker + spacing it wants to keep, so the
        body bytes after the old marker are preserved verbatim.
      replace-span (chip 13) — at the `%!v:<anchorUuid>` paragraph, replace the
        verbatim `match` span with `replacement`. The generic "apply a reviewed
        proposal" primitive (a suggestion's original_text → suggested_text),
        carrying ZERO suggestion knowledge — it just swaps a span. Stale-guarded:
        if the anchor is gone or `match` no longer appears in that paragraph, it
        dies and nothing is spliced (see _replace_span_in_tex).
    """
    tex_path = find_tex_file(doc)
    text = tex_path.read_text(encoding="utf-8")
    mode = te.get("mode") or "end-of-paragraph"

    if mode == "region-replace":
        replacement = te.get("replacement")
        if replacement is None:
            die("texEdit.replacement is required for mode=region-replace")
        marker = te.get("endMarker") or "\\begin{document}"
        i = text.find(marker)
        if i == -1:
            die(f"region-replace end marker not found in .tex: {marker}")
        end = i + len(marker)
        while end < len(text) and text[end] == "\n":
            end += 1
        return tex_path, replacement + text[end:]

    if mode == "replace-span":
        return tex_path, _replace_span_in_tex(text, te)

    insert = te.get("insert")
    if not insert:
        die("texEdit.insert is required")

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


def _replace_span_in_tex(text: str, te: dict) -> str:
    r"""mode=replace-span: at the anchor paragraph's `%!v:<anchorUuid>` marker,
    replace the verbatim `match` span with `replacement`. Returns the new text.

    The L3 "consummate a reviewed proposal" splice, but kind-agnostic — it knows
    nothing about suggestions; it swaps one verbatim span for another at an
    anchor (original_text → suggested_text is just the caller's choice of args).

    Stale-proposal guard (the L3 trust property): `match` must still be present
    in the *anchored paragraph*. The search is scoped to that paragraph — from
    just past the previous `%!v:` marker up to this one — so (a) an identically
    worded span in a *different* paragraph can't be hit by accident, and (b) if
    the paragraph changed since the proposal was drafted (so `match` no longer
    appears there), we die rather than blindly splice a stale edit. Because this
    runs before commit_under_pen, a die() leaves the .tex — and the whole
    transaction — untouched.
    """
    anchor = te.get("anchorUuid")
    if not anchor:
        die("texEdit.anchorUuid is required for mode=replace-span")
    match = te.get("match")
    if not match:
        die("texEdit.match is required for mode=replace-span (the verbatim span to replace)")
    replacement = te.get("replacement")
    if replacement is None:
        die("texEdit.replacement is required for mode=replace-span (may be empty to delete the span)")

    marker = f"%!v:{anchor}"
    mi = text.find(marker)
    if mi == -1:
        die(f"replace-span: anchor marker {marker} not found in .tex — the anchored paragraph "
            f"was removed since the proposal was drafted (stale proposal); refusing to splice")
    # Scope the search to the anchor paragraph: [end of the previous %!v: marker,
    # this marker). Keeps an identically worded span elsewhere out of range.
    region_start = 0
    for m in NODE_UUID_REGEX.finditer(text):
        if m.start() >= mi:
            break
        region_start = m.end()
    idx = text.find(match, region_start, mi)
    if idx == -1:
        die(f"replace-span: the proposal's original_text no longer matches the .tex at anchor "
            f"{marker} — the paragraph changed since the proposal was drafted (stale proposal); "
            f"refusing to splice. Re-draft the suggestion against the current text.")
    return text[:idx] + replacement + text[idx + len(match):]


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
# Bibliography / settings / annotation writes (kind-agnostic, mirroring texEdit)
#
# Three more paper-file capabilities the op-json can carry, each applied in the
# SAME atomic pen commit as the card + .tex. Like texEdit they're declarative:
# the consumer says *what* should land; this owns *how* it lands atomically.
# ---------------------------------------------------------------------------


def _bib_path_for_write(doc: Path) -> Path:
    """The references.bib to write to: the resolved one, or a sensible default
    (so a first citation in a paper that has no .bib yet still lands)."""
    existing = find_bib_file(doc)
    if existing is not None:
        return existing
    try:
        tex = find_tex_file(doc).read_text(encoding="utf-8", errors="replace")
        m = re.search(r"\\(?:bibliography|addbibresource)\{([^}]+)\}", tex)
        if m:
            name = m.group(1).strip()
            if not name.endswith(".bib"):
                name += ".bib"
            return doc / name
    except SystemExit:
        pass
    return doc / "references.bib"


def _bib_apply(doc: Path, be: dict) -> tuple[Path, str]:
    """Compute the new references.bib content for a `bibEdit`. Returns
    (bib_path, new_text). append / set-fields / replace are one parameterized
    capability; the serialization lives in bib_resolve (imported lazily so the
    contract stays import-light)."""
    import bib_resolve as BR

    mode = be.get("mode")
    if not mode:
        mode = "append" if (be.get("entry") and not be.get("citekey")) else "set-fields"
    if mode == "append":
        entry = be.get("entry")
        if not entry:
            die("bibEdit append requires op.bibEdit.entry")
        bib_path = _bib_path_for_write(doc)
        old = bib_path.read_text(encoding="utf-8") if bib_path.exists() else ""
        return bib_path, BR.append_entry(old, entry)
    bib_path = find_bib_file(doc)
    if bib_path is None:
        die(f"bibEdit {mode}: no references.bib found in the paper")
    citekey = be.get("citekey")
    if not citekey:
        die(f"bibEdit {mode} requires op.bibEdit.citekey")
    old = bib_path.read_text(encoding="utf-8")
    if mode == "set-fields":
        fields = be.get("fields")
        if not isinstance(fields, dict) or not fields:
            die("bibEdit set-fields requires a non-empty op.bibEdit.fields object")
        return bib_path, BR.set_fields(old, citekey, fields)
    if mode == "replace":
        entry = be.get("entry")
        if not entry:
            die("bibEdit replace requires op.bibEdit.entry")
        return bib_path, BR.replace_entry(old, citekey, entry)
    die(f"unknown bibEdit mode: {mode!r} (append | set-fields | replace)")
    return bib_path, old  # unreachable


def _settings_apply(doc: Path, txn: "_Txn", se: dict) -> None:
    """Merge `se.set` into virgil/document-settings.json (DocumentSettings —
    e.g. styleId). Loaded once via the txn so it composes + lands in the commit."""
    sets = se.get("set")
    if not isinstance(sets, dict) or not sets:
        die("settingsEdit requires a non-empty op.settingsEdit.set object")
    path = sidecar(doc, "document-settings.json")
    state = txn.jget(path, {})
    if not isinstance(state, dict):
        die("document-settings.json malformed (expected an object)")
    for k, v in sets.items():
        state[k] = v
    txn.mark(path)


def _annotation_apply(doc: Path, txn: "_Txn", ae: dict) -> None:
    """Set the per-bibKey annotation in virgil/annotations.json (AnnotationsState
    = { [bibKey]: string } — flat strings). Tolerates a legacy
    { annotations: {…} } wrapper if a paper happens to carry one."""
    bibkey = ae.get("bibKey")
    text = ae.get("text")
    if not bibkey or text is None:
        die("annotationEdit requires op.annotationEdit.bibKey and .text")
    path = sidecar(doc, "annotations.json")
    state = txn.jget(path, {})
    if not isinstance(state, dict):
        die("annotations.json malformed (expected an object)")
    target = state["annotations"] if isinstance(state.get("annotations"), dict) else state
    target[bibkey] = text
    txn.mark(path)


def _rename_citekey_apply(doc: Path, txn: "_Txn", rc: dict) -> dict:
    r"""Rewrite a citekey across the `.tex` `\cite*{}` commands and the
    virgil/citations.json cards, folding BOTH into the txn so the rename rides the
    SAME atomic pen commit as any bibEdit in the op. A library-swap of one entry
    becomes one all-or-nothing op: its new `.bib` body + every retargeted
    `\cite*{}` + every retargeted citation card land together-or-not-at-all — a
    crash can't leave the bib swapped but the cites dangling, or vice-versa.

    REUSES rename_citekey's pure rewriters (imported lazily so apply_response stays
    import-light) — the contract owns the atomic write, not a second copy of the
    natbib regex. Idempotent: `oldKey` absent from the doc → 0 changes, nothing
    queued, so a sync entry whose key the doc never used doesn't fail the run."""
    import rename_citekey as RC

    old = rc.get("oldKey")
    new = rc.get("newKey")
    if not old or not new:
        die("renameCitekey requires op.renameCitekey.oldKey and .newKey")
    summary = {"oldKey": old, "newKey": new,
               "texCommandsChanged": 0, "citationCardsChanged": 0}
    if old == new:
        summary["noop"] = True
        return summary

    # 1) the .tex \cite*{} commands (a raw write — not JSON).
    tex_path = find_tex_file(doc)
    tex_text = tex_path.read_text(encoding="utf-8")
    new_tex, n_tex = RC.rewrite_tex(tex_text, old, new)
    if n_tex:
        txn.add_raw(tex_path, new_tex)
    summary["texCommandsChanged"] = n_tex

    # 2) virgil/citations.json cards (keys + command) — loaded THROUGH the txn
    #    (jget/mark) so that if a citation card ALSO lands in this op (panel:
    #    citations), both edits compose on the one loaded dict instead of racing
    #    two writes to the same file. Optional sidecar: absent / no match → no-op
    #    (jget caches the default but writes() only emits it once marked dirty).
    cites_path = sidecar(doc, "citations.json")
    data = txn.jget(cites_path, {"citations": []})
    if isinstance(data, dict):
        _, n_cards = RC.rewrite_citations_json(data, old, new)
        if n_cards:
            txn.mark(cites_path)
        summary["citationCardsChanged"] = n_cards
    return summary


def _apply_paper_writes(doc: Path, txn: "_Txn", op: dict) -> None:
    """Splice every paper-file edit the op carries into the txn — the .tex, the
    .bib, the citekey rename, and the two non-panel JSON sidecars. Gated by
    `apply_writes` at the call site (held back on a Level-3 proposal). The headline
    of chip 12 (and 16): every paper-file write rides one atomic, pen-wrapped
    commit, no parallel path."""
    # texEdit and renameCitekey both rewrite the .tex from an independent read;
    # the atomic writer crashes on two queued writes to the same path (the second
    # os.replace finds its temp already consumed). They never co-occur in v1
    # (renameCitekey rides with bibEdit for the library-sync swap; texEdit with the
    # L3 accept splice), so refuse the combination loudly rather than silently lose
    # one edit. A future need to compose them is a contract extension, not a quiet
    # last-write-wins.
    if op.get("texEdit") and op.get("renameCitekey"):
        die("an op cannot carry both texEdit and renameCitekey — both rewrite the "
            ".tex via independent reads and can't be queued as two writes to the "
            "same file. Split them into two ops.")
    if op.get("texEdit"):
        tex_path, new_tex = _tex_splice(doc, op["texEdit"])
        txn.add_raw(tex_path, new_tex)
    if op.get("bibEdit"):
        bib_path, new_bib = _bib_apply(doc, op["bibEdit"])
        txn.add_raw(bib_path, new_bib)
    if op.get("renameCitekey"):
        _rename_citekey_apply(doc, txn, op["renameCitekey"])
    if op.get("settingsEdit"):
        _settings_apply(doc, txn, op["settingsEdit"])
    if op.get("annotationEdit"):
        _annotation_apply(doc, txn, op["annotationEdit"])


def _has_paper_writes(op: dict) -> bool:
    return any(op.get(k) for k in
               ("texEdit", "bibEdit", "renameCitekey", "settingsEdit", "annotationEdit"))


def _complete_bib_review(doc: Path, txn: "_Txn", bibkey: str, *, rtype: str | None = None) -> bool:
    """Flip the matching bib-review-requests.json row(s) pending → complete (the
    BibReviewRequest lifecycle is status-only — the type carries no result field).
    Matched by bibKey, narrowed to `type == rtype` when given so answering a
    `fields` review doesn't also close a pending `notes` review on the same key.
    Returns whether a row was flipped (so the caller can fall through to a clean
    'request id not found' when neither queue holds the id)."""
    path = sidecar(doc, "bib-review-requests.json")
    state = txn.jget(path, None)
    if not isinstance(state, dict) or not isinstance(state.get("requests"), list):
        return False
    flipped = False
    for row in state["requests"]:
        if not isinstance(row, dict):
            continue
        if row.get("bibKey") != bibkey and row.get("id") != bibkey:
            continue
        if rtype is not None and row.get("type") != rtype:
            continue
        row["status"] = STATUS_COMPLETE
        flipped = True
    if flipped:
        txn.mark(path)
    return flipped


# ---------------------------------------------------------------------------
# Dev-dream day-capture — the reflect tail on every writeback.
#
# apply_response is the single writeback chokepoint EVERY editor skill funnels
# through — the CLI paths AND create_card.py's in-process run_write_subcommand —
# so the two commit finalizers (cmd_write, _mutation_commit) are the one place a
# memo is guaranteed for every completed skill (the "day" floor that makes
# paper-cowork sessions accumulate dev-dream memos). The contract is
# skill-agnostic, so we name the skill structurally: a write from the Task's
# `kind` (reliably present on the request row — NOT the top-level op key, which
# direct-CLI ops omit); a mutation from the op label each caller stamps in
# `extra`. Both match the real skill name the umbrella/convention reflection
# uses, so the two MERGE into the same (skill, taskId) memo instead of
# duplicating. This is a LABEL derivation, not new contract state.
# ---------------------------------------------------------------------------

# Task `kind` → responder skill. (No `comment` / `*-comment` entries: a bridged
# cutter/revision-comment reply rides on a `kind: "suggestion"` row — those are
# disambiguated by the source panel in `_write_skill`, so a bare "suggestion"
# here is a *native* draft-suggestion.)
_KIND_SKILL = {
    "footnote": "draft-footnote", "citation": "find-citation",
    "note": "answer-note-request", "todo": "answer-todo-request",
    "report": "answer-report-request", "report-request": "answer-report-request",
    "suggestion": "draft-suggestion", "revision-suggestion": "draft-suggestion",
    "bib-review": "answer-bib-review",
}
# Source-card panel → responder skill. Names the answer-* skill for a card-flag
# reply (a `virtual:<panel>:<cardId>` id carries no kind) and disambiguates a
# bridged comment (kind "suggestion" + linkedTo.panel cutter/revisions).
_PANEL_SKILL = {
    "notes": "answer-note-request", "todos": "answer-todo-request",
    "cutter": "answer-cutter-comment", "revisions": "answer-revision-request",
    "footnotes": "draft-footnote", "citations": "find-citation",
    "reports": "answer-report-request",
}
_OP_SKILL = {
    "update": "edit-card", "archive": "archive-card", "restore": "restore-card",
    "move": "move-card", "link": "link-cards",
    "accept": "accept-suggestion", "reject": "reject-suggestion",
}


def _write_skill(kind: str | None, panel: str | None) -> str:
    """Name the responder skill for a write, from the Task kind + the source-card
    panel. The panel is load-bearing on the card-flag paths: a bridged
    cutter/revision comment reaches here as kind='suggestion' (disambiguate by
    panel), and a `virtual:<panel>:` card-flag reply carries no kind at all."""
    if kind == "suggestion" and panel in ("cutter", "revisions"):
        return _PANEL_SKILL[panel]
    if kind:
        return _KIND_SKILL.get(kind, kind)
    if panel in _PANEL_SKILL:
        return _PANEL_SKILL[panel]
    return "apply"


def _reflect_tail(doc: Path, skill: str, request_id: str | None) -> None:
    """Fire the dev-dream capture for a completed writeback (DEV-gated +
    best-effort inside spawn_reflection). Task-less writebacks key on '-'."""
    spawn_reflection(doc, skill, request_id or "-")


# ---------------------------------------------------------------------------
# The unified write transaction
# ---------------------------------------------------------------------------


def cmd_write(
    doc: Path,
    op: dict,
    *,
    status: str,
    result: str | None,
    apply_writes: bool,
    comment: bool,
    synthesize: bool,
) -> dict:
    """The one write transaction behind every write path.

    write-silent / write-with-comment / complete-task(direct) all land the card
    and the paper-file edits (the .tex, and now the .bib / settings / annotation —
    every `*Edit` the op carries), differing only in `result` and whether a
    sibling comment rides along. complete-task --propose passes apply_writes=False
    (the change is the *proposal*, not yet applied) and a non-terminal status. The
    legacy default-apply op is just this with result=None (no outcome stamped).

    The Task it completes lives in ai-requests.json (by id), bib-review-requests
    .json (by bibKey — a bib review), or nowhere (a writes-only paper edit that
    carries a `*Edit` but no requestId — library-sync's .bib swap + citekey rename).
    """
    summary = op.get("summary") or "AI request complete"
    panel = op.get("panel")
    card = op.get("card")
    request_id = op.get("requestId")
    is_virtual = isinstance(request_id, str) and request_id.startswith("virtual:")

    txn = _Txn(doc)
    reflect_kind: str | None = None  # the Task kind → names the dev-dream memo's skill

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
        reflect_kind = req["kind"]
    elif is_virtual:
        parts = request_id.split(":", 2)
        if len(parts) != 3:
            die(f"malformed virtual request id: {request_id}")
        linked = {"panel": parts[1], "cardId": parts[2]}
    elif request_id:
        ar = txn.jget(ar_path, None)
        idx, req = (
            find_request(ar, request_id)
            if isinstance(ar, dict) and isinstance(ar.get("requests"), list)
            else (None, None)
        )
        if req is not None:
            reflect_kind = req.get("kind")
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
        elif _complete_bib_review(doc, txn, request_id, rtype=op.get("bibReviewType")):
            reflect_kind = "bib-review"  # a bib-review row (keyed by bibKey), not an ai-request id
        else:
            if not isinstance(ar, dict) or "requests" not in ar:
                die("ai-requests.json missing or malformed")
            die(f"request id not found: {request_id}")
    elif _has_paper_writes(op):
        pass  # writes-only: a deliberate paper edit that completes no Task
    else:
        die("op missing requestId (or pass --synthesize-task to create the Task)")

    # 4. Clear the SOURCE card's aiRequest flag. Default-on: clearing the flag
    #    is what "the AI answered this card" means, so every linked-completion
    #    path (L1/L2/direct AND the L3 propose draft) lowers it — that closes
    #    the unbridged-card-flag recycling leg, the twin of the ai-requests
    #    status/resultId leg the drain gate owns. `linked` resolves to the
    #    request's own `linkedTo` (or a virtual id); it is the source, never the
    #    card just produced. Only create_card.py's examples block opts out
    #    (clearSourceFlag:false — a virtual id with no distinct source card).
    if op.get("clearSourceFlag", True) and isinstance(linked, dict):
        txn.clear_source_flag(linked)

    # 5. The paper-file edits — .tex / .bib / settings / annotation (only when
    #    applying, not for a Level-3 proposal). All ride the same atomic commit.
    if apply_writes:
        _apply_paper_writes(doc, txn, op)

    # 6. Notification + version (version last → trails a consistent state).
    notif_path, notif_content = notification_appended(
        doc,
        {"kind": "ai-request-complete", "at": now_iso(), "summary": summary, "requestId": request_id},
    )
    txn.add_raw(notif_path, notif_content)
    vpath, vcontent, vnum = version_bumped(doc)
    txn.add_raw(vpath, vcontent)

    commit_under_pen(doc, txn.writes())
    # Dev-dream day-capture floor: reflect on THIS writeback (the one chokepoint
    # BOTH the CLI and create_card.py's in-process run_write_subcommand pass
    # through). The skill is named from the Task kind + the source-card panel
    # (`linked` — set for a virtual card-flag id or a bridged linkedTo), so it
    # matches the umbrella/convention reflection and merges into the same
    # (skill, taskId) memo. DEV-gated + best-effort inside.
    _reflect_tail(doc, _write_skill(reflect_kind, (linked or {}).get("panel")), request_id)
    return {"ok": True, "version": vnum, "requestId": request_id, "status": status, "result": result}


def cmd_complete_only(
    doc: Path,
    target: str,
    *,
    note: str | None,
    result: str | None,
    synthesize: bool,
) -> dict:
    """Complete a Task without creating a card — flip its status (+ optional
    result) and land any paper-file edits the op carries. Used by bib reviews
    (the .bib field edit / annotation), style-merge (the preamble rewrite +
    settings flip), library-sync (the .bib swap + the citekey rename), and the
    failure cases.

    `target` is a bare request-id / bibKey, OR an op-json (inline `{…}` or
    `@file`) carrying paper-file `*Edit`s — which then ride this same atomic,
    pen-wrapped commit (apply_writes=True). A bare id with no writes stays the
    pure status flip it always was."""
    if result is not None and result not in ALL_RESULTS:
        die(f"unknown result: {result}")
    status = STATUS_FAILED if result in FAIL_RESULTS else STATUS_COMPLETE
    if synthesize:
        op = parse_op_json(target)
        op.setdefault("summary", note or "AI request complete")
        return cmd_write(
            doc, op, status=status, result=result,
            apply_writes=True, comment=False, synthesize=True,
        )
    if target.startswith("@") or target.lstrip().startswith("{"):
        op = parse_op_json(target)
        op.setdefault("summary", note or "AI request complete")
    else:
        op = {"requestId": target, "summary": note or "AI request complete"}
    return cmd_write(
        doc, op, status=status, result=result,
        apply_writes=True, comment=False, synthesize=False,
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
    # Dev-dream day-capture floor: reflect on this mutation. The skill is named
    # from the op label every caller stamps in `extra` (accept → accept-suggestion,
    # archive → archive-card, …). DEV-gated + best-effort inside.
    _reflect_tail(doc, _OP_SKILL.get((extra or {}).get("op") or "", "card-op"), request_id)
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
    # Terminal-transition resolve, Leg B (restore): archiving a flagged card
    # resolves its AI request, just like answer (019) and delete. The LIVE card
    # is about to be removed (so its `aiRequest` flag stops surfacing on the
    # unbridged-card-flag leg by itself), but the verbatim snapshot rides into
    # `originalCard` — so lower the flag ON THE SNAPSHOT, else cmd_restore's
    # re-append (:1213) brings the card back flagged and re-opens the request.
    # Guarded: only a genuinely-flagged card is cloned+cleared.
    if isinstance(original, dict) and original.get("aiRequest"):
        original = {**original, "aiRequest": False}
    txn = _Txn(doc)
    panel = txn.remove_card(card_id)
    if panel is None:
        die(f"could not remove {card_id} from {hit.panel}.json")
    # Terminal-transition resolve, Leg A (bridged row): a user archive has no
    # requestId, so `_mutation_commit`'s request_id-only flip can't reach the
    # open `ai-requests.json` row bridged to this card — close it here by its
    # `linkedTo`, or it dangles OPEN forever. `force=True` (task 093) makes
    # archive terminal REGARDLESS of openness, so an answered-L3 row
    # (`in-progress`+`resultId`) is closed too, not just a plain-open one. No-op
    # (guarded) when unflagged.
    txn.close_linked_request({"panel": panel, "cardId": card_id},
                             result=RESULT_AUTO_APPLIED, force=True)
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


# --- accept / reject (chip 13) — consummate an L3 proposal ------------------
#
# L3 ("propose a change for review") is the one safety level that DRAFTS but
# can't consummate: draft-suggestion lands a suggestion card (revision- or
# cutter-) with the .tex untouched and the Task left awaiting review. These two
# ops close that loop, on the SAME atomic + pen + audit spine as the other
# mutations (_mutation_commit):
#
#   accept — splice the proposal into the .tex (original_text → suggested_text
#            via the generic replace-span texEdit), flip the card status →
#            accepted, and complete the originating Task (result=accepted). The
#            single mutation op that also carries a paper write (the splice), and
#            the only one gated by the stale-proposal guard (in replace-span).
#   reject — flip the card status → rejected and complete the Task
#            (result=rejected). The .tex is UNTOUCHED.
#
# Both treat revision-suggestion and cutter-suggestion uniformly: the only
# per-kind knowledge is "this card carries original_text / suggested_text / an
# anchor", which is identical across the two. A future proposal kind that
# carries the same triad inherits accept/reject for free — "apply a reviewed
# proposal" is now a generic contract capability, not per-kind splice code.

SUGGESTION_KINDS = {"revision-suggestion", "cutter-suggestion"}


def _suggestion_anchor_uuid(card: dict) -> str | None:
    """The anchor paragraph uuid for a suggestion card, from its first textObject
    Link. Tolerates both the live `textObjectIds` shape and the legacy
    `paragraphIds` one (the responder-skill markdown still documents the latter;
    on-disk suggestion cards use textObjectIds)."""
    for link in card.get("links") or []:
        anchor = link.get("anchor") if isinstance(link, dict) else None
        if not isinstance(anchor, dict):
            continue
        ids = anchor.get("textObjectIds") or anchor.get("paragraphIds")
        if isinstance(ids, list) and ids:
            return ids[0]
    return None


def _resolve_proposal(doc: Path, op: dict, verb: str):
    """Shared accept/reject front half: resolve the card, assert it's a suggestion
    proposal, and classify its terminal state. Returns either `(hit, kind)` to
    proceed, or a dict — the idempotent no-op result the caller returns as-is
    (re-accepting an accepted card / re-rejecting a rejected one is a no-op).
    die()s on a hard refusal: not a suggestion, or already in the *opposite*
    terminal state (accept on a rejected card, or vice-versa)."""
    from card_by_id import find_card, card_kind

    card_id = op.get("cardId")
    if not card_id:
        die(f"{verb} requires op.cardId")
    hit = find_card(doc, card_id)
    if hit is None:
        die(f"card not found: {card_id}")
    kind = card_kind(hit)
    if kind not in SUGGESTION_KINDS:
        die(f"{verb}-suggestion applies only to a suggestion proposal "
            f"(revision-suggestion / cutter-suggestion); {card_id} is a {kind}")
    status = hit.card.get("status") or "pending"
    target = "accepted" if verb == "accept" else "rejected"
    opposite = "rejected" if verb == "accept" else "accepted"
    if status == target:
        return {"ok": True, "noop": True, "reason": f"already {target}",
                "op": verb, "cardId": card_id, "cardKind": kind, "status": status}
    if status == opposite:
        die(f"cannot {verb} {card_id}: it is already {opposite} (a terminal state)")
    return hit, kind


def cmd_accept(doc: Path, op: dict) -> dict:
    """Consummate an L3 proposal: splice original_text → suggested_text into the
    .tex (generic replace-span, stale-guarded), flip the suggestion card →
    accepted, and complete the originating Task (result=accepted). One atomic,
    pen-wrapped commit. Idempotent (accepting an accepted card is a no-op)."""
    res = _resolve_proposal(doc, op, "accept")
    if isinstance(res, dict):
        return res
    hit, kind = res
    card = hit.card
    card_id = card["id"]

    original = card.get("original_text")
    if not original:
        die(f"cannot accept {card_id}: the suggestion carries no original_text "
            f"(nothing to match in the .tex)")
    if card.get("suggested_text") is None:
        die(f"cannot accept {card_id}: the suggestion carries no suggested_text")
    anchor = _suggestion_anchor_uuid(card)
    if not anchor:
        die(f"cannot accept {card_id}: the suggestion has no anchor paragraph "
            f"(links[*].anchor.textObjectIds) to splice at")
    # The replacement mirrors the browser's accept: a revision suggestion honors
    # a user refinement (user_text) over the AI draft (suggested_text); an empty
    # value is a deletion (a Cutter "cut entirely"). The .tex write itself is the
    # generic replace-span — no suggestion-specific splice code.
    replacement = card.get("user_text") or card.get("suggested_text") or ""

    txn = _Txn(doc)
    live = txn.card_ref(hit.filename, hit.list_key, card_id)
    if live is None:
        die(f"card vanished while opening the transaction: {card_id}")
    live["status"] = "accepted"
    txn.mark(sidecar(doc, hit.filename))

    # The splice rides chip 12's apply_writes path (always-on here — accept IS
    # the apply). The stale-proposal guard lives in replace-span: if original_text
    # no longer matches at the anchor, _apply_paper_writes → _tex_splice die()s
    # before commit_under_pen, so the .tex, the card, AND the Task all stay put.
    _apply_paper_writes(doc, txn, {"texEdit": {
        "mode": "replace-span", "anchorUuid": anchor,
        "match": original, "replacement": replacement,
    }})

    request_id = op.get("requestId") or card.get("aiOriginRequestId")
    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Accepted {kind} {card_id}",
        request_id=request_id,
        result=RESULT_ACCEPTED,
        extra={"op": "accept", "cardId": card_id, "cardKind": kind,
               "anchorUuid": anchor, "result": RESULT_ACCEPTED},
    )


def cmd_reject(doc: Path, op: dict) -> dict:
    """Dismiss an L3 proposal: flip the suggestion card → rejected and complete
    the originating Task (result=rejected). The .tex is UNTOUCHED. One atomic,
    pen-wrapped commit. Idempotent (rejecting a rejected card is a no-op)."""
    res = _resolve_proposal(doc, op, "reject")
    if isinstance(res, dict):
        return res
    hit, kind = res
    card_id = hit.card["id"]

    txn = _Txn(doc)
    live = txn.card_ref(hit.filename, hit.list_key, card_id)
    if live is None:
        die(f"card vanished while opening the transaction: {card_id}")
    live["status"] = "rejected"
    txn.mark(sidecar(doc, hit.filename))

    request_id = op.get("requestId") or hit.card.get("aiOriginRequestId")
    return _mutation_commit(
        doc, txn,
        summary=op.get("summary") or f"Rejected {kind} {card_id}",
        request_id=request_id,
        result=RESULT_REJECTED,
        extra={"op": "reject", "cardId": card_id, "cardKind": kind, "result": RESULT_REJECTED},
    )


# Op name → handler. One uniform spine (_mutation_commit), op-specific handlers —
# the family is "existing-card mutations through one contract". accept/reject
# (chip 13) join it to consummate an L3 proposal; accept is the one member that
# also carries a paper write (the .tex splice).
MUTATION_OPS = {
    "update": cmd_update,
    "archive": cmd_archive,
    "restore": cmd_restore,
    "move": cmd_move,
    "link": cmd_link,
    "accept": cmd_accept,
    "reject": cmd_reject,
}


# ---------------------------------------------------------------------------
# Subcommand semantics (shared by the CLI and the create-card consumer)
# ---------------------------------------------------------------------------


def run_write_subcommand(
    doc: Path, sub: str, op: dict, *, propose: bool = False, synthesize: bool = False
) -> dict:
    """Map a write subcommand name → its (status, result, apply_writes, comment)
    semantics and run it. One place owns the mapping, so the CLI dispatcher and
    create_card.py (which picks the subcommand from a Task's safetyLevel) can't
    drift apart."""
    if sub == "write-silent":
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_SILENT_APPLIED,
                         apply_writes=True, comment=False, synthesize=synthesize)
    if sub == "write-with-comment":
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_AUTO_APPLIED,
                         apply_writes=True, comment=True, synthesize=synthesize)
    if sub == "complete-task":
        if propose:
            # Level 3: the change is the *proposal* — draft the card, don't apply
            # the paper writes (.tex/.bib/…), leave the Task open (in-progress)
            # awaiting review.
            return cmd_write(doc, op, status=STATUS_IN_PROGRESS, result=None,
                             apply_writes=False, comment=False, synthesize=synthesize)
        # Direct create the user opted into: land the artifact now.
        return cmd_write(doc, op, status=STATUS_COMPLETE, result=RESULT_DIRECT_CREATED,
                         apply_writes=True, comment=False, synthesize=synthesize)
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
                # stamped (result=None), applying whatever paper edits the op
                # carries (a texEdit, and now a bibEdit/settingsEdit/annotationEdit).
                result = cmd_write(
                    doc, op, status=STATUS_COMPLETE, result=None,
                    apply_writes=True, comment=False, synthesize=False,
                )
    except SystemExit:
        raise  # die() already reported + set the exit code
    except Exception as e:  # noqa: BLE001 — convert to a clean error after rollback
        die(f"{type(e).__name__}: {e}")

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
