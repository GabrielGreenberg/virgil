export const meta = {
  name: 'a1-gardening-review',
  description: 'Independent adversarial pre-merge review of the A1 gardening chip (dead-code removal + R30 toolbar GC)',
  phases: [
    { title: 'Review', detail: '6 skeptic lenses over the A1 diff' },
    { title: 'Verify', detail: 'adversarially refute each CRITICAL/HIGH finding' },
    { title: 'Synthesize', detail: 're-run tsc + vitest + grep-gates; adjudicate GO/GO-WITH-NITS/NO-GO' },
  ],
}

const CTX = [
  'You are an INDEPENDENT ADVERSARIAL REVIEWER of an uncommitted-to-main refactor chip.',
  '',
  'REPO: /Users/gabriel/Programming/virgil (Virgil — browser LaTeX editor; Next.js + TipTap).',
  'BRANCH UNDER REVIEW: chip-A1-gardening (currently checked out).',
  'SCOPE (8 commits, NOT merged): git diff main..HEAD  (16 files, +49/-1614 — a large net DELETION). git log --oneline main..HEAD.',
  'Read a DELETED file via: git show main:<path> (e.g. git show main:src/hooks/useComments.ts, git show main:src/lib/stack/... ). Inspect commits with git show <sha>.',
  '',
  'HARD GUARD — READ-ONLY on the working tree. Do NOT run git checkout/switch/branch/stash/reset/restore/commit/merge/rebase/apply or tools/sync-defaults.sh, and do NOT edit source. Inspect via Read/Grep/Bash(read-only git+grep). The SYNTHESIZER runs tsc/vitest read-only on the current checkout (no branch switch).',
  '',
  'WHAT A1 DOES (audit against this) — pure dead-code GARDENING, 8 commits:',
  '1. Remove the dead useComments hook + UserComment/CommentsState types (zero consumers).',
  '2. Remove the dead menuLocation view pref (MenuLocation type, the field, setMenuLocation + export, the defaults.json + reader-view-prefs defaults). setMenuLocation had zero callers; the menuLocation value was never read. RATIFIED R2: NO read-time migration strip (load is a structural spread {...DEFAULT_PREFS, ...parsed}, so a stale persisted key is silently dropped).',
  '3. Remove the grip-redesign commented-out handleDragStart blocks + orphaned imports (MIME_TODO in TodoRow, MIME_TEXT_INSERT + useCallback in ErrorCard). RATIFIED R6: a one-line note was added to MEMO_BUG_BACKLOG.md recording the grip-reintro intent.',
  '4. Remove the inert FloatWindow autoFitBody grow-burst (no Floatable sets autoFitBody — zero producers) + the autoFitBody field from floats/types.ts.',
  '5. Remove the dead ErrorCard popout/lift wiring (usePoppedCards/popKey/onToggleFromCtx/onTogglePopout/isPoppedOut/cardKey) — doubly dead after A4 made isPoppable gate the lift; error is non-anchored + not poppable. compressed simplified from (!expanded && !isPoppedOut) to (!expanded).',
  '6. Reword 3 stale doc-comments to the float:card:<kind>:<id> / buildFloatKey grammar (OmniViewPanel, text-object-registry textObjectPopoutKey, EditorLayout tryScrollOmniEntry example).',
  '7-8. R30 toolbar KILL — remove the detached actions/formatting/menu toolbars. KEY FINDING (re-verify): at HEAD these were ALREADY DEAD CODE, not a live feature — their trigger affordances were severed earlier (AttachedPopover never rendered; the docked MenuBar stripped onGrabStart; no keybinding/menu/setting reaches them). Commit 7 removed the EditorPane consumers (the 3 Detached* portals, the detach handlers/state, the dead actionsBundle, the onActionsDetach/onFormatDetach/onGrabStart/atHome props) + the MenuBar prop plumbing. Commit 8 removed the now-unreferenced MenuBar component defs (AttachedPopover, ActionButton/ActionButtonDef/ACTION_BUTTON_DEFS/ActionButtonsRow, FormatButtonsRow, DetachedActionsToolbar/DetachedFormattingToolbar/DetachedMenuToolbar, ActionsStarIcon/FormatGlyphIcon/IconBtn/TextBtn/ExampleDropdown) + orphaned imports, and trimmed floating-toolbar-shell.tsx (R4) to just `export type ToolbarOrientation`.',
  '',
  'RATIFIED DECISIONS (verify correct implementation, do not re-litigate): R2 no menuLocation strip; R3 chrome-config.ts isActionCallbackVisible/isActionVisible/CALLBACK_TO_ACTION_KIND defs LEFT intact (only the MenuBar import removed); R4 floating-toolbar-shell trimmed to ToolbarOrientation; R5 the ac.props/aria-expanded dead-prop DEFERRED to A9 (NOT touched here); R6 backlog note added.',
  '',
  'THE CRITICAL QUESTION (R30): did A1 lose any LIVE capability? Prove or disprove that the user can STILL, from the docked bar: (a) add comment/note/highlight/todo/cut/archive/footnote/citation — these run through the KEPT `<ActionsStripButton editor={editor} />` in MenuBarContent -> SelectionActionsMenu/ActionsMenuPanel (editor/chrome-driven, NOT the deleted onAddComment-family props, which are pre-existing dead pass-throughs); (b) rotate orientation — ViewMenu rotate via onSetOrientation threaded MenuBarContent -> ViewMenu; (c) the View/kebab menu, paragraph nav, split toggle, collab pill. Also: the docked MenuBar still mounts (export default memo(MenuBar) survives; Editor.tsx imports MenuBar as default).',
  '',
  'KEYSTROKE SANCTITY: pure deletions — verify NO editor.on(update/transaction) body was touched, no per-keystroke work added. The FloatWindow autoFitBody effect that was removed was a MOUNT-time effect (not an update subscriber). TWO-KINDS: verify ZERO text-object ontology changes (only the text-object-registry doc-COMMENT reword + FloatWindow which is the shared window layer).',
  '',
  'Report findings with file:line + a concrete code quote. Severity: CRITICAL (breaks build OR removes a LIVE user capability OR data loss), HIGH (a removed symbol was actually still reachable / a real regression / a wrong doc-comment that misleads materially), MEDIUM (correctness smell, an incomplete removal that orphans something), LOW/INFO (nit/doc). Be a skeptic — your job is to find the removal that broke something live. If a dimension is clean, say so with the evidence you checked.',
].join('\n');

