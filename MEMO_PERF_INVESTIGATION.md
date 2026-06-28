<!-- 2026-06-26 — written after the instant-switch effort (Phases 0–5 of
     MEMO_INSTANT_SWITCH.md) + the multi-outline keep-alive fix. Companion to:
     MEMO_INSTANT_SWITCH.md, MEMO_KEEPALIVE_BUILD.md, the instant_switch_status
     memory, AGENTS.md "Keystroke sanctity". -->

# MEMO — App performance investigation: the warm-switch self-renders + other suspects

**For a fresh session.** The instant-switch effort (keep-alive, scroll, top-bar
memoization, the in-text/marginalia re-show fix, and Phase 5 `React.memo(EditorPane)`)
shipped to local `main`. Phase 5 surfaced that the **dominant residual warm paper↔paper
switch cost is not what we'd been chasing** — it's a burst of ~15–16 *self-renders* on
the pane that's going hidden, which `React.memo` cannot touch. This memo records that
finding precisely, lists the other perf suspects I hit along the way, and gives the
profiling method + gotchas so you don't re-derive them.

**Read first:** `MEMO_INSTANT_SWITCH.md` (the cost map + what shipped), the
`instant_switch_status` memory (full history + the dev-preview repro recipe), and
AGENTS.md "Keystroke sanctity" (the invariant any perf change must preserve).

---

## 0. The headline target — the going-inactive self-render burst

**What:** On a warm paper↔paper switch (multi-doc keep-alive, `virgil:multi-doc-keepalive`
default ON), measure per-`EditorPane` *body executions* (render-function runs) during one
switch. The pane that goes **active→hidden** executes its body **~15–18 times**. Of those,
only ~2–3 are *parent-driven* (the `React.memo` comparator runs ~3×/switch); the other
**~15 are self-driven** — the pane re-rendering itself because its own hooks `setState` in
reaction to becoming hidden (`useIsVisible()` flips `false`). `React.memo` only suppresses
*parent*-driven re-renders, so it can't help here (Phase 5 confirmed: the memo bails
cleanly but the body count barely moves).

**Why it matters:** these are off-screen (hidden pane) but they're synchronous main-thread
React work during the switch, so they plausibly contribute to the felt lag. With
`DOC_KEEP_ALIVE_CAPACITY = 3`, up to 2 panes can be transitioning/settling per switch.

**Where to look (the visibility-flip reactors):** anything that `setState` when
`useIsVisible()` goes `true→false`. Grep `useIsVisible` consumers + effects keyed on
`[isVisible]`. Known reactors touched during this effort:
- `src/hooks/useInTextPositions.ts` — the re-show/hide effects (`isVisibleRef`, the dirty
  gate, `setMeasureVersion`). Phases 1–2 made the VISIBLE re-show cheap; check what fires
  on the HIDE transition.
- `src/hooks/useMarginaliaRegistry.ts` — `isVisibleRef` sync (`useLayoutEffect` on
  `[isVisible]`), observer gating.
- `src/components/EditorPane.tsx` — the Phase-D scroll persist/re-assert effects keyed on
  visibility (`becameVisible`/`wasVisible`), the paneState bubble (now gated), the keep-alive
  scroll capture.
- `src/components/editor-layout/panels/omni-host.tsx` — `useStructuralRevisions` + the
  fold-tick; OmniViewPanel/useInTextPositions mount stays live while hidden (intentional,
  for the cache-retain win — do NOT unmount it).

**Method to attribute the 15:** add a temporary body-execution counter at the top of the
`EditorPane` function (`window.__p5pane[docId] = (…||0)+1`) AND a `React.memo` custom
comparator that records bail-vs-rerender per docId (see §3.2). The gap
`paneBodyDelta − memo.rerender` = self-renders. Then bisect WHICH hook causes them: wrap
candidate `setState`s with a `console.count`/stack capture gated on `!isVisibleRef.current`,
or use React DevTools Profiler "why did this render" on the hidden pane during a switch.

