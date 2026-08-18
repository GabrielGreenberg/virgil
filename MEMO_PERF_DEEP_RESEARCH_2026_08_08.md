# Deep performance research: typing + element-move lag in large documents

**Date:** 2026-08-08 · **Phase:** research/diagnosis (no code changed) · **Next:** planning

## Verdict up front

**This is application code, not the PWA.** An installed Chrome PWA window is the same
renderer, compositor, and input pipeline as a tab; occlusion/background throttling only
affects hidden windows, the service worker never touches keystrokes, and no Chromium issue
attributes input latency to standalone display mode or WCO. (Evidence brief with sources in
§6.) Everything measured below reproduces in a plain browser context and scales with
document size — the signature of app-level O(N) work, not platform overhead.

## 0. Method

- Two synthetic papers generated + registered in dev storage (kept for the next phase):
  - `virgil-data/doc_perftest` — "Perf Large", 1,029 blocks / ~45k words / 145 footnotes
  - `virgil-data/doc_perfhuge` — "Perf Huge", 2,883 blocks / ~131k words / ~490 footnotes
  - generator: scratchpad `gen_perfdoc.py` (well-formed `%!v:` ids, `\vfid`/`\vcid` markers)
- Live dev preview driven with real CDP input; probes: `__keystrokeStats`, `__virgilBusStats`,
  long-task observer, a timer/RAF attribution harness, per-dispatch instrumentation of
  `EditorView.dispatch` / `state.apply` / `updateState` / ViewDesc prototypes / `Selection` API.
- Three parallel code audits: keystroke-path census, drag-path trace, PWA/platform research.
- **Caveats:** dev build (React dev mode ≈ up to 2× on React-side constants; PM/style/layout
  numbers are build-independent). The preview pane is *hidden*, so RAF- and RO-driven work
  did NOT run during typing measurements (real visible-window lag is strictly worse than
  measured), and hidden-tab 1 s timer alignment batches debounce work (the batch *content*
  is real; the 1 Hz shape is an artifact). Load times are inflated by the same throttling —
  but their long-task components are genuine main-thread work.

## 1. Scaling table (measured)

| metric | 88 blocks (devtest) | 1,029 blocks | 2,883 blocks |
|---|---|---|---|
| open-document time (hidden tab) | ~instant | **20.7 s** (7.0 s in long tasks) | **50.5 s** (26.2 s in long tasks, one **15.25 s** single task) |
| live ProseMirror editor instances | 23 | **307** | **881** |
| total DOM nodes | 3.6 k | 18.5 k | 52 k |
| `view.dispatch` per keystroke p50 / p90 / max | 0.8 / 1.1 / 1.6 ms | 1.0 / 2.9 / 3.6 ms | **8–10 / 26 / 94.5 ms** |
| `state.apply` (all PM plugins) p50 | — | — | **0.1–0.6 ms (clean)** |
| keystroke bus discipline (`emitCount` delta) | 0 ✅ | 0 ✅ | 0 ✅ |
| one mousemove over editor (S12 scan) | — | — | **8.7 ms, 1,063 rect reads** |
| drop-mode body-attr toggle (universal selector) | — | 36 ms | (larger) |

Keystroke sanctity as *specified* holds everywhere (no structural emits on plain typing;
plugins O(edit)). The lag lives in layers the doctrine doesn't currently cover.

## 2. Where the per-keystroke time actually goes (huge doc)

Decomposition of a 23.9 ms dispatch:

1. **`Selection.collapse()` = 18.8 ms** — the DOM selection write inside
   `view.updateState` forces a full style-recalc + layout right after the keystroke
   dirties the DOM. Invalidation breadth scales with DOM size and stylesheet shape;
   deleting the 10 `:has(...)` rules (incl. the `p:has(...) + p:has(...)` sibling rule,
   `globals.css:3577`) cut the *tail* (max 22.3 → 15.1 ms) but p50 ~8.5 ms remains.
   Composition of the remaining recalc needs a **visible-window DevTools trace** (next phase).
2. **ViewDesc pass ≈ 5 ms**, of which `NodeViewDesc.matchesNode` is called **2,334×**
   (once per top-level block — PM's `updateChildren` scans all top-level children per
   keystroke; ~1 ms today, a genuine O(N) floor).
3. Remainder: TipTap emit chain + appendTransaction rounds (all individually O(1)/O(edit) —
   confirmed clean).

## 3. The "pause cluster" (fires at every ≥300 ms typing pause) — measured per fire, huge doc

All reset off the same `editor.on('update')` and land in the same wakeup window:

| callback | cost |
|---|---|
| `useLatexSource` serialize (300 ms) — `getJSON` + `serializeToLatex` | **78.6 ms** |
| `useWordCount` (300 ms) — `doc.toJSON` + counts | **47.7 ms** |
| marginalia `scheduleObserveRetry` | 43.2 ms |
| `useInTextPositions` measure (RAF) | 29.8 ms |
| `useLatexLint` (1500 ms) | 14.4 ms |
| autosave `debouncedSave` (1500 ms) | 10.1 ms |
| EditorPane outline tick (300 ms) → `getJSON` + Outline memos | (same window) |

