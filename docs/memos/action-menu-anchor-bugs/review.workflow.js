export const meta = {
  name: 'action-menu-anchor-fix-review',
  description: 'Adversarial review of the unified anchor-kind/target fix diff: correctness, data-loss safety, regressions, keystroke-sanctity',
  phases: [
    { title: 'Review', detail: '6 parallel reviewers over concern clusters' },
    { title: 'Verify', detail: 'adversarially verify each finding (real? already handled?)' },
    { title: 'Synthesize', detail: 'ranked confirmed findings + fixes' },
  ],
}

const WT = '/Users/gabriel/Programming/virgil-wt/action-menu-anchor-fix'

const BASE = [
  'You are adversarially reviewing a LANDED-but-uncommitted bug fix in Virgil (a browser LaTeX editor) in the worktree ' + WT + ' (branch action-menu-anchor-fix). The full staged diff is visible via `git -C ' + WT + ' diff --cached` (also `--stat`). Read the actual changed files in the worktree for context — do not trust the diff hunks alone.',
  'CONTEXT: the fix resolves BUG1 (a "suggest revision" / cutter / todo / report range anchor reloaded as a note-highlight because the linkedAnchor mark KIND was re-derived lossily — the .tex serializer drops kind, the parser re-stamps a hardcoded "note", and the reload re-apply SKIPPED present marks) and BUG2 (a collapsed caret on a heading/list-item silently created no card because the lightning menu flattened the dispatch ref to a fake {kind:"paragraph"}). The unified fix: (i) the reload reconcile (applyLinkedAnchorsImpl) is now AUTHORITATIVE — it re-stamps a present mark\'s kind/linkCard/tintColor from the owning sidecar card; (ii) the menu emits the REAL anchorable-node kind (Path A); (iii) the orphan reaper is synchronous + kind-gate-free, with a load-order `ready` gate.',
  'The design SSOT is /Users/gabriel/Programming/virgil/docs/memos/action-menu-anchor-bugs/IMPLEMENTATION_PLAN.md and DIAGNOSIS.md. Read them.',
  'Virgil rules you must check against: (1) KEYSTROKE SANCTITY — no work proportional to doc size on each keystroke; doc walks must be load/gesture-time only, never an `editor.on("update"|"transaction")` subscriber on the keystroke path. (2) DATA-LOSS is the highest-severity class — an anchor mark must never be stripped while its card is alive, and a card must never silently lose its anchor. (3) The dev preview MASKS anchor persistence — durability is proven by unit tests.',
  'Be a skeptic. Find REAL defects with file:line and a concrete failing scenario. Rate each: blocker (data loss / crash / the reported bug not actually fixed) / high (wrong behavior in a real case) / medium (edge case / latent) / low (style/nit). Do not invent problems; if a concern is already handled, say so.',
].join('\n\n')

