# Unify resize-gutter chrome: band-grip everywhere — 2026-06-30

Bug-catcher session. One UX-unification request. Research only — **no code edited**
(bug-catcher mode + SessionStart worktree warning: CWD is main, a `pending-ai-changes`
worktree is live; HEAD moved a69ea9e5→ba3a9d4b mid-session — checkout is being
live-driven, so this is a spec, not an edit). For the bug-cleaning session.

## Status: `FIX-SKETCHED` (SPEC-READY)

**Request:** make the gutter drag on the **left/right of the text pod** have the
same UI as the **bottom/top of a panel** — invisible except the resize cursor at
rest, revealing the panel-band grip chrome on interaction. **Apply the same to the
library's "big drag items."**

This is a clean [[design-prefer-deep-unified]] case: three divergent divider/resizer
chromes today → **one shared "resize gutter" affordance**.

## The three chromes today

1. **Reference — `.drag-gap-h.band-grip`** (globals.css:4272-4305). A centered grip
   **pill** (`::before`, 28×4px, `border-radius:999px`, `--edge-hover`) that is
   `opacity:0` at rest and fades in on `:hover`/`.hover-preview` (accent
   `--drag-highlight`, widens to 40px) and `.dragging` (accent, 44px). The strip
   itself is the hover/hit zone; `cursor:row-resize`. Applied at:
   - [panel-primitives.tsx:2565](src/components/panel-primitives.tsx#L2565) (inter-band / bottom-band + omni edge)
   - [panel-column.tsx:165](src/components/editor-layout/panel-column.tsx#L165) (panel-column band divider)

2. **Text-pod left/right gutters — `.drag-gap-v`** (globals.css:4210-4252). A faint
   **1px line** (`::after`), `opacity:0` at rest → `0.35` on `.hover-preview` → `0.5`
   on `.dragging` (inherited from the base `.drag-gap`), plus a `::before` invisible
   hit-area extension across the padded gutter. `cursor:col-resize`. **No grip pill.**
   Applied at:
   - [panel-column.tsx:467](src/components/editor-layout/panel-column.tsx#L467) — **the panel↔editor gutter (the "left/right of the text pod" the user means)**
   - [split-with-code.tsx:328](src/components/editor-layout/split-with-code.tsx#L328) — editor↔code splitter
   - [zen-margin.tsx:93](src/components/editor-layout/zen-margin.tsx#L93) — zen-mode margins
   - (the Library **Reader's** panel↔text boundary inherits this via `PanelColumn`/`PaperOuterView` — [RightDetail.tsx:239](library/components/RightDetail.tsx#L239) — so fixing `.drag-gap-v` fixes the Reader gutter for free)

3. **Library "big drag items" — bespoke imperative resizers.** There are **THREE**
   (handlers built via `makeResizeHandler` [LibraryView.tsx:180](library/components/LibraryView.tsx#L180); each renders a handle `<div>` with `onPointerDown` + an inline `cursor`):
   - **`startNavResize`** (col-resize) — handle [LibraryView.tsx:980](library/components/LibraryView.tsx#L980), `aria-label="Resize Libraries navigator"` — the nav-column width.
   - **`startPapersResize`** (row-resize) — handle [LibraryView.tsx:946](library/components/LibraryView.tsx#L946), `aria-label="Resize My Papers pod"` — **the VERTICAL resizer between the "Libraries" (top) and "My Papers" (bottom) sections of the left nav column** (the one the user explicitly flagged — MUST be included).
   - **`startResize`** (col-resize) — handle [LibraryView.tsx:1011](library/components/LibraryView.tsx#L1011), `aria-label="Resize library file panel"` — the nav↔file-list column boundary.

   All three write `flex-basis`/grid-track straight to the DOM (deliberately off the React render path) + set `document.body.style.cursor`. Their handle `<div>`s do **not** use the `.drag-gap`/`.band-grip` classes — a fully parallel chrome. Note the mix of orientations (2× col-resize + 1× row-resize), so the generalized both-orientation band-grip (below) covers all three. (The "big" in the user's phrasing suggests they read visibly heavier than the editor gutters at rest — confirm the handle DOM + any `library.css` handle styling.)

So the same conceptual affordance ("drag this divider to resize") has **three
looks**: grip pill (panel bands), faint 1px line (editor gutters), and the
library's own handles. The user wants #1 everywhere.

## The unified deep fix

**Generalize `.band-grip` into an orientation-agnostic "resize grip" and apply it
to every divider/resizer** — panel bands (already), editor gutters, code splitter,
zen margins, AND the library resizers. One chrome source, consumed everywhere.

1. **Add a vertical grip variant.** The horizontal grip pill is 28×4. The vertical
   gutter needs the same pill rotated: **4×28** (`width:4px; height:28px`), centered
   on the gutter, same `--edge-hover`→`--drag-highlight` colors, same
   `opacity:0`-at-rest + reveal transitions, widening on the SHORT axis
   (height 28→40→44). Cleanest: make `.band-grip::before` read orientation from the
   existing `.drag-gap-v` / `.drag-gap-h` modifier (v ⇒ tall-thin pill, h ⇒ wide-short
   pill), so `.drag-gap-v.band-grip` and `.drag-gap-h.band-grip` share ONE rule set
   differing only in which axis is the pill's long side. Then the reveal/accent/widen
   states are written once for both orientations.
2. **Apply `.band-grip` to the editor gutters.** Add `band-grip` to the classNames at
   panel-column.tsx:467, split-with-code.tsx:328, zen-margin.tsx:93. Drop (or leave
   dormant) the old `.drag-gap-v::after` 1px-line reveal so the grip is the sole
   affordance. Keep the existing `::before` hit-area extension (it's the hover zone).
3. **Route ALL THREE library resizers through the same chrome.** Give each handle
   `<div>` (`startNavResize` :980 + `startResize` :1011 → `drag-gap drag-gap-v band-grip`;
   `startPapersResize` :946, the Libraries↔My-Papers vertical resizer → `drag-gap
   drag-gap-h band-grip`) the shared classes (add a `.dragging` toggle on
   pointerdown/up to match the editor's drag state; the imperative flex-basis logic is
   unchanged — only the handle's chrome classes + a dragging flag are added). Don't
   miss `startPapersResize` — it's the only row-resize of the three and the one the
   user called out. Because library CSS is
   isolated ([library.css], style-guide "Library tab" §), and this is a cross-cutting
   primitive, keep the `.band-grip` rules in **globals.css** (the library already
   consumes global tokens) and have the library handles reference the same class,
   rather than duplicating the pill in library.css. **Deepest option:** extract a tiny
   shared `<ResizeGutter orientation=… onDragStart/…>` (or a `resizeGutterProps()`
   helper) that emits the class set + `.dragging` wiring, consumed by both the editor
   splitters and the library resizers — so the grip lives in exactly one place and a
   fourth resizer inherits it for free.

Net: every divider in the app is invisible-at-rest + shows the SAME grip on
interaction; adding a new resizer is "use the shared gutter," not "re-style a handle."

## Design fork to resolve (reveal trigger)

The user wrote "**invisible except for the drag cursor, until you mouse down**, then
the chrome that panel bottom/tops use." But the current band-grip reveals the grip on
**hover** too, not only on mousedown. Two readings:
- **(A) Match band-grip exactly** — grip fades in on hover AND drag. Most consistent
  with "very similar UI to the bottom of a panel" (it literally IS that chrome). **Recommended** — keeps one behavior across all dividers.
- **(B) Literal reading** — hover shows ONLY the `col-resize` cursor (no grip); the
  grip appears on mousedown/drag. This means dropping the `:hover`/`.hover-preview`
  reveal from `.band-grip` and keeping only `.dragging` — a **global** change that
  would also make the panel bands drag-only-reveal (arguably fine, arguably a
  regression to their discoverability).

Recommend (A) for consistency; flag (B) as a one-line toggle if the user truly wants
hover to be cursor-only. This is the only real decision in the task.

## Surgical alternative (if not unifying)
Add a `.drag-gap-v.band-grip` rule (vertical pill) + the class at the three editor
gutter sites, and separately add matching chrome to the two LibraryView handles. Gets
the look without the shared primitive — leaves two implementations to keep in sync.

## Live-verify (dev preview OK for chrome; also sanity-check FSA)
- Hover the panel↔editor gutter (left & right), the code splitter, and zen margins → cursor + (per fork choice) grip; on drag → accent grip that widens. Matches the panel band bottom/top exactly.
- Library: hover + drag ALL THREE resizers — "Resize Libraries navigator" (:980), "Resize My Papers pod" (:946, the Libraries↔My-Papers vertical), "Resize library file panel" (:1011) → same grip chrome; resizing still works (flex-basis logic unchanged, no per-frame React re-render). Explicitly confirm the Libraries↔My-Papers vertical resizer got the treatment.
- Regression: the panel band dividers (panel-primitives.tsx:2565, panel-column.tsx:165) look unchanged (if fork A) or intentionally drag-only (if fork B); `HSplit`/editor-split plain `.drag-gap-h` (panel-primitives.tsx:2474, split-editor-panes.tsx:71) — decide whether these join the grip too or stay 1px lines (they're editor splits, not user-facing panel edges; recommend they ALSO get the grip for full consistency, or note the deliberate exception).
- Keystroke/gesture sanctity: the library resizers already keep drag off the React path (imperative DOM writes) — preserve that; only add class toggles.
