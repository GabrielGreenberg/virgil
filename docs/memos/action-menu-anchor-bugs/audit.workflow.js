export const meta = {
  name: 'action-menu-anchor-bug-audit',
  description: 'Deep audit: trace BUG1 (suggest-revision turns into note-highlight on reload, orphan undeletable highlight) and BUG2 (cursor-on-heading comment fails) to the deepest unified architectural culprit',
  phases: [
    { title: 'Map', detail: '6 parallel subsystem readers produce structured maps' },
    { title: 'Trace', detail: '2 causal tracers (BUG1, BUG2) over the full maps' },
    { title: 'Verify', detail: 'adversarial skeptics refute each root cause' },
    { title: 'Synthesize', detail: 'deepest unifying culprit plus architectural fix memo' },
  ],
}

const READONLY = 'THIS IS A READ-ONLY DIAGNOSTIC AUDIT. Do NOT edit, write, or patch any source file. Read code, tests, and docs only. Cite every claim with file:line. The repo is /Users/gabriel/Programming/virgil (a browser LaTeX editor "Virgil"). Be exhaustive and precise: trace actual data flow, do not speculate from names.'

const BUGS = [
  'THE TWO BUGS UNDER AUDIT:',
  'BUG 1: User selects text, opens the action menu (the selection/lightning action menu, NOT the grab-handle), chooses "Suggest revision" (the "suggest-edit" action, which drafts a revision-comment card). After reloading the document, the selected text instead shows as a NOTE-HIGHLIGHT (a yellow highlight / note-like marking), i.e. the revision card has effectively turned into a highlight/note on reload. WORSE: sometimes the highlight tint persists in the text with NO backing card anywhere, so the user has no way to select or delete it (an orphaned, undeletable highlight).',
  'BUG 2: User puts a COLLAPSED CURSOR on a section title (heading), opens the action menu, chooses "Comment", and nothing happens (broken). But if the user SELECTS the section title text first and then chooses "Comment", it works. So: selection-on-heading comment works; cursor-on-heading comment fails.',
].join('\n')

const KNOWN = [
  "ESTABLISHED FACTS (verify, do not trust blindly):",
  '- The action menus: src/components/SelectionActionsMenu.tsx + src/components/ActionsMenuPanel.tsx (lightning, selection-driven) and the grab-handle src/components/DragHandleMenu.tsx. SSOT vocabulary in src/lib/actions/action-registry.ts (ActionId "suggest-edit" = revision-comment card; "cutter"; the 11 CardActionIds). Selection-mode taxonomy: "required" greys at collapsed caret (only highlight today), "optional"/"ignored" never grey on range.',
  '- "Comment" in-text flow: src/components/editor-layout/card-actions/comments.ts handleAddComment BAILS when selection is collapsed/empty (if to <= from or slice.content.size === 0 then return), calls createLinkedAnchor(ed, "revision"), opens Revisions panel.',
  '- src/links/links.ts createLinkedAnchor() stamps a linkedAnchor MARK (kind, linkCard, anchorId, tintColor) over the live selection; paragraphUuidAt() resolves the containing paragraph uuid.',
  '- src/lib/tiptap/linked-anchor.ts: the linkedAnchor mark is APP STATE, stripped on .tex export, re-applied on load from sidecar links[]. The mark kind default is "note". linkedAnchorRenderAttrs (src/lib/tiptap/linked-anchor-attrs.ts) decides the painted color: from the data-link-card kind token, falling back to the legacy kind attr when linkCard is empty.',
  '- Reload re-apply: src/links/_shared/reapply-mode-b-anchors.ts buildModeBReapplyRecords RE-DERIVES each card linkedAnchor kind FROM WHICH ARRAY IT IS IN: notes give "note", todoItems give "todo", comments give "revision", cutterCards give "cutter-*", highlights give "highlight". Order is note, todo, revision, cutter, HIGHLIGHT LAST (overlap last-wins via setMark replace).',
  '- Load reconcile: src/links/resolve-card-anchor.ts + src/links/links.ts collectLinksFromEditor + reconcileModeAAnchors; the EditorPane load reconcile (RC-A) runs AFTER reapplyModeBAnchors (RC-B). Mode A vs Mode B: anchor.targetKind === "linkedRange" means Mode B.',
  '- Heading/section scope: src/lib/section-range.ts getSectionRangeByUuid + getHeadingLineRangeByUuid. cardResolveScope in action-registry.ts: heading + annotation gives the heading LINE, heading + lifecycle gives the whole section; a cursor ref gives a zero-width range.',
  '- Prior resolved audit of the GRAB-HANDLE menu: docs/memos/ACTION-MENU-DIAGNOSIS.md (a different menu, but clusters C9/C10/C11 about heading scope + linkedRange paragraphId are relevant priors).',
].join('\n')

