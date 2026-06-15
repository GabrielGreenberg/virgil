# Focus View — deep architectural rework

**Branch:** `focus-view-rework` (worktree `.claude/worktrees/focus-view`)
**Started:** 2026-06-14
**Status:** CORE COMPLETE — CHIPs 0–4 landed, live-verified, adversarially
reviewed (one real crash found + fixed). 6 commits. 1120 tests pass, clean tsc,
no new lint. NOT merged (left on the branch for review). Remaining: CHIP 4b
(breadcrumb/cursor polish, deferred) + CHIP 5 (card-typing — needs a user screen
recording; may already be fixed by the CSS removal). See Progress tracker.

**The deep architectural fix (the primary ask) is done:** focus view is now a
UUID-anchored band, computed once per structural change and consumed uniformly,
hidden via a ProseMirror decoration that cannot touch card editors. The three
reported bugs: index-drift = FIXED; silent card suppression = FIXED (bin); card
typing = likely fixed (CSS removed) but unverifiable headlessly, documented.

This memo is the SSOT for the focus-view rework. It supersedes the four
`scratch/focus-mode-*.md` diagnosis memos (kept for history; some of their
root-cause guesses were **wrong**, see "Corrections" below).

---

## Goal

"Focus view" confines the editor + outline to a contiguous band of top-level
blocks for distraction-free writing. The **UI is good**; the **mechanism is
broken**. Make it actually work, via the deepest correct architecture rather
than three patches.

## Diagnosis — the bugs (all structurally related)

1. **Index-keyed band (root defect).** `focus.json` stores
   `{startBlockIndex,endBlockIndex}` — raw positions. Editing earlier in the
   doc silently slides the band onto different content. (Section-folding already
   solved exactly this by anchoring to paragraph UUIDs.)
2. **Silent card suppression.** Locked focus *drops* out-of-band cards from the
   omni-host array entirely (`omni-host.tsx` Pass 2: `if (outside) continue;`),
   while unlocked merely dims them. New cards created outside a locked band are
   saved but invisible → reads as data loss. The `locked` flag is never read by
   the filter — the asymmetry is unjustified.
3. **Typing into expanded cards breaks — only in focus mode.** Data/DOM are
   objectively correct (`<p>aaaaa</p>`); the symptom is *visual*
   (carriage-return-per-keystroke). **Not yet root-caused** — confirm-first.
4. **(discovered) Reorder staleness.** A top-level reorder is a same-UUID
   delete+insert that **cancels** in the step-inspector (no `addedBlocks`/
   `removedBlocks`, no `blockOrderChanged` field today), so any React consumer
   that caches an index pair gated on add/remove is silently wrong on reorder.
   This latent gap also affects the existing fold filter.

## Corrections to the prior scratch memos

- The round-5 memo blamed (as a leading suspect) the injected
  `.tiptap > :nth-child(N){display:none}` CSS leaking onto card editors
  ("hypothesis D"). The adversarial design pass found this is **one of five
  UNCONFIRMED candidates**, and `useInTextPositions.ts:368-376` explicitly
  documents per-keystroke card `translateY` jitter (cascade reflow) as the
  carriage-return appearance, "especially visible in focus mode." So the visible
  bug is most likely **hyp B (cascade reflow)** and/or **hyp A
  (`scrollIntoView` at `RichTextField.tsx:444`)**, NOT the CSS.
- The plugin migration (below) removes the CSS-leak *class* as a free
  side-effect (defense in depth) but is **NOT** credited with the visual fix.
  CHIP 5 must reproduce + isolate the real mechanism live before touching it.

---

## Chosen architecture (graft of Lens B spine + Lens C discipline)

Collapse the **four** drifting representations of "the band" (injected nth-child
CSS, omni index filter, outline index measurement, section-path `skipHidden`
guards) into **one plugin-owned UUID band + one pure predicate**, mirroring how
section-folding already works for folds.

**Pillar 1 — Data model (UUID anchors).**
`FocusBand = { active, locked, startUuid: string|null, endUuid: string|null }`.
Anchors are any top-level anchorable block's `attrs.uuid` (paragraph OR heading
— drags can land on a parTitle). `null` = doc-start/doc-end sentinel. The live
`{startIdx,endIdx}|null` is **never persisted**; resolved on demand from the
observer's `DocStructure.blocks` Map (`uuid → pos → doc.resolve(pos).index(0)`).
Stays in `focus.json` (do NOT relocate to editor-state.json). Returns `null`
when either anchor is gone → consumers degrade to "show everything".