const FINDINGS_SCHEMA = {
  type: 'object', required: ['lens', 'findings'], additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', required: ['severity', 'title', 'file', 'claim', 'evidence'], additionalProperties: false,
      properties: {
        severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
        title: { type: 'string' }, file: { type: 'string' }, line: { type: 'string' },
        claim: { type: 'string' }, evidence: { type: 'string' }, suggested_fix: { type: 'string' },
      },
    } },
    clean_dimensions_checked: { type: 'string' },
  },
};
const VERIFY_SCHEMA = {
  type: 'object', required: ['title', 'holds_up', 'revised_severity', 'reasoning'], additionalProperties: false,
  properties: {
    title: { type: 'string' }, holds_up: { type: 'boolean' },
    revised_severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'FALSE_POSITIVE'] },
    reasoning: { type: 'string' },
  },
};
const SYNTH_SCHEMA = {
  type: 'object', required: ['verdict', 'tsc_pass', 'tests_pass', 'summary', 'blocking', 'nits'], additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['GO', 'GO-WITH-NITS', 'NO-GO'] },
    tsc_pass: { type: 'boolean' }, tests_pass: { type: 'boolean' }, test_count: { type: 'string' },
    summary: { type: 'string' },
    blocking: { type: 'array', items: { type: 'object', required: ['title', 'file', 'why'], additionalProperties: false,
      properties: { title: { type: 'string' }, file: { type: 'string' }, why: { type: 'string' } } } },
    nits: { type: 'array', items: { type: 'string' } },
  },
};

