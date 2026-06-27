# Warm-switch self-render burst — PROFILED FINDINGS (worktree perf-self-render)

Date: 2026-06-26. Method: live render-count + memo-comparator + state-diff +
commit-counter instrumentation in the multi-doc keep-alive dev preview
(devtest01 = annotation-history card-rich, titletest = small). All temp probes
tagged `__PSR_PROBE` (revert before commit).

## Headline: the "~15-16 self-render burst" is mostly a MEASUREMENT ARTIFACT

`bodyExec` (render-function runs) is exactly **2×** real commits — confirmed
StrictMode dev double-invoke (`__pane`=54 vs `__paneCommit`=27, ratio 2.00).
On top of that, `useWordCount` returns a **fresh `{counts, selection}` object
every render** (src/hooks/useWordCount.ts:298, NOT useMemo-wrapped). It is a
*passenger*: it re-identifies on every render (incl. StrictMode's 2nd invoke),
so a naive state-diff shows "wordCount changed" on 16/16 body executions and
the count looks like ~15. After correcting both, the real number is **5**.

## Clean numbers — ONE warm switch (devtest01 card-rich → titletest), StrictMode-corrected

| Component            | real commits | parent-driven | SELF-renders |
|----------------------|-------------:|--------------:|-------------:|
| devtest01 (→ hidden) |            8 |             3 |        **5** |
| titletest (→ active) |            4 |             4 |        **0** |
| EditorLayout         |            5 |            —  |        **5** |

Total ≈ 17 component renders for the whole switch, spread over ~3s of async settle.

### The 5 hidden-pane self-renders, attributed (distinct drivers, in order):
1. `isVisible` — the `useIsVisible()` context flip. **Unavoidable** (it's how the
   pane learns it is hidden; a context consumer always re-renders on value change).
2. `menubarWidth` (+ui.loaded+wc batched) — the docked-MenuBar **ResizeObserver
   fires `setMenubarWidth(0)`** when the slot goes `display:none` (contentRect→0),
   then again with the real width on re-show. EditorPane.tsx ~3353. **FIXABLE**:
   a hidden pane should not recompute menubar width — gate the setState on visibility.
3. `collab.sidecar` — collab poll (`setInterval` pollMs) resolving. Async, coincidental.
4. `doc.content` — docHook.content state change (autosave drain / sidecar). Coincidental.
5. `ui.loaded` — editor-state.json sidecar load resolving. Coincidental.

So of 5: **1 unavoidable, 1 cleanly fixable (menubarWidth), 3 cheap async settles**
that would happen regardless of the switch.

### Idle control: 0 self-renders over 28s (both panes). Panes ARE inert at idle.
(The collab 1Hz `setTick` is already gated on `sidecar.pen.holder` — and the dev
doc has `pen.holder:null`, so it never fires. The earlier "idle churn" reading was
settling-tail from a just-completed switch, not steady-state.)

### Content-independence: the small doc (titletest) going hidden fires the SAME ~5.
The hidden-pane self-render count is NOT card-proportional — it's a fixed
visibility/chrome/settle cascade. (Card/marginalia/in-text-position hooks live in
CHILDREN — OmniHost/Marginalia — so they re-render those children, NOT EditorPane.)

## §1a fresh-object-literal sweep (the memo's "highest-value systematic win")

153 hooks scanned. **13 return a fresh object literal NOT useMemo-wrapped**, consumed
whole as a memo-dep/prop in EditorPane:
- useNotes, useTodos, useRevisions, useCutter, useReports, useFootnotes, useArchive,
  useAnnotations (consumed in EditorPane spread-memos / handler bundles)
- useBibReview, useAiRequests (popoutsDeps)
- **useWordCount** (caught EMPIRICALLY here — the static sweep MISSED it; it's the
  one that polluted the self-render measurement)
- useFocusActions, useLibraryTabs (destructured by sole caller → low)

Adversarial verification: the *mechanism* is real for all, but the *blast radius is
LOW* (severity downgraded med→low). They are mostly passengers — they re-identify
every render but rarely *cause* renders; they make each EditorPane/EditorLayout render
slightly more expensive (cascade to children that should bail). Fix = wrap each return
in `useMemo`; deep version = + a regression-guard test asserting return identity is
stable across a no-op re-render.

## Other suspects (census + adversarial verification)
- **1b** big memo bundles (editorMutationHandlers ~22 deps, editorPaneView*): CONFIRMED
  fragile. Fix = identity-stability test/lint per bundle. (med)
- **1d** unbounded `virgil-view-prefs/window/<uuid>` localStorage: partially confirmed,
  never GC'd, hundreds observed. Fix = one-shot GC at first useViewPrefs load. (low, easy)
- **1f** cold-mount settle loop (coordsAtPos × cards, SETTLE_MAX_FRAMES): CONFIRMED a
  DISTINCT, larger class (the content-proportional cost) — not yet optimized. (med)
- **2-card-store** anchored-card-store module-global (not docId-scoped): CONFIRMED.
  Fix = key state/listeners by docId. (med, more correctness than perf)
- **2-diskwatcher** per-doc ~3s setInterval: pauses on tab-hidden but NOT pane-hidden;
  low cost under keep-alive. (low)

## Bottom line
The warm-switch **React render cost is already small and well-optimized** (the prior
instant-switch effort did its job). The headline §0 "burst" was inflated by StrictMode
×2 + the useWordCount passenger. Remaining felt warm-switch lag (if any) is in the
**editor/DOM layer** (display:none→flex reflow, TipTap NodeView, KaTeX, re-show
measurement) — NOT faithfully measurable in the headless preview — and/or the **COLD
switch (§1f)**, the genuinely content-proportional class.
