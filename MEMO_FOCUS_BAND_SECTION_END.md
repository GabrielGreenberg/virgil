# Bug: dragging the Focus band's bottom edge onto a section stops at the header, not the section's end

> **STATUS: LANDED** — branch `bugsweep-2026-06-26`, commit `4ce81cf5`. `snapBoundary` made section-aware via the existing `regionForNode`, edge-asymmetric (top→regionStart, bottom→regionEnd); heading list threaded at the handler level (`useFocusActions`), so the OutlinePanel drag call keeps its `(edge, blockIndex)` signature. `measure()` already absorbs it (no visual jump). tsc 0, vitest green. NOT pushed/merged.

**Status:** `ROOT-CAUSE-FOUND` / `FIX-READY` — diagnosis only, NOT implemented. Bug-catcher session 2026-06-26.
**Confidence:** HIGH (full trace; the one risk — a visual jump — is ruled out by the existing `measure()` logic).
**Worktree:** TBD (touches `useFocusMode.ts` + the `onFocusSnapBoundary` wiring; small, self-contained).

---

## Request (user)

> "In focus view (in the Outline panel), when you select a range of sections, it includes the last section *header*, but not the section text itself — it should extend to the end of the section."

---

## Root cause: the band-drag (`snapBoundary`) is "row-raw", so the bottom edge snaps to the heading's index, not the section end

