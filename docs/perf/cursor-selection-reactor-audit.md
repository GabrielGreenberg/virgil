# Cursor / Selection Reactor Audit + Marginalia Overhaul Memo

_Date: 2026-05-23_

## TL;DR

Text manipulation in Virgil feels choppy. The cause is not any one bug; it's a **category error** in how layout-derived UI state is sourced. Several reactors recompute pixel-position state on every edit (or every selection change, or every mousemove) for the **entire document**, when they only need to react to **actual layout changes** in the **visible viewport**.

The single biggest offender is `useMarginalia` — it walks the whole doc on every edit. Fixing it well, and applying the same principle to its neighbors, should yield a 100–500× reduction in per-keystroke layout work on a long doc. The fixes are architectural, not surgical, and prevent a class of bugs from recurring.

---

## 1. The full inventory

We did a thorough sweep of every listener/effect/observer reacting to:
- **(a) cursor position** — the caret moving (arrow keys, clicks, typing)
- **(b) moving edge during selection** — drag-to-select, shift+arrow
- **(c) the selected region** — bounds/contents of an existing range

### Caret-position reactors

| Title | What it does | Cost |
|---|---|---|
| Grab-handle resolver (`src/text-objects/TextObjectGrabHandle.tsx`) | Decides which block the caret is "inside" so the gutter handle docks to the right block. Re-runs on every caret move, scroll, and **global mousemove**. | **HIGH** |
| Yellow lightning-button placer (`src/components/SelectionActionsMenu.tsx`) | Floats the gutter actions-menu button at the head of the caret/selection. | MED |
| Actions-strip enabler (`src/components/ActionsStripButton.tsx`) | Toggles the menubar button between cursor/selection mode. | LOW |
| Last-known-paragraph saver (`src/hooks/useEditorUIState.ts:174`) | Remembers the paragraph the cursor was last in so the doc reopens there. Debounced 400ms. | LOW |
| Outline-section highlighter (`src/panels/Outline/OutlinePanel.tsx`) | Highlights the current section in the outline. | LOW |
| Slash-menu trigger (`src/lib/tiptap/slash-popup.ts`) | Shows `/` command palette. | LOW |

### Moving-edge reactors (during active drag-to-select)

| Title | What it does | Cost |
|---|---|---|
| Grab-handle resolver | Re-resolves the current block while the selection grows. | **HIGH** |
| Yellow lightning-button placer | Tracks the growing selection (suppressed during drag, snaps on mouseup). | MED |
| Selection word/char counter (`src/hooks/useWordCount.ts:281`) | Updates "X words / Y characters selected". **Unthrottled.** | **MED** |
| Lift-gesture watcher (`TextObjectGrabHandle.tsx:673`) | Window-level mousemove during drag-from-handle for the 5px lift threshold. | LOW |
| Outline-row drag tracker (`OutlinePanel.tsx:1305`) | Computes drop slot under the mouse during outline reordering. | LOW |
| Floating-panel header dragger (`src/components/FloatingPanel.tsx`) | Repositions detached panels as you drag their header. | LOW |

### Selected-region reactors

| Title | What it does | Cost |
|---|---|---|
| Grab-handle resolver | Switches handle into "selection mode" and positions next to the range. | **HIGH** |
| Yellow lightning-button placer | Anchors to the head line. | MED |
| Selection word/char counter | Reads selected text and counts. | MED |
| Action-menu opener (`src/components/ActionsMenuPanel.tsx`) | Stashes `{from, to}` so wrap-in-footnote etc. operate on the right range. | LOW |
| Drag-handle popover positioner (`src/components/DragHandleMenu.tsx`) | Places per-block popover menu. | LOW |
| Card-to-text scroll aligner (`src/links/_shared/usePlacement.ts`) | When a panel card is clicked, scrolls the editor to align its in-text anchor. | MED |
| Link-connector SVG router (`src/links/_shared/LinkConnector.tsx`) | Draws curve from in-text marker to panel card. | MED |
| Recently-added-pin clearer (`src/components/editor-layout/recently-added-auto-clear.tsx`) | Un-pins most-recent card when a different one is selected. | LOW |

### Layout-driven, technically selection-agnostic, but fires on every keystroke