phase('Review')

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cluster', 'findings'],
  properties: {
    cluster: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'severity', 'file', 'line', 'scenario', 'suggestedFix', 'confidence'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          file: { type: 'string' }, line: { type: 'string' },
          scenario: { type: 'string', description: 'The concrete sequence that triggers the defect; "n/a — clean" if no defect' },
          suggestedFix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const CLUSTERS = [
  {
    key: 'bug1-reconcile-core',
    prompt: 'Review the BUG1 reconcile core: src/links/_shared/apply-linked-anchors.ts (applyLinkedAnchorsImpl), src/links/_shared/reapply-mode-b-anchors.ts (buildModeBReapplyRecords + the new reports array + the cardId/tintColor/paragraphId fields), and src/links/links.ts reanchorByText. VERIFY: (a) the present-and-disagrees re-stamp produces EXACTLY the create-time attrs (anchorId/kind/linkId/linkKind/linkCard/tintColor) and never leaves a duplicate or partial mark; (b) the agree-check is correct so a healthy in-session mark is a true no-op (idempotent — no needless transaction, no bus emit on a plain reload of a correct doc); (c) the linkCard token built via legacyKindToCardKindString is byte-identical to create-time for EVERY kind (revision→comment:, cutter-comment→cutter-comment:, report→report:, highlight, todo); (d) reports are collected BEFORE highlights (highlights strictly last for overlap last-wins) and report vs report-request split correctly; (e) the absent-branch reanchorByText restores kind+tint+linkCard faithfully. Find any kind/token that reloads wrong, any double-stamp, any non-idempotency.',
  },
  {
    key: 'load-order-data-loss',
    prompt: 'Review the load-order DATA-LOSS safety of the synchronous orphan reaper: src/links/_shared/useLinkedAnchorReconciler.ts (the `ready` gate + the synchronous useLayoutEffect sweep + reapOrphanLinkedAnchors) and src/components/EditorPane.tsx (the `ready: allCardSidecarsLoaded && docContentReady` wiring at the hook call site + the load-reconcile pass that also calls reapOrphanLinkedAnchors LAST). This is the HIGHEST-RISK area. VERIFY EXHAUSTIVELY: (a) is there ANY render where the hook sweep runs with the doc holding linkedAnchor marks but an INCOMPLETE alive-set (some sidecars not yet loaded)? Consider: initial mount, doc-switch (docId change → sidecars reload → does `ready` correctly drop to false?), a single sidecar reloading mid-session, the `.loaded ⟹ cards-populated` invariant (does any hook flip loaded=true before its cards array is set?). (b) Effect ordering: the hook is a useLayoutEffect (runs before the EditorPane load-pass useEffect) — on the render where ready flips true, the hook sweep runs FIRST against the parsed (not-yet-reconciled) doc; is every live card\'s anchorId in the alive-set at that point so nothing live is reaped? (c) Does dropping `isInitialized` (keeping only `isDestroyed`) ever run the sweep against a half-built editor? (d) Could a card whose mark was lost-across-parse (reanchorByText re-stamp pending in the load-pass) be wrongly absent from the doc but that\'s fine — confirm. Find any window that reaps a live annotation.',
  },
  {
    key: 'bug2-create-path',
    prompt: 'Review the BUG2 create path: src/lib/anchor-uuid.ts (resolveAnchorUuidAndKind + the factored ensureAnchorUuidNode), src/components/SelectionActionsMenu.tsx (menuTarget widening + resolveAnchorUuidAndKind use), src/components/ActionsMenuPanel.tsx (runAction cursor branch emitting {kind:nodeKind,id} + the UNCHANGED {kind:"cursor"} probe), and src/components/editor-layout/card-actions/drag-handle-actions.ts (resolveRefRange for the resulting real-kind refs + the new dev-warn). VERIFY: (a) heading caret → comment lands on the heading LINE (not the whole section) and as Mode-A; listItem caret → note lands on the listItem (Mode-A), no throw; paragraph caret still works (regression); a real selection still works (regression — the probe vs dispatch asymmetry must not break highlight greying or selection-mode actions). (b) the mint-without-stale-read in ensureAnchorUuidNode is correct (node.type.name invariant across setNodeMarkup; uuid is the freshly-minted value). (c) any kind resolveRefRange does NOT handle for the real-kind ref (e.g. an atom-block caret) — does it degrade gracefully (resolve to a NodeSelection) or crash? (d) does the dev-warn fire on a legitimate stale-ref case and become noisy? Find any caret/kind that still no-ops or now misbehaves.',
  },
  {
    key: 'dropped-kind-gates',
    prompt: 'Review dropping the kind gate in the 5 orphan listeners: src/hooks/useRevisions.ts, useCutter.ts, useReports.ts, useNotes.ts, useTodos.ts (each `virgil-anchor-orphaned` handler now does `if (!anchorId) return;` then calls clearCardAnchor, instead of also gating on the event\'s `kind`). The rationale: after reload the event carries the parser-default "note", so a kind gate makes a panel ignore its OWN orphaned non-note mark; each clearCardAnchor self-filters by anchorId with a no-match early-return. VERIFY for EACH of the 5 hooks: (a) clearCardAnchor (or the inlined sweep) TRULY early-returns (returns prev state unchanged, fires no write) when the anchorId matches none of THAT panel\'s cards — quote the early-return line; (b) there is no shared-anchorId collision where two panels both own a card with the same anchorId and dropping the gate makes the wrong panel clear it (anchorIds are globally unique — confirm); (c) no added per-event cost that walks all cards without an index (the handler must stay O(panel-cards) with an early-return, not a doc walk). Find any hook whose clearCardAnchor mutates/writes on a non-matching anchorId.',
  },
  {
    key: 'reanchor-uuid-scope',
    prompt: 'Review the uuid-scoped, atom-aware reanchorByText in src/links/links.ts (the paragraphUuid branch + the per-child offset walk + the doc-wide fallback). VERIFY: (a) the offset walk advances the DOC position by nodeSize for ALL children (incl. inline atoms) but the char offset only for text nodes, so `from`/`to` are correct when the snapshot spans an inline atom (footnote/citation between words) — check the off-by-one at child boundaries and the from/to inclusivity; (b) when paragraphUuid resolves a node but the snapshot is NOT found inside it, does it fall back to the doc-wide search or return null? (the safe choice is the bounded behavior — confirm what it does and whether that is right); (c) the doc-wide fallback (absent/unresolved uuid) is byte-identical to the legacy behavior (back-compat — the legacy linked-anchor-roundtrip test must stay green); (d) duplicate-text disambiguation actually works (two paragraphs same text → lands in the uuid-named one). Find any boundary/atom mismaps.',
  },
  {
    key: 'cross-cutting',
    prompt: 'Review cross-cutting concerns. (a) KEYSTROKE SANCTITY: confirm NO new code subscribes to editor.on("update"|"transaction") or does a doc-size walk on the keystroke path. The new doc walks (collectPresentMarks, reapOrphanLinkedAnchors, reanchorByText, resolveAnchorUuidAndKind) must all be load-time or gesture-time only — trace each caller. Run/inspect: are any of the touched hooks (useNotes/useTodos/useCutter/useRevisions/useReports) firing the orphan handler per keystroke? (b) BACK-COMPAT: the .tex \\vlid{X} marker shape is UNCHANGED (we did NOT encode kind) — confirm no serializer/parser format change; old docs round-trip identically. (c) cardKindToLegacyAnchorKind now returns LinkedAnchorKind|null (was string, default "note") and is exported — audit EVERY caller (esp. links.ts:385 createAnchorLink with `?? "note"`) for a behavior change: does any caller now get null where it expected a string, or rely on the old wrong "note" for a real anchor kind? (d) the EditorHandle.applyLinkedAnchors type widening + the shared applyLinkedAnchorsImpl extraction — any consumer left on a stale shape? Find any keystroke-path regression, format break, or caller breakage.',
  },
]

const reviews = await parallel(CLUSTERS.map((c) => () =>
  agent(BASE + '\n\n=== YOUR CLUSTER: ' + c.key + ' ===\n\n' + c.prompt + '\n\nInspect the real worktree code (read files; run `git -C ' + WT + ' diff --cached -- <path>` for specific hunks). Return findings (empty findings array if the cluster is clean — say so explicitly with one "n/a — clean" entry).',
    { label: 'review:' + c.key, phase: 'Review', schema: FINDING_SCHEMA })
))

const allFindings = reviews.filter(Boolean).flatMap((r) =>
  (r.findings || []).filter((f) => f.severity && f.scenario && !/^n\/a/i.test(f.scenario)).map((f) => ({ ...f, cluster: r.cluster })))
log('Surfaced ' + allFindings.length + ' candidate findings across ' + reviews.filter(Boolean).length + ' clusters')

phase('Verify')

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'verdict', 'severityAfterReview', 'reasoning', 'fix'],
  properties: {
    title: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed-real', 'partially-real', 'not-a-bug'] },
    severityAfterReview: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'none'] },
    reasoning: { type: 'string', description: 'Read the actual code; confirm or refute the scenario with file:line' },
    fix: { type: 'string', description: 'The concrete fix if real; empty if not-a-bug' },
  },
}

