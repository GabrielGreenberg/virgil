<!-- 2026-06-25 — written after the multi-doc keep-alive follow-up session.
     Companion to: tabswitch_keepalive_status memory, MEMO_KEEPALIVE_BUILD.md,
     MEMO_KEEPALIVE_PLAN.md, MEMO_TABSWITCH_DIAGNOSIS.md. -->

# MEMO — Instant paper switches: the editor-side residual

**Goal of this memo:** record what shipped for tab-switch performance, then lay out
exactly what is left to make a warm paper↔paper switch feel **instantaneous** —
grounded in a code-level cost map, with a deep architectural direction, a phased
plan, the risks, and a profile-first method.

---

## 0. TL;DR

Multi-doc keep-alive + the scroll fix + the top-bar memoization are **shipped and
merged to local `main`** (merge `7ca0458a`, not pushed). The top bar is no longer
the bottleneck.

A warm switch is still ~**600ms of main-thread long tasks**. We measured that the
bar does only ~19 DOM mutations on a switch, so the cost is **editor-side**: when
the kept-alive pane flips `display:none → flex`, the system re-runs the **cold-load
measurement/heal lifecycle** even though the warm editor received **zero
transactions** while hidden and its NodeViews were already mounted and sized before
the hide. The dominant mass is **card-count-proportional** (the test doc,
`annotation-history`, has ~65–99 anchored cards).

**The deep fix is one invariant:** *"Hidden is frozen, not torn down. Re-show is a
**republish** of cached geometry, not a **re-measure** — unless something provably
changed while hidden."* A small doc already switches near-instantly; this work makes
the populated doc match it.

---

## 1. What shipped (2026-06-25)

On local `main` (not pushed), three commits behind merge `7ca0458a`:

| Commit | What |
|---|---|
| `8af8835b` | **ISSUE #1 — scroll position survives a switch.** Unified scroll-restoration ownership: never persist `scrollTop` while hidden (a `display:none` container reads 0 → was corrupting the saved offset to 0); re-assert the last visible offset on a warm re-show; and the cold-restore now wins over the cursor's focus-scroll (`restoreCursorToParagraph(uuid, {scrollIntoView:false})` when a saved scroll will be restored — `Editor.tsx`, `EditorPane.tsx`). |
| `386bc49a` | **ISSUE #2 — top bar no longer repaints on tab interactions.** Extracted memoized `<TopBar>` = `<TabStrip>` + `<StatusCluster>` (`src/components/editor-layout/`), EditorLayout −1150 lines. Killed the memo-defeaters that made the boundary useless: `libraryRegistry` and `helperPositionStyle` were each churning **29×/switch** (now memoized at source); `vbar` functions routed through a latest-ref; `openTabs` memoized in `useFiles`. |
| `e3a908df` | **ISSUE #2 follow-on — status cluster bails on collab ticks.** `CollabStatusPill` reads collab from its existing `CollabContext` instead of a prop, and `StatusCluster` takes a `collabEnabled` boolean — so a collab pen/presence tick (frequent during active collaboration) re-renders only the pill, not the cluster. |

**Measured live (dev preview, two warm content docs):** idle bar re-renders **0**;
a switch dropped `TabStrip` **22→2** and `StatusCluster` **22→8→6**; **closing a
non-active tab went from a full-bar repaint to ~4 renders / 85ms** (that was the
"close-X is also slow" clue — fixed). `tsc` 0 / `vitest` 2933 pass.

---

## 2. The finding: the switch lag is editor-side, not the chrome

Gabriel's hypothesis was that the top-bar chrome re-render was the lag. **That was
true for the close-X** (now fixed) but **not for the switch.** A live measurement of
a warm paper↔paper switch: ~600ms of long tasks (`longtask` bursts ~`[201, 330,
137]`ms) while the bar did **only ~19 DOM mutations**. The switch is provably warm —
the `.ProseMirror` node survives (no remount). So the ~600ms is the editor-side
**re-show measurement cascade**, detonated by one event: the active `KeepAliveSlot`
flips visible, which flips `useIsVisible()` true and re-arms work the keep-alive had
correctly deferred while hidden.

