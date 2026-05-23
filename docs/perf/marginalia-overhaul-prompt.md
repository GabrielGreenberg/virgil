# Prompt — Marginalia overhaul (next session)

_Pick this up cold. Don't assume context._

## What you're doing and why

Text manipulation in Virgil is choppy. We did a thorough audit of every reactor watching cursor/selection/layout state — the full memo is at **`docs/perf/cursor-selection-reactor-audit.md`**. **Read it before doing anything else.**

The headline finding: `useMarginalia` walks the entire document on every edit, and most of that work is wasted because (a) most keystrokes don't change any block's layout, and (b) the data is only ever consumed for blocks that are on-screen. Fixing it well, in line with the architectural principles in the memo, should give a 100–500× reduction in per-keystroke layout work on a long doc.

## Required reading before coding

1. **`docs/perf/cursor-selection-reactor-audit.md`** — the full audit + the architectural diagnosis. Specifically sections 3, 4, 5, 6.
2. **`src/hooks/useMarginalia.ts`** — the main offender. ~210 lines.
3. **`src/hooks/useEditorViewportCache.ts`** — existing viewport-cache pattern. Same instinct (drive from `ResizeObserver` not from edits); good prior art.
4. **`src/links/_shared/LinkConnector.tsx`** lines ~241–247 — see how the in-text variant deliberately drops `selectionUpdate` and gates on `docChanged`. Same instinct should guide the marginalia rewrite.
5. **`src/text-objects/TextObjectGrabHandle.tsx`** — related reactor with similar problems. Out of scope for this session, but skim it so you understand the class of bug.

If anything in the Next.js / React / ResizeObserver / IntersectionObserver / TipTap APIs feels uncertain, **read the relevant guide in `node_modules/next/dist/docs/`** or the TipTap source under `node_modules/@tiptap/`. The repo's `AGENTS.md` flags that this Next version has breaking changes from training data; do not guess.

## This is architectural, not surgical

The user's explicit instruction (and a standing preference) is to prefer **deep architectural fixes** over surgical patches. We're not band-aiding `useMarginalia` — we're replacing it with a design that prevents this class of bug from recurring. Concretely:

- Layout state must be sourced from layout observers, not edit events.
- Reactor work must be scoped to the viewport.
- Cost must scale with change-size, not document-size.
- Derived state should be pulled on demand with a sparse cache, not eagerly snapshotted.

Section 6 of the memo lists the full set of principles. The end state should be: writing the wrong-shaped reactor next time should be the harder path, not the easier one.

## Proposed design (interrogate before implementing)

Replace `useMarginalia` with a registry (working name: `marginaliaRegistry` / `useMarginaliaRegistry`) that:

1. **Sparse cache** keyed by paragraph UUID. Populated on demand.
2. **One `IntersectionObserver`** with root margin ≈ ±800px. Observes every UUID-bearing block's DOM node. As a block enters the near-zone, the registry attaches measurement; as it leaves, the registry detaches and drops the cache entry.
3. **One `ResizeObserver`** observing the subset of blocks currently in the near-zone. On observed resize, re-measure just that block; propagate Y shift to blocks below it (strategy below).
4. **Subscribes to TipTap `transaction` (not `update`)** and bails unless the transaction included a **structural change** (block added/removed/moved). On structural change, sync the observed set against the new doc — attach new blocks that are in the near-zone, drop deleted ones.
5. **Does not subscribe to `selectionUpdate`.** Cursor movement cannot change marginalia.
6. **Exposes `getMetrics(uuid)`** returning the cached value or `null` if not measured yet.
7. **Optionally exposes `subscribe(uuid, callback)`** for consumers that need push notification when a specific block's metrics change.

## Open questions to resolve before coding

These need explicit answers, not assumptions:

