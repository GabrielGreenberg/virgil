export const meta = {
  name: 'action-menu-anchor-fix-plan',
  description: 'Design the unified anchor-kind/target fix: resolve open architecture choices, produce one concrete implementable edit plan with chip ordering',
  phases: [
    { title: 'Design', detail: '4 parallel design agents nail each seam' },
    { title: 'Synthesize', detail: 'merge into one coherent implementation plan' },
  ],
}

const BASE = [
  'You are designing the IMPLEMENTATION of a verified bug fix in Virgil (a browser LaTeX editor), repo /Users/gabriel/Programming/virgil.',
  'READ the full diagnosis first: docs/memos/action-menu-anchor-bugs/DIAGNOSIS.md. It is the verified SSOT — both bugs trace to ONE culprit: a linkedAnchor mark KIND and TARGET are never authoritatively owned (re-derived late+lossily on reload from .tex round-trip + card-array membership; flattened to a fake {kind:"paragraph"} ref on create).',
  'CENTRAL DESIGN PRINCIPLE (the user is emphatic): prefer a UNIFIED, DEEP, ARCHITECTURAL solution that captures the whole range of related phenomena. Avoid superficial, surgical patches. Where reasonable, pick the deepest solution that also IMPROVES the app.',
  'Your job is DESIGN ONLY — read the real code, settle the exact seams, and return a precise, implementable edit plan (file + exact location/anchor + the change + rationale). Do NOT edit any source file. Cite file:line for everything. Verify each claim in the diagnosis against the live code; if the diagnosis is wrong about a line, say so.',
  'Respect Virgil keystroke-sanctity (no per-keystroke doc walks; load/gesture-time work only) and the "annotations are sidecar-owned app-state, .tex is document SSOT" design.',
].join('\n\n')

phase('Design')

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['part', 'decisions', 'edits', 'newTests', 'risks', 'dependencies', 'openConcerns'],
  properties: {
    part: { type: 'string' },
    decisions: {
      type: 'array',
      description: 'Each open architectural choice, resolved with a recommendation + rationale',
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'recommendation', 'rationale', 'alternativesRejected'],
        properties: {
          question: { type: 'string' }, recommendation: { type: 'string' },
          rationale: { type: 'string' }, alternativesRejected: { type: 'string' },
        },
      },
    },
    edits: {
      type: 'array',
      description: 'Concrete edits in dependency order. Each: file, exact location/anchor, what changes (before→after intent), why.',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'location', 'change', 'rationale'],
        properties: {
          file: { type: 'string' }, location: { type: 'string' },
          change: { type: 'string' }, rationale: { type: 'string' },
        },
      },
    },
    newTests: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'name', 'asserts'],
        properties: { file: { type: 'string' }, name: { type: 'string' }, asserts: { type: 'string' } },
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    dependencies: { type: 'array', items: { type: 'string' }, description: 'Other parts/files this part must coordinate with' },
    openConcerns: { type: 'array', items: { type: 'string' }, description: 'Anything the synthesis lead or implementer must decide' },
  },
}

