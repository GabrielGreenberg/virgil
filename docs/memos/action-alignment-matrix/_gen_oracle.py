#!/usr/bin/env python3
"""CHIP 8 expected-delta oracle generator.

Encodes the per-category oracle (from the CHIP 8 oracle synthesis prompt) and
emits two artifacts:
  - cells.json          flat Cartesian (action x applicableKind x surface) cell list
  - EXPECTED-MATRIX.md  human matrix + drive-live-first list + recipe appendix

The input JSON in the prompt was truncated mid-`bullet-list` (format-marks
category). The format-mark rows are structurally uniform (shared formatToggleRow
run, lightning-only surface, tiptap-chain backbone), so the tail rows are
reconstructed from that shared shape. Each reconstructed-tail field is flagged
in a comment; all upstream rows are verbatim from the oracle.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# The oracle, category by category. Each cell:
#   action, surfaces[], slashName, inputRulePattern, keybinding, runRef,
#   applicableKinds[{kind, applies, note?}], expected{...},
#   crossSurfaceIdentity, knownRisk
# `applies` in {"ok","disabled","absent"}. We expand ok+disabled (drop absent).
# ---------------------------------------------------------------------------

def K(kind, applies, note=""):
    d = {"kind": kind, "applies": applies}
    if note:
        d["note"] = note
    return d

CATEGORIES = []

# ============================ CARD ACTIONS (11) ============================
card_cells = []

card_cells.append({
    "action": "highlight",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:311 (case \"highlight\")",
    "applicableKinds": [
        K("selection", "ok", "non-empty range wraps; empty selection -> disabled via selection:'required'"),
        K("atom-only:inline-math", "ok", "math-only line selected/blocked-ref still has a range -> ok"),
        K("atom-bearing:citation", "ok"),
        K("paragraph", "ok", "block ref -> selection spans whole content range, mark wraps entire passage"),
        K("heading", "ok", "annotation action -> wraps the HEADING LINE only (collectAnnotationRange), never the section body"),
        K("blockquote", "ok"), K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes highlight"),
        K("displayMath", "ok", "NON_PROSE_BLOCK_ACTIONS keeps highlight (only F/C/suggest-edit dropped)"),
        K("codeBlock", "ok"), K("bulletList", "ok"), K("orderedList", "ok"),
        K("figureBlock", "ok"), K("texBlock", "ok"), K("latexComment", "ok"),
        K("linkedRange", "ok", "LINKED_RANGE_ACTIONS keeps highlight; grab menu never opens for linkedRange but applies() still computes ok"),
        K("selection:cursor-empty", "disabled", "empty/collapsed selection (mode 'cursor') -> disabled; the ONE card action with selection:'required'"),
    ],
    "expected": {
        "behavior": "Wraps the resolved range in a linkedAnchor mark (tintColor #fbbf24), mints a HighlightCard via createHighlight, binds the card to the anchor, selects+pins it in the notes panel omni view, focuses the new card. No-ops (break) if textBetween is empty.",
        "docDelta": "linkedAnchor mark added over the range (no block added/removed)",
        "sidecarDelta": "highlights/notes sidecar +1 HighlightCard; anchor linkCard attr stamped on the mark",
        "texDelta": "\\vlid{id}...\\vlidend{id} paired markers wrap the highlighted text on round-trip (linkedRange sourceMarker 'vlid')",
        "lifecycle": "card selected + pinned (recentlyAdded) in notes panel, NOT popped as a float (mode omni); focusNewCard drops caret into card",
    },
    "crossSurfaceIdentity": "grab and lightning both route to dragHandleMenu.dispatch('highlight', ref) - NOT row.run() - so they are byte-identical by construction (same dispatch case). The registry run() (cardRun->ctx.dispatch) is the declarative twin only.",
    "knownRisk": "Heading x highlight: must wrap heading LINE only (collectAnnotationRange) - a regression here corrupts \\section{} braces and strips every linkedAnchor on reload (the C9/C11 bug). Drive heading x highlight live first. Also verify empty-selection grey-out in cursor mode (lightning mode:'cursor').",
})

card_cells.append({
    "action": "note",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:296 (case \"note\")",
    "applicableKinds": [
        K("selection", "ok", "wantRangeAnchor -> drops a linkedAnchor mark + binds note"),
        K("paragraph", "ok", "block ref -> Mode-A paragraph anchor, NO mark"),
        K("heading", "ok", "annotation -> heading line"),
        K("blockquote", "ok"), K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok"), K("displayMath", "ok"), K("codeBlock", "ok"),
        K("figureBlock", "ok"), K("bulletList", "ok"), K("orderedList", "ok"),
        K("texBlock", "ok"), K("latexComment", "ok"), K("graphicsBlock", "ok"),
        K("linkedRange", "ok", "LINKED_RANGE_ACTIONS includes note"),
    ],
    "expected": {
        "behavior": "Creates a UserNote anchored to the paragraph (Mode-A) or, for a range source (selection/linkedRange with text), drops a 'note' linkedAnchor and binds the card to it. Selects+pins in the notes panel.",
        "docDelta": "for a range source: linkedAnchor mark added; for a block source: no doc change (Mode-A link only)",
        "sidecarDelta": "notes.json +1 UserNote; targetKind recorded (paragraph for selection/linkedRange, the ref kind otherwise)",
        "texDelta": "range source -> \\vlid markers; block source -> no .tex change (anchor lives in sidecar)",
        "lifecycle": "card selected + pinned in notes omni, focusNewCard into card body; not popped (mode omni)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('note', ref) directly - byte-identical. Mode-A vs Mode-B anchor branch hinges on ref.kind (selection/linkedRange -> range anchor; block -> paragraph anchor).",
    "knownRisk": "",
})

card_cells.append({
    "action": "footnote",
    "surfaces": ["grab", "lightning", "slash", "typed"],
    "slashName": "\\footnote",
    "inputRulePattern": "FOOTNOTE_RE_FULL (\\footnote{...}) - @/lib/footnote-commands",
    "keybinding": "",
    "runRef": "action-registry.ts:1158 (footnoteRun); grab/lightning -> drag-handle-actions.ts:253; slash -> commands.ts:177; typed -> footnote.ts:106 (handleTextInput)",
    "applicableKinds": [
        K("cursor", "ok", "slash/typed at caret -> adopt the synchronously-inserted atom"),
        K("selection", "ok", "collapse to range.to, insert empty footnote atom"),
        K("paragraph", "ok"),
        K("heading", "ok", "TITLE_FIELD/PROSE both include footnote; annotation -> heading line, collapse to to"),
        K("blockquote", "ok"), K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes footnote (round-trips as \\thanks{})"),
        K("linkedRange", "ok"),
        K("displayMath", "disabled", "NON_PROSE_BLOCK_ACTIONS DROPS footnote - no inline slot in a non-prose block"),
        K("codeBlock", "disabled"), K("bulletList", "disabled"), K("orderedList", "disabled"),
        K("figureBlock", "disabled"), K("texBlock", "disabled"), K("latexComment", "disabled"),
        K("graphicsBlock", "disabled"), K("exampleBlock", "disabled"),
    ],
    "expected": {
        "behavior": "grab/lightning: collapse selection to range.to, createFootnote({fromSelection:false}) -> inserts empty footnote atom + pristine+pinned card. slash/typed: PM caller ALREADY inserted the \\footnote{} atom synchronously; footnoteRun ADOPTS it via createFootnote({existingFootnoteId, pristine}) - pristine:true for blank, false for typed \\footnote{body} - then soft-routes into footnotes-side omni only if collapsed/blank.",
        "docDelta": "one inline footnote atom inserted (grab/lightning) or already-present (slash/typed, adopted not re-inserted)",
        "sidecarDelta": "footnotes sidecar +1; pristine flag set when body blank; renumberFootnotes() reflows numbers",
        "texDelta": "\\footnote{body} at the caret/passage-end (or \\thanks{} when inside a titleField/author)",
        "lifecycle": "card pristine (blank -> click-away-discardable), pinned, selected; slash/typed soft-route never force-opens Footnotes panel; menu mode omni",
    },
    "crossSurfaceIdentity": "All four surfaces must land the SAME footnote atom (footnoteId, number:0 pre-renumber, empty content) AND the SAME pristine+pinned+selected card lifecycle. Slash/typed adopt (no double-insert); menu inserts. Card footnoteId === atom footnoteId on every surface. CHIP 4b aligned slash/typed to the menu.",
    "knownRisk": "Pristine alignment: typed \\footnote{realtext} must pass pristine:false (footnote.ts:172 computes match[1].trim().length===0) so the click-away discarder doesn't reap a typed body. Drive typed-with-body live to confirm it is NOT reaped. Also: slash/typed adopt path runs renumberFootnotes but skips re-insert - verify no double-insert.",
})

card_cells.append({
    "action": "citation",
    "surfaces": ["grab", "lightning", "slash", "typed"],
    "slashName": "\\cite",
    "inputRulePattern": "CITE_RE_FULL (\\cite{key}) canonical; CITE_RE_BARE (\\cite ) second trigger - @/lib/cite-commands",
    "keybinding": "",
    "runRef": "action-registry.ts:1070 (citationRun); grab/lightning -> drag-handle-actions.ts:273; slash -> commands.ts:138; typed full -> citation.ts:149, bare -> citation.ts:182",
    "applicableKinds": [
        K("cursor", "ok", "slash/typed: atom already inserted, register card with same citationId"),
        K("selection", "ok", "collapse to range.to, insert [cite] pill, anchored card"),
        K("paragraph", "ok"), K("heading", "ok"), K("blockquote", "ok"),
        K("listItem", "ok"), K("exampleItem", "ok"), K("linkedRange", "ok"),
        K("titleField", "disabled", "TITLE_FIELD_ACTIONS DROPS citation (a title has no bibliography)"),
        K("displayMath", "disabled", "NON_PROSE_BLOCK_ACTIONS DROPS citation"),
        K("codeBlock", "disabled"), K("bulletList", "disabled"), K("orderedList", "disabled"),
        K("figureBlock", "disabled"), K("texBlock", "disabled"), K("latexComment", "disabled"),
        K("graphicsBlock", "disabled"), K("exampleBlock", "disabled"),
    ],
    "expected": {
        "behavior": "grab/lightning: collapse to range.to, mint citationId, handle.insertCitation('\\cite{}', id, '') drops the pill, createCitation({command:'\\cite{}', citationId, unanchored:false}) registers the anchored card. slash/typed: PM caller already inserted the citation atom; citationRun registers the card with the SAME citationId+command and soft-routes into citations-side omni, focusing the library-picker.",
        "docDelta": "one inline citation atom inserted (grab/lightning) or already-present (slash/typed)",
        "sidecarDelta": "citations.json +1 CitationRef {id, command, keys (parsed from command), createdAt, unanchored absent (anchored)}; pristine marked when keys empty",
        "texDelta": "\\cite{} (empty) or \\cite{key} (typed full) at the passage-end/caret",
        "lifecycle": "anchored card selected + pinned; slash/typed focus the library-picker input and soft-route only if citations side collapsed/blank",
    },
    "crossSurfaceIdentity": "Atom attrs {citationId, command, displayText:''} must be byte-identical across surfaces. CitationRef sidecar shape identical (id===citationId; keys parsed from command). Difference: typed \\cite{key} carries the FULL command (renders keys) while menu/slash carry empty \\cite{}.",
    "knownRisk": "Typed \\cite{key} was the CHIP 4a-ii bug fix (previously made NO card). Drive typed full-command live: verify the card renders the parsed keys (command preserved) and is anchored. Verify bare \\cite followed by space also registers an anchored card (citation.ts:182). Both must share the citationId of the synchronously-inserted atom.",
})

card_cells.append({
    "action": "todo",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:330 (case \"todo\")",
    "applicableKinds": [
        K("selection", "ok", "seeds todo text from selected text"),
        K("paragraph", "ok"), K("heading", "ok"), K("blockquote", "ok"),
        K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes todo"),
        K("displayMath", "ok", "NON_PROSE_BLOCK_ACTIONS keeps todo"),
        K("codeBlock", "ok"), K("figureBlock", "ok"), K("bulletList", "ok"),
        K("orderedList", "ok"), K("texBlock", "ok"), K("latexComment", "ok"),
        K("graphicsBlock", "ok"), K("linkedRange", "ok"),
    ],
    "expected": {
        "behavior": "Creates a TodoItem (addTodo), seeds its text from the selected/block text if present, and writes a Mode-A textObjectId link to the paragraph (addTodoTextObjectId). Selects+pins in the todo panel.",
        "docDelta": "none (todo is purely a sidecar card with a Mode-A anchor; no mark, no atom)",
        "sidecarDelta": "todos.json +1 TodoItem; textObjectIds link records paragraphId + targetKind",
        "texDelta": "none (todo anchor lives entirely in the sidecar)",
        "lifecycle": "card selected + pinned in todo omni, focusNewCard into card; not popped (mode omni)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('todo', ref) directly - byte-identical. Todo is anchor-by-paragraph-uuid only (no linkedAnchor even for selection refs - note the case does NOT call createAnchor).",
    "knownRisk": "",
})

card_cells.append({
    "action": "suggest-edit",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:341 (case \"suggest-edit\")",
    "applicableKinds": [
        K("selection", "ok", "range source -> 'revision' linkedAnchor + bound card"),
        K("paragraph", "ok"), K("heading", "ok"), K("blockquote", "ok"),
        K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes suggest-edit"),
        K("linkedRange", "ok"),
        K("displayMath", "disabled", "NON_PROSE_BLOCK_ACTIONS DROPS suggest-edit"),
        K("codeBlock", "disabled"), K("bulletList", "disabled"), K("orderedList", "disabled"),
        K("figureBlock", "disabled"), K("texBlock", "disabled"), K("latexComment", "disabled"),
        K("graphicsBlock", "disabled"), K("exampleBlock", "disabled"),
    ],
    "expected": {
        "behavior": "Creates a RevisionComment card (createRevisionComment) in the Revisions panel - the quick gesture drafts a revision-COMMENT (the conversation opener), NOT a suggestion-with-rewrite. Drops a 'revision' linkedAnchor for a range source and binds the card.",
        "docDelta": "range source -> linkedAnchor mark; block source -> none (Mode-A)",
        "sidecarDelta": "revisions.json +1 RevisionCommentCard; targetKind recorded",
        "texDelta": "range source -> \\vlid markers; block source -> none",
        "lifecycle": "card selected + pinned in revisions omni, focusNewCard; not popped (mode omni)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('suggest-edit', ref) directly - byte-identical. The action id 'suggest-edit' maps to a revision-COMMENT card (not revision-suggestion); the suggestion-with-rewrite is a separate responder-skill output.",
    "knownRisk": "Low-medium. The label says 'suggest edit' but the gesture produces a comment card - verify the produced card kind is revision-comment (not revision-suggestion). The NON_PROSE_BLOCK drop of suggest-edit (alongside F/C) is easy to get wrong if NON_PROSE_BLOCK_ACTIONS is edited.",
})

card_cells.append({
    "action": "cutter",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:356 (case \"cutter\")",
    "applicableKinds": [
        K("selection", "ok", "range -> 'cutter-comment' linkedAnchor + bound card"),
        K("paragraph", "ok"), K("heading", "ok"), K("blockquote", "ok"),
        K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes cutter"),
        K("displayMath", "ok", "NON_PROSE_BLOCK_ACTIONS keeps cutter"),
        K("codeBlock", "ok"), K("figureBlock", "ok"), K("bulletList", "ok"),
        K("orderedList", "ok"), K("texBlock", "ok"), K("latexComment", "ok"),
        K("graphicsBlock", "ok"), K("linkedRange", "ok"),
    ],
    "expected": {
        "behavior": "Creates a CutterComment card ('Suggest cut') via createCutterComment in the Cutter panel. Drops a 'cutter-comment' linkedAnchor for a range source and binds the card.",
        "docDelta": "range source -> linkedAnchor mark; block source -> none (Mode-A)",
        "sidecarDelta": "cutter.json +1 CutterCommentCard; targetKind recorded",
        "texDelta": "range source -> \\vlid markers; block source -> none",
        "lifecycle": "card selected + pinned in cutter omni, focusNewCard; not popped (mode omni)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('cutter', ref) directly - byte-identical. Produces a cutter-COMMENT (not cutter-suggestion).",
    "knownRisk": "Low. Verify the produced kind is cutter-comment. cutter is in NON_PROSE_BLOCK_ACTIONS (unlike suggest-edit), so it stays enabled on non-prose blocks - confirm the asymmetry with suggest-edit.",
})

card_cells.append({
    "action": "report",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:378 (case \"report\")",
    "applicableKinds": [
        K("selection", "ok", "range -> 'report-request' linkedAnchor + bound card"),
        K("paragraph", "ok"), K("heading", "ok"), K("blockquote", "ok"),
        K("listItem", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "TITLE_FIELD_ACTIONS includes report"),
        K("displayMath", "ok", "NON_PROSE_BLOCK_ACTIONS keeps report"),
        K("codeBlock", "ok"), K("figureBlock", "ok"), K("bulletList", "ok"),
        K("orderedList", "ok"), K("texBlock", "ok"), K("latexComment", "ok"),
        K("graphicsBlock", "ok"), K("linkedRange", "ok"),
    ],
    "expected": {
        "behavior": "Files a Report REQUEST (the ask), NOT an authored Report - createReportRequest in the Reports panel. Drops a 'report-request' linkedAnchor for a range source and binds the card.",
        "docDelta": "range source -> linkedAnchor mark; block source -> none (Mode-A)",
        "sidecarDelta": "reports.json +1 ReportRequestCard (kind report-request, not report); targetKind recorded",
        "texDelta": "range source -> \\vlid markers; block source -> none",
        "lifecycle": "card selected + pinned in reports omni, focusNewCard; not popped (mode omni)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('report', ref) directly - byte-identical. The id 'report' produces a report-REQUEST card (the quick gesture files the ask; an AI authors the actual Report later).",
    "knownRisk": "Low-medium. Verify the produced kind is report-request (not report). Both report and report-request pin under the same 'reports' RecentlyAddedKind bucket.",
})

card_cells.append({
    "action": "duplicate",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "",
    "keybinding": "D (menu-scoped letter hint, grab/lightning surface - NOT a global keybinding)",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:402 (case \"duplicate\"); heading confirm: drag-handle-actions.ts:180,664 (confirmHeadingLifecycle)",
    "applicableKinds": [
        K("selection", "ok"), K("paragraph", "ok"),
        K("heading", "ok", "LIFECYCLE action -> whole SECTION duplicated; wide-scope confirm (confirmHeadingLifecycle), non-destructive so NOT via confirmDestructive"),
        K("blockquote", "ok"), K("codeBlock", "ok"), K("listItem", "ok"),
        K("exampleItem", "ok"), K("bulletList", "ok"), K("orderedList", "ok"),
        K("displayMath", "ok", "atom block -> NodeSelection on the clone, not TextSelection.near"),
        K("figureBlock", "ok"), K("texBlock", "ok"), K("graphicsBlock", "ok"),
        K("latexComment", "ok"), K("exampleBlock", "ok"),
        K("titleField", "disabled", "TITLE_FIELD_ACTIONS DROPS duplicate (singleton; also caught by pre-dispatch tr.doc.check())"),
        K("linkedRange", "disabled", "LINKED_RANGE_ACTIONS DROPS duplicate (cloning a mark-backed range mints two marks with the same id -> linkedAnchor id-uniqueness violation)"),
    ],
    "expected": {
        "behavior": "Resolves the OUTER node range (outerRangeFor - heading -> whole section), slices the doc, clones via duplicateSlice (mints fresh anchorIds + new linkCard keys + forks sidecar entries via cardLifecycle.clone), validates the new doc with tr.doc.check() BEFORE dispatch, inserts the clone after outer.to, places NodeSelection (atom blocks) or caret-near (text), then rewireClonedAnchors binds each cloned card's links to the new mark.",
        "docDelta": "block(s) added - a duplicate of the outer node range inserted immediately after it (whole section for heading)",
        "sidecarDelta": "for each cloned linkedAnchor/atom in the slice: cardLifecycle.clone forks a new sidecar entry (fresh id); cloned cards' links rewired to the clone",
        "texDelta": "duplicated block(s) re-serialized with fresh \\vlid/\\footnote/\\cite ids; section duplicate for heading",
        "lifecycle": "no card produced (duplicate is structural); clone selected via NodeSelection/caret; heading x duplicate shows a section-scope confirm first (cancel = silent no-op)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('duplicate', ref) directly - byte-identical. The whole duplicate flow (fail-loud B1: stale ref/empty slice/schema reject -> notify+abort) lives in ONE dispatch case.",
    "knownRisk": "HIGH - drive live first. Atom-only / atom-bearing: cloning a slice carrying footnote/citation/inline-math atoms must mint FRESH atom ids (else duplicate ids corrupt renumber - the atom_drag observer bug class). titleField x duplicate is double-guarded (action-set drop + tr.doc.check); confirm both. linkedRange x duplicate is dropped (id-uniqueness). Heading duplicate must copy the WHOLE section and warn. The pre-dispatch tr.doc.check() is the only thing preventing a doomed transaction.",
})

card_cells.append({
    "action": "archive",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "",
    "keybinding": "A (menu-scoped letter hint, grab/lightning surface - NOT global)",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:486 (case \"archive\"); destructive confirm: drag-handle-actions.ts:172,711 (resolveDestructiveConfirm) + per-kind confirmDestructive in text-object-registry.ts",
    "applicableKinds": [
        K("selection", "ok", "sub-range archive; source paragraph survives so keeps its uuid as anchor; word-count confirm"),
        K("atom-only:inline-math", "ok", "$\\lambda$-only line: NOT silently no-op'd - slice content.size>0 so it archives; confirm surfaces. Fixed in 80170b3/63ccace."),
        K("atom-only:citation", "ok", "citation-only line archives; confirm shown"),
        K("atom-only:footnote", "ok"),
        K("paragraph", "ok", "descriptorForSimpleBlock; silent (null confirm) iff empty AND no anchors/atoms"),
        K("heading", "ok", "LIFECYCLE -> whole SECTION; descriptorForHeading wide-scope confirm"),
        K("blockquote", "ok"), K("codeBlock", "ok"),
        K("listItem", "ok", "cascade: last item collapses the list wrapper too"),
        K("exampleItem", "ok"),
        K("bulletList", "ok", "descriptorForContainer (item count)"), K("orderedList", "ok"),
        K("displayMath", "ok", "atom block -> always-warn confirm; NodeSelection extraction"),
        K("figureBlock", "ok"), K("texBlock", "ok"), K("graphicsBlock", "ok"),
        K("latexComment", "ok", "confirmDestructive returns null (never warn - author noise)"),
        K("exampleBlock", "ok"),
        K("linkedRange", "ok", "always-danger confirm (underlying text also archived)"),
        K("titleField", "disabled", "TITLE_FIELD_ACTIONS DROPS archive"),
    ],
    "expected": {
        "behavior": "Bail ONLY when the resolved range has NO content at all (slice content.size===0) - an atom-only line has empty textContent but non-empty slice, so it archives. Resolve outer range, expandCascadeRange, snapshot rich slice JSON (sliceToDocJson), resolve reanchor target (findPreviousAnchorableBlock for block / keep source paragraph for selection), cleanupLinksInRange (lifecycle.delete each sidecar), delete with LIFECYCLE_DELETE_META, then createArchiveSnippet.",
        "docDelta": "the outer/cascade-extended range deleted from the doc (block removed; wrapper swallowed if emptied)",
        "sidecarDelta": "archive.json +1 ArchivedSnippet (rich content snapshot + reanchored paragraphId/targetKind); any linkedAnchor/atom sidecars inside the range deleted via cardLifecycle",
        "texDelta": "the archived block's .tex removed; its content preserved in the archive snippet sidecar (not the .tex)",
        "lifecycle": "snippet selected + pinned in archive omni; LIFECYCLE_DELETE_META suppresses MarginaliaAnchorGuard re-insert; TextObjectOrphanGuard sweeps orphaned Mode-A cards; per-kind confirm gates (cancel = silent no-op)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('archive', ref) directly - byte-identical. The destructive-confirm resolution (resolveDestructiveConfirm -> per-kind meta.confirmDestructive, or confirmSelectionDestructive for selection refs) is shared in ONE place.",
    "knownRisk": "HIGH - drive live first. Atom-only line archive was a real bug (silently no-op'd, fixed 80170b3): verify $\\lambda$-only / citation-only / footnote-only lines DO archive AND surface the destructive confirm. The empty-content bail uses slice content.size, NOT textContent. Cascade (last listItem/exampleItem collapses wrapper) and heading whole-section archive both need live checks. Reanchor: block source walks to previous anchorable; selection source keeps source paragraph.",
})

card_cells.append({
    "action": "delete",
    "surfaces": ["grab", "lightning"],
    "slashName": "", "inputRulePattern": "",
    "keybinding": "Backspace / Delete (menu-scoped, grab surface - fires only while the menu is open, DragHandleMenu.tsx:148; NOT global). Letter hint del.",
    "runRef": "action-registry.ts:1022 (cardRun) -> drag-handle-actions.ts:578 (case \"delete\"); destructive confirm: drag-handle-actions.ts:172,711",
    "applicableKinds": [
        K("selection", "ok", "word-count confirm (confirmSelectionDestructive)"),
        K("atom-only:inline-math", "ok", "math/cite/footnote-only line is deletable AND surfaces the destructive confirm (was silently deletable before 63ccace)"),
        K("atom-only:citation", "ok"), K("atom-only:footnote", "ok"),
        K("paragraph", "ok", "descriptorForSimpleBlock w/ preview; null (silent) iff empty AND no anchors/atoms"),
        K("heading", "ok", "LIFECYCLE -> whole SECTION; descriptorForHeading; tone danger"),
        K("blockquote", "ok"), K("codeBlock", "ok"),
        K("listItem", "ok", "cascade: last item swallows the list wrapper (no PM auto-fill placeholder)"),
        K("exampleItem", "ok"),
        K("bulletList", "ok", "descriptorForContainer (item count)"), K("orderedList", "ok"),
        K("displayMath", "ok", "atom block -> always-warn; danger tone"),
        K("figureBlock", "ok", "deletes figure + caption"),
        K("texBlock", "ok"), K("graphicsBlock", "ok"),
        K("latexComment", "ok", "confirmDestructive null -> no warning (author noise, cheap to redo)"),
        K("exampleBlock", "ok"),
        K("linkedRange", "ok", "always-danger confirm (underlying text + anchored cards removed)"),
        K("titleField", "disabled", "TITLE_FIELD_ACTIONS DROPS delete"),
    ],
    "expected": {
        "behavior": "Resolve outer range (heading -> whole section), expandCascadeRange (swallow a wrapper that would be emptied - so PM content-rule auto-fill never injects a placeholder), cleanupLinksInRange (lifecycle.delete each sidecar-bearing footnote/citation atom + linkedAnchor mark in range), then delete with LIFECYCLE_DELETE_META. NO snapshot/archive - the content is gone.",
        "docDelta": "the outer/cascade-extended range deleted; emptied wrapper removed too",
        "sidecarDelta": "every linkedAnchor/atom sidecar inside the range deleted via cardLifecycle.delete (no orphan sidecar entries left)",
        "texDelta": "the block's .tex removed entirely (along with nested \\footnote/\\cite/\\vlid markers)",
        "lifecycle": "no card produced; LIFECYCLE_DELETE_META suppresses MarginaliaAnchorGuard re-insert; TextObjectOrphanGuard sweeps orphaned Mode-A cards; per-kind destructive confirm (danger tone) gates - cancel = silent no-op; on no-card path ed.view.focus() restores focus so Cmd-Z reaches the doc (B4)",
    },
    "crossSurfaceIdentity": "grab and lightning both dispatch('delete', ref) directly - byte-identical. Shares the destructive-confirm resolution + cascade + cleanup with archive (delete is archive minus the snapshot+snippet).",
    "knownRisk": "HIGH - drive live first. Atom-only/atom-bearing: a math/cite/footnote-only line was SILENTLY DELETABLE without a confirm before 63ccace - verify the destructive confirm now surfaces. Cleanup must remove the nested footnote/citation sidecars (no orphans). Cascade on last listItem/exampleItem must swallow the wrapper. Heading delete = whole section, danger tone. Confirm focus restoration (B4) after the confirm dialog closes so Cmd-Z works. titleField delete must be disabled (singleton protection).",
})

CATEGORIES.append(("Card actions (11)", card_cells))

# ========================= HEADING + TITLE (7) =========================
ht_cells = []

def heading_row(action, slash, level, cmd, extra_kinds=None):
    kinds = [
        K("selection", "ok", "selection/cursor base 'ok' (always sits in a convertible text block). Gated only by collab via gateApplies."),
        K("paragraph", "ok", "Non-atom-block text block -> convertible."),
        K("heading", "ok", "Re-levels an existing heading. SET, not toggle."),
        K("blockquote", "ok", "Non-atom-block, text-bearing -> base 'ok'."),
        K("codeBlock", "ok", "Non-atom-block per registry -> 'ok' (text-bearing in the schema)."),
        K("titleField", "ok", "Non-atom-block -> 'ok'; in practice only invoked from a caret in body text."),
        K("displayMath", "disabled", "isAtomBlock -> base 'disabled' (no text to convert)."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
    ]
    if extra_kinds:
        kinds = extra_kinds
    return {
        "action": action, "surfaces": ["slash", "lightning"],
        "slashName": slash, "inputRulePattern": "", "keybinding": "",
        "runRef": f"action-registry.ts:1236 (headingRun, factory); headingRow(\"{action}\"); level {level}",
        "applicableKinds": kinds,
        "expected": {
            "behavior": f"Convert the current block (containing selection.from..to) to heading level {level} ({cmd}), ALWAYS SET (never toggle-off) with numbered:true. setBlockType(selection.from, selection.to, heading, {{level:{level}, numbered:true}}); view.dispatch. No card, no popover. Collab read-only (canEdit===false) -> no-op.",
            "docDelta": f"One block setBlockType'd to heading{{level:{level}, numbered:true}}; existing uuid preserved; no block count change.",
            "sidecarDelta": "None - pure-PM, no sidecar.",
            "texDelta": f"On serialize: the line becomes {cmd}{{<content>}}; section auto-numbering recomputed by the heading-extension appendTransaction (editor-extensions.ts:1560).",
            "lifecycle": "No card produced. No float, no pin/pristine.",
        },
        "crossSurfaceIdentity": f"slash ({slash}) and lightning (BlockTypeDropdown level {level} via applyHeadingFromDropdown->spec.run) MUST produce a byte-identical setBlockType to heading{{level:{level}, numbered:true}} on selection.from..to. Both build a {{kind:'cursor', pos:selection.head}} ref and invoke the SAME headingRun. canEdit: slash reads view.editable, lightning reads editor.isEditable - same flag.",
    }

c = heading_row("heading-chapter", "chapter", 1, "\\chapter",
    extra_kinds=[
        K("selection", "ok", "selection/cursor base 'ok' (always sits in a convertible text block). Gated only by collab via gateApplies (DA-5 range no-op for 'ignored')."),
        K("atom-only:inline-math", "ok", "A CURSOR ref (slash) is always base 'ok' regardless of surrounding atom - slash fires from a caret. setBlockType converts the CONTAINING paragraph."),
        K("paragraph", "ok", "TextObjectRef path - non-atom-block kind -> base 'ok' (text-bearing, convertible)."),
        K("heading", "ok", "Already a heading; setBlockType re-sets level+numbered (idempotent-ish re-level)."),
        K("blockquote", "ok", "Non-atom-block, text-bearing -> base 'ok'."),
        K("codeBlock", "ok", "Non-atom-block per registry -> 'ok' (codeBlock is text-bearing in the schema)."),
        K("titleField", "ok", "Non-atom-block -> 'ok'; in practice only invoked from a caret (slash/dropdown) inside body text."),
        K("displayMath", "disabled", "isAtomBlock -> base 'disabled' (no text to convert)."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
    ])
c["knownRisk"] = "REAL multi-surface divergence OUTSIDE the registry: the Heading extension is configure({levels:[0..6]}), and that comment states levels drive BOTH 'input rules and keyboard shortcuts'. So StarterKit's Mod-Alt-1 and the markdown '# ' input rule are LIVE and call TipTap's toggleHeading/setHeading - a TOGGLE path that the alignment effort deliberately replaced with always-SET. A user pressing Mod-Alt-1 on an existing level-1 heading will toggle it back to paragraph - diverging from slash/dropdown SET. Drive this live: Mod-Alt-1 twice toggles, vs \\chapter twice stays a heading. Also confirm '# ' input rule numbered:true consistency."
ht_cells.append(c)

c = heading_row("heading-section", "section", 2, "\\section",
    extra_kinds=[
        K("selection", "ok", "Same applies() as heading-chapter - selection/cursor -> 'ok'."),
        K("paragraph", "ok", "Non-atom-block text block -> convertible."),
        K("heading", "ok", "Re-levels an existing heading (e.g. chapter->section). SET, not toggle."),
        K("displayMath", "disabled", "isAtomBlock -> 'disabled'."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock -> 'disabled'."),
    ])
c["crossSurfaceIdentity"] = "slash \\section and lightning BlockTypeDropdown level 2 route through the SAME headingRun(2); identical setBlockType{level:2, numbered:true} tx, identical serialized \\section{}."
c["knownRisk"] = "Same keyboard/input-rule TOGGLE divergence as heading-chapter (Mod-Alt-2 / a markdown rule toggle vs the registry SET). The dropdown's prior behavior toggled; CHIP 5a unified on SET. Drive live: dropdown 'Section' on an existing section must STAY a section (no revert); 'Body' (setParagraph) is the ONLY way out."
ht_cells.append(c)

c = heading_row("heading-subsection", "subsection", 3, "\\subsection",
    extra_kinds=[
        K("selection", "ok", "selection/cursor -> 'ok'."),
        K("paragraph", "ok", "Convertible text block."),
        K("heading", "ok", "Re-levels to subsection."),
        K("displayMath", "disabled", "isAtomBlock -> 'disabled'."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock -> 'disabled'."),
    ])
c["crossSurfaceIdentity"] = "slash \\subsection and lightning dropdown level 3 -> same headingRun(3); identical tx + \\subsection{} output."
c["knownRisk"] = "Same keyboard-toggle (Mod-Alt-3) / input-rule divergence as the other heading rows. Lower priority to drive than chapter/section (less common), but the same root: levels[] enables StarterKit shortcuts that toggle."
ht_cells.append(c)

c = heading_row("heading-subsubsection", "subsubsection", 4, "\\subsubsection",
    extra_kinds=[
        K("selection", "ok", "selection/cursor -> 'ok'."),
        K("paragraph", "ok", "Convertible text block."),
        K("heading", "ok", "Re-levels to subsubsection."),
        K("displayMath", "disabled", "isAtomBlock -> 'disabled'."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock -> 'disabled'."),
    ])
c["crossSurfaceIdentity"] = "slash \\subsubsection and lightning dropdown level 4 -> same headingRun(4); identical tx + \\subsubsection{} output."
c["knownRisk"] = "Same keyboard-toggle (Mod-Alt-4) / input-rule divergence. NOTE the dropdown also lists out-of-registry levels 0 (Part), 5 (Paragraph heading), 6 (Subparagraph heading) which fall to a DIRECT setNode fallback - also SET+numbered but NOT through a registry row, so no slash twin and no coverage row. If a future chip adds \\part etc., verify the fallback stays SET-consistent."
ht_cells.append(c)

# title / author / date (slash-only)
ht_cells.append({
    "action": "title", "surfaces": ["slash"],
    "slashName": "title", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1276 (titleFieldRun, factory) via titleFieldRow(\"title\"):1382; routed by runViewOnlyAction(\"title\") commands.ts:93",
    "applicableKinds": [
        K("selection", "ok", "blockApplies base 'ok'. selection-mode 'ignored' so range never greys it. In practice ONLY invoked from a caret (slash)."),
        K("cursor", "ok", "The actual invocation ref (slash builds a CursorRef). titleFieldRun ignores the ref and reads the live doc top to find-or-insert."),
        K("paragraph", "ok", "Non-atom-block -> 'ok' by blockApplies. Theoretical TextObjectRef path; no menu surface exposes it (slash-only)."),
        K("titleField", "ok", "The idempotent path: if a 'title' titleField already exists, places the caret at end of its content (no duplicate)."),
        K("displayMath", "disabled", "blockApplies isAtomBlock -> 'disabled'. Unreachable in practice (slash-only)."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
    ],
    "expected": {
        "behavior": "IDEMPOTENT find-existing-or-insert of a \\title titleField at the doc top. Scans top-level children for titleField{field:'title'}. IF FOUND: no node mutation, place caret at end of content, scrollIntoView - NO duplicate. IF ABSENT: insert titleField{field:'title', rawPrefix:null, isToday:false, uuid:fresh} at canonical order position 0, caret inside empty content. Collab read-only -> no-op. SLASH-ONLY (a doc-top singleton, not a card).",
        "docDelta": "If absent: +1 titleField node at the doc top (order index 0). If present: ZERO doc mutation (caret move only).",
        "texDelta": "If absent: +\\title{} line on serialize. If present: no .tex change.",
        "sidecarDelta": "None - pure-PM, no card sidecar.",
        "lifecycle": "No card, no float. The titleField renders as an in-doc lozenge, not a panel card.",
    },
    "crossSurfaceIdentity": "SLASH-ONLY - no cross-surface byte-match required. The invariant is INTERNAL idempotency: a second \\title must NOT create a second titleField. Minted attrs (field:'title', rawPrefix:null, isToday:false, fresh uuid) must match what the .tex parser produces on reload.",
    "knownRisk": "Drive live FIRST: the IDEMPOTENT branch is divergence-prone. (1) Run \\title twice - second must be a no-op caret-move, NOT a duplicate node. (2) Run \\title when a titleField exists but is NOT at index 0 - find scans ALL children so it should dedupe; confirm. (3) Canonical-order insert walks childOrder; verify a \\title inserted when only \\date exists lands BEFORE \\date (title order 0 < date order 2).",
})

ht_cells.append({
    "action": "author", "surfaces": ["slash"],
    "slashName": "author", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1276 (titleFieldRun) via titleFieldRow(\"author\"):1382; routed by runViewOnlyAction(\"author\") commands.ts:94",
    "applicableKinds": [
        K("cursor", "ok", "Slash builds a CursorRef -> blockApplies 'ok'. Ref ignored by run; doc-top find-or-insert."),
        K("selection", "ok", "blockApplies base 'ok'; selection 'ignored' so range never greys."),
        K("titleField", "ok", "Idempotent: existing author field -> caret to content end, no duplicate."),
        K("displayMath", "disabled", "isAtomBlock -> 'disabled' (theoretical; slash-only)."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
    ],
    "expected": {
        "behavior": "IDEMPOTENT find-or-insert of a \\author titleField. Same mechanics as 'title' but field:'author', canonical order index 1 (between title=0 and date=2). If exists -> caret to end, no duplicate. If absent -> insert at order position 1, empty content, caret inside. Collab read-only -> no-op.",
        "docDelta": "If absent: +1 titleField{field:'author'} at order index 1 (after any \\title, before any \\date / non-title). If present: zero doc mutation (caret move only).",
        "texDelta": "If absent: +\\author{} on serialize. If present: no change.",
        "sidecarDelta": "None.",
        "lifecycle": "No card, no float - in-doc lozenge.",
    },
    "crossSurfaceIdentity": "Slash-only - no cross-surface match required. Invariant: idempotency (no duplicate author field) + canonical ordering (author between title and date). Minted attrs round-trip identically to a parsed \\author.",
    "knownRisk": "Ordering insert is the risk: with both \\title and \\date present, \\author must land at index 1 (between them). Verify live. Also verify idempotent no-op on a second \\author.",
})

ht_cells.append({
    "action": "date", "surfaces": ["slash"],
    "slashName": "date", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1276 (titleFieldRun) via titleFieldRow(\"date\"):1382; routed by runViewOnlyAction(\"date\") commands.ts:95",
    "applicableKinds": [
        K("cursor", "ok", "Slash CursorRef -> blockApplies 'ok'. Ref ignored; doc-top find-or-insert."),
        K("selection", "ok", "blockApplies base 'ok'; selection 'ignored'."),
        K("titleField", "ok", "Idempotent: existing date field -> caret to content end, no duplicate (does NOT re-stamp today)."),
        K("displayMath", "disabled", "isAtomBlock -> 'disabled' (theoretical; slash-only)."),
        K("texBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
        K("figureBlock", "disabled", "isAtomBlock -> 'disabled' (theoretical)."),
    ],
    "expected": {
        "behavior": "IDEMPOTENT find-or-insert of a \\date titleField, with a DATE-SPECIFIC pre-fill. On INSERT: attrs include isToday:true, nodeContent pre-filled with today's date pretty-printed (toLocaleDateString en-US); isToday:true tells the serializer to emit \\date{\\today} rather than the literal. On FIND-EXISTING: caret to end, NO re-stamp of today. Collab read-only -> no-op.",
        "docDelta": "If absent: +1 titleField{field:'date', isToday:true, content=pretty-printed today} at order index 2. If present: zero doc mutation (caret move only).",
        "texDelta": "If absent: +\\date{\\today} on serialize (because isToday:true, NOT the expanded literal). If present: no change.",
        "sidecarDelta": "None.",
        "lifecycle": "No card, no float - in-doc lozenge showing the pretty date.",
    },
    "crossSurfaceIdentity": "Slash-only. Invariant: idempotency + the \\today special-case must round-trip: an inserted date (isToday:true, pretty content) serializes to \\date{\\today}, and re-parsing \\date{\\today} must reproduce isToday:true + the same pretty rendering. Canonical order index 2.",
    "knownRisk": "Drive live FIRST - date carries the most behavior. (1) Verify INSERT pre-fills today's pretty date AND serializes to \\date{\\today} (NOT \\date{June 14, 2026}). (2) Verify FIND-EXISTING does NOT overwrite a user-edited date with today. (3) Verify canonical ordering: \\date lands LAST among title fields (index 2); with \\maketitle present it goes BEFORE \\maketitle (order:99 for non-titles). This \\maketitle-ordering is the subtlest case.",
})

CATEGORIES.append(("Heading + title (7)", ht_cells))

# ========================= BLOCK INSERTS (6) =========================
bi_cells = []

bi_cells.append({
    "action": "example", "surfaces": ["slash", "lightning"],
    "slashName": "ex", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1748 (exampleRun); template buildExampleNode:1655; EXAMPLE_ACTION_ROW:1823",
    "applicableKinds": [
        K("selection", "ok", "SelectionRef -> blockApplies base 'ok'. The WRAP path: harvests inline content from the slice."),
        K("cursor", "ok", "CursorRef (slash caret) -> base 'ok'. INSERT empty single example at caret."),
        K("paragraph", "ok", "isAtomBlock:false -> base 'ok' via blockApplies."),
        K("heading", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled' (no caret to insert at)."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "When ctx.canEdit === false: gateApplies layer (1) -> 'disabled' uniformly, regardless of kind."),
    ],
    "expected": {
        "behavior": "Wrap-if-selection-else-insert. Non-empty selection -> WRAP: extractInlineFromSlice harvests ONLY inline nodes, deleteSelection() then insert a SINGLE exampleBlock seeded with that inline content in its first item paragraph. Whitespace-only harvest -> empty-template fallback. Collapsed caret -> INSERT an empty single example. After insert, caret PARKED inside the new block's first editable paragraph (by uuid). scrollIntoView. Slash additionally soft-selects in an ALREADY-open Examples panel. No-op when ctx.canEdit===false.",
        "docDelta": "One exampleBlock added (kind:'single', attrs uuid + tag/label/exnoOverride:null/suppressSpace:false/number:0), content = [paragraph] (seeded inline on wrap, empty on insert). On wrap the selected range is deleted first. buildExampleNode is the SSOT.",
        "texDelta": "\\ex <inline content>\\vexid{<uuid>}\\n (serializeExampleBlock). Empty insert -> \\ex with empty body. Requires \\providecommand{\\vexid}[1]{}.",
        "sidecarDelta": "None - exampleBlock is a pure in-doc node. The only out-of-doc effect is the transient Examples-panel selectedExampleId state (slash surface).",
        "lifecycle": "No card produced. Caret parked in new block's first paragraph. Slash: selectedExampleId set to new uuid (soft panel-select, no force-open).",
    },
    "crossSurfaceIdentity": "Both surfaces route through the ONE exampleRun: same exampleBlock node, same firstParagraph seeding, same uuid-collision scan, same caret-park, same .tex round-trip. The ONLY intentional difference: slash threads panelRouting.selectExample (soft panel-select); the lightning grid omits panelRouting entirely - by design.",
    "knownRisk": "Drive the WRAP-on-atom-only-selection case live FIRST: when the selection holds ONLY an inline atom (citation/$\\lambda$/\\ref) and no text, extractInlineFromSlice returns it via hasUsable=true and WRAPS it - unlike texRun/mathRun which BAIL on an atom-only selection. example's atom-only behavior INTENTIONALLY diverges from tex/math: example MOVES the atom into the item paragraph. Verify the atom survives the deleteSelection->insert round-trip (the observer multi-step move-bug class). Also: the lightning grid uses a SEPARATE hand-rolled ctx builder (wrapSelectionInExample, ActionsMenuPanel:274) that calls exampleRun directly - verify it stays in sync with the bridge ctx.",
})

bi_cells.append({
    "action": "tex", "surfaces": ["slash", "lightning"],
    "slashName": "tex", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1441 (texRun); TEX_ACTION_ROW:1490; lightning delegate tex-block.ts:125 (insertTexBlock->texRun); slash commands.ts:225 (runViewOnlyAction('tex'))",
    "applicableKinds": [
        K("selection", "ok", "SelectionRef -> blockApplies base 'ok'. SEED code from the selection."),
        K("cursor", "ok", "CursorRef (slash caret) -> 'ok'. Insert empty texBlock at caret."),
        K("paragraph", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled' via blockApplies."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "ctx.canEdit===false (collab read-only) -> 'disabled' uniformly via gateApplies layer (1)."),
    ],
    "expected": {
        "behavior": "Seed-from-selection. Non-empty selection -> seedCode = textBetween(from,to,'\\n', hardBreak->'\\n'), deleteSelection() then replaceSelectionWith a texBlock carrying that code. Collapsed caret -> empty texBlock (code:''). DATA-LOSS GUARD: a non-empty selection that yields seedCode==='' but a non-empty slice (an inline atom selected alone) BAILS - the atom is preserved. scrollIntoView. No-op when read-only.",
        "docDelta": "One texBlock added (attrs: uuid via the single collision-free scan, code = seedCode | ''). On a text-bearing selection the range is deleted first.",
        "texDelta": "%!vtex:begin <uuid>\\n<escaped code>\\n%!vtex:end <uuid>\\n\\n (serializeTexBlock; raw passthrough between sentinels). \\vtex sentinels are comments, no command needed.",
        "sidecarDelta": "None - texBlock is a pure in-doc node, no JSON sidecar.",
        "lifecycle": "No card produced. Caret left at the inserted block. No panel hop on either surface.",
    },
    "crossSurfaceIdentity": "Both surfaces route through texRun: same seedCode harvest, same ONE uuid-collision scan, same deleteSelection->replaceSelectionWith, same data-loss guard, same %!vtex sentinel round-trip. Slash via runViewOnlyAction (CursorRef ctx); lightning via insertTexBlock's hand-rolled SelectionRef ctx - both feed the SAME texRun which reads ctx.view.state.selection directly.",
    "knownRisk": "Drive the lightning tex cell live FIRST: it is wired as onClick={() => insertTexBlock(editor)} (ActionsMenuPanel:569), NOT runGridAction('tex') - it bypasses the unified grid ctx (no canEdit thread). insertTexBlock builds a minimal ctx WITHOUT canEdit, so texRun's isCollabReadOnly returns false - the collab read-only gate is effectively INERT on the grid tex cell. In a collab read-only session the grid tex cell would attempt the insert (relying on readOnlyEnforcer to reject) where slash explicitly no-ops at view.editable. Verify the grid tex cell is greyed/blocked under collab read-only. Also verify the atom-only-selection data-loss guard on BOTH surfaces.",
})

bi_cells.append({
    "action": "figure", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1940 (figureRun); FIGURE_ACTION_ROW:2069; smart-insert smart-insert.ts:119; attrs figure-attrs.ts:42",
    "applicableKinds": [
        K("selection", "ok", "Grid passes a SelectionRef -> blockApplies base 'ok'. A non-empty selection is REPLACED by the block (smartInsertBlock policy)."),
        K("cursor", "ok", "Collapsed caret -> 'ok'. Plain cursor-insert."),
        K("paragraph", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "ctx.canEdit===false -> 'disabled' via gateApplies (the grid threads canEdit through runGridAction)."),
    ],
    "expected": {
        "behavior": "INSERT an opaque figureBlock atom at the caret (replacing any non-empty selection per smartInsertBlock's REPLACE policy), with a freshFigureBlockAttrs stub (centered \\includegraphics empty path, label 'fig:', numbered:true, widthPercent:60, collision-free uuid) and a single figureCaption child. Then ONE rAF after insert, open the SOURCE popover anchored to the block via ctx.openFigurePopover(seed). No-op when ctx.canEdit===false.",
        "docDelta": "One figureBlock added via smartInsertBlock (deleteSelection if non-empty, then replaceSelectionWith), content=[figureCaption]. uuid minted collision-free. Position relocated post-dispatch by uuid for the popover anchor.",
        "texDelta": "\\begin{figure}...\\centering \\includegraphics[width=0.6\\textwidth]{} \\caption{} (label \\label{fig:} when present)...\\end{figure}. The fresh stub has an EMPTY image path until the user fills the popover.",
        "sidecarDelta": "None - figureBlock is a pure in-doc node (attrs + figureCaption sub-node), no JSON sidecar.",
        "lifecycle": "No card produced. The source popover opens (one rAF later) for the user to fill the \\includegraphics path/label.",
    },
    "crossSurfaceIdentity": "Single-surface (lightning only) today - no cross-surface byte-identity to enforce. But figureRun IS the SSOT the standalone insertFigureBlock helper and any future FILE-DROP path delegate to (DA-2): all figure-insert paths must produce the byte-identical smartInsertBlock result.",
    "knownRisk": "Drive the rAF-deferred popover live FIRST in the backgrounded preview - rAF is paused when backgrounded, so the popover-open + relocateBlock(uuid) lookup inside the rAF may never fire under test; shim rAF->setTimeout. Also verify the REPLACE-selection policy on a non-empty selection: smartInsertBlock deletes the selected range and drops the figure in its place - confirm this is the intended (documented) behavior vs surprising data loss.",
})

bi_cells.append({
    "action": "graphics", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1968 (graphicsRun); GRAPHICS_ACTION_ROW:2078; smart-insert smart-insert.ts:119; attrs figure-attrs.ts:94",
    "applicableKinds": [
        K("selection", "ok", "SelectionRef -> 'ok'. Non-empty selection REPLACED by the block."),
        K("cursor", "ok", "Collapsed caret -> 'ok'."),
        K("paragraph", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled' (self-kind also excluded - no caret in an atom block)."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "ctx.canEdit===false -> 'disabled' via gateApplies."),
    ],
    "expected": {
        "behavior": "INSERT an opaque graphicsBlock atom at the caret (replacing any non-empty selection per smartInsertBlock's REPLACE policy) with a freshGraphicsBlockAttrs stub (command = '\\includegraphics[width=0.5\\textwidth]{}', source '', widthPercent:50, collision-free uuid) and NO content child. Then ONE rAF after insert, open the SOURCE popover anchored to the block via ctx.openFigurePopover(seed) (raw = attrs.command). No-op when ctx.canEdit===false.",
        "docDelta": "One graphicsBlock added via smartInsertBlock, no content. uuid minted collision-free. Position relocated post-dispatch by uuid for the popover anchor.",
        "texDelta": "Verbatim \\includegraphics[width=0.5\\textwidth]{} (standalone, serializeGraphicsBlock emits attrs.command verbatim; \\vxid{<uuid>} marker). Empty path until the user fills the popover.",
        "sidecarDelta": "None - graphicsBlock is a pure in-doc node (attrs-only), no JSON sidecar.",
        "lifecycle": "No card produced. Source popover opens (one rAF later) seeded with attrs.command.",
    },
    "crossSurfaceIdentity": "Single-surface (lightning only) today. graphicsRun is the SSOT the standalone insertGraphicsBlock helper and any future FILE-DROP path delegate to (DA-2): all must produce the byte-identical smartInsertBlock result.",
    "knownRisk": "Same rAF-pause caveat as figure (shim rAF->setTimeout in the backgrounded preview). Note the self-kind 'disabled' (graphicsBlock x graphics) is correct-by-design but is the kind of cell to spot-check it isn't accidentally 'absent'/missing in the grid. REPLACE-on-selection: confirm a non-empty selection is intentionally consumed.",
})

bi_cells.append({
    "action": "inline-math", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1877 (mathRun('inline')); INLINE_MATH_ACTION_ROW:2051; grid call ActionsMenuPanel:511 (runGridAction('inline-math'))",
    "applicableKinds": [
        K("selection", "ok", "SelectionRef -> blockApplies base 'ok'. WRAP the selected text into the atom's latex."),
        K("cursor", "ok", "Collapsed caret -> 'ok'. Insert placeholder 'x' inlineMath."),
        K("paragraph", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled' via blockApplies."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "ctx.canEdit===false -> 'disabled' via gateApplies (grid threads canEdit through runGridAction)."),
    ],
    "expected": {
        "behavior": "WRAP the selection: latex = textBetween(from,to,' '), or placeholder 'x' when empty. deleteSelection() then insertContent({type:'inlineMath', attrs:{latex}}) via editor.chain().focus(). NOTE 'inline-math' is category:'block' in the registry but produces an INLINE atom (inlineMath, NO uuid attr). DATA-LOSS GUARD: a non-empty selection holding an inline atom but no text BAILS so the atom isn't destroyed. No-op when ctx.canEdit===false.",
        "docDelta": "One inlineMath inline atom inserted (attrs:{latex}, NO uuid). On a text-bearing selection the range is deleted first.",
        "texDelta": "$<latex>$ inline. Empty selection -> $x$.",
        "sidecarDelta": "None - inlineMath is a pure in-doc inline atom, no JSON sidecar.",
        "lifecycle": "No card produced. Caret after the inserted inline atom (insertContent default).",
    },
    "crossSurfaceIdentity": "Single-surface (lightning only). No cross-surface identity to enforce today. (mathRun preserves the former grid wrapSelectionInMath semantics verbatim - a temporal/refactor identity, not multi-surface.)",
    "knownRisk": "Drive the atom-only-selection data-loss guard live FIRST (mathRun:1889): selecting a lone citation/\\ref/$math$ and hitting inline-math must BAIL, NOT replace the atom with $x$. Same guard texRun has and example INTENTIONALLY lacks - confirm the divergence is correct. Lower priority: 'inline-math' is mislabeled category:'block' though it yields an inline atom; note it for the oracle's category-consistency check.",
})

bi_cells.append({
    "action": "display-math", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1877 (mathRun('display')); DISPLAY_MATH_ACTION_ROW:2060; grid call ActionsMenuPanel:520 (runGridAction('display-math'))",
    "applicableKinds": [
        K("selection", "ok", "SelectionRef -> 'ok'. WRAP selected text into the displayMath latex."),
        K("cursor", "ok", "Collapsed caret -> 'ok'. Insert placeholder '\\int f(x)\\,dx' displayMath."),
        K("paragraph", "ok", "isAtomBlock:false -> 'ok'."),
        K("displayMath", "disabled", "isAtomBlock:true -> 'disabled' (self-kind also excluded)."),
        K("texBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("latexComment", "disabled", "isAtomBlock:true -> 'disabled'."),
        K("selection:collab-readonly", "disabled", "ctx.canEdit===false -> 'disabled' via gateApplies."),
    ],
    "expected": {
        "behavior": "WRAP the selection: latex = textBetween(from,to,' '), or placeholder '\\int f(x)\\,dx' when empty. deleteSelection() then insertContent({type:'displayMath', attrs:{latex}}) via editor.chain().focus(). The displayMath uuid is NOT pre-minted - it hydrates lazily via ensureAnchorUuid on first interaction. DATA-LOSS GUARD: an atom-only selection BAILS. No-op when ctx.canEdit===false.",
        "docDelta": "One displayMath block atom inserted (attrs:{latex}; uuid absent/lazy - hydrated by ensureAnchorUuid on first interaction). On a text-bearing selection the range is deleted first. displayMath is a block atom - PM lifts the insert out of an inline container automatically.",
        "texDelta": "\\[\\n<latex>\\n\\]<anchor>\\n\\n (serializer line 386; the %!v anchor appended only when the equation carries a uuid - absent until lazy-hydrated). Empty selection -> \\[\\n\\int f(x)\\,dx\\n\\].",
        "sidecarDelta": "None - displayMath is a pure in-doc block atom, no JSON sidecar.",
        "lifecycle": "No card produced. uuid hydrated lazily (ensureAnchorUuid) on first interaction, NOT at insert.",
    },
    "crossSurfaceIdentity": "Single-surface (lightning only). No cross-surface identity to enforce today.",
    "knownRisk": "Drive the lazy-uuid behavior live FIRST: displayMath is NOT pre-minted a uuid (unlike tex/figure/graphics/example), so a freshly inserted display equation serializes WITHOUT a %!v anchor until ensureAnchorUuid runs on first interaction. Verify the round-trip is stable (insert->serialize->reparse) for an un-interacted equation, and that a card anchored to it later isn't orphaned by the late uuid. Also verify the atom-only-selection data-loss guard (same as inline-math).",
})

CATEGORIES.append(("Block inserts (6)", bi_cells))

# ========================= ATOM REF (1) =========================
ref_cells = [{
    "action": "ref", "surfaces": ["slash", "lightning"],
    "slashName": "\\ref", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts:1528 (refRun); ActionSpec row REF_ACTION_ROW:1548",
    "applicableKinds": [
        K("selection", "ok", "blockApplies: ref.kind==='selection' -> base 'ok'. selection:'optional' so a live range is NOT required; the popover lands the labelRef atom at the caret. Normal lightning-cell path."),
        K("cursor", "ok", "blockApplies: ref.kind==='cursor' -> base 'ok'. The slash \\ref path and the collapsed-caret case. selection:'optional'. The dominant real-world entry."),
        K("paragraph", "ok", "isAtomBlock:false -> base 'ok'. A \\ref is insertable into running prose."),
        K("heading", "ok", "isAtomBlock:false -> 'ok'."),
        K("bulletList", "ok", "isAtomBlock:false -> 'ok'."),
        K("orderedList", "ok", "isAtomBlock:false -> 'ok'."),
        K("blockquote", "ok", "isAtomBlock:false -> 'ok'."),
        K("codeBlock", "ok", "isAtomBlock:false -> 'ok' per registry, though semantically odd. Theoretical (ref is only invoked from caret/selection, not a block-grab handle)."),
        K("titleField", "ok", "isAtomBlock:false -> 'ok'. Theoretical (ref has no grab surface on titleField)."),
        K("figureBlock", "ok", "SURPRISING: figureBlock is isAtomBlock:FALSE in text-object-registry.ts:411, so blockApplies returns base 'ok' - NOT 'disabled' - even though a figure is an opaque atom block with no inline caret. The REF_ACTION_ROW jsdoc:1542 says figure -> 'disabled', but figureBlock does NOT carry isAtomBlock, so the gate does NOT disable it. The doc and the data disagree for figureBlock - flag as a doc/data mismatch. Harmless because ref has no grab surface to reach figureBlock."),
        K("exampleBlock", "ok", "isAtomBlock:false -> 'ok'. Theoretical (no grab surface)."),
        K("listItem", "ok", "isAtomBlock:false -> 'ok'."),
        K("exampleItem", "ok", "isAtomBlock:false -> 'ok'."),
        K("linkedRange", "ok", "isAtomBlock:false -> 'ok'. Theoretical."),
        K("atom-only:ref", "ok", "A paragraph whose only content is a \\ref atom is still a paragraph -> 'ok'. ref insertion is non-destructive (inserts a NEW labelRef atom at the caret), so the atom-only-data-loss class does NOT apply - refRun never deletes the existing atom."),
        K("atom-bearing:ref", "ok", "A paragraph containing a \\ref among text -> 'ok'; inserting another \\ref is additive, no interplay hazard."),
        K("displayMath", "disabled", "isAtomBlock:true (text-object-registry.ts:490) -> blockApplies base 'disabled'. A display-math atom block has no inline caret. Deliberately greyed via the shared blockApplies gate."),
        K("texBlock", "disabled", "isAtomBlock:true (:552) -> 'disabled'. Opaque raw-LaTeX block, no caret."),
        K("latexComment", "disabled", "isAtomBlock:true (:535) -> 'disabled'."),
        K("graphicsBlock", "disabled", "isAtomBlock:true (:620) -> 'disabled'."),
        K("collab-read-only", "disabled", "isCollabReadOnly(ctx)===ctx.canEdit===false. TWO independent gates: (1) gateApplies forces applies()->'disabled' uniformly; (2) refRun early-returns at :1529 so even if invoked it opens NO popover. The lightning FmtBtn is also hard-gated by disabled={!canEdit} (ActionsMenuPanel.tsx:601) - a THIRD belt-and-suspenders layer."),
    ],
    "expected": {
        "behavior": "Opens the LabelRef create-mode popover at the live caret - it does NOT insert anything itself. refRun is a one-liner: collab-gate check, then ctx.openRefPopover?.(). The popover is the creator: lists every \\label{...} site; when the user picks/types a label, useRefActions.handleInsertRef (card-actions/ref.ts:324) lands the labelRef atom at the cursor. With NO popover seam (pure view-only path), refRun no-ops cleanly (optional-chain ?. swallows the absent seam) - verified by ref-title-cross-surface.test.ts:195.",
        "docDelta": "refRun ALONE produces NO docDelta (no atom inserted; the cross-surface test asserts labelRefs===0 after the action). The atom lands only on a SUBSEQUENT user pick: handleInsertRef does insertContent({type:'labelRef', attrs:{label, displayText, refCommand, targetKind}}). refCommand defaults to 'ref'.",
        "sidecarDelta": "NONE. Unlike citation/footnote, \\ref has NO card and NO sidecar - the labelRef atom is self-contained in the .tex and the popover is the only creator. No panelRouting, no cardCreation touched.",
        "texDelta": "On user pick: \\ref{<label>} (or \\getref{...}/\\getfullref{...} when refCommand is getref/getfullref). The labelRef node carries {label, displayText, refCommand, targetKind}; only label + refCommand are load-bearing for the serializer. refRun itself emits NO texDelta.",
        "lifecycle": "NO card lifecycle - \\ref mints no float, no pinned/pristine card (card-LESS by design, atom-registry.ts:63 idAttr:null). The only transient state is the LabelRef popover open/close.",
    },
    "crossSurfaceIdentity": "Slash (\\ref) and lightning (Cross-ref cell) MUST be byte-identical because both route through the SINGLE refRun -> ctx.openRefPopover(). The two seam suppliers - EditorPane.tsx:2233 (slash) and ActionsMenuPanel.tsx:253 (lightning) - hand-roll the SAME caret-rect computation (selection.from -> coordsAtPos -> new DOMRect -> dispatch 'virgil-ref-create-popover'). The marker-clicks.ts:360 listener consumes that ONE event for BOTH surfaces. The resulting labelRef atom is identical attrs/shape regardless of surface. Verified by ref-title-cross-surface.test.ts.",
    "knownRisk": "DRIVE LIVE FIRST - three concerns: (1) The caret-rect computation is HAND-ROLLED in TWO places (EditorPane.tsx:2233 and ActionsMenuPanel.tsx:253) rather than centralized - they currently match byte-for-byte, but this is exactly the divergence class CHIP 8 hunts; a future edit to one will silently drift the popover anchor. Diff the two DOMRect expressions live and confirm both popovers anchor at the identical screen position. (2) figureBlock isAtomBlock:false vs the REF_ACTION_ROW jsdoc claiming figure -> 'disabled' - confirm whether ref is ever reachable on a figureBlock and whether the doc should be corrected. (3) The lightning cell is gated by THREE canEdit checks while slash relies on only the refRun early-return - verify a collab read-only doc greys the grid cell AND no-ops the slash command, with no popover ever appearing.",
}]
CATEGORIES.append(("Atom ref (1)", ref_cells))

# ========================= FORMAT MARKS =========================
# Marks: bold/italic/strike/code share formatToggleRow. lightning-only,
# backbone tiptap-chain, selection:"ignored". Live keyboard binding exists
# (StarterKit) but is NOT modeled on the ActionSpec (surfaces.keyboard FALSE).
fmt_cells = []

def fmt_mark_row(action, label, toggle, keystroke, mark_name, tex, extra_note="", extra_risk=""):
    kinds = [
        K("selection", "ok", "selection:'ignored' - range-agnostic; gateApplies base 'ok'"),
        K("paragraph", "ok", "a collapsed caret in a paragraph still toggles the STORED mark"),
        K("heading", "ok", "caret/selection inside heading text - mark toggle valid; no kind filter"),
        K("listItem", "ok", "caret inside list-item text"),
        K("blockquote", "ok"),
        K("exampleItem", "ok", "caret inside example-item text"),
        K("atom-only:inline-math", "ok", "formatApplies never inspects content; toggling a mark on a math-only line is a PM no-op but applies() still says ok"),
        K("atom-bearing:citation", "ok", "selection spanning text+atom toggles the mark on the text runs only"),
        K("titleField", "ok", "caret in title text - mark would toggle; applies() unconditionally ok"),
    ]
    return {
        "action": action, "surfaces": ["lightning"],
        "slashName": "", "inputRulePattern": "", "keybinding": "",
        "runRef": f"action-registry.ts ({action.upper().replace('-','_')}_ACTION_ROW = formatToggleRow); shared run :2140-2157",
        "backbone": "tiptap-chain",
        "applicableKinds": kinds,
        "expected": {
            "behavior": f"Toggle the {label} mark. On a non-empty selection wraps/unwraps the range; at a collapsed caret flips the pending STORED mark. run() first guards isCollabReadOnly (no-op when canEdit===false), then editor.chain().focus().{toggle}().run(). Grid active-state from editor.isActive('{mark_name}').{(' ' + extra_note) if extra_note else ''}",
            "docDelta": f"{mark_name} mark added/removed on the selected inline range (or stored-mark toggled, no doc change, at a caret). No block added/removed/converted.",
            "sidecarDelta": "none - backbone tiptap-chain, no sidecar.",
            "texDelta": f"selection serialized to {tex} (or unwrapped) on the next .tex sync via code-pane-bridge; no atom marker, no %!v marker.",
            "lifecycle": "no card produced.",
        },
        "crossSurfaceIdentity": f"Registry exposes ONLY the lightning surface; the live keyboard binding {keystroke} (StarterKit) is NOT modeled on the ActionSpec. The two live paths (grid cell run() and the {keystroke} keystroke) both bottom out in {toggle} so they produce a byte-identical {mark_name} mark / identical {tex} serialization - but ONLY the grid path goes through the registry's collab guard; the keystroke is gated separately by the readOnlyEnforcer plugin filterTransaction (editor-extensions.ts:1839).",
        "knownRisk": (f"Keyboard-surface omission: {keystroke} is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer)." + ((" " + extra_risk) if extra_risk else "")),
    }

fmt_cells.append(fmt_mark_row("bold", "bold", "toggleBold", "Mod-b", "strong", "\\textbf{...}",
    extra_risk="A held Mod-b while a partner holds the pen is the belt-and-suspenders case the run() guard comment at registry:2135-2138 calls out."))
fmt_cells.append(fmt_mark_row("italic", "italic (em)", "toggleItalic", "Mod-i", "italic", "\\textit{...}",
    extra_risk="Lower-risk than the lifecycle actions; drive once to confirm grid==keystroke parity and the collab gate on both."))
fmt_cells.append(fmt_mark_row("strike", "strikethrough", "toggleStrike", "Mod-Shift-s", "strike", "\\sout{...}",
    extra_risk="Strike has NO grid keybinding hint in the cell title (ActionsMenuPanel:432, no shortcut shown), unlike Bold/Italic - minor UI inconsistency, not a behavioral bug."))
fmt_cells.append(fmt_mark_row("code", "inline code", "toggleCode", "Mod-e", "code", "\\texttt{...}",
    extra_note="Toggles the INLINE code mark, NOT the codeBlock node.",
    extra_risk="NAMING TRAP - id 'code' is the inline code MARK, easily confused with the codeBlock text-object kind. Drive live to confirm the grid cell toggles the inline mark and never wraps a codeBlock, and that Mod-e does the same. Note the codeBlock kind below is applies:'ok' for this row because the INLINE mark toggles inside a code block (a near-no-op), distinct from the codeBlock NODE."))
# code row gets an extra codeBlock applicable kind
fmt_cells[-1]["applicableKinds"].append(
    K("codeBlock", "ok", "the INLINE code MARK (toggleCode) - distinct from the codeBlock NODE. applies() unconditionally ok; toggling the inline mark inside a code block is a near-no-op but applies() does not branch"))

# Block-structure format rows: bullet-list / ordered-list / blockquote.
# These were truncated in the prompt JSON. Reconstructed from the shared
# formatToggleRow shape + the documented toggle semantics. RECONSTRUCTED-TAIL.
def fmt_block_row(action, label, toggle, mark_active, tex_note, toggle_off_note, convert_note):
    return {
        "action": action, "surfaces": ["lightning"],
        "slashName": "", "inputRulePattern": "", "keybinding": "",
        "runRef": f"action-registry.ts ({action.upper().replace('-','_')}_ACTION_ROW = formatToggleRow); shared run :2140-2157",
        "backbone": "tiptap-chain",
        "applicableKinds": [
            K("paragraph", "ok", f"wraps the current block into a {label}; valid at a collapsed caret (selection:'ignored')"),
            K("selection", "ok", "wraps spanned blocks"),
            K("bulletList", "ok", toggle_off_note if action == "bullet-list" else convert_note),
            K("orderedList", "ok", toggle_off_note if action == "ordered-list" else convert_note),
            K("listItem", "ok", "caret inside an item"),
            K("heading", "ok", f"applies() unconditionally ok; {toggle} may fail to wrap a heading but applies() does not gate it - possible divergence"),
            K("blockquote", "ok"),
            K("titleField", "ok", f"applies() ok, but wrapping the title field is a structural no-op/odd; applies() does not gate it"),
            K("displayMath", "absent", "atom block - the lightning format grid only fires from a selection/caret in body text; an atom-block has no selectable text range, so no grid cell targets it"),
            K("figureBlock", "absent", "atom/leaf block; format grid never targets it"),
            K("graphicsBlock", "absent"),
            K("texBlock", "absent"),
            K("latexComment", "absent"),
        ],
        "expected": {
            "behavior": f"Toggle the {label} structure. run() guards isCollabReadOnly (no-op when canEdit===false), then editor.chain().focus().{toggle}().run(). On a plain block it wraps; on an existing {label} it lifts items back to paragraphs (toggle). Grid active-state from editor.isActive('{mark_active}').",
            "docDelta": f"current block(s) wrapped into a {label} (listItem children) - or, on an existing {label}, lifted back to paragraphs. Structural node change (wrap/lift), not a mark.",
            "sidecarDelta": "none - backbone tiptap-chain, no sidecar.",
            "texDelta": tex_note,
            "lifecycle": "no card produced.",
        },
        "crossSurfaceIdentity": f"Registry exposes ONLY the lightning surface; StarterKit also binds the live keyboard shortcut and markdown input rules ('- '/'1. ') which call the SAME {toggle} - NOT modeled on the ActionSpec. Grid run() and the keystroke/input-rule both bottom out in {toggle}; identical structural result. Only the grid path goes through the registry collab guard; the keystroke/input-rule is gated by readOnlyEnforcer.",
        "knownRisk": f"RECONSTRUCTED-TAIL (the bullet-list/ordered-list/blockquote rows were truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but {toggle} may be a structural no-op there - the applies()-vs-effect divergence (an enabled cell that does nothing). Drive a {label}-toggle on a heading and on a titleField live to see whether the cell should be greyed. Also: the markdown input rule ('- '/'1. ') is a SECOND live surface not in the registry - confirm it produces the same structure as the grid.",
    }

fmt_cells.append(fmt_block_row(
    "bullet-list", "bulletList", "toggleBulletList", "bulletList",
    "selection's blocks serialized into \\begin{itemize}...\\item...\\end{itemize} (or unwrapped) on the next .tex sync; no marker.",
    "toggle OFF - lifts items back to paragraphs; toggleBulletList is a toggle",
    "converts ordered->bullet (toggle behavior)"))
fmt_cells.append(fmt_block_row(
    "ordered-list", "orderedList", "toggleOrderedList", "orderedList",
    "selection's blocks serialized into \\begin{enumerate}...\\item...\\end{enumerate} (or unwrapped) on the next .tex sync; no marker.",
    "toggle OFF - lifts items back to paragraphs; toggleOrderedList is a toggle",
    "converts bullet->ordered (toggle behavior)"))

# blockquote row (reconstructed-tail)
fmt_cells.append({
    "action": "blockquote", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts (BLOCKQUOTE_ACTION_ROW = formatToggleRow); shared run :2140-2157",
    "backbone": "tiptap-chain",
    "applicableKinds": [
        K("paragraph", "ok", "wraps the current block into a blockquote; valid at a collapsed caret (selection:'ignored')"),
        K("selection", "ok", "wraps spanned blocks"),
        K("blockquote", "ok", "toggle OFF - lifts the wrapped content back to paragraphs; toggleBlockquote is a toggle"),
        K("heading", "ok", "applies() unconditionally ok; toggleBlockquote may wrap or be odd on a heading but applies() does not gate it - possible divergence"),
        K("listItem", "ok", "caret inside a list item"),
        K("titleField", "ok", "applies() ok, but wrapping the title field is a structural no-op/odd; applies() does not gate it"),
        K("displayMath", "absent", "atom block - the lightning format grid only fires from a selection/caret in body text; no grid cell targets it"),
        K("figureBlock", "absent", "atom/leaf block; format grid never targets it"),
        K("graphicsBlock", "absent"),
        K("texBlock", "absent"),
        K("latexComment", "absent"),
    ],
    "expected": {
        "behavior": "Toggle the blockquote structure. run() guards isCollabReadOnly (no-op when canEdit===false), then editor.chain().focus().toggleBlockquote().run(). On a plain block it wraps; on an existing blockquote it lifts content back to paragraphs (toggle). Grid active-state from editor.isActive('blockquote').",
        "docDelta": "current block(s) wrapped into a blockquote - or, on an existing blockquote, lifted back to paragraphs. Structural node change, not a mark.",
        "sidecarDelta": "none - backbone tiptap-chain, no sidecar.",
        "texDelta": "selection's blocks serialized into \\begin{quote}...\\end{quote} (or unwrapped) on the next .tex sync; no marker.",
        "lifecycle": "no card produced.",
    },
    "crossSurfaceIdentity": "Registry exposes ONLY the lightning surface; StarterKit also binds the live keyboard shortcut and a markdown input rule ('> ') which call the SAME toggleBlockquote - NOT modeled on the ActionSpec. Grid run() and the keystroke/input-rule both bottom out in toggleBlockquote; identical structural result. Only the grid path goes through the registry collab guard.",
    "knownRisk": "RECONSTRUCTED-TAIL (the blockquote row was truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleBlockquote may be a structural no-op there - the applies()-vs-effect divergence. Drive a blockquote-toggle on a heading and on a titleField live. Also: the '> ' markdown input rule is a SECOND live surface not in the registry - confirm parity with the grid.",
})

# text-color (lightning, popover-routed) - reconstructed-tail, modeled after the
# figure/graphics popover-routed pattern + the runGridAction color seam.
fmt_cells.append({
    "action": "text-color", "surfaces": ["lightning"],
    "slashName": "", "inputRulePattern": "", "keybinding": "",
    "runRef": "action-registry.ts (TEXT_COLOR_ACTION_ROW); grid seam ctx.openColorPopover (ActionsMenuPanel runGridAction)",
    "backbone": "tiptap-chain",
    "applicableKinds": [
        K("selection", "ok", "selection:'ignored' - the color popover applies a textStyle color mark to the range/caret"),
        K("paragraph", "ok", "caret/selection in a paragraph"),
        K("heading", "ok", "caret/selection in heading text"),
        K("listItem", "ok"), K("blockquote", "ok"), K("exampleItem", "ok"),
        K("titleField", "ok", "applies() unconditionally ok"),
        K("displayMath", "absent", "atom block - format grid never targets it"),
        K("figureBlock", "absent"), K("graphicsBlock", "absent"),
        K("texBlock", "absent"), K("latexComment", "absent"),
    ],
    "expected": {
        "behavior": "Opens the color popover (ctx.openColorPopover) anchored to the selection/caret - it does NOT apply a color itself. On a user pick, the popover applies a textStyle color mark over the range (or sets the stored mark at a caret). run() guards isCollabReadOnly.",
        "docDelta": "On user pick: a textStyle/color mark added/removed on the selected inline range (or stored-mark at a caret). run() ALONE opens the popover, no docDelta until the pick.",
        "sidecarDelta": "none - backbone tiptap-chain, no sidecar.",
        "texDelta": "selection wrapped in the project's color macro (e.g. \\textcolor{...}{...}) on the next .tex sync; no marker.",
        "lifecycle": "no card produced. Transient color-popover open/close state only.",
    },
    "crossSurfaceIdentity": "Single-surface (lightning only) today - no cross-surface byte-identity to enforce. The popover seam (ctx.openColorPopover) is the single creator; any future surface must route through the SAME seam.",
    "knownRisk": "RECONSTRUCTED-TAIL (the text-color row was beyond the truncation point in the source oracle JSON - reconstructed from the figure/graphics popover-routed pattern + the runGridAction color seam; verify the exact run()/seam name and tex macro against action-registry.ts + the color popover before relying on the doc). Concern: like ref/figure, the popover-open is RAF/event-driven - drive live in the backgrounded preview (shim rAF->setTimeout) and confirm the color mark round-trips through .tex.",
})

CATEGORIES.append(("Format marks", fmt_cells))

# ---------------------------------------------------------------------------
# Expand to the flat Cartesian cell list: one element per (action x kind x surface)
# where applies != "absent".
# ---------------------------------------------------------------------------
flat = []
for cat_name, cells in CATEGORIES:
    for cell in cells:
        for k in cell["applicableKinds"]:
            if k["applies"] == "absent":
                continue
            for surface in cell["surfaces"]:
                flat.append({
                    "id": f"{cell['action']}@{k['kind']}#{surface}",
                    "category": cat_name,
                    "action": cell["action"],
                    "kind": k["kind"],
                    "surface": surface,
                    "applies": k["applies"],
                    "kindNote": k.get("note", ""),
                    "slashName": cell.get("slashName", ""),
                    "inputRulePattern": cell.get("inputRulePattern", ""),
                    "keybinding": cell.get("keybinding", ""),
                    "runRef": cell.get("runRef", ""),
                    "backbone": cell.get("backbone", ""),
                    "expected": cell["expected"],
                    "crossSurfaceIdentity": cell.get("crossSurfaceIdentity", ""),
                    "knownRisk": cell.get("knownRisk", ""),
                })

# Sort: knownRisk != "" first (stable), then by category order, action, kind, surface.
cat_order = {name: i for i, (name, _) in enumerate(CATEGORIES)}
flat.sort(key=lambda c: (
    0 if c["knownRisk"] else 1,
    cat_order[c["category"]],
    c["action"], c["kind"], c["surface"],
))

with open(os.path.join(HERE, "cells.json"), "w") as f:
    json.dump(flat, f, indent=2)

# ---------------------------------------------------------------------------
# EXPECTED-MATRIX.md
# ---------------------------------------------------------------------------
def esc(s):
    return s.replace("|", "\\|").replace("\n", " ")

lines = []
lines.append("# CHIP 8 — Expected-Delta Matrix (cross-surface verification oracle)")
lines.append("")
lines.append("Machine-readable companion: [`cells.json`](cells.json) — the flat Cartesian (action × applicableKind × surface) list the live sweep iterates. Live-sweep harness: [`_harness.js`](_harness.js) (inject via `preview_eval`; acquires `window.__v = {main, dh, cc}`).")
lines.append("")
total = len(flat)
risk = sum(1 for c in flat if c["knownRisk"])
lines.append(f"**{total}** applicable cells across **{len(CATEGORIES)}** categories; **{risk}** carry a known risk (drive-live-first).")
lines.append("")
lines.append("`applies` legend: **ok** = enabled & acts; **disabled** = greyed (gate fires); cells with `applies:absent` are not modeled (the surface never targets that kind) and are omitted from `cells.json`.")
lines.append("")

# Per-category tables
for cat_name, cells in CATEGORIES:
    lines.append(f"## {cat_name}")
    lines.append("")
    lines.append("| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |")
    lines.append("|---|---|---|---|---|")
    for cell in cells:
        ok = [k["kind"] for k in cell["applicableKinds"] if k["applies"] == "ok"]
        dis = [k["kind"] for k in cell["applicableKinds"] if k["applies"] == "disabled"]
        absent = [k["kind"] for k in cell["applicableKinds"] if k["applies"] == "absent"]
        kinds_cell = "**ok:** " + (", ".join(ok) if ok else "—")
        if dis:
            kinds_cell += "<br>**disabled:** " + ", ".join(dis)
        if absent:
            kinds_cell += "<br>**absent:** " + ", ".join(absent)
        e = cell["expected"]
        summ = (f"**doc:** {e['docDelta']}<br>"
                f"**sidecar:** {e['sidecarDelta']}<br>"
                f"**tex:** {e['texDelta']}<br>"
                f"**lifecycle:** {e['lifecycle']}")
        risk_cell = ("**" + ("HIGH — drive live first. " if cell["knownRisk"].startswith("HIGH") else "")
                     + "**" if cell["knownRisk"].startswith("HIGH") else "")
        risk_cell = esc(cell["knownRisk"]) if cell["knownRisk"] else "—"
        surf = ", ".join(cell["surfaces"])
        lines.append(f"| **{cell['action']}**"
                     + (f" (`{cell['slashName']}`)" if cell.get("slashName") else "")
                     + f" | {surf} | {esc(kinds_cell)} | {esc(summ)} | {risk_cell} |")
    lines.append("")

# Drive-live-first priority list
lines.append("## Drive-live-first priority list")
lines.append("")
lines.append("Every cell carrying a known risk, HIGH-risk first. These are the cells where a code-read ✓ is NOT a ✓ — drive the real surface in the live app before trusting the predicted delta.")
lines.append("")
# rank: HIGH first, then by category order
def risk_rank(c):
    kr = c["knownRisk"]
    if kr.startswith("HIGH"):
        return 0
    if "DRIVE LIVE FIRST" in kr or "Drive live FIRST" in kr or "Drive live first" in kr or "drive live FIRST" in kr or "live FIRST" in kr:
        return 1
    return 2
# de-dupe by (action,surface) since the risk is per-cell not per-kind
seen_risk = []
risk_rows = []
for c in flat:
    if not c["knownRisk"]:
        continue
    key = (c["action"], c["knownRisk"])
    if key in seen_risk:
        continue
    seen_risk.append(key)
    risk_rows.append(c)
risk_rows.sort(key=lambda c: (risk_rank(c), cat_order[c["category"]], c["action"]))
lines.append("| # | Action | Surfaces | Category | Risk |")
lines.append("|---|---|---|---|---|")
for i, c in enumerate(risk_rows, 1):
    # recover the parent cell's surfaces
    surfaces = next(cell["surfaces"] for _, cells in CATEGORIES for cell in cells
                    if cell["action"] == c["action"])
    lines.append(f"| {i} | **{c['action']}** | {', '.join(surfaces)} | {c['category']} | {esc(c['knownRisk'])} |")
lines.append("")

# Cross-surface identity reference
lines.append("## Cross-surface identity invariants")
lines.append("")
lines.append("The byte-identity claims the sweep must refute per action (where >1 surface exists) or the internal invariant (single-surface).")
lines.append("")
seen_id = set()
for cat_name, cells in CATEGORIES:
    for cell in cells:
        if cell["action"] in seen_id:
            continue
        seen_id.add(cell["action"])
        if cell.get("crossSurfaceIdentity"):
            lines.append(f"- **{cell['action']}** ({', '.join(cell['surfaces'])}): {cell['crossSurfaceIdentity']}")
lines.append("")

matrix_md = "\n".join(lines)

# Append the surface-driver recipes verbatim.
recipes_path = os.path.join(HERE, "_recipes.md")
if os.path.exists(recipes_path):
    with open(recipes_path) as rf:
        recipes = rf.read()
    matrix_md = matrix_md.rstrip() + "\n\n---\n\n" + recipes.lstrip()

with open(os.path.join(HERE, "EXPECTED-MATRIX.md"), "w") as f:
    f.write(matrix_md)

print(json.dumps({
    "total_cells": total,
    "known_risk_cells": risk,
    "by_category": {name: sum(1 for c in flat if c["category"] == name) for name, _ in CATEGORIES},
    "risk_rows": len(risk_rows),
}))
