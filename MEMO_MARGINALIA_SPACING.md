# BUG — Marginalia marker spacing/position: overlaps scrollbar, collides with selection bolt, no minimum-margin floor

**Status:** `IMPLEMENTED` (c178218e marginalia geometry SSOT + 8d815147 widened bolt/marker lane, 2026-06-24, prior drain) — owes live FSA feel-check (geometry fully mapped; 2 small design decisions flagged) · confidence **high**
**Filed by:** bug-catcher session, 2026-06-21
**Surface:** editor right margin chrome (marginalia markers + selection bolt + overlay scrollbar)
**Repo note:** diagnosis only (no source edits). The `library-reader-followups` worktree is unrelated; whoever
implements picks the worktree.

---

## 1. Symptom (user + screenshot)

Right-side marginalia markers (the green doc icons) are mis-spaced: they **overlap the scrollbar**, are **poorly
positioned relative to the selection bolt (⚡)**, and "just don't make sense." Also: **set a minimum margin spacing so
that even at the minimum, things don't overwrite each other.**

---

## 2. Root cause — three uncoordinated offset systems (one class)

The three things that share the right margin are each positioned by a **separate ad-hoc constant in a separate
coordinate system**, with no shared geometry and no scrollbar reservation:

| Element | Positioned by | Constant | File |
|---|---|---|---|
| Marginalia markers | `right:0` in the marginalia host pod; markers end `OUTER_PAD_RIGHT` from that edge | **6px** | [Marginalia.tsx:483-490](src/components/Marginalia.tsx:483), [marginalia.ts:307](src/lib/marginalia.ts:307) |
| Selection bolt (⚡) | `left = textRight + RIGHT_GAP` (portaled to body, viewport coords) | **6px** | [SelectionActionsMenu.tsx:34,110](src/components/SelectionActionsMenu.tsx:110) |
| Overlay scrollbar | `left = editorCol.right − width(6) − rightInset(3)` (fixed, viewport coords) | **9px footprint** | [editor-scrollbar.tsx:81](src/components/editor-layout/editor-scrollbar.tsx:81) |

### Verified geometry (text edge = `textRight`; right margin = 64px wide)
- Right margin internal layout: `[INNER_PAD 8] icon(22) gap(6) icon(22) [OUTER_PAD_RIGHT 6]` →
  `ICONS_BLOCK_WIDTH = 50`, `MARGINALIA_MARGIN_WIDTH_RIGHT = 8+50+6 = 64` ([marginalia.ts:294-325](src/lib/marginalia.ts:294)).
- **Overlap #1 — markers ↔ scrollbar:** the right icon ends `OUTER_PAD_RIGHT = 6px` from the host's right edge, but
  the scrollbar thumb occupies the rightmost **9px** (`width 6 + rightInset 3`). With host right ≈ editor-column right
  (the screenshot confirms it), the right icon's last ~3px sits **under the scrollbar thumb**. `6 < 9` is the bug.
- **Overlap #2 — bolt ↔ markers:** the bolt is placed at `textRight + 6`, but the marker grid starts at
  `textRight + INNER_PAD(8)`. The 28px-wide bolt (`textRight+6 … textRight+34`) lands **on top of the left marker
  column** (`textRight+8 … textRight+30`). They're fighting for the same first ~30px of the right margin → "poorly
  positioned relative to the selection bar."
- **No minimum reservation:** zen `MIN_MARGIN = 0` ([useZenMode.ts:32](src/hooks/useZenMode.ts:32)); the
  `useMarginEdit` floors are left 72 / **right 24** with no scrollbar/marginalia clearance
  ([useMarginEdit.ts:74-79](src/hooks/useMarginEdit.ts:74)); the editor column `min-width` reserves text width but **not**
  the 64/80px marker lanes ([EditorPane.tsx:4638](src/components/EditorPane.tsx:4638)); compressed/code mode caps margins
  smaller still. So shrinking the margin drives markers into the text, the scrollbar, and each other — exactly the
  "things overwrite each other at minimum" the user calls out.

> Note: the marker↔scrollbar overlap is **visual** (scrollbar z=35 over markers z=10), not click-theft (scrollbar is
> `position:fixed`, markers are in a separate stacking context). Still wrong — chrome must not occlude controls.

---

## 3. Deep fix — one shared right-margin geometry (no ad-hoc offsets)

Model the right margin as a **single coherent lane** whose sub-bands (marker grid · selection bolt · scrollbar gutter)
are all **derived from shared constants**, so nothing overlaps at any margin width.

### 3a. One scrollbar-gutter SSOT
Export the scrollbar footprint as a shared constant (a layout-constants module, e.g. `editor-layout/constants.ts`),
consumed by **all three** sites instead of their private magic numbers:
```ts
export const SCROLLBAR_THUMB_WIDTH = 6;
export const SCROLLBAR_RIGHT_INSET = 3;
export const SCROLLBAR_GUTTER = SCROLLBAR_THUMB_WIDTH + SCROLLBAR_RIGHT_INSET; // 9
```
`editor-scrollbar.tsx` derives its `width`/`rightInset` from these (so any change propagates).