const LENSES = [
  { key: 'r30-capability', prompt: 'LENS: R30 — NO LIVE CAPABILITY LOST (the headline). git diff main..HEAD -- src/components/MenuBar.tsx src/components/EditorPane.tsx. (1) Re-verify the detached toolbars were truly DEAD before A1: grep main for any live trigger — git show main:src/components/MenuBar.tsx and git show main:src/components/EditorPane.tsx — confirm AttachedPopover had 0 render sites, the docked MenuBar stripped onGrabStart, and no keybinding/menu/setting spawned a detached toolbar. (2) Prove the docked action vocabulary SURVIVES: the kept <ActionsStripButton editor={editor} /> in MenuBarContent is the docked actions trigger (editor/chrome-driven). Confirm it is still rendered and that the removed onAddComment-family props were NOT what it used. (3) ViewMenu rotate: onSetOrientation still threads MenuBarContent -> ViewMenu and drives the orientation. (4) export default memo(MenuBar) survives (grep -c = 1) and Editor.tsx default-imports it. (5) Tree-wide: zero live JSX/import refs to any deleted symbol. Hunt HARD for a lost user capability.' },
  { key: 'dead-proof-removals', prompt: 'LENS: EACH REMOVAL IS TRULY DEAD. For commits 1-5, grep the WHOLE tree to prove zero live consumers of each removed symbol BEFORE accepting the deletion: useComments / UserComment / CommentsState (git show main:src/hooks/useComments.ts then grep importers); menuLocation / setMenuLocation / MenuLocation (zero readers/callers); autoFitBody (zero producers — only the field decl + the removed FloatWindow consumer); the ErrorCard removed wiring; MIME_TODO in TodoRow + MIME_TEXT_INSERT in ErrorCard (were they used by anything other than the deleted commented blocks?). Flag ANY symbol that still has a live consumer (a removal that should not have happened).' },
  { key: 'errorcard', prompt: 'LENS: ERRORCARD LIFT-WIRING REMOVAL (commit 5). git diff main..HEAD -- src/panels/Errors/ErrorCard.tsx. Confirm: the error card still renders, still EXPANDS/COLLAPSES via the A4 chevron (onToggleExpanded path intact), still JUMPS + DISMISSES; compressed simplified to (!expanded) is correct (error is never popped, so the !isPoppedOut term was always true); ErrorsPanel.tsx + Errors/omni.tsx do NOT pass the removed onTogglePopout/isPoppedOut props (tsc would catch, but confirm no caller relied on them); the A4 panel-local expand axis (R5) is untouched. Hunt for a broken error-card interaction.' },
  { key: 'prefs-shell', prompt: 'LENS: menuLocation PREF REMOVAL + FLOATING-TOOLBAR-SHELL TRIM. (a) The menuLocation removal touches a PERSISTED pref. Confirm R2: the load path is a structural spread (no validator), so a stale persisted menuLocation key is silently ignored — no migration needed, no crash. Check useViewPrefs.ts + useViewPrefs.defaults.json + reader-view-prefs.ts are consistent (no dangling reference to the removed field/type/setter). (b) floating-toolbar-shell.tsx (R4) trimmed to just ToolbarOrientation — confirm MenuBar was its ONLY consumer (grep tree-wide for the file path) and MenuBar now imports only the type. Hunt for a dangling import of a deleted shell export anywhere.' },
  { key: 'keystroke-two-kinds', prompt: 'LENS: KEYSTROKE SANCTITY + TWO-KINDS + DOC-COMMENT ACCURACY. Confirm the entire A1 diff adds NO editor.on(update/transaction) subscriber and removes only dead code (no per-keystroke work added). The removed FloatWindow autoFitBody effect: confirm it was a mount-time effect, not an update subscriber (git show main:src/floats/FloatWindow.tsx). TWO-KINDS: confirm zero text-object ONTOLOGY changes — the text-object-registry.ts edit is a doc-COMMENT reword only (verify), and FloatWindow is the shared window layer (allowed). Then check the 3 reworded doc-comments (OmniViewPanel, text-object-registry textObjectPopoutKey, EditorLayout tryScrollOmniEntry) ACCURATELY describe the current float:card:<kind>:<id> / buildFloatKey grammar — not a new inaccuracy.' },
  { key: 'completeness-critic', prompt: 'LENS: COMPLETENESS CRITIC. Run eslint on the touched files (MenuBar.tsx, EditorPane.tsx, ErrorCard.tsx, TodoRow.tsx, FloatWindow.tsx, useViewPrefs.ts) and confirm the deletions left ZERO newly-orphaned imports/vars (net-new unused = 0 vs the main baseline). Did A1 orphan any dead code it did NOT clean (a now-unused helper/type/import anywhere in the tree)? Verify the RATIFIED dispositions: R3 (chrome-config.ts isActionCallbackVisible/isActionVisible/CALLBACK_TO_ACTION_KIND defs still present — only the MenuBar import removed), R5 (useAnchoredCard ac.props/aria-expanded NOT touched — deferred to A9), R6 (MEMO_BUG_BACKLOG.md note added). Any §9 punch-list item the chip was supposed to do but skipped? Any deletion that is actually OUT of A1 scope (popCardAtAnchor=A3, the stack path=already-AF-follow)?' },
];