const PARTS = [
  {
    key: 'bug2-resolve-target-policy',
    prompt: [
      'PART (ii): ONE resolve-anchor-target policy so a collapsed caret / heading / list-item annotation works like a selection (the BUG2 fix, generalized to all block kinds).',
      'Read: src/components/ActionsMenuPanel.tsx (runAction ~:206-214 cursor flattening + the ~:398-400 grey-out probe), src/components/SelectionActionsMenu.tsx (menuTarget computation + paragraphUuid passing ~:326-355,399), src/components/editor-layout/card-actions/drag-handle-actions.ts (DragHandleRef type ~:73, resolveRefRange ~:983-1049, the silent annotation bail ~:192-204, actionClass ~:961-968), src/lib/anchor-uuid.ts (resolveAnchorableNode), src/lib/section-range.ts, and the registry cardResolveScope (src/lib/actions/action-registry.ts:949-1001) + CursorRef/ActionRef.',
      'KEY DECISION TO SETTLE: Path A (the menu emits the REAL anchorable-node kind it already resolved — heading→{kind:"heading"}, listItem→{kind:"listItem"} — reusing the existing resolveRefRange branches, since menuTarget ALREADY resolved the node) vs Path B (introduce a first-class CursorRef into DragHandleRef and teach resolveRefRange to resolve it). Determine whether menuTarget already carries the real node kind (so Path A is "stop discarding the kind"). Recommend the deeper-yet-cleaner path. The fix MUST make probe and dispatch share ONE ref so they never diverge again, and add a Mode-A fallback at a caret.',
      'Also: confirm resolveRefRange handles {kind:"listItem"|"blockquote"|"codeBlock"|"exampleItem"|"heading"} correctly for an annotation action (Mode-A, right range); design the dev-assert/notify when an annotation resolve returns null; and verify footnote/citation-at-caret still land sensibly (passage-end of the resolved block). Note the full set of actions+kinds this fixes.',
    ].join('\n\n'),
  },
  {
    key: 'bug1-reload-reconcile-authority',
    prompt: [
      'PART (i): make the reload reconcile AUTHORITATIVE over the parser default so an anchor mark kind/linkCard/tintColor is re-stamped from its owning sidecar card (the BUG1 fix).',
      'Read: src/components/Editor.tsx applyLinkedAnchors (~:1519-1534, the present-skip) + the EditorHandle type, src/links/_shared/reapply-mode-b-anchors.ts (ModeBReapplyRecord, buildModeBReapplyRecords, the false header invariant), src/links/links.ts (reanchorByText ~:964-1017, updateLinkedAnchorCard ~:921-958, createLinkedAnchor), src/lib/latex-parser.ts (applyLinkedAnchorBoundaries ~:858-860 hardcoded kind:"note"), src/lib/latex-serializer.ts (serializeMarks/serializeInlineSequence ~:655-689), src/components/EditorPane.tsx (the load reconcile effect that calls reapplyModeBAnchors then per-panel reconcileAnchors ~:1351-1364), src/lib/tiptap/linked-anchor.ts (mark attrs).',
      'KEY DECISIONS TO SETTLE: (1) Reconcile-not-skip: change applyLinkedAnchors so a present mark whose kind/linkCard/tintColor DISAGREES with the record is RE-STAMPED (not skipped). This needs cardId + tintColor threaded into ModeBReapplyRecord and into reanchorByText (today it passes neither). Confirm applyLinkedAnchors is LOAD-ONLY (grep every call site) before changing its contract. (2) Should we ALSO encode kind in the .tex \\vlid marker (DIAGNOSIS option i.a)? Argue against it if it contradicts "sidecar is SSOT for kind / a markerless anchor with no card must be reaped, not painted from .tex" — recommend the principled choice. (3) Verify ordering still holds (RC-B before RC-A; reconcile before first autosave). Design the faithful re-stamp (kind + linkCard + tintColor + cardId) and the minimal change to buildModeBReapplyRecords to carry tintColor/cardId. Confirm this generalizes to revision/cutter/todo/report/highlight identically.',
    ].join('\n\n'),
  },
  {
    key: 'orphan-tint-and-kind-aware',
    prompt: [
      'PART (iii) + the kind-aware glue: eliminate the orphan-tint-without-card class and make the resolver + orphan listeners kind-aware (so a removed mark routes to the right panel regardless of the parser default).',
      'Read: src/links/resolve-card-anchor.ts (buildResolveIndex.anchorIdToParagraph ~:116-135, rung-2 source:"mark" ~:222-237, reconcileCardToResolved ~:360-369 — kind-blind), src/links/_shared/useLinkedAnchorReconciler.ts (the setTimeout(0) orphan reaper ~:75-90), src/cards/delete-margin-item.ts (~:118-121 strips mark only when editor+anchorId both passed), src/lib/tiptap/linked-anchor.ts (LinkedAnchorGuard virgil-anchor-orphaned dispatch — uses the mark default kind), src/hooks/useRevisions.ts (kind-gated orphan listener ~:534-544), src/links/links.ts reanchorByText (~:971-993 indexOf doc-wide first-match + the dropped `to` when snapshot crosses an inline atom).',
      'DESIGN: (1) a deterministic, kind-aware orphan reap that runs synchronous-with-reconcile (NOT a detached setTimeout racing autosave) and keys off the union of live card anchorIds so a mark with no owning card is reaped in the same pass; respect keystroke-sanctity (reconcile/structural-diff time, not per-transaction). (2) make every delete path strip the in-doc mark (thread the editor handle to all handlers.delete call sites, OR reap on the reconcile keyed off the sidecar delete) — enumerate the call sites. (3) make virgil-anchor-orphaned + the resolver carry the CARD\'s kind, not the parser default. (4) uuid-anchor reanchorByText (use the card\'s stored paragraph uuid to disambiguate, not doc-wide indexOf) and make it multi-text-node aware so co-located highlight/revision overlaps stop displacing each other. Give exact edit specs.',
    ].join('\n\n'),
  },
  {
    key: 'test-and-verification-surface',
    prompt: [
      'PART (iv): the test + verification surface that proves the fix and guards against regression.',
      'Read existing tests: src/links/_shared/__tests__/reapply-mode-b-anchors.test.ts, src/links/__tests__/resolve-card-anchor.test.ts, src/links/__tests__/mode-a-reconcile.test.ts, src/components/editor-layout/card-actions/__tests__/ (the drag-handle-dispatch-nits.test.tsx cursor-paragraph success at ~:260-274), any linked-anchor-roundtrip test (search), and how tests mount a real Editor / parse+serialize in this repo (look for parseLatex/serializeToLatex usage in tests, and the vitest storage-mock gotcha in node-env).',
      'DESIGN the new tests (file path + name + exact asserts): (1) the MISSING combined round-trip — serialize a REVISION (and cutter/todo/report/highlight) linkedAnchor → parseLatex → run RC-B applyLinkedAnchors against the already-parsed doc (with the mark present as note) → assert the live mark kind/linkCard/tintColor are restored (this is the BUG1 collision the current RC-B tests never exercise because they mount a mark-free doc). (2) a dispatch test: a caret/real-kind ref on a HEADING and on a LIST-ITEM → assert the comment/note lands on the heading line / list-item (mirrors the paragraph-cursor success test). (3) an orphan-reap test: a \\vlid that round-trips with no owning card → assert the mark is reaped (not left painted) deterministically. (4) a negative test: cursor-on-heading/listItem annotation must NOT silently produce nothing.',
      'Also specify: which existing tests will need updating (e.g. any asserting only {anchorId,text} round-trip, or the ModeBReapplyRecord shape), and the exact commands to run (tsc, eslint, the targeted vitest files, full suite worker count).',
    ].join('\n\n'),
  },
]