≈ **220+ ms hitch exactly when the user pauses and is about to resume typing** — this is
the subjective "sticky typing" shape. Three of these independently re-serialize the whole
doc on the same trigger.

## 4. Always-on per-keystroke/per-frame O(N) sites (code-confirmed; RAF/RO-driven, so they
   did not run in the hidden pane — real-world typing pays these ON TOP of §2)

Full census in the agent report; ranked:

- **S1 Breadcrumb recompute** `EditorLayout.tsx:1782–1913` (+ mirror `:1945`) — full
  top-level walk + `coordsAtPos` per heading *and* per parTitle block per RAF while typing;
  no early exit (the `forEach` "stop" comment is wrong — it only continues); forced-layout
  reads of the scroller each pass; ×2 with split pane. Allowlisted as "RAF-coalesced" —
  RAF bounds frequency, not cost. The `disableTier1B` perf flag exists for exactly this
  site but defaults OFF.
- **S2 Grab-handle hover resolver** `TextObjectGrabHandle.tsx:263–313, :811` — fires on
  `selectionUpdate` (every keystroke; not covered by the guardrail grep), scans
  `querySelectorAll('[data-uuid]')` + `getBoundingClientRect` per block with the viewport
  cull AFTER the rect read; `mousePosRef` latch keeps it armed for the whole typing session
  once the user has clicked in. Allowlist entry says "docChanged-gated, cheap" — both wrong.
- **S3 Marginalia registry** `useMarginaliaRegistry.ts:520, :823` — RO fires on every
  line-wrap keystroke → O(N) `docOrder.indexOf` + O(N) invalidation set + full
  `doc.descendants` walk (`walkAnchorableBlocks` visits every text node).