phase('Review');
const reviews = (await parallel(
  LENSES.map((l) => () => agent(CTX + '\n\n' + l.prompt, { label: 'review:' + l.key, phase: 'Review', schema: FINDINGS_SCHEMA }))
)).filter(Boolean);
const allFindings = reviews.flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.lens })));
log('Lenses returned ' + allFindings.length + ' raw findings (' + reviews.length + '/' + LENSES.length + ' reported)');

const toVerify = allFindings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
phase('Verify');
const verifications = toVerify.length
  ? (await parallel(toVerify.map((f) => () =>
      agent(CTX + '\n\nADVERSARIAL VERIFY. Another reviewer raised this ' + f.severity + ' finding:\n  title: ' + f.title + '\n  file: ' + f.file + ' ' + (f.line || '') + '\n  claim: ' + f.claim + '\n  evidence: ' + f.evidence + '\nIndependently read the ACTUAL code (and git show main:<path> for any deleted/changed surface) and try HARD to REFUTE it. Default to holds_up=false / FALSE_POSITIVE unless you can reproduce a genuine lost-capability or broken-build from the real source.',
        { label: 'verify:' + (f.title || 'f').slice(0, 30), phase: 'Verify', schema: VERIFY_SCHEMA }))
    )).filter(Boolean)
  : [];

phase('Synthesize');
const synth = await agent(
  CTX + '\n\nYOU ARE THE SYNTHESIZER / FINAL GATE.\nSTEP 1 — independently re-run on the CURRENT checkout (do NOT switch branches):\n  cd /Users/gabriel/Programming/virgil && npx tsc --noEmit > /tmp/a1_review_tsc.log 2>&1; echo tsc=$?\n  cd /Users/gabriel/Programming/virgil && npx vitest run > /tmp/a1_review_test.log 2>&1; echo vitest=$?  (read the tail; expect ~594 passed)\nGrep-gates (expect zero LIVE refs): grep -rn "AttachedPopover|DetachedActionsToolbar|DetachedMenuToolbar|ActionButtonsRow|useComments|menuLocation|autoFitBody" src/ — any hit must be a doc-comment/prose mention, NOT live code; and grep -c "export default memo(MenuBar)" src/components/MenuBar.tsx (expect 1).\nSTEP 2 — adjudicate. Raw lens findings (JSON):\n' + JSON.stringify(allFindings, null, 1) +
  '\n\nAdversarial verifications of CRITICAL/HIGH (JSON):\n' + JSON.stringify(verifications, null, 1) +
  '\n\nDrop FALSE_POSITIVE / holds_up=false findings. For anything you are unsure of, READ THE REAL CODE before counting it. Verdict: NO-GO if tsc/tests fail OR a LIVE capability was removed OR a genuine CRITICAL/HIGH survives; GO-WITH-NITS if only MEDIUM/LOW remain; GO if clean. This gate decides whether A1 merges to main and COMPLETES BATCH 0.',
  { label: 'synthesize:verdict', phase: 'Synthesize', schema: SYNTH_SCHEMA }
);

return { verdict: synth, lensCount: reviews.length, rawFindingCount: allFindings.length, verifiedCount: verifications.length };