// Phase 1: Map
phase('Map')

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subsystem', 'keyFiles', 'dataFlow', 'bug1Relevance', 'bug2Relevance', 'suspectedDefects'],
  properties: {
    subsystem: { type: 'string' },
    keyFiles: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['path', 'role'],
        properties: { path: { type: 'string' }, role: { type: 'string' } },
      },
    },
    dataFlow: { type: 'string', description: 'Precise step-by-step data flow through this subsystem with file:line anchors' },
    bug1Relevance: { type: 'string', description: 'How this subsystem participates in BUG1. "none" if irrelevant.' },
    bug2Relevance: { type: 'string', description: 'How this subsystem participates in BUG2. "none" if irrelevant.' },
    suspectedDefects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'file', 'line', 'detail', 'confidence'],
        properties: {
          title: { type: 'string' }, file: { type: 'string' }, line: { type: 'string' },
          detail: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const SUBSYSTEMS = [
  {
    key: 'action-surfaces',
    prompt: 'Map the ACTION-MENU SURFACES. Read src/components/SelectionActionsMenu.tsx, src/components/ActionsMenuPanel.tsx, src/components/DragHandleMenu.tsx, and how they build their ActionRef (SelectionRef vs CursorRef vs TextObjectRef) and dispatch comment/suggest-edit/cutter. CRITICAL QUESTIONS: (1) When does the SELECTION action menu appear: only on a non-empty selection, or also on a collapsed cursor? In what mode (cursor vs selection)? (2) When the cursor is COLLAPSED inside a heading vs inside a paragraph, what ref is built and what scope/range results? (3) How is the Comment action wired from the menu to handleAddComment (comments.ts): does it go through the action-registry suggest-edit / a dedicated comment handler, or a window event? Trace the exact path. (4) Does Comment use createLinkedAnchor (Mode B range mark) and bail on a collapsed selection? Pinpoint the collapsed-cursor failure for comment, and whether headings differ from paragraphs here.',
  },
  {
    key: 'card-creation-dispatch',
    prompt: 'Map the CARD-CREATION DISPATCH. Read src/components/editor-layout/card-actions/drag-handle-actions.ts (the dispatcher), card-creation.ts, comments.ts, and any suggest-edit/revision-suggestion creator. For the suggest-edit (revision) action AND the comment (revision-comment) action: trace exactly (a) what selection/range is captured, (b) what linkedAnchor mark kind is stamped (via createLinkedAnchor), (c) which SIDECAR / card array the resulting card is written into (revisions? notes? highlights?), (d) what the card links[]/anchor (Mode A vs Mode B, targetKind) looks like at creation. KEY QUESTION for BUG1: when you suggest revision from the selection menu, does the card land in the revisions/comments sidecar with a proper revision linkedAnchor, or does something route it (or a sibling highlight) into the highlights sidecar? Note any place a highlight tintColor is stamped alongside.',
  },
  {
    key: 'mark-persistence-export',
    prompt: 'Map the linkedAnchor MARK PERSISTENCE + .tex EXPORT/IMPORT round-trip. Read src/lib/tiptap/linked-anchor.ts, src/lib/tiptap/linked-anchor-attrs.ts, and the .tex serializer/parser for the linkedAnchor mark (search for vlid/vlidend/data-link-card/data-tint-color and how marks are stripped on export and what survives import). Establish: (1) Is the linkedAnchor mark fully stripped on .tex save (so ONLY the sidecar links[] survive), or does any kind/tint info persist in the .tex? (2) On import, what painted color does a re-applied mark get: does it depend on the card kind array, on the persisted linkCard token, or on tintColor? (3) The kind default "note" and the tintColor attr: when would a re-applied mark paint as a yellow note-highlight? (4) Does the highlight tint (data-tint-color) round-trip independently of the card?',
  },
  {
    key: 'reload-reconcile',
    prompt: 'Map the RELOAD RECONCILE pipeline (the prime suspect for BUG1). Read src/links/_shared/reapply-mode-b-anchors.ts, src/links/resolve-card-anchor.ts, src/links/links.ts (collectLinksFromEditor, reconcileModeAAnchors, getTextAnchor, isModeAOrphaned), and the EditorPane load-reconcile effect that calls reapplyModeBAnchors then the per-panel reconcileAnchors (search src/components/EditorPane.tsx). Trace the EXACT load sequence for a card that was created as a suggest revision (revision-comment) over a text selection. KEY QUESTIONS: (1) buildModeBReapplyRecords derives the mark kind from WHICH ARRAY the card is in. Under what conditions could a revision-comment card be ABSENT from the comments array but present (or duplicated) in notes/highlights at reapply time, causing it to repaint as note/highlight? (2) How does an orphaned highlight with NO card arise (the undeletable case)? Look at LinkedAnchorGuard orphan events, removeTransientAnchor, and any path that strips a card textRange while leaving the mark, or stamps a tint mark with no sidecar. (3) Ordering: revision before highlight; does a highlight sub-range or an overlap repaint the revision range as highlight?',
  },
  {
    key: 'card-kinds-hooks',
    prompt: 'Map the CARD-KIND MODEL for revisions / notes / highlights. Read src/hooks/useRevisions.ts (or wherever revision-comment/revision-suggestion cards live), src/hooks/useNotes.ts, and the highlights hook/source, plus src/panels/Revisions/* and src/cards/card-registry.tsx. Establish the SIDECAR SHAPES and what distinguishes: a revision-comment card, a revision-suggestion card, a note card, and a highlight card, especially their kind field, their links[] anchor shape (Mode A vs Mode B), and whether a highlight is a first-class card with its own sidecar or a derived/tint-only entity. KEY for BUG1: what determines which ARRAY (notes vs comments vs highlights) a freshly created suggest revision card ends up in at reapply time, and could a revision card created via the SELECTION menu be persisted with the wrong kind or into the wrong sidecar (e.g. as a highlight because it carried a tintColor, or as a note)?',
  },
  {
    key: 'heading-anchoring',
    prompt: 'Map HEADING / SECTION-TITLE anchoring (the prime suspect for BUG2). Read src/lib/section-range.ts (getSectionRangeByUuid, getHeadingLineRangeByUuid), paragraphUuidAt in src/links/links.ts, and how a heading node gets/keeps a uuid. Trace what happens for a COLLAPSED CURSOR inside a heading vs a SELECTION over a heading, specifically for the Comment action: (1) Does paragraphUuidAt resolve a uuid when the cursor is in a heading (headings are not paragraph nodes: does it return null/"" for headings)? (2) For comment with a collapsed cursor: handleAddComment bails on to<=from, so does cursor-comment fail EVERYWHERE (paragraph too) or only on headings? Determine whether the menu even offers/enables Comment at a collapsed caret, and whether heading vs paragraph diverge. (3) The action-registry selection-mode for suggest-edit: is it "required" (greys at caret) or "optional"? If comment routes through suggest-edit with selection "optional", what range does cardResolveScope give for a cursor-on-heading, and does createLinkedAnchor then no-op on the zero-width range? Pin the exact reason cursor-on-heading comment fails while selection-on-heading works.',
  },
]

const maps = await parallel(SUBSYSTEMS.map((s) => () =>
  agent(READONLY + '\n\n' + BUGS + '\n\n' + KNOWN + '\n\nYOUR SUBSYSTEM: ' + s.key + '\n\n' + s.prompt + '\n\nReturn a structured subsystem map. Be concrete: every defect must carry file:line and a precise causal mechanism, not a guess.',
    { label: 'map:' + s.key, phase: 'Map', schema: MAP_SCHEMA })
))

const validMaps = maps.filter(Boolean)
log('Mapped ' + validMaps.length + '/' + SUBSYSTEMS.length + ' subsystems; ' + validMaps.reduce((n, m) => n + (m.suspectedDefects ? m.suspectedDefects.length : 0), 0) + ' suspected defects surfaced')

const mapsDigest = JSON.stringify(validMaps, null, 1)

// Phase 2: Trace
phase('Trace')

const ROOT_CAUSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bug', 'reproSummary', 'causalChain', 'deepestCulprit', 'isArchitectural', 'relatedPhenomena', 'evidence', 'alternativesConsidered', 'openQuestions'],
  properties: {
    bug: { type: 'string', enum: ['BUG1', 'BUG2'] },
    reproSummary: { type: 'string', description: 'The precise sequence of events that produces the bug, step by step' },
    causalChain: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['step', 'file', 'line', 'detail'],
        properties: { step: { type: 'string' }, file: { type: 'string' }, line: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    deepestCulprit: { type: 'string', description: 'The single deepest, most general root cause, a class of bug not a surface symptom' },
    isArchitectural: { type: 'boolean' },
    relatedPhenomena: { type: 'array', items: { type: 'string' }, description: 'Other bugs/behaviors the SAME deepest culprit would also cause or explain' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Concrete file:line evidence supporting the chain' },
    alternativesConsidered: { type: 'array', items: { type: 'string' }, description: 'Other hypotheses examined and why rejected' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'Anything unresolved that a live repro/test would settle' },
  },
}

function tracerPrompt(bug, focus) {
  return READONLY + '\n\n' + BUGS + '\n\n' + KNOWN + '\n\nYou are the CAUSAL TRACER for ' + bug + '. Below are 6 structured subsystem maps from parallel readers. Use them as leads, but VERIFY every link by reading the actual code yourself: do not trust a map claim without confirming the file:line.\n\nSUBSYSTEM MAPS (JSON):\n' + mapsDigest + '\n\nYOUR TASK: ' + focus + '\n\nProduce the complete causal chain from user action to persisted state to reload to observed symptom, each step pinned to file:line. Then name the DEEPEST, MOST GENERAL culprit: a bug CLASS that would explain related phenomena too, not a one-line surgical fix. The user central principle: prefer unified, deep, architectural diagnoses that capture a RANGE of related phenomena. Explicitly list other phenomena the same culprit predicts. Consider and rule out alternatives.'
}

const traced = await parallel([
  () => agent(tracerPrompt('BUG1', 'Trace how suggest revision over a selection becomes a NOTE-HIGHLIGHT after reload, AND how the undeletable orphan highlight (tint with no card) arises. The kind re-derivation in buildModeBReapplyRecords (notes give note, comments give revision, highlights give highlight) is the leading suspect: determine under exactly what condition a revision-comment card is missing from the comments array (or its textRange is stripped, or a tint mark survives without a card) at reapply time. Also examine whether the SELECTION-menu suggest revision even creates a proper revision-comment card vs mis-routing into notes/highlights at creation time.'),
    { label: 'trace:BUG1', phase: 'Trace', schema: ROOT_CAUSE_SCHEMA }),
  () => agent(tracerPrompt('BUG2', 'Trace exactly why a COLLAPSED CURSOR on a heading fails to create a comment while a SELECTION on the heading succeeds. Determine: does comment fail for a collapsed cursor on ANY block (paragraph included), i.e. is the real bug "comment requires a non-empty selection", or is there a heading-specific divergence (paragraphUuidAt returning null for headings, cardResolveScope giving a zero-width range, the menu offering Comment at a caret but createLinkedAnchor no-op-ing on the empty range, or a missing Mode-A fallback for headings)? Identify the deepest culprit: the absence of a unified "what does this action anchor to when there is no live range" policy across block kinds.'),
    { label: 'trace:BUG2', phase: 'Trace', schema: ROOT_CAUSE_SCHEMA }),
])

const rootCauses = traced.filter(Boolean)
log('Traced ' + rootCauses.length + ' root causes.')

// Phase 3: Verify
phase('Verify')

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'verdict', 'reasoning', 'counterEvidence', 'correction'],
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'partially-confirmed', 'refuted'] },
    reasoning: { type: 'string' },
    counterEvidence: { type: 'array', items: { type: 'string' } },
    correction: { type: 'string', description: 'If partially-confirmed or refuted, the corrected mechanism with file:line. Empty if confirmed.' },
  },
}

