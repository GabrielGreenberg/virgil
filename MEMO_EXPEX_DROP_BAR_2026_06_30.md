# expex drop-bar width: sibling-insert below an `ex` reads "short" — 2026-06-30

Bug-catcher session. One item on the example (`ex`/expex) drag-drop indicator.
Research only — **no code edited**. For the bug-cleaning session. HEAD at
diagnosis: `a69ea9e5` (main, clean).

## Status: `ROOT-CAUSE-FOUND` (high confidence)

**Symptom:** dragging an `ex` example and dropping it **below another `ex`** shows
a **short** blue bar; the user expects a **full-width** bar (across the page),
because this is a *sibling* insertion — same as dropping below a paragraph, which
correctly shows the full-width bar. The short bar should be **reserved for adding
a sub-example** into an existing example.

## Root cause

The sibling-insert (between-blocks) indicator bar takes its **width from the
dragged-over block's own content box**, which for an example is short/indented;
for a paragraph it's the full prose column. So the *same* affordance ("insert a
top-level sibling here") renders full-width below a paragraph but stubby below an
example — and the stubby bar reads like the sub-example affordance.

**Trace (dragging a top-level `\ex`, i.e. source kind `exampleBlock`):**
1. Grab-handle drag → drop-mode → [hitTest()](src/components/drop-mode/hit-test.ts#L41).
2. `resolveSubItemPeerBlock` → null (`exampleBlock` is not `isSubObject`); `resolveBlockIntoExpex` → null (`exampleBlock` ∉ `EXPEX_DROP_KINDS = {paragraph, graphicsBlock, displayMath}`, [:320-324](src/components/drop-mode/hit-test.ts#L320)). So the example-drag does **not** use the expex into/new-item bars at all.
3. Falls through to `resolveAnchorableBlock` → gap below example B → **[makeBetweenBlocksPlacement()](src/components/drop-mode/hit-test.ts#L624)**.
4. There, `const frame = resolveContentEdges(block.dom)` and `width: Math.max(frame.contentWidth, 3)` ([:655-665](src/components/drop-mode/hit-test.ts#L655)).
5. **[resolveContentEdges()](src/text-objects/block-frame.ts#L365)**: for an `exampleBlock` (a `CONTAINER_KIND`, [block-frame.ts:153-157](src/text-objects/block-frame.ts#L153)), `resolveFirstLineTarget` descends to the example's **first item's inner `<p>`** ([:180-189](src/text-objects/block-frame.ts#L180)); `contentWidth = firstLineRect.width` is that element's box — **short** (a one-line example) and **indented** (past the `(n)` label), not the full prose column.
6. For a **paragraph**, the same target is the `<p>` that fills the text column → `contentWidth` ≈ full column → full-width bar. Hence the asymmetry the user sees.

[Indicator.tsx](src/components/drop-mode/Indicator.tsx#L32) just paints `rect.width`/`rect.height` literally (and flips vertical when `height > width`), so the stubby width comes entirely from the placement.

**Behavior vs visual:** the *drop action* is likely correct — `applyDrop` classifies the top-level insert pos (parent `doc`) → `top-level` → `topLevelDropAdapter` → drop-direct → inserts a top-level **sibling** ([textobject.ts:58-135](src/components/drop-mode/specs/textobject.ts#L58)). So this is a **visual/affordance** bug: the bar misrepresents a correct sibling insert as the short (sub-example-looking) bar. The cleaning session should confirm the drop really lands as a sibling, not nested.

## The unified deep fix

**Bar WIDTH should encode insert SCOPE, decoupled from the neighbor block's text length:**

- **Top-level / outer-tier sibling insert** → bar spans the **full prose column** (column-left → column-right), page-wide — identical for paragraph, example, heading, figure. This is "a new top-level block lands here."
- **Sub-tier sibling insert** (dragging a sub-item among peer items) → bar spans the **item column** (indented, narrower).
- **Into-container insert** (genuine sub-example / sub-block) → the **short vertical/indented** tick. This is the bar the user wants *reserved*.

Concretely:
1. In `makeBetweenBlocksPlacement` ([hit-test.ts:624](src/components/drop-mode/hit-test.ts#L624)), for a **top-level** insertion the bar's x/width should be the **prose-column** edges, not `frame.contentLeft`/`frame.contentWidth` of the (short/indented) neighbor. Keep `contentLeft` only for the **sub-item peer** path (`snapToMidpoint`/R3), where indented item-width is correct.
2. For consistency, `makeExpexNewItemPlacement` ([:584-598](src/components/drop-mode/hit-test.ts#L584)) — the "new sibling ITEM" horizontal bar — should likewise span the item column rather than the (possibly short) `item.contentWidth`, so "new sibling item" also reads full-width within the example.
3. Leave `makeExpexIntoItemPlacement` ([:607-618](src/components/drop-mode/hit-test.ts#L607)) and the single-example into-body bar ([:477-497](src/components/drop-mode/hit-test.ts#L477)) as the **short vertical** affordance — these ARE the "add a sub-example/sub-block" bars the user wants the short shape reserved for. (The A3 redesign already encodes orientation = meaning for the *text-into-example* drag; this fix extends the same principle — width/orientation = scope — to the *example-as-sibling* drag.)

**Where to get the prose-column width:** there's no column-width field on `BlockFrame` today (it only exposes the neighbor's `contentLeft/contentWidth/contentRight`). Options for the cleaning session: (a) measure the editor's prose content box — `editor.view.dom` (`.ProseMirror`) border box minus padding — for the column left/right; (b) add a `columnLeft`/`columnRight` to the frame primitive resolved from the editor content element; (c) reference a known full-width block. Prefer (a)/(b) so the column metric is a single shared source (consistent with block-frame.ts's "one canonical geometry source" doctrine).

## Surgical fix (if deferred)

In `makeBetweenBlocksPlacement`, when the resolved `block` is an `exampleBlock`/`exampleItem` at top level (or more generally whenever the insert is a top-level sibling), set `rect.x` = prose-column-left and `rect.width` = column width instead of `frame.contentLeft`/`frame.contentWidth`. Narrow, but doesn't unify the analogous `makeExpexNewItemPlacement` short-item case.

## Live-verify (PROD FSA — drop/anchor geometry can mask in the dev preview)
- Drag a top-level `\ex` and hover the gap **below another `\ex`** → bar must span the **full page/column width** (matching the below-a-paragraph bar), and the drop must land as a **top-level sibling**.
- Drag **text/picture/equation INTO** an example → the **short** affordances must still appear: vertical into-item bar (middle band) and horizontal new-item bar (top/bottom band), per the A3 thirds model.
- Confirm a **short one-line example** and a **long wrapped example** both now show the same full-width sibling bar (the bug was width tracking the example's text length).
- Regression: below a **paragraph**, **heading**, **list**, **figure** — sibling bar unchanged (still full-width); sub-item-among-peers drop still indented.
- Measure live: `resolveContentEdges(exampleBlock.dom).contentWidth` vs a paragraph's — confirm the example value is the short/indented one (root cause), and that the example body `<p>` is the resolved target.
