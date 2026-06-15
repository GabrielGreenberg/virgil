# Multi-Surface Action Alignment — Plan & Chip Roadmap

**Status: EFFORT COMPLETE (CHIP 0–8) — 2026-06-15.** The multi-surface action-alignment
refactor + verification is done and on `origin/main`. One `VIRGIL_ACTION_REGISTRY` SSOT drives all
4 surfaces; CHIP 8's empirical verification (live canary + a 200-case real-stack regression suite)
covered the ACTION × KIND × SURFACE matrix and found+fixed **2 latent DATA-LOSS bugs** (F2
graphicsBlock/atom over-delete `741c1fa`; Bug #1 wrapper-toggle destroys titleField/heading
`7ecf358`). **Read [docs/memos/action-alignment-matrix/SUMMARY.md](docs/memos/action-alignment-matrix/SUMMARY.md)
for the verification outcome.** The section below is the original plan/roadmap (historical).

This was the active handoff/SSOT for the effort to make every editing tool **work**, be **aligned**,
and be **deeply designed** across all of Virgil's action surfaces. Modeled on the prior
[ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md) (which solved the
grab-handle × text-object-kind matrix); this memo is the *cross-surface* successor.

Goals (user's framing):
- **(A) WORKS** — every tool on every surface does its intended thing.
- **(B) ALIGNED** — tools that mean the same thing (`\cite` vs menu Citation vs typed `\cite{key}`) produce the same result via the same path.
- **(C) DESIGNED** — implementation is deep (routes through canonical SSOTs), not shallow (ad-hoc inserts, event-bus hacks, duplicated creators).

Central design principle (honored throughout): prefer the deepest unified architectural
fix that captures the whole class, not surgical per-tool patches.

---

## 1. The surfaces — there are FOUR, in two worlds

The audit was scoped to 3 surfaces; an adversarial pass found a **fourth** (typed-LaTeX
input rules) that diverges the worst. The load-bearing split is **React-land vs
ProseMirror-plugin-land**:

| # | Surface | Code | Layer | Reaches `cardCreation`? |
|---|---|---|---|---|
| 1 | Grab-bar menu | `DragHandleMenu` ← `TextObjectGrabHandle` | React | ✅ directly |
| 2 | Lightning-bolt menu | `SelectionActionsMenu` → `ActionsMenuPanel` (action list + formatting grid) | React | ✅ directly (shares #1's dispatcher) |
| 3 | Slash commands | `VIRGIL_COMMANDS` ([commands.ts](src/lib/tiptap/commands.ts)) + slash popup | **PM plugin** | ❌ only via window-event bridge |
| 4 | **Typed LaTeX** | input rules: `\footnote{…}` ([footnote.ts:96](src/lib/tiptap/footnote.ts)), `\cite{key}` / `\cite key` ([citation.ts:125](src/lib/tiptap/citation.ts)) | **PM plugin** | ❌ only via window-event bridge |

**The whole architecture turns on this boundary.** Surfaces 3 & 4 live inside
ProseMirror plugins (`EditorView` only, no React context). The window `CustomEvent`
hops (`virgil-citation-create`, `virgil-footnote-input`, …) exist *precisely because*
they are the only PM→React bridge. Any "unify" plan that assumes a slash command can
call React-land `cardCreation` directly is **infeasible**.

---

## 2. What's already excellent (the target shape)

**9 of 11 card actions are model-grade.** Surfaces 1 & 2 share *one* dispatcher,
`useDragHandleActions.dispatch` ([drag-handle-actions.ts:150](src/components/editor-layout/card-actions/drag-handle-actions.ts))
→ `cardCreation.*` / `cardLifecycle`. `note`, `highlight`, `todo`, `suggest-edit`,
`cutter`, `report`, `duplicate`, `archive`, `delete` are byte-identical across both and
route through canonical SSOTs. `duplicate`/`delete` are the cleanest code in the system
(registry-driven cascade via `duplicateSlice` / `cleanupLinksInRange`, **zero per-kind
branches**, `assertLifecycleCoverage`-guarded). **This is exactly the shape the rest of
the system should converge to.** The registry just extends this proven discipline to the
command + formatting + typed-input layers.

---

## 3. The divergences (what we're fixing)

| Tool | Divergence | Goals |
|---|---|---|
| **citation** | Same destination, atom inserted **3 different ways**; slash routes via **2 listeners** ([command-input.ts](src/components/editor-layout/event-bridges/command-input.ts) + [citations-host.tsx](src/components/editor-layout/panels/citations-host.tsx)); **typed `\cite{key}` makes NO card at all** (the `virgil-citation-create` emit is only in the bare-`\cite ` branch). `citationId` minted outside the SSOT in every caller. | B, C |
| **footnote** | Slash/typed hand-roll insertion — no pristine/pinned lifecycle; fire a `virgil-footnote-created` event **with zero listeners**; insert logic duplicated in **4 places** (command-input.ts, footnote.ts input rule, Editor.tsx ×2). | B, C |
| **heading** | Grid dropdown *toggles* (`toggleHeading`); slash *sets* (`setBlockType`). **Numbering is NOT divergent** — both yield `numbered:true` (schema default `{default:true}` at [editor-extensions.ts:777](src/lib/editor-extensions.ts)). Only toggle-vs-set is real. | B |
| **example** | **3 creators** (grid `wrapSelectionInExample`/`buildExampleTemplate`, slash `insertExample`, MenuBar `insertExampleAtCursor`); wrap-selection vs insert-empty. A structural `multi` divergence (`exampleItemList` vs bare items) exists but is **dormant** (no surface calls `multi`). | B, C |
| **tex** | 2 creators; grid seeds code from selection, slash discards selection (`code:''`). | B, C |
| **`\ref`** | Slash-only — no menu route to insert a cross-reference from a selection, despite `labelRef` being a first-class atom in `ATOM_REGISTRY`. | B |
| **figure / image / math** | Grid-only, ad-hoc `deleteSelection().insertContent` inserts, `virgil-figure-click` event-bus hack, selected text silently dropped. No canonical block-atom creator. | C |
| **`DA-1`** | `wrapSelectionInExample` stuffs raw slice JSON into an inline-only node with only an `Array.isArray` guard — a **live corruption risk**, independent of alignment. | A |

Full per-tool dispatch traces are in the research workflow output (run `wf_50b2ce6f-837`,
20-row alignment matrix). Distilled here; reproduce by reading the files cited above.

---

## 4. The architecture — `VIRGIL_ACTION_REGISTRY` + one bridge

A single **`VIRGIL_ACTION_REGISTRY`** (`src/lib/actions/action-registry.ts`) — the
natural sibling of `ATOM_REGISTRY` / `CARD_REGISTRY` / `TEXT_OBJECT_REGISTRY` /
card-lifecycle / drop-spec registries. One `ActionSpec` per conceptual tool:

```ts
interface ActionSpec {
  id: ActionId;                    // stable identity — the join key across all surfaces
  label: string; icon?; letter?;   // presentation
  category: 'card' | 'atom' | 'block' | 'format';
  surfaces: { grab?; lightning?; slash?; typed?; keyboard? };  // which VIEWS expose it
  slashName?: string;              // \cite, \section… — REPLACES the VIRGIL_COMMANDS row
  inputRulePattern?: RegExp;       // \cite{key} / \footnote{} — REPLACES the per-extension input rule
  keybinding?: string;             // kept DISTINCT-by-id from the highlight-MARK binding
  applies(ctx): 'ok' | 'disabled' | 'absent';   // absorbs C1/Class-A/B + DA-5 mode taxonomy in ONE predicate
  resolveScope?(ctx): Range;       // absorbs the Class-D heading line-vs-section split as a slot
  run(ctx): void | Promise<void>;  // THE ONE canonical handler — every surface reaches THIS
}
```

`run()` lives in **React-land** (it needs `cardCreation`/`cardLifecycle`).

- **Surfaces 1 & 2** (React) call `run()` directly.
- **Surfaces 3 & 4** (PM) call `run()` through **ONE canonical imperative bridge**
  (`editorActionsRef` — a typed `EditorActionsHandle` the React tree publishes and the
  PM plugins consume), **replacing the 5 scattered CustomEvents + 2 citation listeners
  with a single typed entrypoint.**

We do **not** delete the PM→React bridge (we can't); we **collapse it from a mess into
one line.** That still: kills the dual SSOT (`MENU_ENTRIES` + `VIRGIL_COMMANDS` → one
table), makes `\cite` / typed-`\cite{key}` / menu-Citation land at the *same*
`citation.run` **by construction** (auto-fixing typed-cite-no-card), and makes a new
tool one declarative row exposed on N surfaces with guaranteed-identical behavior.

### Settled design calls (2026-06-13)

| Call | Decision |
|---|---|
| **Registry scope** | **Everything** — all 4 surfaces + the formatting grid (math/figure/image/marks). |
| **Citation atom durability** | **PM inserts the `\cite` atom synchronously** (always lands even if the host is unmounted); the **card** is registered via the single bridge → `citation.run` → `cardCreation.createCitation`. The PM/React split is a *robustness feature*, kept deliberately. |
| **Slash/typed footnote** | **Align to menu**: pristine (blank = click-away-discardable) + pinned to panel top. Drop the dead `virgil-footnote-created` event. |
| **Heading verb** | **Always SET** (slash semantics) + `numbered:true`. The dropdown stops toggling-off an existing same-level heading. |
| **`\ref` menu cell** (default, vetoable) | **Add** a lightning/grab cell whose `run()` opens the `LabelRef` popover from any surface. |
| **Example wrap-vs-insert** (default) | **Wrap** if selection non-empty, else **insert** empty. One template; resolve the `multi` structural split to one canonical shape (currently dormant). |
| **Formatting marks in registry** (default) | **Yes**, declared `backbone:'tiptap-chain'` — the registry *records* they are intentionally backbone-less rather than hiding it. |
| **Collab gating** (default) | `applies()` gates **all** surfaces uniformly on collab read-only. NOTE: this is **new behavior** to design (today only the grab handle incidentally disables) — not a consolidation of existing gates. |

### Verification discipline — the (A) WORKS audit is a FULL EMPIRICAL MATRIX

**Code-read "predicted-works" grids are NOT trusted.** The prior
[ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md) marked
`displayMath × Archive` as ✓ by code-read, yet it is **broken in practice** (user-found:
"$mathmode$ atoms do not archive properly", 2026-06-13). Every cell must be **driven in
the live app** (dev preview on `virgil-data/doc_devtest`), observing real DOM + sidecar
JSON deltas + `.tex` round-trip, not predicted from the dispatcher.

**The matrix is three-dimensional: ACTION × TEXT-OBJECT-KIND × SURFACE.**

- **Actions** (≥11 card + atoms + block/structural + format).
- **Kinds** — all 16 `TEXT_OBJECT_REGISTRY` kinds (paragraph, heading, bulletList,
  orderedList, blockquote, codeBlock, displayMath, titleField, latexComment, texBlock,
  figureBlock, graphicsBlock, exampleBlock, listItem, exampleItem, linkedRange) **PLUS
  ranges/paragraphs CONTAINING each inline atom** (footnote / citation / `\ref` /
  **inline-math**) — the math-archive class lives here: archiving/duplicating/deleting a
  block or range that *contains* an atom must preserve or correctly relocate that atom and
  round-trip its `.tex` marker.
- **Surfaces** — grab / lightning / slash / typed / keyboard, for each action that exposes
  on that surface.

**Per-chip gate (every chip that touches an action's behavior):** before it's "done", the
action must be empirically verified across **all applicable kinds** on **every surface it
exposes**, with the result recorded. A chip does not pass on a green typecheck alone.

**Acceptance for an aligned tool:** byte-identical sidecar entry + atom attrs + panel-card
lifecycle (pin/pristine/select) across every surface it exposes, AND a correct, non-corrupting
result on every applicable kind (including atom-bearing ranges).

CHIP 8 (and the standalone CHIP V baseline below) own the matrix; the artifact lands in
`docs/memos/action-alignment-matrix/` (per-surface or per-kind files, mirroring the prior
diagnosis's parallel-agent layout).

### Known defects to confirm + fix (seed list — grows as the matrix runs)

- **`displayMath` / inline-`$math$` × Archive** — user-reported broken (the atom/block is
  not archived properly). Confirm the exact failure (does the `.tex` math marker round-trip?
  does the archive snippet capture the math? is the doc-side delete clean?) and fix in the
  archive `run()` / `cleanupLinksInRange` math handling. This is the canary for the whole
  atom-bearing-range class.
- **ROOT-CAUSED (CHIP V-a, 2026-06-13):** the "math won't archive/delete" failure is **NOT math-specific** — it is **`MarginaliaAnchorGuard` re-inserting an empty placeholder paragraph (same uuid) whenever any ANCHORED block is deleted** ([linked-anchor.ts:205-299](src/lib/tiptap/linked-anchor.ts)). Sample para `3311` happened to BOTH contain inline math AND carry a cutter card; the card put `3311` in `anchoredUuidsRef`, so the guard resurrected it empty → looks like the lifecycle delete no-oped. Inline math is a red herring (a 2×2 vitest matrix shows anchored→resurrected-empty for plain AND math, un-anchored→clean for both). **Blast radius: every lifecycle action (archive / delete / cut / duplicate-then-source-removal) on ANY anchored block — paragraph / heading / listItem / etc. — regardless of atom content.** Full analysis + repro: [docs/memos/action-alignment-matrix/math-archive-rootcause.md](docs/memos/action-alignment-matrix/math-archive-rootcause.md); repro test `src/lib/tiptap/__tests__/anchored-block-delete-reinsert.test.ts`.
- (add others here as the empirical matrix surfaces them — do NOT trust the old ✓ grid.)

### CHIP V findings + proven harness (2026-06-13)

**Math-archive defect CONFIRMED empirically** (stabilized env, plain-paragraph control passes):
- Archive on a **plain** paragraph → source removed ✅ (doc childCount drops; `%!v:<uuid>` gone from `.tex`).
- Archive on a paragraph containing **inline-math atoms** → archive snippet IS created (and correctly captures the math) but the **source paragraph is NOT deleted** ❌ (still in live doc AND `document.tex`). Verified on the inline-math paragraph `3311` vs the plain `1102` in one session.
- **Mechanism (hypothesis, to root-cause):** `cleanupLinksInRange` is a pure no-op for inline-math (it only touches footnote/citation/linkedAnchor), so the inline-math atoms don't differ in that path — yet the subsequent `ed.view.dispatch(ed.state.tr.delete(extended.from, extended.to))` silently fails to remove the node, with NO thrown error and NO console error. Strongly suggests a **transaction-level guard** (`filterTransaction`/`appendTransaction`/observer) that rejects or reverts a delete spanning an `inlineMath` atom. If so, the **blast radius is every lifecycle action (archive/delete/cut/duplicate) on any range/block containing an inline-math atom** — not just archive. ROOT-CAUSE THIS (CHIP V-a) — it's the prize (the class).

**Proven preview harness (for the dispatched verifier — bake this in):**
- Reach the live main editor + dispatch: DFS the React fiber tree from `#__next` for (a) the editor whose `state.doc.childCount` is largest = main editor (`__vMain`); (b) the context value with `{open, dispatch}` = `__vDH` (the SHARED grab+lightning dispatcher); (c) the value with `createArchiveSnippet`/`createCitation` = `__vCC` (cardCreation). NOTE there are ~20 `.ProseMirror` instances (card-body mini-editors); `pms[0]` is NOT the main editor.
- Invoke an action faithfully: `__vDH.dispatch(action, ref)` with `ref = { kind: <TextObjectKind>, id: <uuid> }` for a block, or `{ kind:'selection', from, to, paragraphId }` for a range. This is the SAME path grab-handle and lightning-bolt both use, so one dispatch covers surfaces 1 & 2.
- **Async ConfirmDialog**: archive/delete open a `ConfirmDialog`. It renders on a later React tick — checking for it *synchronously in the same eval as the dispatch returns null (the pitfall that produced a false "no-op")*. Dispatch in one eval; in a SEPARATE eval find the button by text (`/archive paragraph/i`, `/delete/i`) and `.click()`; observe in a THIRD eval.
- Observe: in-memory via `__vMain.state.doc` (childCount + uuid presence); on-disk via Bash on `virgil-data/doc_devtest/virgil/*.json` and `document.tex` (`grep -c "%!v:<uuid>"`), allowing ~2s for the 1500ms autosave debounce; console errors via `preview_console_logs level:error`.
- **Fixture reset between destructive cells:** `rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`, then reload the preview (`window.location.reload()`, keep `localStorage['virgil:force-dev-storage']='1'`), wait for recompile, re-acquire the harness.
- **Env gotchas:** (1) NEVER leave git worktrees under `.claude/worktrees/` during preview testing — the main `next dev` watches them and HMR-remounts the editor mid-op → false half-completed states. Remove worktrees first. (2) After a hard reload the dev route recompiles (~10-30s) — poll readiness before probing. (3) The dev server currently serves branch `remove-gutter-prefs` (not `main`) — note the branch under test.
- Target uuids in the sample: displayMath `a292`/`0ee9`; figureBlock `48cc`/`a7d3`; texBlock `7e10`; paragraphs-with-citation `4402`/`4403`; with-footnote `1101`/`2201`; with-inline-math `3311`/`3312`. Plain paragraphs e.g. `1102`.

### Invariants the work must NOT break

- **Keystroke sanctity** — no per-keystroke doc walks. ⚠️ The **typed-input-rule surface
  runs inside `handleTextInput` on every `}` / ` ` / `\n`** — its `run()` path is a hot
  path; keep it O(edit-size). Verify `__virgilBusStats().emitCount` stays flat on plain typing.
- **LaTeX round-trip fidelity** — the example `multi` unification will change serialized
  `.tex` for multi-examples; the sample paper [samples/annotation-history/](samples/annotation-history/)
  must contain a multi-example exercising expex glosses for the diff to catch a regression — **verify it does first.**
- **Backlog #2 — slash/typed commands never force-open a panel.** The settled rule is the
  *exact* prefs-inspecting soft-route in [command-input.ts:60-87](src/components/editor-layout/event-bridges/command-input.ts)
  (surface omni only if the citations side is collapsed/blank; never clobber a covering
  panel). It must be replicated precisely behind a `surface:'slash'|'typed'` flag, not a generic one.
- **The landed C1–C11 / B1–B4 data-loss fixes** live in the 623-line dispatch switch
  (heading line-vs-section scope, cascade-delete, fail-loud duplicate with `tr.doc.check()`,
  B4 Cmd-Z refocus, reanchor-to-previous-block). The switch is **relocated, not rewritten** —
  each case moves verbatim into its `run()` body.
- **`virgil-figure-click` is dual-use** — it also drives **click-to-edit existing figures**
  ([marker-clicks.ts](src/components/editor-layout)). Only the *insert-time* use may be
  replaced with a direct popover open; the edit-time listener stays.
- **`ATOM_REGISTRY` is descriptive (detection/grab/drop-spec only).** Adding a canonical
  atom-`create()` must not entangle creation into the pure-metadata table — put block-atom
  creation in a new `smart-insert.ts`, keep `ATOM_REGISTRY` mutation-free.

---

## 5. Chip roadmap

Each chip ships green (compiles, tests pass, no behavior regression unless noted).
Dispatch as focused agents (worktree-isolated where they touch overlapping files).

### Independent — can run now, no deps
- **CHIP 0 · DA-1 example-wrap corruption.** Fix `wrapSelectionInExample`
  ([ActionsMenuPanel.tsx ~179-193](src/components/ActionsMenuPanel.tsx)): block-content
  filter + empty-template fallback so block-level nodes can't be stuffed into an
  inline-only node. *Risk: low. Standalone data-integrity bug, split out per the critique.*
  **[DISPATCHED 2026-06-13, worktree agent.]**
- **CHIP V · Current-state empirical baseline matrix.** Drive the live dev preview and
  build the **ACTION × KIND × SURFACE** matrix of *today's* behavior (before any registry
  work), recording PASS / FAIL / BROKEN + observed DOM/sidecar/`.tex` for every cell.
  Prioritize the suspect cells first: non-prose + atom-bearing kinds (displayMath,
  inline-math, figure, graphics, texBlock, latexComment, codeBlock) × the lifecycle/atom
  actions (archive, delete, duplicate, footnote, citation) across all surfaces — this is
  where the math-archive class lives. Confirm the seeded math-archive defect. The artifact
  is the regression oracle the refactor must preserve/improve. *Independent of the registry
  (read-only of current behavior); but preview-driven, so heavy — see the prior diagnosis's
  parallel-agent harness + the `virgil:force-dev-storage` / RAF-shim gotchas.*

### Phase 0 — Foundation
- **CHIP 1 · Scaffold `VIRGIL_ACTION_REGISTRY` + bridge contract + coverage assertion.**
  Create `action-registry.ts` (ActionSpec, ActionContext, empty registry); define the
  `EditorActionsHandle` bridge type (`editorActionsRef`) but don't wire it; add
  `assertActionCoverage()` that fails if any `MENU_ENTRIES` letter, `VIRGIL_COMMAND_NAMES`
  entry, **input-rule pattern (cite/footnote), OR the MenuBar `insertExampleAtCursor`
  control** lacks a row. *(The tripwire must see surfaces 3 AND 4 AND the stray MenuBar
  control — the critique showed a naive version would be blind to exactly the missed surfaces.)*
  Additive; nothing consumes it. *Risk: very low.* **[DISPATCHED 2026-06-13, worktree agent.]**

### Phase 1 — Prove the join (React surfaces)
- **CHIP 2 · Register the 11 card actions as wrappers.** `run()` calls today's
  `dispatch(id, ref)`; wire `surfaces:{grab,lightning}`, letters, `applies()` from
  `TEXT_OBJECT_REGISTRY.actions` + Class-A/B/C/D. Zero behavior change. *Depends: 1.*
- **CHIP 3 · Re-point DragHandleMenu + ActionsMenuPanel action-list at the registry.**
  Render `registry.filter(surfaces.grab/.lightning)`; delete the private `MENU_ENTRIES`
  array. Surfaces 1+2 now read the SSOT. *Depends: 2. Risk: medium (live menus) — cover
  with menu tests + dev-doc walk.*

### Phase 2 — The bridge + PM surfaces (the core alignment payoff)
- **CHIP 4 · Build `editorActionsRef`; migrate slash + typed cite/footnote.**
  Publish the bridge from React; consume it from the slash popup
  ([slash-popup.ts](src/lib/tiptap/slash-popup.ts) `executeSelection`) and the typed input
  rules ([citation.ts](src/lib/tiptap/citation.ts), [footnote.ts](src/lib/tiptap/footnote.ts)).
  `citation.run` = **PM-synchronous atom** + bridge→`createCitation` (fixes typed-cite-no-card).
  `footnote.run` = `createFootnote` (pristine+pinned). Retire `virgil-citation-create`,
  `virgil-footnote-input`, `virgil-footnote-created`, the 2 citation listeners; collapse to the
  bridge. Preserve backlog-#2 soft-route exactly behind `surface` flag. Re-point + extend
  `command-input-no-panel.test`. *Depends: 3. Risk: HIGH — behavior-visible (footnote now
  pristine+pinned per decision); verify sidecar+atom byte-identical across all 4 surfaces.
  May split 4a (bridge+citation) / 4b (footnote+typed).*

### Phase 3 — Block/structural + heading + grid
- **CHIP 5 · Unify example + tex + heading creators.** Collapse 3 example creators → 1
  `example.run` (wrap-if-selection; one template, resolve `multi` to one shape); 2 tex → 1
  (seed-from-selection); one **SET+numbered** heading helper for both the BlockType dropdown
  and `\chapter..\subsubsection` (register as rows, delete the 4 copy-paste closures).
  *Depends: 4. Risk: medium — example unification changes serialized `.tex`; diff vs sample.*
- **CHIP 6 · Fold the formatting grid into the registry + `smart-insert.ts`.** Register
  marks (`backbone:'tiptap-chain'`), textColor, inlineMath, displayMath, tex, figure,
  graphics. Create `smart-insert.ts` as the ONE block-atom insert helper (container-aware,
  DA-2) shared by grid cells AND the figure/graphics file-drop path. Replace
  `virgil-figure-click` for the **insert** case with a direct popover open — **keep the
  edit-existing-figure listener.** *Depends: 5. Risk: medium — reproduce popover-open timing.*

### Phase 4 — Applicability + gaps + verify
- **CHIP 7 · DA-5 mode taxonomy + `\ref` cell + uniform collab gating.** Extend `applies()`
  to a declarative mode taxonomy (selection-required / cursor-only / selection-ignored)
  read by both the panel render (disabled-visible) and `run()` (guard); make cursor-mode
  mark toggles read correctly; add the `\ref` lightning/grab cell; design uniform collab
  read-only gating across all 4 surfaces (NEW behavior — flag for review). *Depends: 6.*
- **CHIP 8 · Full post-refactor verification matrix.** Re-run the CHIP V matrix
  (ACTION × KIND × SURFACE) against the refactored build and assert: every cell that passed
  before still passes; every seeded/found defect (math-archive et al.) is now fixed; and for
  each aligned tool the sidecar + atom attrs + panel-card lifecycle are **byte-identical
  across every surface it exposes**. Confirm keystroke sanctity (`__virgilBusStats` emitCount
  flat on plain typing — **especially the per-keystroke input-rule surface**). Confirm
  backlog-#2 panel-silence for every slash/typed command. Refresh the sample paper if schemas
  changed. *Depends: 7 (+ CHIP V as the baseline oracle). Risk: low — but WILL re-open an
  earlier chip for any cell that regressed or any old ✓ that was never really true.*

---

## 6. Critique corrections folded in (don't re-derive)

- Heading `numbered` is **not** divergent (false alarm); only toggle-vs-set is. Decision: SET.
- Example `multi` structural split is **dormant** (no surface calls `multi`) — unify the
  single-template path; note the `multi` hazard but don't over-build.
- The `pendingCitationCreate` legacy branch is **LIVE and fully wired** (command-input.ts:78-87
  → EditorPane → citations-host) — not dead code; handle it when retiring the listeners.
- The typed-input-rule surface is the **4th surface** and the worst offender — in scope.
- `virgil-figure-click` is dual-use (insert + edit) — don't break edit.
- Don't naively delete the 623-line dispatch switch — relocate with its landed fixes.
- The coverage tripwire must cover surfaces 3 & 4 + the MenuBar control, or it ships "complete" while paths stay un-unified.

---

## 7. Open follow-ups (non-gating)

- `todo` selection-range loss (Mode-A-only, asymmetric with note/cutter/revision) — fold into CHIP 7's applicability pass or a separate nit.
- `archive`/`delete` silent-break on stale ref (no user feedback) vs duplicate's fail-loud — consistency nit.
- `highlight` on a block always wraps the whole block with no opt-out + silent empty-break — UX nit.
