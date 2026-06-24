# FEATURE / UX — Edge-resizable pop-outs (L / R / Bottom) + remove the corner grip styling

**Status:** `PLAN-READY` (researched + designed, **not** implemented; single-file change, low risk)
**Filed by:** bug-catcher session, 2026-06-21
**Request (verbatim intent):** "For any kind of pop out — text object, card, panel — I'd like the L, R, and Bottom
edges all to be drag-resizable. At the same time let's get rid of the bottom-right-hand corner styling."
**Screenshot:** referenced but did not attach this turn; the "bottom-right corner styling" is unambiguously the
diagonal-line resize grip at [`FloatingPanel.tsx:636-646`](src/components/FloatingPanel.tsx:636) (confirm with the
user if they meant something else).

---

## 1. Why this is a clean, single-file change

Every pop-out in the app is already funneled through **one shell component**, so "any kind of pop out" is
literally one code path:

- **`FloatingPanel`** ([src/components/FloatingPanel.tsx](src/components/FloatingPanel.tsx)) — the only draggable/
  resizable window shell. Portals to `document.body` when floating.
- **Cards + text-objects** float via **`FloatWindow`** ([src/floats/FloatWindow.tsx:170](src/floats/FloatWindow.tsx:170))
  → `FloatingPanel`. (Kind-blind `Floatable` contract.)
- **Panels** float via `FloatingPanel` directly (`mode="floating"`, `onUndock`/`onMaybeRedock`).
- **Bib / AI windows** are `bareWindow` floatables → still `FloatWindow` → `FloatingPanel`.

**Verified there is exactly one resize seam:** `onResizeMouseDown` + the `nwse-resize` corner grip live only in
`FloatingPanel`. No other component renders a float resize handle (grep for `nwse-resize` / `onResizeMouseDown`
returns only this file). So fixing `FloatingPanel` fixes text-object, card, AND panel pop-outs at once — exactly
the unified surface the request wants.

---

## 2. Current resize mechanism (what we're replacing)

1. **The grip** ([:636-646](src/components/FloatingPanel.tsx:636)) — rendered only when `mode === "floating"`:
   ```jsx
   <div onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
        style={{ background: "linear-gradient(135deg, … diagonal grey lines …)" }}
        aria-label="Resize" />
   ```
   ← **this `linear-gradient` is the "bottom-right corner styling" to delete.**