const designs = await parallel(PARTS.map((p) => () =>
  agent(BASE + '\n\n=== YOUR PART: ' + p.key + ' ===\n\n' + p.prompt + '\n\nReturn a precise, implementable edit plan. Every edit must be concrete enough to apply without re-deriving it. Settle the open decisions with a clear recommendation.',
    { label: 'design:' + p.key, phase: 'Design', schema: PLAN_SCHEMA })
))

const validDesigns = designs.filter(Boolean)
log('Designed ' + validDesigns.length + '/' + PARTS.length + ' parts; ' + validDesigns.reduce((n, d) => n + (d.edits ? d.edits.length : 0), 0) + ' concrete edits, ' + validDesigns.reduce((n, d) => n + (d.newTests ? d.newTests.length : 0), 0) + ' new tests')

phase('Synthesize')

const synth = await agent(
  BASE + '\n\nYou are the IMPLEMENTATION-PLAN SYNTHESIS LEAD. You have 4 structured design plans (one per part). Merge them into ONE coherent, ordered implementation plan and WRITE it to /Users/gabriel/Programming/virgil/docs/memos/action-menu-anchor-bugs/IMPLEMENTATION_PLAN.md.\n\nThe 4 design plans (JSON):\n' + JSON.stringify(validDesigns, null, 1) + '\n\nThe plan MUST:\n1. State the FINAL architecture decisions (resolve every open choice the parts raised — especially Path A vs CursorRef for BUG2, and reconcile-not-skip vs encode-kind-in-marker for BUG1 — with a one-line rationale each). Pick the deepest coherent solution that improves the app; flag any place the parts disagreed and break the tie.\n2. Order the work into CHIPS (coherent, independently-verifiable units) with explicit dependencies. Each chip: title, the files it touches, the exact edits (carry them forward verbatim from the design plans), the tests it adds/updates, and its verification command. Sequence chips so the suite stays green between them where possible.\n3. Identify cross-part conflicts (files touched by multiple parts — e.g. links.ts reanchorByText, the ModeBReapplyRecord shape, drag-handle-actions.ts) and specify the single coherent change so chips do not stomp each other.\n4. List the global verification gates (tsc, eslint, targeted vitest, full suite) and the live-preview checks that ARE faithful (BUG2 gestures) vs the ones that must be unit-tested (BUG1 persistence — preview masks it).\n5. Call out keystroke-sanctity and back-compat (old \\vlid{X} must keep parsing) guardrails.\n\nReturn: the absolute plan path, the final architecture decisions (bulleted), and the ordered chip list (title + one-line scope each).',
  { label: 'synthesize-plan', phase: 'Synthesize', effort: 'high' }
)

return { plan: synth }