**Likely deep fix direction (hypothesis, verify first):** the visibility flip should be a
single coalesced transition, not N independent hook `setState`s. Options to evaluate:
(a) batch the visibility-driven state into one reducer/one `setState`; (b) move
visibility-reactive work off render into refs + a single post-flip rAF (several hooks
already use `isVisibleRef` — push more of them off the render path); (c) for state that a
hidden pane doesn't need at all, skip the `setState` entirely while hidden (guard on
`!isVisibleRef.current`). The keep-alive invariant ("hidden is frozen/inert") says a hidden
pane should ideally do ZERO render work — today it does ~15. **Measure each hook's
contribution before fixing; don't fix blind** (this is exactly how Phase 0 caught the
30-frame-settle red herring and Phase 5 caught the 28×3 over-estimate).

---

## 1. Other grounded perf suspects (found during the effort)

### 1a. "Fresh object literal every render" hook returns — systematic sweep (HIGH value)
`useFocusMode` (`src/hooks/useFocusMode.ts`) returned a plain `return { … }` object literal
every render. Its members were all individually stable (useMemo/useCallback/useState), but
the *wrapper object* re-identified every render — so every consumer using the whole object
as a dep (`useFocusActions` → `editorMutationHandlers` → the `editorPaneViewPrefs` bundle)
churned every render, defeating `React.memo(EditorPane)` AND over-rendering the active pane
+ the Library Reader. Fixed in Phase 5 by `return useMemo(() => ({…}), [members])`.
**This pattern almost certainly repeats.** Sweep custom hooks for `return { … }` (object/array
literal) at the top level of the hook body where the result is consumed as a memo/effect dep
or passed as a prop. Each one is a silent memo-buster. Candidates to check: the bigger
hooks (`useViewPrefs` is already memoized — good template; audit `useCitations`,
`useNotes`, `useRevisions`, `useCutter`, `useReports`, `useTodos`, `useAnnotations`,
`useFocusActions` return shapes, the `*Hook` returns bubbled through PaneState).

### 1b. Large memo bundles with many deps are fragile (MEDIUM)
`editorMutationHandlers` (~22 deps) and `editorPaneViewDerivations` in
`src/components/EditorLayout.tsx`: a single churning dep re-identifies the whole bundle,
which cascades into `editorPaneViewPrefs` → every pane's `viewPrefs` prop. Phase 5 split the
section-path fields out and added a stable `editorPaneViewPrefsInactive`, but these big
bundles remain regression-prone. Consider: (a) a lint/test that asserts the bundle identity
is stable across a no-op re-render; (b) narrowing the bundles. Also audit `editorPaneMenuBar`
(`EditorLayout`) — it churns on a switch (`paraNav*`/`activeSplitPane` deps); Phase 5 gated
it `isActive ? … : undefined` for inactive panes, but the active pane rebuilds it each switch.

### 1c. The active-pane settling cascade (MEDIUM)
On a switch, the newly-active doc's per-doc slices (compile, AI requests, sidecar loads)
settle over several renders; each bumped a `setPaneStateByDocId` → an `EditorLayout` render
(~9–11 `EditorLayout` body executions per switch measured). Phase 5e coalesced the
*bubble* (gated on `isVisible && editor && allCardSidecarsLoaded && !anyCardSidecarLoadError`),
but the active pane itself still re-renders N times as it settles. Worth measuring whether
each settle render is necessary or can be batched. The deferred Phase 5g (a ref-backed
`useSyncExternalStore` `paneState` store keyed by docId) would stop `setPaneStateByDocId`
from re-rendering `EditorLayout` at all — only build it if profiling shows `EditorLayout`'s
own re-renders are a material cost (they appeared modest: ~9–11/switch).

### 1d. Unbounded `virgil-view-prefs/window/<uuid>` localStorage growth (MEDIUM, easy win)
Each window/session mints a new `window-id` and writes a `virgil-view-prefs/window/<uuid>`
key; they are **never garbage-collected**. On this machine there were **hundreds** of them
(observed live). Every one is parsed/iterated on relevant reads, and unbounded localStorage
growth is a latent startup + storage cost. Add a GC (drop keys older than N days / cap to
the last K windows / key by a stable per-install id instead of per-session). Check
`src/hooks/useViewPrefs.ts` + the view-prefs persistence layer. (Dev-only artifact is
amplified by repeated dev-server restarts, but the per-session-window-id growth is real in
production too.)