2. **Gesture start** `onResizeMouseDown` ([:521-533](src/components/FloatingPanel.tsx:521)) — sets
   `dragStateRef = { mode: "resize", startX, startY, origW: pos.width, origH: pos.height }`, body cursor
   `nwse-resize`, `stopPropagation` (so the header move gesture doesn't also fire).
3. **Gesture move** — the resize branch of the shared window `onMove` ([:341-347](src/components/FloatingPanel.tsx:341)):
   ```js
   const nw = clamp(origW + (clientX - startX));   // 240..900
   const nh = clamp(origH + (clientY - startY));   // 200..(innerH-40)
   setPos(p => ({ ...p, width: nw, height: nh }));  // top-left fixed, grows bottom-right only
   ```
4. **Commit** — `onUp` persists via `handlersRef.current.onChange(latestPos)` ([:409](src/components/FloatingPanel.tsx:409)).

Limitation: only the **bottom-right corner** resizes, and only **outward from a fixed top-left**. No left/right/
bottom-edge handles. Top is (correctly) reserved for the header move/undock drag.

---

## 3. Proposed deep solution — edge-aware resize in `FloatingPanel` (one file)

Generalize the single corner gesture into an **edge-descriptor resize model**, then render thin hit-zones on the
**L, R, B** edges and delete the corner grip. Top stays move-only (it's the header). Docked mode is untouched
(docked panels resize via the band gutters in `panel-column.tsx`).

### 3a. Generalize the drag state
Extend the `resize` variant of `dragStateRef` ([:176](src/components/FloatingPanel.tsx:176)) to carry the edges
being dragged and the original **x/y** (needed for left-edge resize, which moves the left side):
```ts
| { mode: "resize";
    edges: { left?: boolean; right?: boolean; bottom?: boolean };
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number }
```

### 3b. Edge math in the `onMove` resize branch ([:341-347](src/components/FloatingPanel.tsx:341))
```js
const dx = e.clientX - s.startX;
const dy = e.clientY - s.startY;
let { x, y, width, height } = latestPosRef.current; // start from current
if (s.edges.right)  width  = clampW(s.origW + dx);                 // x fixed
if (s.edges.bottom) height = clampH(s.origH + dy);                 // y fixed
if (s.edges.left) {                                                // right edge fixed
  const rightEdge = s.origX + s.origW;
  width = clampW(s.origW - dx);
  x = rightEdge - width;          // clamping width auto-stops x at min/max
}
setPos(p => ({ ...p, x, y, width, height }));
```
where `clampW = v => Math.max(FLOAT_MIN_W, Math.min(FLOAT_MAX_W, v))` and
`clampH = v => Math.max(FLOAT_MIN_H, Math.min(window.innerHeight - 40, v))`.
**Centralize** the magic numbers (`240 / 900 / 200`) as `FLOAT_MIN_W / FLOAT_MAX_W / FLOAT_MIN_H` and reuse them
in the existing undock clamp at [:244-245](src/components/FloatingPanel.tsx:244) too (it duplicates them today).

### 3c. Replace the corner grip with three edge zones (floating only)
Delete the `<div … linear-gradient …>` and render thin, **invisible** strips (≈6px) — each `stopPropagation`s and
seeds the matching `edges`:
```jsx
{mode === "floating" && (<>
  <div onMouseDown={beginResize({ left: true })}   className="absolute top-0 left-0  h-full w-1.5 cursor-ew-resize" />
  <div onMouseDown={beginResize({ right: true })}  className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize" />
  <div onMouseDown={beginResize({ bottom: true })} className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize" />
</>)}
```
`beginResize(edges)` = the generalized `onResizeMouseDown`: captures `origX/Y/W/H`, sets body cursor to the edge's
cursor (`ew-resize` / `ns-resize`), `preventDefault` + `stopPropagation`. Render these **after** `children` so they
sit above the body; they're transparent so nothing shows — **the corner styling is gone**.

### 3d. (Recommended) keep the corner *ergonomics* without the styling
The request removes the corner **styling**, not necessarily corner **resizing**. Strongly recommend adding two
small (≈12px) **invisible** corner zones so two-axis resize survives (users reflexively grab corners):
```jsx
<div onMouseDown={beginResize({ bottom: true, left: true })}  className="absolute bottom-0 left-0  w-3 h-3 cursor-nesw-resize" />
<div onMouseDown={beginResize({ bottom: true, right: true })} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize" />
```
Place them after the edge strips (higher stacking) so the corner wins where they overlap. **This is the one real
design choice — see §6.** If the user wants pure single-axis edges, drop this block.

---

## 4. Edge cases / gotchas (verified against the code)
- **Left-edge clamping moves x correctly:** deriving `x = rightEdge − clampedWidth` means hitting `FLOAT_MIN_W`/
  `FLOAT_MAX_W` naturally freezes the left edge — no separate x clamp needed.
- **Top intentionally excluded:** the header strip ([:629-635](src/components/FloatingPanel.tsx:629)) owns the
  top for move/undock. Don't add a top zone (it would fight the move gesture). Matches the request (L/R/B only).
- **Header vs. full-height L/R strips:** the L/R strips span full height, so the outer ~6px beside the header
  resize instead of move. That's conventional (OS windows) and fine; if undesired, start the L/R strips below the
  header height. Note for the implementer.
- **Move/undock gesture untouched:** `onHeaderMouseDown`, `beginDragAt`, `setRect`, the docked→floating undock,
  stack-drop, and `onChange` persistence all stay as-is. Only the `resize` branch + handle DOM change.
- **`WINDOW_DRAG_BLOCK_SELECTOR`:** irrelevant to the edge zones (they're overlay siblings, not `[data-card]`
  descendants); `stopPropagation` already prevents the header handler from co-firing.
- **All surfaces covered:** the zones render for every `mode==="floating"` shell regardless of `surface`
  ("panel" vs "card") and `bareWindow`, so paragraph/heading/selection text floats, cards, panels, and bib/AI
  windows all gain edge-resize uniformly.
- **Rounded corners:** the 14px panel radius means the corner zones overlap the rounded area cosmetically — fine
  for invisible hit-zones.

---

## 5. Blast radius & tests
- **Files:** `src/components/FloatingPanel.tsx` only (optionally a tiny constants export). No `FloatWindow` /
  panel / card changes needed — they inherit through the shell.
- **Existing tests:** none assert on the corner grip (float `__tests__` cover policy/key/chrome/drop-dispatch),
  so nothing breaks. **Add** a `FloatingPanel` resize test: simulate mousedown on each edge zone + mousemove and
  assert the new `pos` (right→width only; bottom→height only; left→width down + x right with right edge fixed;
  min/max clamps freeze x). Assert the `linear-gradient` grip is gone.
- **Live verify:** pop out a card, a text-object (paragraph float), and a panel; drag each of L/R/B; confirm the
  corner styling is gone and resize feels right. (Dev preview needs `doc_devtest` loaded.)

## 6. Open design question for the user / cleaning session
**Corners:** keep small *invisible* 2-axis corner zones (§3d, recommended — preserves corner-drag ergonomics with
zero styling) **or** go pure single-axis L/R/B edges only? The literal request is the three edges; the recommended
default keeps corners functional but unstyled. One-line decision.

## 7. Key anchors
- [`FloatingPanel.tsx`](src/components/FloatingPanel.tsx): `:176` resize drag-state variant · `:341-347` resize
  move math · `:521-533` `onResizeMouseDown` · `:636-646` corner grip to delete · `:244-245` duplicated clamp
  constants to centralize · `:409` commit-on-up.
- [`FloatWindow.tsx`](src/floats/FloatWindow.tsx) (consumer, no change) · `src/floats/FloatChrome.tsx` (header).