**Pillar 2 — One shared predicate + resolver** in new `src/lib/focus-view.ts`
(peer of `section-folding.ts`): `resolveFocusBand`, `isPosInFocusBand`,
`isUuidInFocusBand`, `transactionTouchesFocus`. Every surface calls these; none
re-derives `i < start || i > end`.

**Pillar 3 — Main-editor hide via `focusViewPlugin`** (peer of
`sectionFoldingPlugin`), registered in the SAME `addProseMirrorPlugins` slot in
`editor-extensions.ts` (~:1364) behind the SAME `isFloat`-omit gate.
Plugin-state `{band, decoSet}`. `apply()` bails on `!transactionTouchesFocus`;
on a plain docChanged keystroke it **`DecorationSet.map(tr.mapping)`** (NOT a
rebuild — the explicit departure from `section-folding.ts:189-207` which walks
every `decorations()` call); rebuilds ONLY on focus-meta or when
`readPendingDiff` reports a block add/remove or a dead anchor. `props.decorations`
returns the cached set (no walk). `globals.css` gets
`.focus-hidden{display:none!important}` (twin of `.section-folded`).
**Cannot reach card editors**: the plugin lives only in `buildEditorExtensions`
(main + float); card `RichTextField`s use a bare StarterKit. No global
`.tiptap` selector exists anymore. Mirror pane shares `editor.state` (EditorMirror
`v.updateState`), so it inherits the decoration for free.

**Pillar 4 — React consumers resolve LIVE per consume** (omni cards, outline,
word count, both section-path panes), gated on `editor + rev.blocks +
rev.headings + band identity + onBlockOrderChanged`, reading positions from
`getBus(editor).structure`. No cached index pair, no `docVersion` counter.

**Pillar 5 — Card suppression: separate FILTER from RENDER.** omni-host Pass 2
stops `continue`-dropping; it keeps every card and stamps `outsideFocus:true`.
`OmniViewPanel` makes the single render decision on `band.locked`:
unlocked → dim (static compressed summary, opacity-30 pointer-events-none —
do NOT mount N live editors); locked → omit from flow but render a
"N cards outside focus" affordance so nothing reads as silent loss. The `locked`
flag becomes load-bearing in exactly one place.

### Decisions locked in (were left open by the lenses)
- **Anchor-death policy:** on `removedBlocks` containing an anchor, re-anchor
  that edge to the nearest surviving top-level block at/after the deleted pos
  (start) / section-end of the surviving start (end). **Deactivate only if BOTH
  anchors die.** Never silently widen a deleted-middle band to whole-doc.
- **Dual-store:** `useFocusMode` is the single WRITABLE source; the plugin is a
  downstream mirror fed by a meta-only tx on band change. Plugin never writes back.