### 1e. Marginalia re-show measureBlock reads (LOW–MEDIUM)
Phase 3 hoisted the per-entry `walkAnchorableBlocks` out of the `onIntersection` loop
(O(K×doc) → O(doc+K)), but the per-ENTER `measureBlock` geometry reads
(`getBoundingClientRect`/`coordsAtPos`) still fire on a re-show IO batch even when the cache
is unchanged (the equality check makes them a no-op *diff*, but the reads happen). I
deliberately deferred an "aggressive suppression" (a clean-re-show window that skips
`measureBlock` for already-cached uuids) because the reads are async (off the critical flip)
and the hoist removed the dominant cost. Revisit only if a profile shows these reads matter.
NOTE: marginalia IO is **unmeasurable in the headless dev preview** (0×0 viewport →
`observed:0`); measure in a real browser. (`src/hooks/useMarginaliaRegistry.ts`.)

### 1f. Cold-mount / cold paper↔paper switch cost (MEDIUM — the OTHER switch class)
Phases 1–2 made the WARM re-show cheap (0 coordsAtPos on a clean re-show). But switching to
a doc NOT in the keep-alive LRU (or first open) cold-mounts a new editor: parse + the
`useInTextPositions` settle loop (`coordsAtPos` × card-count, up to `SETTLE_MAX_FRAMES=30`)
+ TipTap NodeView typeset (KaTeX/examples/figures). The flushSync-during-cold-mount warning
was fixed separately (commits e6bdc10d / c1015899, "defer cold editor mount one tick"), but
the cold editor build + NodeView render is the dominant *cold*-switch cost and is
card/figure-proportional. Profile a cold switch (a doc beyond `DOC_KEEP_ALIVE_CAPACITY=3`)
separately from a warm one.

### 1g. Keystroke sanctity is the guardrail, not a suspect
Typing is already well-protected (the DocStructureBus `emitCount`-gated design — AGENTS.md).
ANY perf fix must keep `window.__virgilBusStats().emitCount` FLAT across N plain keystrokes.
Verify after every change. Don't add an `editor.on('update'|'transaction')` subscriber or
per-keystroke doc-proportional work.

---

## 2. Suspected-but-UNVERIFIED (worth a look, lower confidence)
- The `anchored-card-store` (`src/links/_shared/anchored-card-store.ts`) is module-global,
  NOT docId-scoped. Safe only because hidden panes don't render panels (the multi-outline
  fix gated `FloatingPanel` on `useIsVisible`). If anything ever renders a hidden pane's
  cards, cross-doc bleed/perf. Audit if you touch the card store.
- `orphanedFootnotes` is a shared event-driven accumulator (NOT per-doc) on the flag-OFF
  path — co-mingles across keep-alive docs. Spawned as its own task (per-doc scoping); it's
  a correctness bug but also iterates a shared list. See the spawned chip / `instant_switch_status`.
- `DiskWatcher` per-doc `setInterval` pollers (~3s) — one per live doc under keep-alive.
  Cheap individually; confirm they pause while `document.hidden` and don't stack.

---

## 3. Profiling method + gotchas (so you don't re-derive them)

### 3.1 The dev-preview multi-doc repro (REQUIRED for switch profiling)
The headless preview defaults to the FSA backend (empty registry → "No document open").
1. `localStorage['virgil:force-dev-storage']='1'` + `localStorage['virgil:multi-doc-keepalive']='1'`, reload.
2. Seed two open tabs: IndexedDB DB `virgil`, store `kv`, key `tabs/<sessionStorage['virgil-window-id']>`
   = `{openTabIds:['devtest01','titletest'], currentDocId:'devtest01', activePane:'doc',
   outerOrder:['library:__root__','devtest01','titletest']}`. (`devtest01` = `doc_devtest`
   = annotation-history sample, card-rich; `titletest` = small. Refresh `doc_devtest` from
   `samples/annotation-history` first.)