| Title | What it does | Cost |
|---|---|---|
| **Marginalia metrics computer** (`src/hooks/useMarginalia.ts`) | Measures every paragraph's Y, line height, line count for bullets/grid alignment. Walks the **whole doc** per edit, debounced 120ms. | **VERY HIGH** |
| Editor viewport cache (`src/hooks/useEditorViewportCache.ts`) | Caches editor right-edge + scroll bounds. Resize-only, not per-edit. | LOW |

### Per-keystroke pile-up

A single keystroke fires `update` + `selectionUpdate`, which schedules RAF callbacks in:
- Grab-handle resolver
- Yellow lightning-button placer
- Actions-strip enabler
- Word counter
- Marginalia computer (debounced)
- LinkConnector (in-text variant gated on `docChanged`; floating variant on scroll)

That's ~5 RAF callbacks per keystroke, each doing some amount of layout reading. RAF coalesces per-listener but not across listeners.

---

## 2. The marginalia case in detail

`useMarginalia` is the worst because its cost scales with **document length**, not viewport size or change-size:

```
on every update event (debounced 120ms):
  for every UUID-bearing block in the doc:
    view.nodeDOM(pos)
    getBoundingClientRect()
    getComputedStyle()
    line-height math
    view.coordsAtPos(pos + 1)
```

On a 500-paragraph doc that's 500 layout reads every 120ms while typing. The code itself comments that this "eats most of one frame on a long doc."

### Why on every keystroke?

It doesn't have to be. The list of things that actually change marginalia data:

| Action | Any paragraph Y changes? | Any line count changes? |
|---|---|---|
| Typing inside a non-wrapping line | **No** | **No** |
| Typing that pushes a line wrap | Only paragraphs **below** the current one | Yes, current |
| Pressing Enter | Below shift down | Current splits |
| Backspace joining paragraphs | Below shift up | Two merge |
| Caret movement (arrow keys, click) | **Never** | **Never** |

The dominant case during typing — typing within a wrapped line — changes **nothing** that marginalia tracks. The current implementation is doing pure waste work on the majority of keystrokes.

### Why for the whole doc?

Nothing off-screen needs marginalia Y. Use sites checked:
- **Bullets / grid alignment** — purely visual, only matters on-screen.
- **Card-to-marker connectors** — only render when visible; clamp to viewport edge otherwise.
- **Card panel ordering** — uses **document order** (UUID position in the doc), not pixel Y. Verified by reading the panel layout code.
- **Outline panel** — uses UUIDs, not Y.
- **Scroll-to-anchor jumps** — call `coordsAtPos` on demand at the moment of the jump.

Nothing depends on having marginalia Y for paragraph 312 when paragraph 312 is 8000px off-screen.

---

## 3. Architectural diagnosis

This is a **category error in event sourcing**. There are three kinds of reactor in the codebase:

1. **Layout-coupled** — care about pixel positions
2. **Content-coupled** — care about what text exists
3. **Selection-coupled** — care about selection state

The bug pattern is **driving layout-coupled state with content-coupled events**: subscribing to `update` to maintain pixel positions. The browser's own layout engine is the authoritative source of truth for layout. Listening to edits is a proxy that's both expensive (overruns) and incorrect (misses CSS-triggered reflows).

The right pattern is to source each state-kind from its native producer:

| State kind | Native source |
|---|---|
| Layout (Y, height, box size) | `ResizeObserver`, `IntersectionObserver`, viewport scroll |
| Content (text, structure) | TipTap `transaction` / `update` with `docChanged` gating |
| Selection (from, to, anchor, head) | `selectionUpdate` |

A secondary principle: **make work proportional to the change**, not to the total state size. Most current per-keystroke walks scan the entire doc; they should scan only the delta.

A tertiary principle: **prefer pull-with-cache over push-everything**. Instead of computing all marginalia and storing it, consumers should request marginalia for a specific UUID and get a fresh measurement on cache miss. The cache populates lazily.

---

## 4. The two architectural fixes

### Fix 1 — Trigger on layout change, not on edit (`ResizeObserver`)