- **Migration:** two-phase (sync `migrate` can't see the doc). Phase A keeps
  legacy indices in `_legacyStart/_legacyEnd`; Phase B (deferred effect gated on
  the reactive `editor` + populated structure) resolves indices→UUIDs once and
  rewrites `focus.json`. Out-of-range legacy index → null sentinel (clamp), not
  deactivate.

---

## Chip plan (each independently landable; commit per chip on this branch)

- **CHIP 0** ✅ DONE — `blockOrderChanged` + `changedBlocks` plumbing
  (precondition, no focus changes). Added BOTH to `StructureDiff`/`EMPTY_DIFF`/
  `isEmptyDiff`; `step-inspector.ts` reconcile now detects a same-uuid block in
  both added & removed with a changed pos → pushes the new-pos entry to
  `changedBlocks` + sets `blockOrderChanged`; `structure-index.ts` `applyDiff`
  folds `changedBlocks` into the blocks Map (fixes the **stale-position** bug —
  the synthesis under-specified this: `blockOrderChanged` alone pings consumers
  but `mapStructurePositions` maps a moved block's old pos to the deletion point,
  so the index needs `changedBlocks` to carry the real new pos, exactly like
  `changedFootnotes`/`changedCitations`); `bus.ts` `onBlockOrderChanged` event +
  `hasStructuralChange` includes it; `useStructuralRevisions` bumps `rev.blocks`.
  Files: `doc-structure/{types,step-inspector,structure-index,bus}.ts`,
  `useStructuralRevisions.ts` + tests.
  **DoD met:** 40 doc-structure unit tests pass (incl. new reorder + applyDiff
  tests), clean `tsc`. Typing never sets either field (verified by test).
- **CHIP 1** ✅ DONE — created `src/lib/focus-view.ts` (FocusBand,
  INACTIVE_BAND, resolveFocusBand + isPos/isUuidInFocusBand,
  transactionTouchesFocus, setFocusBandMeta, getFocusBand/State,
  focusViewPlugin, dev rebuild counter) + `.focus-hidden` CSS. No wiring.
  **Divergence from synthesis (for the better):** `resolveFocusBand(doc, band)`
  reads the LIVE doc (walks top-level children for the anchor UUIDs) instead of
  `structure.blocks` — staleness-free, simpler, and only called on structural
  change (memo-gated) or plugin rebuild, so it never runs per keystroke.
  `blockOrderChanged` (CHIP 0) remains the consumer re-resolve trigger.
  **DoD met:** 12 vitest cases — predicate trio (named/sentinel/inactive/dead/
  inverted) + plugin (activate hides out-of-band; plain typing MAPS w/ rebuild
  counter flat; block add REBUILDS; deactivate clears). Clean `tsc`.
- **CHIP 2** ✅ DONE — registered `focusViewPlugin()` in `editor-extensions.ts`
  next to `sectionFoldingPlugin()` (main-only, float omits, mirror inherits via
  shared state). EditorLayout now dispatches `setFocusBandMeta` from an effect
  that converts the (still index-based) `focusMode.state` → a UUID `FocusBand`
  resolved against the live doc (doc-edge → null sentinel) — so the main-editor
  hide is already UUID-stable. **DELETED** the injected `<style>` effect +
  `editorChildCount` tracker + `focusStyleRef`.
  **DoD met + LIVE-VERIFIED in preview (devtest01, band 10–15):**
  · full path focus.json→useFocusMode→effect→plugin → 60 hidden / 6 visible;
  · `.focus-hidden` reaches React-NodeView blocks — `node-figureBlock`/
    `node-graphicsBlock`/`node-texBlock` outside the band all `display:none`,
    in-band graphicsBlock stays visible (risk #2/#7 RESOLVED);
  · no `style[data-virgil-focus]` in head;
  · keystroke sanctity: typing 5 chars in-band left `__virgilBusStats().emitCount`
    FLAT (16→16) and decoSet mapped at 60 (no rebuild); clean tsc.
  Note: omni/outline/section-path still read index-state in CHIP 2 (migrate in
  CHIP 3+4) — the index→UUID seam currently lives in the EditorLayout effect.
- **CHIP 3** ✅ DONE — `useFocusMode(docId, editor)` now persists a UUID
  `FocusBand` and exposes BOTH `band` (for the plugin) and a **live-derived**
  `state: FocusState` (index projection via `resolveFocusBand`, gated on
  `rev.blocks`). This keeps every index-based consumer (cursor, section-path,
  word count, omni, OutlinePanel) UNCHANGED and drift-free for free. Two-phase
  migration (sync `_legacy` carry → deferred Phase-B resolve+persist, gated on
  the REACTIVE editor — the ref+silent-counter trap bit Phase B first), plus a
  re-anchor effect (dead anchor → nearest surviving block via last-good index;
  deactivate only if both die). EditorLayout dispatches `focusMode.band` via
  meta (gated on band primitives).
  **Two real bugs found + fixed during live verify:**
  1. Phase B never persisted (effect gated on `editorRef` + load-silent counter
     → fixed to depend on reactive `editor`).
  2. The plugin's rebuild-vs-map used `readPendingDiff`, but `focusView$` is
     registered BEFORE `docStructureObserver$` (heading-extension order), so the
     diff is ALWAYS null there → every tx mapped, dropping node decorations of
     newly-structural blocks (insert-above-band left the new block visible).
     Rewrote the discriminator to read the transaction's STEPS directly
     (`isMapSafeEdit`: map only for in-block `ReplaceStep`/mark/attr steps;
     rebuild on childCount change or `ReplaceAroundStep`/boundary edits, which
     drop node decos under `.map()`).
  **DoD met + LIVE-VERIFIED (devtest01):** legacy index `focus.json` migrates to
  `{startUuid,endUuid}` on disk and restores the SAME content; inserting a block
  ABOVE the band keeps the band on the same paragraphs (drift-free) AND hides
  the new out-of-band block; typing 5 chars → 0 plugin rebuilds (keystroke
  sanctity); 52 unit tests pass; clean tsc.
- **CHIP 4** ✅ DONE (card suppression). The React consumers were already routed
  via CHIP 3's live-derived `state` (drift-free for free), so CHIP 4 reduced to
  the card-suppression UX. `omni-host` Pass 2 now STAMPS `outsideFocus:true` on
  out-of-band cards instead of `continue`-dropping; `OmniViewPanel` routes them
  into a new collapsed **"N outside focus" bin** (`OmniOutsideFocusBin`, peer of
  the unanchored bin — zero-flow `position:absolute`; renders cards only when
  expanded so NO live editors mount by default). Added `OmniItem.outsideFocus`.
  **Design note:** the synthesis's dim-unlocked/collapse-locked split assumed
  out-of-band cards could dim *in place*, but their anchors are `display:none` in
  BOTH lock modes — nothing to dim against — so the bin is the correct single
  behavior. No more silent data loss.
  **LIVE-VERIFIED (devtest01, band 10–15):** both omni panels show "31 / 17
  outside focus" bins (were silently dropped before); expanding reveals the cards
  (0 live editors mounted); in-band cards still cascade inline; clean tsc.
- **CHIP 4b** (deferred polish, NOT data-loss) — route the section-path breadcrumb
  + cursor-coercion through `isPosInFocusBand` (the breadcrumb reads slightly
  wrong under focus because it measures hidden headings), and verify the mirror
  pane hides the same blocks. Lower priority than CHIP 5.
- **CHIP 5** — card-typing visual fix, **confirm-first**. STATUS: the new
  decoration mechanism REMOVED the injected global stylesheet (round-5 hyp D, the
  leading suspect), so this may already be fixed. Could NOT verify the *visual*
  symptom headlessly (it needs watching the card's translateY during real
  keyboard typing — the round-5 memo's own conclusion: "get a screen recording").
  Per that memo's hard-won lesson ("don't write more code before seeing the
  recording" — 4 blind rounds failed), NO blind code landed. NEXT: get a user
  screen recording under the new focus impl; if it persists, isolate hyp B
  (cascade reflow, `useInTextPositions.ts:368-376`) / hyp A (`scrollIntoView`
  `RichTextField.tsx:444`) and land only the change that removes the visible jump.

## Live verifications that MUST happen (don't assume)
1. CHIP 5 root cause — reproduce carriage-return live BEFORE coding.
2. focus-hidden figure/texBlock (React NodeViews, `.react-renderer.node-*`)
   actually collapse — codebase warns CSS can miss these wrappers.
3. `__virgilBusStats().emitCount` flat on N plain chars under active focus; dev
   focusViewPlugin rebuild counter flat on plain typing, bumps on add/remove + move.
4. Reorder-while-focused: main decoration stays correct + omni filter re-resolves.
5. Mirror pane hides same blocks + breadcrumbs match.
6. Migration: old index focus.json → restores same content → rewritten as UUID.
7. Out-of-band dimmed cards do NOT mount live editors.

## Dev preview (this worktree)
- Launch config `focus-worktree` (port 3009), `virgil-data` symlinked.
- Force dev storage: `localStorage.setItem('virgil:force-dev-storage','1'); location.reload()`.
- Set band: PUT `/api/dev/doc/devtest01/virgil/focus.json`
  `{"active":true,"locked":true,"startBlockIndex":19,"endBlockIndex":22}` (band
  19-22 = "Birth of the Footnote"), reload. (Pre-CHIP-3 it's index-shaped; after
  CHIP 3 use UUID shape or rely on migration.)
- Refresh dev doc: `rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`.

---

## Progress tracker
- [x] CHIP 0 — blockOrderChanged + changedBlocks plumbing (40 tests, clean tsc)
- [x] CHIP 1 — focus-view.ts lib + plugin + CSS (12 tests, clean tsc)
- [x] CHIP 2 — register plugin, delete injected CSS (LIVE-verified: hide +
      NodeView coverage + keystroke sanctity)
- [x] CHIP 3 — UUID-anchored useFocusMode + migration + derived state
      (LIVE-verified: migration persists, drift-free, insert-above hides,
      typing 0 rebuilds). Fixed Phase-B reactive-editor + step-based rebuild.
- [x] CHIP 4 — card suppression: "N outside focus" bin (LIVE-verified, no data loss)
- [ ] CHIP 4b — section-path/cursor via predicate + mirror verify (deferred polish)
- [ ] CHIP 5 — card-typing visual fix (needs user screen recording; may be fixed
      already by the CSS removal — no blind code landed per the round-5 lesson)
- [x] Full test + tsc + lint sweep — 1120 tests pass, clean tsc, no new lint
- [x] Adversarial review of the diff (subagent) — found + FIXED one real crash:
      `isMapSafeEdit` resolved later steps against the wrong doc (tr.docs[0] vs
      tr.docs[i]) → a multi-step tail edit (input rules / IME / smart-punctuation)
      with no childCount change threw "Position out of range" and broke dispatch.
      Fixed (per-step before-doc + bounds guard + try/catch→rebuild); regression
      test added; live-verified the repro no longer throws. Other findings were
      minor/deferred (unused predicate exports kept for CHIP 4b; breadcrumb =
      CHIP 4b; bin-overlap-when-expanded + 1-frame anchor-death flash = cosmetic).