3. **Temp dev grant** (StrictMode releases the per-doc Web Lock between mounts, dropping the
   2nd doc): at the top of `claimDoc` in `src/lib/multi-window/doc-ownership.ts` add
   `if (localStorage['virgil:force-dev-storage']==='1') return { owned:true };` — **REVERT
   before commit.**
4. **Switch by clicking the doc tab** (the `.virgil-bar` `.group` with the doc title);
   dispatch a full pointerdown/mousedown/pointerup/mouseup/click sequence (plain `.click()`
   misses the tab handler).

### 3.2 Render-count instrumentation (faithful even at 0×0 viewport)
Render COUNTS are deterministic (faithful in headless); absolute ms + IO/marginalia are NOT.
- `EditorLayout` body counter: `const r=useRef(0); r.current++; (window as any).__lr=r.current;`
  at the top of the component body (NOT in an effect).
- `EditorPane` per-doc body counter: at the top of the function body,
  `(window.__pane??={})[docId]=(window.__pane[docId]||0)+1;`.
- **Memo bail attribution** (the key tool): temporarily give `React.memo(EditorPane)` a custom
  comparator that does a real shallow compare AND records, per docId, `bail`/`rerender` counts
  and which prop keys differ (`diffKeyCounts`). This tells you EXACTLY which prop churns +
  whether the memo bails. (Revert to the default no-comparator memo before commit.)
- **Dep-churn attribution**: to find which dep of a big `useMemo` bundle churns, snapshot the
  deps into a ref each render and record which index changed identity. (How `editorMutationHandlers`
  churn was traced to the four `useFocusActions` handlers → `useFocusMode`.)

### 3.3 Measurement gotchas (cost me real time)
- **Switch TO a card-rich doc, not a small one.** The memo bails during the *active pane's
  settling cascade*; a small doc (titletest) settles instantly → nothing to bail on → you
  see `bail:0` and wrongly conclude the memo is broken. Switch TO `devtest01` (card-rich).
- **HMR serves STALE for component/structural edits** — the dev server often runs the OLD
  chunk after an edit+reload; you must **restart the dev server** (not just reload) to load
  the new code. (Matches the `pwa_localhost_stale_http_cache` memory.) Symptom: your probe/
  fix "doesn't take." Verify with a module-load marker.
- **0×0 headless viewport**: `innerWidth/innerHeight===0`, so IntersectionObserver never
  registers blocks (marginalia `observed:0`) and you can't exercise marginalia/scroll. The
  main editor still lays out (`.ProseMirror` scrollHeight is real), so `coordsAtPos` counts
  ARE faithful. `preview_resize` does NOT fix the 0×0.
- **Shell cwd flakily resets to the main repo** between Bash calls — always `cd <worktree> &&`
  for tsc/vitest, or you'll measure/test the wrong tree.
- `React.memo(forwardRef(fn), comparator)` closes with `})` (one paren for memo); a stray
  `)` → "Expected a semicolon" parse error + blank page.

### 3.4 Verify per change
`npx tsc --noEmit` = 0; `npx vitest run` green; `__virgilBusStats().emitCount` flat across N
keystrokes; live render-count before/after on the card-rich multi-doc switch. Gabriel owes
the production-FSA feel-check (dev timing is unfaithful for absolute ms; counts are faithful).

---

## 4. What's already shipped (don't redo)
On local `main` (mostly pushed; the latest may be local-only — check `git log`):
- Multi-doc keep-alive + scroll-restore + top-bar memoization (prior effort).
- Phases 1–2: `useInTextPositions` cache-retaining hide + dirty-gate → clean warm re-show =
  0 `coordsAtPos` (was card-count). Phase 3: marginalia walk hoist. Phase 4: `requestLowPriority`
  defer. Phase 5: `React.memo(EditorPane)` + the `useFocusMode` memoization root-fix + prop
  stabilization + paneState bubble coalesce.
- The multi-outline keep-alive bug: `FloatingPanel` gated on `useIsVisible` (hidden panes
  render no docked panels/floats).
- The TipTap flushSync-in-commit cold-mount warning (separate session).

The **self-render burst (§0)** is the main un-addressed warm-switch cost; §1a (the object-
literal hook-return sweep) is the highest-value systematic win.