Use one `ResizeObserver` instance observing every visible block's DOM node. On observed change:
- Re-measure only the block whose box changed.
- For blocks below it, either re-measure lazily on next access, or shift cached Y by the height delta. (Decision deferred.)

Structural changes (paragraph added/removed/moved) detected from the TipTap `transaction`, not `update`. On a structural change, sync the observed set against the new doc.

**Do not subscribe to `selectionUpdate` at all.** Pure caret movement cannot change marginalia.

### Fix 2 — Scope to the viewport (`IntersectionObserver`)

One `IntersectionObserver` with root margin ≈ viewport ± 800–1000px so just-off-screen blocks are pre-measured for smooth scrolling. As a block enters the near-zone:
- Attach `ResizeObserver` observation.
- Measure once.
- Add to sparse cache.

As a block leaves the near-zone:
- Detach `ResizeObserver` observation.
- Drop from cache.

Consumers requesting marginalia for an off-screen block receive `null` and skip rendering — which is what they'd want anyway since the block isn't on-screen.

### Combined effect

| Strategy | Typing cost (500-paragraph doc) |
|---|---|
| Status quo | 500 measurements every 120ms |
| ResizeObserver only | ~1 measurement on rare reflow keystrokes |
| IntersectionObserver only | ~30 measurements every 120ms |
| **Both** | **0–1 measurements on rare reflow keystrokes** |

100–500× reduction. The bulk of keystrokes do **zero** marginalia work.

---

## 5. Related reactors — same root cause

The marginalia case is worst, but the category error recurs:

1. **Grab-handle resolver subscribes to global `mousemove`.** This fires hundreds of times per second. The right primitive is `mouseenter`/`mouseleave` per block, or — better — don't drive the handle from mouse position at all. The user's caret is a much better signal of intent than where their mouse is hovering.

2. **Selection word/char counter is unthrottled.** During rapid keyboard selection (shift+arrow) it fires per-character. Should be RAF-coalesced or debounced ~50ms — the user can't read a count that updates faster than that.

3. **Cross-listener RAF pile-up.** 5 listeners each scheduling a RAF means 5 callbacks run next frame, each doing layout reads. A shared "frame-tick" dispatcher would let them batch their layout reads, eliminating thrash.

4. **LinkConnector floating variant** does bezier math on every scroll for **every connector** — including those whose endpoints are off-screen. Same `IntersectionObserver` fix applies.

5. **Editor UI state cursor save** writes on every selection change (debounced 400ms). Fine for now, but it's the only purely-cursor-driven listener. Consider longer debounce since the only consumer is "where to put the caret when the doc reopens later."

---

## 6. Principles to apply going forward

Not just for this fix — for any reactor we add or touch in the future:

1. **Source events from their native producer.** Layout state comes from layout observers, not edit events.
2. **Scope reactor work to the viewport.** Use `IntersectionObserver` as the gate. If the user can't see it, don't compute it.
3. **Make cost proportional to change-size, not state-size.** Per-block invalidation, not whole-doc rescans.
4. **Pull derived state on demand.** Sparse caches with lazy population beat eager full snapshots.
5. **Batch cross-listener frame work.** A shared "selection/doc/layout changed this frame" dispatcher prevents N independent RAFs from each forcing layout.
6. **Use the right primitive for the gesture.** Hover = `mouseenter`/`mouseleave`. Selection = `selectionUpdate`. Drag = pointer events with capture. Don't conflate.

These are not optimizations to bolt on — they're invariants the architecture should enforce. The marginalia case is the canary: it was easy to write the wrong way because nothing in the architecture pushed back. The cleanup should leave the codebase in a state where writing the wrong way next time would be the harder path.

---

## 7. Open questions

To resolve before coding (see the companion prompt `marginalia-overhaul-prompt.md`):

- What's the full surface of `useMarginalia` consumers? (Need an exhaustive grep.)
- Can all consumers tolerate sparse / `null` entries?
- Y-shift propagation strategy: re-measure lazily, shift eagerly, or invalidate-and-remeasure? Each has tradeoffs.
- TipTap `transaction` signal for "block structure changed" — what's the canonical check?
- Initial-render correctness — does `IntersectionObserver` fire synchronously enough to avoid a flash of unmeasured marginalia on first paint?