const verified = await pipeline(
  allFindings,
  (f) => agent(BASE + '\n\nADVERSARIALLY verify this review finding by reading the ACTUAL code in the worktree. Default to skepticism — many review findings are false alarms (the concern is already handled, the scenario can\'t occur, or the code is correct). Confirm ONLY if you can trace a real failing scenario in the live code. If real, give the minimal correct fix.\n\nFINDING (JSON):\n' + JSON.stringify(f, null, 1) + '\n\nReturn your verdict.',
    { label: 'verify:' + (f.file || '').split('/').pop() + ':' + f.severity, phase: 'Verify', schema: VERDICT_SCHEMA })
)

const confirmed = verified.filter(Boolean).filter((v) => v.verdict !== 'not-a-bug' && v.severityAfterReview !== 'none')
log('Confirmed ' + confirmed.length + '/' + allFindings.length + ' findings after adversarial verification')

phase('Synthesize')

const synth = await agent(
  BASE + '\n\nYou are the review LEAD. Below are the adversarially-VERIFIED findings (false alarms already dropped). Produce the final review verdict and WRITE it to /Users/gabriel/Programming/virgil/docs/memos/action-menu-anchor-bugs/REVIEW.md.\n\nVERIFIED FINDINGS (JSON):\n' + JSON.stringify(confirmed, null, 1) + '\n\nThe memo must: (1) an overall verdict — is the fix SHIP-READY, ship-with-fixes, or needs-rework? (2) blockers first, then high/medium/low, each with file:line + the concrete fix; (3) explicitly confirm or flag the two highest-risk properties: BUG1 reconcile correctness (kind/token restored for every kind) and the load-order data-loss safety (no live annotation reaped on any load/doc-switch path); (4) a short "what was checked and found clean" list so the absence of findings in an area is documented, not assumed. Return: the memo path, the overall verdict, and the ordered list of must-fix items (title + file:line + one-line fix), or "none" if ship-ready.',
  { label: 'synthesize-review', phase: 'Synthesize', effort: 'high' }
)

return { review: synth, confirmedCount: confirmed.length }