---

## 3. Cost model — where the ~600ms goes (ranked)

> Scaling summary: `cost ≈ (settle frames up to 30) × (in-text card count)` **[#1]**
> `+ (near-zone block count K × doc size)` **[#2]** `+ (≈28 EditorLayout renders × 3
> EditorPane bodies)` **[#3]**. Card count is the dominant axis; a small doc is
> already instant.

**#1 — `useInTextPositions` re-measure + the up-to-30-frame settle loop — THE
dominant cost.** Visibility is folded into `enabled` (`useInTextPositions.ts:310-311`),
and `enabled` is a dep of both the `measure` callback (`:426`) and the layout effect
(`:433`). So the hidden→visible flip **re-runs the full cold-load path**:
`measure()` does `editor.view.coordsAtPos(pos)` per card (`:369`, a forced layout
flush each) + `getBoundingClientRect()` per in-viewport card (`:382`); then the A.1
settle RAF loop (`:471-487`) re-runs `measure()` **every frame up to
`SETTLE_MAX_FRAMES = 30`** (`:106-107`) until `scrollHeight` is stable. **Critical
amplifier:** the hidden `!enabled` branch **clears `naturalRef` to empty**
(`:434-439`), so re-show enters at size 0 where the degeneracy guard (`:406`, only
active when `naturalRef.size > 0`) is inert — it commits possibly-degenerate values
and **heals across all 30 frames**. There is exactly one caller —
`OmniViewPanel.tsx:491-516` — which aggregates **every** card category into one
`inTextItems` array (~65–99 cards in `annotation-history`). A second effect
(`:583-615`) re-observes every omni card wrapper with a per-card `ResizeObserver`;
the `display:none→flex` resize fires each, scheduling yet more `measure()` passes.

**#2 — `useMarginaliaRegistry` IntersectionObserver/ResizeObserver re-measure storm
— `O(K × doc)`.** The registry retains its cache while hidden (good) and gates
callbacks behind `isVisibleRef` (`:331-335`), but the main effect is keyed only on
`[editor]` (`:815`), so it does **not** re-arm on the flip — instead **the browser**
fires a batched IntersectionObserver `ENTER` for every block within
`±NEAR_ZONE_PX = 600` as the subtree regains size, plus per-block ResizeObserver
callbacks. With `isVisibleRef` now true, these run fully: `onIntersection` calls
`walkAnchorableBlocks(editor)` — **a full `doc.descendants()` walk — once per entry**
(`:624`, `marginalia-blocks.ts:24-39`), so K near-zone entries = `O(K × doc)`; each
then `measureBlock` (`nodeDOM` + `getBoundingClientRect` + `coordsAtPos`,
`:184-260`). `onResize` floods `invalidateFromUuid` (a block + **all** blocks below
it, `:448-457`) into a `flushRecompute` that re-walks the doc.

**#3 — the render multiplier: ≈28 `EditorLayout` body re-runs × 3 unmemoized
`EditorPane` bodies.** `EditorPane` is `forwardRef` with **no `React.memo`**
(`EditorPane.tsx:780`). The paneState bubble already emits one object
(`EditorPane.tsx:4096`) but its ~30-entry dep array (`:4136-4166`) re-fires on every
slice that settles during the switch; each → `setPaneStateByDocId`
(`EditorLayout.tsx:776-785`) → one EditorLayout render. Plus EditorLayout's own
per-switch `setState` fan-out across separate ticks (the `[currentDocId]` reset
`:406-417` = 3 setStates; async `setDocPermState`; LRU `setOrder`; the
`[rev.citations, editorInstance]` effect's `setCitationOrder` + a per-citation regex
`:1819-1831`; `useStructuralRevisions` re-subscribe). **Each** EditorLayout render
re-executes **all 3 warm `DocKeepAliveSlot` EditorPane bodies** via
`renderedKeepAliveEntries.map` (`:3670`). The doc-walks inside are dep-gated so they
don't *recompute* 28×, but 28 × 3 bare body re-executions + child reconciliation is
real tax.

**#4 — one-time doc-proportional re-derivations (bounded, fire once, but land in the
window):** `extractHeadings` (`EditorLayout.tsx:2308`), `focusStructure` with
`doc.resolve` per heading (`:2326`), `getFootnotes` (`:2213`), `getCitations` + per-
cite regex (`:1819`). Gated on `[editorInstance, rev.X]`; the `editorInstance` A→B
swap busts them once. There's a stale-snapshot second wave because `docForOutline`
is 300ms-debounced (derives against doc A, then re-derives when B catches up).

**#5 — O(1) re-show followers (cheap, fire once):** `useEditorViewportCache.refresh`
(~10 rect reads, bumps `version` → wakes F1/F9, `:281`), `EditorScrollbar`
refresh + `syncRowBoundCss`, `SelectionActionsMenu` margin-bolt (one `coordsAtPos`),
and the **Phase-D scroll re-assert** (`EditorPane.tsx:3238-3254`) — O(1) itself, but
it writes `scrollTop`, which dispatches a `scroll` event that wakes the otherwise-
lazy breadcrumb/scrollbar followers. Keep it, but ensure the heavy re-measure is not
on that synchronous path.

**Verified NOT on the warm path** (good — don't re-investigate): EditorLayout
breadcrumb/section-path (scroll/resize/update-driven, no `isVisible` dep),
`TextObjectGrabHandle` (mousemove), `float-sync` (transaction-gated; a flip is zero
tx), the `marginaliaMarkers`/`resolveCardAnchor` builder (deps stable across the
flip), the live-pos resolver map (snapshot identity unchanged while hidden).

---

## 4. The deep fix — "warm re-show ≠ cold mount"

**One unifying principle:** every dominant cost is the same category error — caches
are cleared on hide and the full cold-load settle/heal/derive lifecycle is re-armed
on the visibility flip, even though the kept-alive editor got **zero transactions**
while hidden, its NodeViews (KaTeX/expex/figures) were sized **before** the hide, and
pod-relative positions are **scroll-invariant**. Enforce one cross-cutting invariant
at the keep-alive seam:

> **Hidden is frozen, not torn down. Re-show is a *republish*, not a *re-measure* —
> unless something provably changed while hidden.**

Three pillars realize it:

**(A) Cache-retaining hide.** Stop clearing measurement caches on the hide
transition. `naturalRef` (`useInTextPositions`) and the marginalia metrics cache hold
the last-good geometry across the hide. Because the doc didn't change and positions
are scroll-invariant, that geometry is still correct on re-show. This single change
**deactivates the size-0 cold path** — the degeneracy guard stays armed, so the warm
switch never enters the 30-frame heal.

**(B) A "dirtied-while-hidden" gate as the universal re-show predicate.** One small
per-slot signal, set **only** when a real invalidation occurs while hidden: a
`DocStructureBus` structural event (block/heading/card add-remove) **or** a
container-**width** change (a ResizeObserver width delta — a legitimate geometry
invalidation; scroll is *not*). The kept-alive doc gets no transactions while hidden,
so this flag is **almost always clean**. On re-show: *clean* ⇒ flip display +
republish cached positions — **zero `coordsAtPos`, zero settle loop, zero IO
re-measure** (treat the browser's post-flip IO/RO batch as a no-op diff). *Dirty* ⇒
**one** bounded re-measure (no 30-frame settle — NodeViews are already settled),
scoped to what the bus said changed. The same predicate gates `useInTextPositions`,
`useMarginaliaRegistry`, and (defensively) the breadcrumb.

**(C) Defer-off-the-flip + memoize the shell.** The display flip with cached
positions is what the user *sees*; any genuinely-needed correction is scheduled in
`requestIdleCallback`/low-priority RAF so no long task blocks the visible transition.
In parallel: wrap `EditorPane` in `React.memo` (after splitting the section-path
fields out of `editorPaneViewDerivations` so its prop identity is actually stable),
coalesce the paneState bubble to **one** settled emission per switch, and move
per-slot paneState into a ref-backed/`useSyncExternalStore` store keyed by `docId`
so writing one slot doesn't re-render readers of the others. This collapses the
28×3 multiplier to ~1 active pane.

**The throughline:** A and B make re-show **O(1) by default** (cache survives,
re-measure is opt-in on proven change); C makes even the rare dirty case invisible
and stops the render fan-out from amplifying it. This is the *deep fork* — one
invariant enforced by a cache-retaining hide + a dirty-gate + a memoized shell —
rather than three surgical patches to three hooks. It also pays off **cold load**
(the hoisted single marginalia doc-walk) and **protects keystroke sanctity** (nothing
new subscribes per-transaction; the dirty-gate consumes the existing bus on
visibility transitions only).

---

## 5. Phased plan

- **Phase 0 — PROFILE FIRST (do not fix blind).** Confirm the ranking and prove
  card-count proportionality (small doc vs `annotation-history`). Gate the rest on
  confirming #1 is the dominant mass. See §7.
- **Phase 1 — Cache-retaining hide for `useInTextPositions`** (highest leverage,
  smallest change). Stop emptying `naturalRef`/`editorContentHeight` on the hidden
  transition (`useInTextPositions.ts:434-439` and inside `measure()` `:326-329`).
  Retain them so the degeneracy guard (`:406`) stays armed and re-show can't enter
  the size-0 heal. **This alone should remove the dominant long task.**
- **Phase 2 — Dirty-while-hidden gate for `useInTextPositions`.** Add a per-hook flag
  set only by (a) a `DocStructureBus` structural event while hidden, or (b) a
  container-width ResizeObserver delta. On `isVisible` false→true: *clean* ⇒ don't
  call `measure()`, don't arm the settle loop — bump `measureVersion` once to
  republish; *dirty* ⇒ one `measure()` with the settle loop capped to ~2 frames.
  Decouple visibility from `enabled` so the flip stops re-creating `measure` (`:426`)
  and re-running the effect (`:433`) by identity.
- **Phase 3 — Marginalia: hoist the per-entry doc walk** (standalone win, also helps
  cold load). Move `walkAnchorableBlocks(editor)` **out** of the `onIntersection`
  entries loop (`useMarginaliaRegistry.ts:624`) — build one `posByUuid` map per IO
  batch, turning the ENTER storm from `O(K × doc)` to `O(doc + K)`. Then add the same
  dirty-gate: when clean, treat the post-flip IO/RO batch as a no-op diff; add an
  `isVisible`-keyed effect that does nothing when clean, or one batched
  `flushRecompute` over the already-observed set when dirty.
- **Phase 4 — Defer off the critical flip.** For both hooks: do the display flip +
  cached republish synchronously; schedule any dirty-case re-measure in
  `requestIdleCallback`/low-priority RAF. Keep the Phase-D scroll re-assert
  (`EditorPane.tsx:3238-3254`) but ensure the heavy re-measure is **not** on that
  synchronous scroll-dispatch path.
- **Phase 5 — Kill the render multiplier.** Wrap `EditorPane` in `React.memo`
  (`EditorPane.tsx:780/6009`) — but **first** split the section-path fields
  (`currentSectionPath`/`currentParTitleIndex`/`mirror*`) out of
  `editorPaneViewDerivations` (`EditorLayout.tsx:2871-2916`) so the breadcrumb
  re-show recompute doesn't bust the whole `viewPrefs` bundle into EditorPane (else
  the memo silently never bails). Coalesce the paneState bubble to one settled
  emission per switch (gate `EditorPane.tsx:4096` on `isVisible && editor &&
  sidecars-ready`, reusing the readiness gate at `:4206` — not a naive timer). Move
  per-slot paneState into a ref-backed store keyed by `docId` (`:776-785`). Batch the
  `[currentDocId]` reset fan-out (`:406-417`).
- **Phase 6 — Verify + guard.** Re-profile (Phase 0 harness) → warm switch should be
  near-zero long-task on `annotation-history`. Keystroke-sanctity regression:
  `window.__virgilBusStats().emitCount` flat across N plain keystrokes. Live FSA
  feel-check (cache durability differs under storage-fsa vs storage-dev — see the
  `anchor_persistence_dev_masks_fsa` memory; do durability via unit tests, feel via
  real FSA).

---

## 6. Risks (read before touching code)

- **Keystroke sanctity (primary).** The dirty-gate must consume the **existing**
  `DocStructureBus` (emitCount-gated, silent on plain keystrokes). It must **not** add
  an `editor.on('update'|'transaction')` subscriber. Any new subscription needs an
  O(1)-per-tx justification and a line in the AGENTS.md permitted-subscribers list.
  The gate fires on **visibility transitions**, not per transaction — keep it that way.
- **Stale geometry on dirty re-show.** A container-**width** change while hidden
  (window resize, panel toggle, margin/gutter change) invalidates cached pod-relative
  tops. The width-delta branch of the dirty-gate **must** catch it or cards land
  wrong. Scroll change is safe (positions are scroll-invariant); width is not. Test:
  resize the window while a doc is hidden, then switch to it.
- **Cache-retaining hide masks in the dev preview.** storage-dev writes load-minted
  UUIDs back to `.tex`; storage-fsa does not. Verify retained-cache correctness on
  re-anchor with **unit tests**, then feel-check under real FSA.
- **`React.memo(EditorPane)` false stability.** `editorPaneViewPrefs` gets a fresh
  identity every switch via the section-path recompute (`EditorLayout.tsx:2908`). If
  not split out first, the memo silently never bails and the multiplier survives. Land
  the viewPrefs split with/before the memo. Also confirm the hidden-slot
  `isActive ? prop : undefined` props are genuinely stable.
- **Degeneracy-guard inversion.** The guard is *intentionally* inert at size 0 so the
  very first cold paint isn't blank. Retaining `naturalRef` across hide must
  distinguish "cold mount, never measured" (size 0, settle needed) from "warm re-show,
  cache retained" (size > 0, settle skipped). The `size > 0` test encodes this — verify
  the first-ever open of a doc still settles.
- **Marginalia no-op-diff risk.** Treating the post-flip IO batch as a no-op assumes
  re-measured == cached. If a NodeView re-lays-out late on re-display (unlikely — sized
  before hide — but possible for images/figures whose intrinsic size resolves late),
  markers could be stale. Keep the structural branch; consider a one-frame settle only
  when figures/images are in the near zone.
- **Bubble coalescing can drop a late slice.** If the "settled" gate fires before a
  sidecar finishes loading, a genuinely-changed slice is lost. Use the existing
  readiness gate (`EditorPane.tsx:4206`), not a timer.

---

## 7. How to profile first (Phase 0)

In the dev preview on `virgil-data/doc_devtest` (refresh from
`samples/annotation-history` first so card counts are realistic), with ≥2 warm docs
open (both in the keep-alive LRU; `DOC_KEEP_ALIVE_CAPACITY = 3`):

1. **Performance timeline.** Record a warm paper↔paper switch. In the ~600ms window
   expect: (a) a cluster of ~30 `measure()` invocations with `coordsAtPos` self-time
   as the top frame — hitter #1; (b) IntersectionObserver callbacks each containing
   `walkAnchorableBlocks`/`doc.descendants` — hitter #2; (c) repeated
   EditorLayout/EditorPane render commits — the multiplier. Note the self-time split.
2. **Instrument the settle loop.** Temporarily count `settleStep`
   (`useInTextPositions.ts:471-487`): frames + cards/frame + total `coordsAtPos`
   calls per switch. Confirm it hits ~30 frames on a warm switch (proving it runs the
   cold heal) and scales with card count across two doc sizes. After Phases 1–2 this
   should drop to 0 (clean) or ≤2 (dirty).
3. **Instrument the marginalia walk.** Count `walkAnchorableBlocks` per
   `onIntersection` batch (`useMarginaliaRegistry.ts:624`) — confirm K-per-batch on
   re-show. After Phase 3 it should be 1 per batch.
4. **React Profiler.** Confirm EditorLayout commits ~28× and all 3 EditorPane
   instances appear in each commit. After Phase 5, hidden panes show "Did not render
   (memoized)."
5. **Keystroke-sanctity baseline + regression.** `window.__virgilBusStats()` →
   snapshot `emitCount`, type N chars, confirm flat — before and after each phase.

Wrap `activateDocPane → first-paint` in `performance.mark` for a single felt-latency
number; track it phase-by-phase. **Target:** warm-switch long-task budget falls from
~600ms to a single sub-frame republish on the clean (common) path.

---

## 8. Dev-preview multi-doc reproduction recipe

The previous session couldn't reproduce multi-doc switches; this is why and how:

- The preview's headless Chromium is **not** an iframe and **has**
  `showDirectoryPicker`, so `detectDevStorage()` silently picks the **FSA** backend
  (empty registry → "No document open"). Fix: in the console set
  `localStorage['virgil:force-dev-storage'] = '1'` and reload (module-level
  `isDevStorage` re-evaluates).
- Then seed open tabs directly: idb-keyval DB `virgil`, store `kv`, key
  `tabs/<sessionStorage 'virgil-window-id'>` = `{ openTabIds:[...], currentDocId:... }`,
  reload. (Make a 2nd content doc by copying `doc_devtest` to a 2nd folder with its own
  id + an `index.json` entry.)
- React StrictMode's mount→unmount→mount **releases the per-doc Web Lock** between the
  two mounts, so the 2nd hydration sees the doc "busy" and drops it. Work around with
  a temporary dev-storage-only short-circuit in `claimDoc`
  (`src/lib/multi-window/doc-ownership.ts`: `if (isDevStorage) return {owned:true}`) —
  **revert before committing.** (Making this a permanent dev-storage-only grant would
  fix multi-doc dev testing for good; a candidate dev-ergonomics improvement.)

---

## Appendix — key file anchors

- `src/hooks/useInTextPositions.ts` — `:310-311` (visibility→enabled), `:426`
  (measure), `:433-568` (layout effect), `:471-487` (settle loop), `:106-107`
  (`SETTLE_MAX_FRAMES=30`), `:406` (degeneracy guard), `:434-439`/`:326-329`
  (the cache-clear to STOP), `:583-615` (per-card ResizeObserver).
- `src/panels/Omni/OmniViewPanel.tsx:491-516` — the single caller; all card categories
  funnel into one `inTextItems` array.
- `src/hooks/useMarginaliaRegistry.ts` — `:624` (per-entry walk to hoist), `:331-335`
  (isVisibleRef gating), `:604-646`/`:184-260` (IO ENTER + measureBlock), `:448-457`
  (invalidateFromUuid flood), `:815` ([editor]-only effect).
- `src/lib/marginalia-blocks.ts:24-39` — `walkAnchorableBlocks` (the O(doc) walk).
- `src/components/EditorPane.tsx` — `:780`/`:6009` (no `React.memo`), `:4096`/`:4136-4166`
  (paneState bubble + 30-entry deps), `:4206` (readiness gate), `:3238-3254` (Phase-D
  scroll re-assert).
- `src/components/EditorLayout.tsx` — `:776-785` (`setPaneStateByDocId`), `:3670`
  (renderedKeepAliveEntries.map), `:406-417` (`[currentDocId]` reset fan-out),
  `:2871-2916`/`:2908` (editorPaneViewDerivations → viewPrefs identity), `:1819-1831`
  (citation derive + per-cite regex), `:2213`/`:2308`/`:2326` (footnotes/headings/focus).
- `src/lib/keep-alive/` — visibility context, `KeepAliveSlot`, the LRU.
- Keep-alive background: `MEMO_KEEPALIVE_BUILD.md`, `MEMO_KEEPALIVE_PLAN.md`; the
  F1–F9 guard rationale + permitted-subscribers list is in `AGENTS.md` (Keystroke
  sanctity).