- **S4 Omni in-text positions** `useInTextPositions.ts:438–579, :632` — O(#cards)
  `querySelector` + `coordsAtPos` per wrap; 30-frame settle loop re-arms on `items`
  identity churn (O(cards)×30 storm); `OmniViewPanel` maps all anchored cards, no
  virtualization.
- **S5 Code-pane bridge** (code view open) `code-pane-bridge.ts:150` — 150 ms reverse
  debounce fires mid-typing: `getJSON` + `serializeToLatex` + whole-CodeMirror replace;
  plus O(#paragraphs) band scan per selection frame.
- Smaller: `latex-command.ts:113` `oldSet.find()` allocates every decoration per keystroke
  and rebuilds the FULL doc's decorations when typing adjacent to any command; math
  NodeView re-renders KaTeX with no equality bail (`math.ts:125`); paragraph NodeView
  builds `textContent` per keystroke (`editor-extensions.ts:399`).

## 5. Element-move (drag) lag — trace + live confirmation

Block moves are custom mouse-event surfaces (not HTML5 DnD). During a lift, **four global
mousemove listeners** are live; one is coalesced. Ranked (agent trace, key items live-confirmed):

- **D1 = S12 (measured: 8.7 ms + 1,063 rect reads per raw mousemove)** `Editor.tsx:823–838`
  — uncoalesced scroller-mousemove scan over every `.par-title-wrapper.has-text` — runs at
  raw mouse event rate (~60–120 Hz ⇒ 0.5–1 s of main thread per second of mouse movement
  on the huge doc), during drags and plain mouse travel alike.
- **D2 = S1's drag half** `TextObjectGrabHandle.tsx:273–282` — O(N) rect reads per
  RAF-frame during the whole gesture (cull after read; JSDoc claims O(visible) — false).
- **D3 LiftHost** `LiftHost.tsx:478–503` — per-raw-mousemove React `setState`, no RAF, no
  bail; overlay writes `left/top` (not `transform`) on a `position:fixed` full DOM clone —
  for a heading lift the clone is the whole section ⇒ O(section) layout per move; plus
  3 doc walks + full-section `cloneNode(true)` at threshold-cross (the "hitch before it
  starts moving").
- **D4 uuid-mint cliff** `hit-test.ts:179` + `anchor-uuid.ts:162` — hovering a block
  without a uuid mid-drag ⇒ full-doc walk + dispatch + **synchronous FSA `.tex` write per
  pointermove** (`useDocument.ts:526` flushNow). Known trigger: `maketitle-marker` is
  missing from `UUID_BEARING_NODE_TYPES` (`latex-serializer.ts:70–86`).
- **D5 (measured: 36 ms @18.5k nodes)** `globals.css:3482` —
  `body[data-drop-mode-active] *` universal selector ⇒ full-tree style recalc at every
  drag start AND end.
- **D6 Outline row drag** `OutlinePanel.tsx:1112` — uncoalesced HTML5 `dragover` ⇒
  `setDropTarget` new object every event, no bail, `EditablePod` not memoized ⇒ O(pods)
  re-render per dragover.
- Also: drop commit does 4 full doc walks + double `JSON.stringify` doc-compare + no
  content-drag equivalent of PaneFreeze/park (every RO + marginalia registry stays live
  through the gesture); no auto-scroll (wheel during drag ⇒ S1 scan per scroll frame with
  a stale indicator).
- Confirmed clean: drop-mode controller throttle/equality bails, indicator, drag ghost,
  observer multi-step move mapping, backfill, library/pane-divider drags.

## 6. The editor-instance explosion (load time + memory + fan-out)

Every footnote/example card mounts a **live TipTap editor** regardless of visibility:
23 @88 blocks → 307 @1,029 → **881 @2,883**. This is the main driver of the 20 s/50 s
open times (one 15.2 s single main-thread task at open), a large share of the 52k-node
DOM, and a per-doc-change fan-out multiplier (float-sync re-serializes per open float).
No virtualization exists on card panels (Omni maps all anchored cards).

## 7. PWA question — evidence brief (agent, with sources)

Same renderer/compositor/input pipeline as a tab (Chromium PWA integration docs); occlusion
throttling hits only hidden/covered windows; WCO has no documented repaint cost; service
workers intercept network, not input; IndexedDB/FSA behave identically in tab vs app window.
Honest confounds when a PWA "feels slower": long-lived renderer vs fresh tab, dev-vs-prod
build comparisons, wake-from-occlusion. TipTap v3 context: `shouldRerenderOnTransaction`
already defaults off; the residual large-doc cost class is node-view count + decoration
volume + raw DOM/style-recalc — exactly what §1–§2 measured (cf. tiptap#7231, #4492;
ProseMirror discuss #2498/#4972; web.dev DOM-size guidance).

## 8. Guardrail blind spots this sweep exposed (why the doctrine didn't catch it)

1. `editor.on("selectionUpdate")` is outside the guardrail grep — S2 rides it every keystroke.
2. "RAF-coalesced" counts as a justification but bounds only frequency — S1/S2/S3/S4 are
   allowlisted yet O(N)-per-fire. Allowlist entries need a **cost class**, not a write-safety note.
3. RO/MO allowlists audit write-loops, not read cost (S3/S4).
4. Two allowlist prose claims are now factually wrong (S2 "docChanged-gated, cheap";
   S1's "only cancels/schedules RAF"), and `docs/perf/reactor-sweep-followup-findings.md:24`
   contradicts current code ("no longer walks the doc").
5. No probe counts mousemove-path work (S12/D1 invisible to all three probes).

## 9. Candidate deep fixes for the planning phase (bug-class level, per the
   prefer-deep-unified principle — NOT yet decided)

- **A. Card-editor lifecycle** — lazy-mount/virtualize per-card TipTap editors (viewport +
  focus-driven), killing the 881-editor explosion → load time, memory, fan-out.
- **B. One geometry service** — a single RAF-coalesced, viewport-culled measurement pass
  (structure from the bus + rects only for on-screen blocks) serving breadcrumb, grab
  handle, marginalia, omni — replacing 4+ independent O(N) scanners (S1/S2/S3/S4/S12).
- **C. Serialize SSOT** — one debounced doc→JSON/LaTeX product shared by latexSource,
  word count, outline, lint, code bridge (staggered or worker-offloaded) — kills the
  pause-cluster triple serialize.
- **D. Drag engine alignment** — transform-based RAF-coalesced LiftHost; cull-before-read;
  retire/gate the S12 scan; content-drag freeze/park edges on PaneDragBus; pre-mint uuids
  (add `maketitle-marker` to `UUID_BEARING_NODE_TYPES`); replace the universal drop-mode
  selector with a scoped class.
- **E. Style-invalidation budget** — eliminate `:has()`+sibling rules from the typing path;
  evaluate `content-visibility: auto`/containment for off-screen blocks in a **real visible
  window** (selection/IME caveats apply); measure `Selection.collapse` recalc composition
  in a DevTools trace.
- **F. Guardrail upgrades** — selectionUpdate coverage; cost-class allowlists; a
  mousemove-work probe; fix the two stale allowlist justifications + the stale doc line.

## 10. Verification protocol still owed (planning phase inputs)

1. Production build + **visible** window (or Gabriel's real PWA) re-run of: dispatch bench,
   pause-cluster attribution, a DevTools performance trace of 10 s of typing in
   `doc_perfhuge` (style-recalc composition of the `Selection.collapse` cost).
2. Real-pointer drag profile (the synthetic harness couldn't mount the grab handle headless).
3. Keep `doc_perftest`/`doc_perfhuge` as the standing perf corpus; note they contain
   junk characters from typing bursts (harmless).