const LENSES = [
  { key: 'code-correctness', instr: 'Re-read the actual code in the causal chain and verify each step is literally true (the function does what the chain claims; the condition can actually be reached). Find any step where the code contradicts the claim.' },
  { key: 'test-evidence', instr: 'Search the test suite (src/links/__tests__, the reapply-mode-b-anchors test, resolve-card-anchor test, mode-a-reconcile test, any revisions/notes/highlight tests) for tests that would PASS only if the chain is wrong, or that already cover this path. Does existing test evidence support or contradict the root cause?' },
  { key: 'alternative-cause', instr: 'Try hard to find a DIFFERENT, simpler explanation for the symptom that the tracer missed or dismissed too quickly. If a competing hypothesis fits the evidence better, argue for it with file:line.' },
]

const verdicts = await pipeline(
  rootCauses,
  (rc) => parallel(LENSES.map((L) => () =>
    agent(READONLY + '\n\n' + BUGS + '\n\nA causal tracer proposed this root cause for ' + rc.bug + '. ADVERSARIALLY verify it through the "' + L.key + '" lens. Default to skepticism: if uncertain, say so. ' + L.instr + '\n\nPROPOSED ROOT CAUSE (JSON):\n' + JSON.stringify(rc, null, 1) + '\n\nReturn your verdict with concrete file:line counter-evidence or confirmation.',
      { label: 'verify:' + rc.bug + ':' + L.key, phase: 'Verify', schema: VERDICT_SCHEMA }))
  ).then((vs) => ({ bug: rc.bug, rootCause: rc, verdicts: vs.filter(Boolean) }))
)