Focus-mode edge operations come in two flavors:
- **`moveTo` / `expandTo`** (click / shift-click an outline row) resolve a heading through `regionForNode` → `sectionRange` ([useFocusMode.ts:128-170](src/hooks/useFocusMode.ts:128)), so a heading expands to `[headingIndex, sectionEnd]` (the block before the next same-or-higher heading). **These are section-aware and already correct.**
- **`snapBoundary`** (dragging the band's top/bottom handle) is deliberately **"row-raw — no section re-expansion"** ([useFocusMode.ts:332-353](src/hooks/useFocusMode.ts:337)): it sets the edge to the **bare `blockIndex`** of the outline row under the handle.

The outline only renders **heading** (and optional **parTitle**) rows — never the body paragraphs. So when you drag the **bottom** edge down to include a section, it snaps to that section's **header row**, and `snapBoundary("bottom", headerIndex)` sets `endBlockIndex = headerIndex` ([useFocusMode.ts:348](src/hooks/useFocusMode.ts:348)). The drag-commit path confirms it passes the raw row index: `onSnapBoundary(drag.edge, drag.pendingBlockIndex)` where `pendingBlockIndex = row.blockIndex` ([OutlinePanel.tsx:1422-1465](src/panels/Outline/OutlinePanel.tsx:1422)).

**Concrete:** sections H1(block 0, body 1-3), H2(block 4, body 5-7), H3(block 8…). Drag the band from H1 down to H2 → bottom snaps to H2's row → `endBlockIndex = 4`. Focus region = blocks 0-4 = H1 + body + **H2's header only**, excluding H2's body (5-7). That is exactly *"includes the last section header, but not the section text."*

(Shift-click `expandTo` to H2 would instead give `endBlockIndex = 7` — correct. So the bug is specifically the **drag-resize** path; if the user used shift-click they'd see correct behavior. The drag is the natural "select a range" gesture, hence the report.)

## The deep framing: a heading row's extent is edge-asymmetric

A heading row "owns" the range `[sectionStart, sectionEnd]`. Which end the band edge should snap to **depends on the edge**:
- **TOP** edge on a heading → `sectionStart` (= the heading index). The current row-raw value is already this — correct.
- **BOTTOM** edge on a heading → `sectionEnd` (the last body block). The current row-raw value is the header index — **wrong**.

The current model treats both edges as the bare heading index — correct for the top edge, wrong for the bottom. (For a **parTitle / paragraph** row, `regionForNode` returns `[block, block]`, so both edges stay row-raw — preserving sub-section precision, which we want to keep.)

## Recommended fix — make `snapBoundary` section-aware via the SAME `regionForNode` the other ops use

Unify the drag with the click/shift-click model. Re-thread `headings` + `totalBlocks` into `snapBoundary` (reverting the "no args / row-raw" simplification — that simplification *is* the bug) and resolve the snapped row through `regionForNode`, edge-asymmetrically:

```ts
const snapBoundary = (
  edge: "top" | "bottom",
  blockIndex: number,
  headings: { index: number; level: number }[],
  totalBlocks: number,
) => {
  const doc = editorRef.current?.state?.doc;
  if (!doc) return;
  update((s) => {
    if (!s.active || s.locked) return s;
    const cur = resolveFocusBand(doc, s) ?? { startIdx: 0, endIdx: doc.childCount - 1 };
    const [regionStart, regionEnd] = regionForNode(blockIndex, headings, totalBlocks);
    if (edge === "top") {
      const newStart = Math.min(regionStart, cur.endIdx);   // heading → section start (unchanged)
      return bandFromIndices(doc, newStart, cur.endIdx, true, s.locked);
    }
    const newEnd = Math.max(regionEnd, cur.startIdx);        // heading → section END (the fix)
    return bandFromIndices(doc, cur.startIdx, newEnd, true, s.locked);
  });
};
```

This makes the drag consistent with `moveTo`/`expandTo` (all three now resolve a row through `regionForNode`), so "selecting" a section via *any* gesture includes its full body. parTitle/paragraph rows stay row-raw (region = `[block, block]`), preserving mid-section precision.

### Why it's low-risk: no visual change, no jump
The band's visual rect is measured as the last **visible** outline row with `blockIndex ≤ endBlockIndex` ([OutlinePanel.tsx:1357-1369](src/panels/Outline/OutlinePanel.tsx:1357), `botEl`). With `endBlockIndex` extended to the section end (a paragraph with no row), `botEl` resolves to the **same heading row** the drag snapped to (it's the last visible row ≤ sectionEnd, since the next heading is > sectionEnd). So the committed band paints identically to the transient drag rect → **no visible jump** (the [OutlinePanel.tsx:1461-1464](src/panels/Outline/OutlinePanel.tsx:1461) "same snapped row → same rect" invariant still holds). The only thing that changes is the **confined region** the editor focus plugin uses — which now correctly includes the section body. The outline dim/cull logic (`node.index > endBlockIndex`, [OutlinePanel.tsx:699-701](src/panels/Outline/OutlinePanel.tsx:699)) also stays correct: the next heading (index > sectionEnd) remains outside.

## Wiring to update
- [useFocusMode.ts:337-353](src/hooks/useFocusMode.ts:337) `snapBoundary` — signature + body as above.
- [OutlinePanel.tsx:1465](src/panels/Outline/OutlinePanel.tsx:1465) `onSnapBoundary(drag.edge, drag.pendingBlockIndex)` → pass `headings` + `totalBlocks` (OutlinePanel already has both).
- The `onFocusSnapBoundary` prop type through `outline-host.tsx` → `EditorPane`/`EditorLayout` (the `useFocusActions` handler that calls `snapBoundary`).

## Tests
- `snapBoundary("bottom", headingIndex, headings, total)` → `endBlockIndex === sectionRange(heading).end` (the section's last body block), not `headingIndex`.
- `snapBoundary("top", headingIndex, …)` → `startBlockIndex === headingIndex` (unchanged).
- `snapBoundary("bottom", parTitleIndex, …)` → ends at `parTitleIndex` (sub-section precision preserved).
- Locked band → no-op (existing guard).
- Visual: a drag ending on a heading paints the band to that heading's row both during drag and after commit (no jump).

## Repro
Open a multi-section doc; activate Focus in the Outline; drag the band's **bottom** handle down so it snaps onto a later section's heading row. The editor focus region includes that heading but dims/excludes its body paragraphs. (Shift-clicking the same heading instead correctly includes the body — confirming the drag path is the culprit.)