### 3b. Markers clear the gutter
`MARGINALIA_OUTER_PAD_RIGHT = SCROLLBAR_GUTTER + GAP` (e.g. `9 + 3 = 12`) so the right marker column sits a few px
**left of** the scrollbar, not under it. `MARGINALIA_MARGIN_WIDTH_RIGHT` recomputes from it (→ ~70px). **Left side
unchanged** (`OUTER_PAD_LEFT = 22`, no scrollbar there) — keep the asymmetry.

### 3c. Bolt joins the same lane (instead of `textRight + 6`)
Derive the bolt's x from the shared right-margin geometry so it occupies its **own sub-band that doesn't overlap the
marker grid and clears the scrollbar** — e.g. align it to the marker grid's left column / inner-pad origin, or give it
a dedicated band just inside the marker grid. Replace the standalone `RIGHT_GAP = 6` with a value derived from
`INNER_PAD` + the shared lane model. Keep the existing viewport-edge clamp ([SelectionActionsMenu.tsx:111-113](src/components/SelectionActionsMenu.tsx:111))
and the RAF-coalesced reposition (keystroke sanctity — don't change the cadence, only the resting offset).

### 3d. Minimum-margin floor (the user's explicit ask)
Define the lane's intrinsic minimum and clamp every adjustable margin to it **when markers are shown**:
```ts
export const MARGINALIA_MIN_MARGIN_RIGHT = MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_RIGHT; // ~70
export const MARGINALIA_MIN_MARGIN_LEFT  = MARGINALIA_INNER_PAD + ICONS_BLOCK_WIDTH + MARGINALIA_OUTER_PAD_LEFT;  // ~80
```
Apply as a floor in: zen `_clamp` ([useZenMode.ts:84](src/hooks/useZenMode.ts:84)), the `useMarginEdit` right floor
([useMarginEdit.ts:74-79](src/hooks/useMarginEdit.ts:74)), the editor column `min-width`
([EditorPane.tsx:4638](src/components/EditorPane.tsx:4638)), and the compressed/code-mode cap. Result: the marker lane is
guaranteed at any setting — nothing overwrites at the minimum.

---

## 4. Design decisions (flagged — these are the only open calls)
1. **Min-floor gates on marker visibility (recommended).** A hard 70px floor would change *zen / distraction-free*
   layout where the user may want near-zero margins. **Gate the floor on the condition that actually renders the
   marginalia margins** — when markers are shown, reserve the lane; when a reading mode hides them, keep the freedom.
   (Confirm the marginalia-visible condition; apply the floor there, not unconditionally.) Avoids the
   `library-reader` read-only "wasted space" regression too.
2. **Breathing gap values:** marker↔scrollbar gap (§3b, recommend ~3px → outer-pad 12) and bolt sub-band placement
   (§3c). Pick once; everything else derives.

---

## 5. Files
- [src/lib/marginalia.ts:294-325](src/lib/marginalia.ts:294) (pads/widths + new MIN constants) ·
  [src/lib/marginalia-grid.ts](src/lib/marginalia-grid.ts) (cell x math) · [src/components/Marginalia.tsx:483-490](src/components/Marginalia.tsx:483).
- [src/components/editor-layout/editor-scrollbar.tsx](src/components/editor-layout/editor-scrollbar.tsx) (consume SSOT) ·
  new/`editor-layout/constants.ts` (SCROLLBAR_GUTTER).
- [src/components/SelectionActionsMenu.tsx:33-34,108-126](src/components/SelectionActionsMenu.tsx:108) (bolt x from shared lane).
- [src/hooks/useZenMode.ts:32,84](src/hooks/useZenMode.ts:84) · [src/hooks/useMarginEdit.ts:74-79](src/hooks/useMarginEdit.ts:74) ·
  [src/components/EditorPane.tsx:4638](src/components/EditorPane.tsx:4638) (min-margin floors).

## 6. Risk / tests
- **Keystroke sanctity:** the bolt reposition stays RAF-coalesced + placement-equality-bailed — only the resting offset
  constant changes, not the cadence ([SelectionActionsMenu.tsx](src/components/SelectionActionsMenu.tsx); CLAUDE.md margin-bolt note).
- **Min-floor regression:** an unconditional floor would force visible margins in zen reading and waste space in the
  read-only library reader → gate on marker visibility (§4.1).
- **Confirm `host.right` vs `editorCol.right`:** the marker lane assumes the marginalia host's right edge ≈ the editor
  column's right edge (the screenshot supports it). Implementer should confirm live and, if the pod is inset, reserve
  the gutter relative to whichever edge the scrollbar uses.
- **Tests:** assert (a) right marker column's right edge ≤ `editorCol.right − SCROLLBAR_GUTTER`; (b) bolt x-range does
  not intersect the marker grid; (c) clamped right margin ≥ `MARGINALIA_MIN_MARGIN_RIGHT` when markers visible.
  Live feel-check at default + dragged-to-minimum margins, narrow viewport, and with a selection on a marker line.

## 7. Open questions
1. In which modes are marginalia markers hidden (zen/reading/library-reader)? Determines where the min-floor applies (§4.1).
2. Should the bolt sit **left of** the marker grid (in the margin, toward the text) or get its own slot — i.e. what's the
   intended visual relationship between ⚡ and the markers when both are on the same line?
3. Touch targets: keep the scrollbar gutter at 9px, or widen for easier grabbing (knock-on to the marker lane width)?
