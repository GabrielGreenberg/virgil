# Note marginalia place above target (settle-then-jump-up) — 2026-06-30

Bug-catcher session. **Generalizes and supersedes** batch item (2) ("notes
attach to the section divider") — the same defect, now reported for **all** note
marginalia, not just headings-with-dividers. Research only — **no code edited**
(checkout live-driven, HEAD 1b776636). For the bug-cleaning session.

## Status: `DIAGNOSED` — architecture ROOT-CAUSE-FOUND (high); exact settle-trigger MEDIUM

**Symptom:** note margin markers render in the **correct** place for ~a second,
then **jump UP** (above the anchor line). General across notes, worsened / most
visible on section titles when dividers are on.

## Architecture (why "jump" = a re-measure disagreeing with itself)

There is exactly **one** measurement function and **one** render path:
- Measure: `measureBlock()` ([useMarginaliaRegistry.ts:184-269](src/hooks/useMarginaliaRegistry.ts#L184)), run inside a RAF flush (`flushRecompute`, :391) that is driven by IntersectionObserver / **ResizeObserver** (:729,:779) / structural txns. It writes `{top, lineHeight, lineCount,…}` to a cache; a marker only moves when a re-measure changes those.
- Position: `cellAt()` ([marginalia-grid.ts:51-76](src/lib/marginalia-grid.ts#L51)) → `y = node.top + row·lineHeight + (lineHeight − ICON_SIZE)/2`.
- Render: `top: cell.y` verbatim ([Marginalia.tsx:254](src/components/Marginalia.tsx#L254)) — **no transform, no offset, no CSS transition** on Y.

So the two-phase "correct → jump up" is **two invocations of `measureBlock` for the same block returning different `top` (or `lineHeight`)**: the first (first paint) is right; a later RAF re-measure (fired by the ResizeObserver ~a second in) returns a value that puts the icon higher.

## Two structural smells (either/both produce the jump)

**Smell 1 — `top` is read from two different reference points depending on branch** ([measureBlock](src/hooks/useMarginaliaRegistry.ts#L228-244)):
- plain prose (`measureEl === dom`): `top = editor.view.coordsAtPos(pos+1).top − hostRect.top` (:242) — a **glyph/caret-line** top;
- wrapper / heading / `[data-glyph-anchor]` kinds: `top = element.getBoundingClientRect().top − hostRect.top` (:233,:240) — a **border-box** top.

These reference points differ by ~half-leading + padding. If the block's DOM **branch changes between the two RAFs** — e.g. first paint measures the bare `<p>` (coordsAtPos branch) but after the React NodeView / title-wrapper / decoration mounts the `dom` becomes a wrapper and it switches to the `getBoundingClientRect`/`[data-glyph-anchor]` branch — the reference point flips and the marker jumps. For kinds with chrome **above** the pod (`[data-glyph-anchor]`, titled blocks, exampleBlock `(n)`), the override top is the **wrapper/pod visual top, above the body line** → an **upward** jump, exactly the symptom. On a heading with a **divider** the wrapper gains a large `margin-top` + a `::before` divider (globals.css `.show-dividers-N`), amplifying it (this is why batch item 2 read as "attaches to the divider").

**Smell 2 — marginalia centers on the LINE-BOX, not the optical cap-band, and is a SEPARATE measurement path from the grab handles.** `cellAt` uses `(lineHeight − ICON_SIZE)/2`; the grab handles use the canonical `resolveBlockFrame()` / `text-metrics.ts` optical center (`firstLineRect.top + capTopOffset + capHeight/2`) and **do not jump**. Two independent measurement implementations for the same anchor line is the root disease (same class as the [[ui_geometry_bugsweep_2026_06_30_status]] duplicated-geometry bugs and batch item 2): the grab-handle path is stable/correct; marginalia re-derives geometry its own way and lands on a different reference on re-measure.

## Deep fix (one fix, covers this + batch item 2 + the h4-h6 miss)

**Unify marginalia measurement onto the grab-handle SSOT** — measure the anchor line via `resolveBlockFrame()` / `resolveInlineContextElement()` ([block-frame.ts](src/text-objects/block-frame.ts), [text-metrics.ts](src/lib/text-metrics.ts)) and anchor markers to the **optical center** the handles already use, instead of `measureBlock`'s two-branch `coordsAtPos`/`getBoundingClientRect` + line-box centering. Then:
- notes align **identically to the grab handle** on every kind (paragraph, heading, titled, blockquote, exampleBlock) — and stay put on re-measure because both passes read the same stable reference;
- the divider case (batch item 2) falls out — the SSOT measures the heading text's own first-line box, never the wrapper margin / divider chrome;
- the latent **h4-h6 miss** (`measureBlock` only queries `h1,h2,h3` at :217) is fixed for free (`resolveInlineContextElement` handles h1-h6).

**Surgical (if not unifying now):** make `measureBlock` use ONE reference point for all kinds (prefer the resolved inner element's `getBoundingClientRect().top`, matching block-frame), drop the `coordsAtPos` branch so first-paint and settle can't disagree, and ensure the `[data-glyph-anchor]` override is applied on the FIRST measure too (not introduced on a later RAF). But this re-implements what block-frame already does — the deep unify is the real fix.

## Nail the exact trigger — live instrumentation (preview is up on :3000)

Because the settle-trigger direction is timing-dependent, capture it live rather than infer:
1. Load the dev doc; add a note to a plain paragraph. In DevTools console, watch the marker's computed `top` across the jump.
2. Instrument `measureBlock` (temp `console.log` of `uuid, top, domTop, lineHeight, measureEl.tagName/className, branch`) OR read `window.__marginaliaStats()` (`recomputes`/`version`) to confirm a **second** RAF flush fires ~1s after load and changes `top`.
3. Determine what changes between the two flushes: (a) the DOM branch (bare `<p>` → wrapper/`[data-glyph-anchor]`), (b) a font swap altering `coordsAtPos`/`lineHeight`, or (c) an image/late layout above. (a) is the leading hypothesis and produces an *upward* jump.
4. **Verify under real FSA too** ([[anchor_persistence_dev_masks_fsa]]) — anchor geometry can mask in the preview iframe; confirm the grab handle on the SAME block does NOT jump (that asymmetry confirms the divergent-path root).

Ties to [[marginalia_omni_flash_status]] (a prior "NOTE cards flash at top" fix used live-pos over a stale baked pos — same family: a stale/second measurement moving markers to the top) and batch item (2) in [[bug_batch_2026_06_30_status]].