- [ ] **Consumer surface.** Grep every reader of `useMarginalia`'s output. List them. For each, confirm it only needs metrics for visible blocks. The biggest worry is card panel ordering — verify it sorts by document order (UUID position in the doc), not by pixel Y. The memo claims this is the case but the audit found it by reasoning; verify in the actual code.
- [ ] **Sparse-cache tolerance.** Can every consumer handle `null` / missing entries gracefully (by skipping render), or do some assume a complete dictionary? If any assume completeness, either refactor them or provide a fallback.
- [ ] **Y-shift propagation.** When block N's height changes by `delta`, blocks N+1, N+2, ... shift Y by `delta`. Options:
  - **(a) Lazy**: drop cached Y for blocks below; re-measure on next `getMetrics` call.
  - **(b) Eager**: shift cached Y by `delta` in place.
  - **(c) Invalidate-and-remeasure-on-next-paint**: drop, schedule a RAF, re-measure in the RAF.
  Tradeoffs: (a) is simplest but risks flicker if a consumer needs Y immediately. (b) is most correct in steady state but trickier (what if the resize is reported as a delta from a stale measurement?). (c) is the safest middle ground. Pick one with reasoning written down.
- [ ] **TipTap "structure changed" signal.** How do you detect from a `transaction` that block structure changed (vs just text within blocks)? Candidates: `tr.docChanged && tr.steps.some(s => s instanceof ReplaceStep && ...)`, or comparing block-UUID lists before/after, or a custom Mark/Node added/removed check. Look at how the existing TipTap extensions in `src/lib/editor-extensions/` (or wherever they live — grep for `addProseMirrorPlugins`) handle this. The ProseMirror Transform docs are in `node_modules/prosemirror-transform/` if you need them.
- [ ] **Initial-render flash.** `IntersectionObserver` fires asynchronously after attaching, which could mean a frame of unmeasured (null) metrics on first render. Strategies: (i) eagerly measure the first viewport-worth synchronously on mount, then let the observer take over; (ii) accept the one-frame flash and structure consumers to render gracefully without metrics; (iii) prime the cache from a `requestAnimationFrame` callback after mount. Decide.
- [ ] **Block DOM-node lookup.** The current code uses `editor.view.nodeDOM(pos)`. The new design needs a way to map UUID → DOM node so it can attach observers. Verify the mapping is stable (UUIDs don't change across edits) and that `nodeDOM` returns the right element type for `ResizeObserver`/`IntersectionObserver` to observe.

## Implementation order

1. Answer all open questions in writing. Update the memo or this prompt with the decisions.
2. Build the new registry as a parallel hook. Don't delete `useMarginalia` yet.
3. Port one consumer to the new registry. Verify visual parity.
4. Port the rest one at a time. Run the dev doc (`virgil-data/doc_devtest`) after each port to catch regressions.
5. Once all consumers are ported, delete `useMarginalia`.
6. Add an instrumentation hook (or a test) that counts marginalia recomputes during a 100-character typing burst on a long doc. The number should be in the single digits.

## Success criteria

- Typing 100 characters in a long doc (500+ paragraphs) triggers at most ~5 marginalia recomputes (the ones that actually cause reflows), down from ~100.
- Pure caret movement (arrow keys, click-to-place) triggers **zero** marginalia work.
- Visible behavior is identical: bullets aligned with their paragraphs, line metrics correct for the grid, no flicker on initial render or during scroll.
- No new code paths walk the whole doc.

## Out of scope for this session

Note these and stop. Don't expand scope:

- The grab-handle resolver's global `mousemove` subscription (section 5 of the memo). Separate fix, same architectural family. Tackle next.
- The selection word/char counter throttle. One-line fix, do whenever it bothers you.
- A shared cross-listener frame-tick dispatcher. Bigger refactor; does after this lands.
- `LinkConnector` floating-variant viewport scoping. Same `IntersectionObserver` mechanism, port after this lands.

## After landing

Once this is in and stable:
1. Update `docs/perf/cursor-selection-reactor-audit.md` with the actual measurements (compute count, frame time) before/after.
2. Add a short note to `AGENTS.md` (or wherever architectural conventions live) explaining the "layout from layout observers, never from edit events" rule, with this registry as the canonical example.
3. Open follow-up tickets for the out-of-scope items above.