const verifiedRootCauses = verdicts.filter(Boolean)
for (const v of verifiedRootCauses) {
  log(v.bug + ' verdicts: ' + v.verdicts.map((d) => d.verdict).join(', '))
}

// Phase 4: Synthesize
phase('Synthesize')

const synthInput = JSON.stringify({ subsystemMaps: validMaps, verifiedRootCauses }, null, 1)

const synthesis = await agent(
  READONLY + '\n\n' + BUGS + '\n\n' + KNOWN + '\n\nYou are the SYNTHESIS lead. You have: 6 subsystem maps, 2 verified root causes (each with 3 adversarial verdicts that may CORRECT the tracer chain). Apply the corrections: where a verdict refuted or partially-confirmed a step, use the corrected mechanism.\n\nINPUT (JSON):\n' + synthInput + '\n\nPRODUCE A DIAGNOSIS MEMO and WRITE IT to /Users/gabriel/Programming/virgil/docs/memos/action-menu-anchor-bugs/DIAGNOSIS.md (create the directory if needed). The memo must contain, in this order:\n1. Executive summary: the SINGLE deepest unifying culprit (or the smallest set if genuinely two distinct ones) behind BOTH bugs, stated as a bug CLASS.\n2. BUG1 verified causal chain (corrected per verdicts), with file:line.\n3. BUG2 verified causal chain (corrected per verdicts), with file:line.\n4. The unifying analysis: what architectural gap connects them. The user hypothesis space: both bugs live at the seam between (a) how an action decides what to ANCHOR to when given a range vs a collapsed caret vs a heading, and (b) how that anchor KIND/identity survives the .tex strip + sidecar-driven reload reapply. Argue whether there is ONE deep culprit (e.g. anchor kind/identity is not authoritatively persisted, it is re-derived on reload from card-array membership, and the create path has no unified range-or-fallback anchoring policy across block kinds) or two.\n5. The PROPOSED DEEP ARCHITECTURAL FIX: a unified design that captures the whole range of related phenomena (NOT surgical patches). Address: (i) making each anchor kind/identity authoritative and self-describing so reload never re-derives it from array membership; (ii) a single resolve-anchor-target policy that handles selection / collapsed-caret / heading uniformly (Mode-A fallback when no live range) so comment-at-caret and heading work like paragraph; (iii) eliminating the orphan-tint-without-card class. List the concrete files/functions each part touches.\n6. Related phenomena this fix would also resolve (from the tracers relatedPhenomena + the maps suspectedDefects).\n7. Risks, open questions, and what a live repro/test should confirm before implementing.\n\nReturn: the absolute memo path, the executive-summary text, and a 5-bullet TL;DR of the proposed fix.',
  { label: 'synthesize', phase: 'Synthesize', effort: 'high' }
)

return { memo: synthesis }
