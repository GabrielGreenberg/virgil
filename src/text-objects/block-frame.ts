/**
 * block-frame.ts — the ONE canonical per-block geometry source for every
 * margin affordance (grab handle, drop indicator, and figure chrome).
 * Resolve a block's frame once and every affordance
 * reads the SAME numbers, so they align BY CONSTRUCTION rather than by
 * coincidence (the bug this replaces: each handle measured its own block,
 * so a container and its first item only happened to land within ~2px).
 *
 * Chip 1 built the VERTICAL axis (`opticalCenterY`); chip 2 adds the
 * HORIZONTAL axis — `contentLeft` (the block's text-start X), a MEASURED
 * `markerLeft` (the block's leftmost marker glyph: bullet band / `(n)` /
 * `a.` / plain text), and `gapPx` (the em handle-gap resolved against THIS
 * block's font). Every margin affordance now hugs `markerLeft − gapPx − <its
 * own width>`, so a container and its first item align BY CONSTRUCTION. All
 * fields are viewport-space and resolvable from `el` + ancestry alone.
 *
 * Chip 4a wires the DRAG DROP-INDICATOR onto the same frame: the between-blocks
 * bar and the expex drop bars now take their x from this `contentLeft` and
 * their span from `contentWidth`, so the drop bar lines up with the grab
 * handles (and the block content) by construction rather than via an
 * independent `getBoundingClientRect().left` measurement (the §4 bug). The drop
 * path reads only `contentLeft` / `contentWidth`, so it can take the lean
 * {@link resolveContentEdges} door directly (see {@link resolveBlockFrame}).
 *
 * Chip 4b wires the FIGURE CHROME onto the same frame: the controls that sit
 * BESIDE a figure/graphics block anchor their "beside" left to the figure box's
 * content-RIGHT edge ({@link BlockFrame.contentRight} = `contentLeft +
 * contentWidth`), so the chrome hugs the rendered image's right edge the way the
 * grab handle hugs the marker on the LEFT — both from one resolve, no parallel
 * measurement to drift. One subtlety the chrome handles at its call site: a
 * figure's canonical `[data-uuid]` node DOM is the full-COLUMN-width
 * `.react-renderer` host (the box the drop indicator correctly spans for a
 * full-width insert bar), so the chrome resolves the frame on the INNER
 * `.figure-block` hug box — whose right edge IS the image — rather than on the
 * host. `resolveFirstLineTarget` is therefore left untouched (descending it to
 * the hug box would shrink the drop indicator's figure-adjacent bar to image
 * width — a chip-4a regression).
 *
 * KEYSTROKE SANCTITY (AGENTS.md): resolution is pure DOM + ancestry —
 * O(1)/O(depth), NEVER O(doc). The resolver runs on the hover/scroll/RAF
 * placement path, which already holds the block's DOM element; it must
 * never walk the document (`doc.descendants`) or do work proportional to
 * doc size.
 */

import {
  capBandCenterOffset,
  measureTextWidth,
  resolveInlineContextElement,
} from "@/lib/text-metrics";
import { FOLD_CHEVRON_NODE_TYPES } from "@/lib/node-attr-sets";

/**
 * Per-block geometry, all in VIEWPORT coordinates — the ONE source every
 * margin affordance reads, so they align by construction.
 */
export interface BlockFrame {
  /** The block's outer DOM element (the `[data-uuid]` node DOM — the same
   *  element `editor.view.nodeDOM(pos)` returns, since `data-uuid` is a
   *  node decoration). */
  el: HTMLElement;
  /**
   * The inline-context text element whose first line defines the frame — the
   * result of `resolveFirstLineTarget(el)` (for a container, its first
   * grabbable child's first-line element). Exposed so a consumer that needs
   * the resolved font target (the selection grab handle's optical-center read)
   * reads it from the ONE resolve rather than re-descending via
   * `resolveInlineContextElement`. Same element `ContentEdges.target` carries.
   */
  target: HTMLElement;
  /**
   * The resolved text element's border box (`getBoundingClientRect`). Its
   * `.top` is the FIRST VISUAL TEXT LINE's line-box top and `.left` is the
   * content-left; for a multi-line block the box spans every line (chip 2
   * can refine to a true single-line rect if it needs the height). For a
   * container block (`bulletList` / `orderedList` / `exampleBlock`) this is
   * resolved from the first grabbable child — the row the user actually sees
   * — so a container and its first item share one frame.
   */
  firstLineRect: DOMRect;
  /**
   * Optical (cap-band) center Y of the first visual text line:
   * `firstLineRect.top + capBandCenterOffset(target)` (i.e. the shared
   * `opticalCenterY(firstLineRect.top, target)` primitive). THE canonical
   * vertical anchor for margin chrome — center an affordance's glyph on
   * this and it sits on the optical middle of the text it labels,
   * independent of font size / line-height.
   */
  opticalCenterY: number;
  /**
   * The block's text content-left in viewport coords (= `firstLineRect.left`).
   * For a markerless block (paragraph / heading / blockquote / codeBlock /
   * titleField / framed atom) this IS the marker reference; exposed separately
   * from {@link markerLeft} so the drop indicator (chip 4a) can anchor to
   * text-start. (Grab handles — text-object AND selection — hug {@link markerLeft},
   * not this: the selection handle takes the same gutter slot as its block's
   * text-object handle. See `handle-layout.ts#resolveHandleMarkerLeft`, task 092.)
   */
  contentLeft: number;
  /**
   * The block's content-box WIDTH in viewport coords (= `firstLineRect.width`,
   * i.e. `contentRight − contentLeft`). The HORIZONTAL drop indicator (chip 4a)
   * spans this — the between-blocks bar and the expex new-item bar derive their
   * width from the frame's content extent, the same source as {@link contentLeft},
   * so the bar hugs the text column rather than an independently-measured box.
   */
  contentWidth: number;
  /**
   * The block's content-RIGHT edge in viewport coords (= `contentLeft +
   * contentWidth` = `firstLineRect.right`). The figure chrome (chip 4b) anchors
   * its "beside" control row here — `.figure-chrome-beside` sits at
   * `contentRight + gap`, hugging the rendered figure box's right edge, the
   * mirror of the grab handle hugging {@link markerLeft} on the LEFT, both from
   * one frame. Exposed so the chrome (and any future right-hugging affordance)
   * needn't recompute `contentLeft + contentWidth`.
   */
  contentRight: number;
  /**
   * The MEASURED left edge of the block's leftmost rendered marker — the
   * single horizontal anchor every margin affordance hugs. Per kind:
   *   • exampleBlock → its `(n)` number (`.expex-number`) left.
   *   • exampleItem  → its `a./b.` marker (`.expex-item-marker`) left.
   *   • listItem     → the bullet band: the parent list's marker indent,
   *     anchored at the MIDDLE of the measured `padding-left` band
   *     (`li.left − padding-left / 2`). The `::marker` pseudo isn't
   *     rect-able, so we never read a hardcoded glyph width — the band is
   *     em-scaling and reliably between its left edge and the `<li>` content.
   *     Where that assumption doesn't hold (a wide `10.`), {@link inkLeft}
   *     carries the tighter MEASURED boundary; this anchor is unchanged.
   *   • listItem → the MEASURED left edge of its marker string (task 487; the
   *     band middle survives only as the fallback where nothing can measure).
   *   • bulletList / orderedList (markerless container) → its own border-box
   *     left, which is the content edge of the level above it. Consumed only
   *     when {@link columnRight} is `null` (a top-level list, or one inside a
   *     markerless container): the list then reads as an ordinary markerless
   *     block and takes the same gutter slot every paragraph takes.
   *   • everything else (no marker) → `contentLeft`.
   * An affordance's left edge = `markerLeft − gapPx − <its own width>`, so its
   * RIGHT edge sits one uniform {@link gapPx} left of the marker.
   */
  markerLeft: number;
  /**
   * Task 487 — the inner (right) edge of the MARKER COLUMN this block's handle
   * OCCUPIES, or `null` when the handle hugs a marker instead.
   *
   * A block with a marker of its own has a FULL column on its row — the glyph
   * is in it — so its handle steps outboard and hugs it ({@link markerLeft}).
   * A markerless CONTAINER has no glyph on this row at all: its own marker
   * column is the one belonging to the level above, whose glyph sits a row up,
   * so the column is empty here and the handle can sit IN it, right-justified
   * to this edge. That is Gabriel's ruling — "the outer grab handle should
   * justify right under the bullet point above" — and it is what makes
   * non-overlap STRUCTURAL rather than a separation constant: two levels sit in
   * two different columns.
   */
  columnRight: number | null;
  /**
   * Task 526 — the INNER (right) edge of the fold-chevron COLUMN reserved on
   * this row, or `null` when this row renders no chevron.
   *
   * The left margin has TWO occupants and, since 526, ONE resolution: the
   * chevron column is fixed and outboard (`--margin-col-chevron` +
   * `--margin-col-chevron-width`, a px column measured from the block's own
   * left edge), and the grab handle takes what remains inboard of it — its
   * resting position is clamped there and its hit/hover halo is capped there
   * (`handle-layout.ts#resolveHandleLane`). That is the LEFT margin's reading
   * of the lane law the right margin already states (`resolveRightLane`,
   * AGENTS.md → "The ordering half").
   *
   * Reserved per ROW rather than app-wide, and the gate is a KIND
   * ({@link FOLD_CHEVRON_NODE_TYPES}) rather than a DOM probe, for the reason
   * `glyph-anchor.ts` is kind-gated: an unconditional
   * `querySelector(".source-pod-fold-chevron")` walks a source pod's whole
   * CodeMirror subtree once per hover placement. A prose row therefore keeps
   * its full halo — which at a large `--editor-font-size` is 10px per side the
   * unconditional reservation would have taken for a chevron that is not there.
   *
   * Stated limit: the column is measured from the block's own border-box left,
   * which is where the chevron's positioning ancestor sits for both renderers
   * (`.heading-wrapper` IS the block element; `.source-pod` fills its wrapper's
   * content box). A future chrome that insets its chevron from that edge would
   * be reserved slightly outboard of where it renders.
   */
  chevronRight: number | null;
  /**
   * The left edge of the row's leftmost DOCUMENT INK — the boundary no margin
   * affordance may cross (task 382). {@link markerLeft} is the anchor an
   * affordance HUGS; this is the line it must never be pushed past, and the two
   * are resolved together (`resolveMarkerGeometry`) so the anchor and the
   * boundary can never disagree. They differ only where the anchor is a
   * heuristic rather than a measurement:
   *   • a MEASURED marker (`.expex-number` / `.expex-item-marker`) → `inkLeft
   *     === markerLeft`: the marker's own rect IS the ink.
   *   • a list `<li>` → the anchor is the band MIDDLE (the `::marker` pseudo
   *     has no rect), which assumes the glyph stays in the band's right half.
   *     That holds for a `•` and is FALSE for a wide `10.`, so the ink boundary
   *     also takes the MEASURED marker-string width when it reads further left
   *     (never further right — a measurement may only tighten the heuristic).
   *   • a markerless container (`<ul>`/`<ol>`) → its first row's ink is its
   *     ITEM's bullet: same row, same boundary, one step outboard anchor.
   *   • everything else → `contentLeft` (the prose itself is the ink).
   */
  inkLeft: number;
  /**
   * `--margin-handle-gap` resolved (em → px) against THIS block's font, so the
   * gap scales with the labeled text — every prose block shares one value (a
   * uniform gap), a larger heading font widens it proportionally. The shared
   * horizontal gap for every affordance on this row.
   */
  gapPx: number;
}

/**
 * Container kinds whose own first visual line lives in their first
 * grabbable child rather than in any text of their own: a `<ul>`/`<ol>`
 * has no text line, and an `.expex-block`'s only direct text is the `(n)`
 * chip (rendered at `0.95em` — the wrong metrics to anchor chrome to).
 * Resolving THROUGH to the first child's first line makes a container and
 * its first item produce the SAME `opticalCenterY` by construction.
 *
 * Mirrors the sub-object `parentKind`s in `TEXT_OBJECT_REGISTRY`
 * (`listItem`→`bulletList`, `exampleItem`→`exampleBlock`), plus
 * `orderedList`, which is structurally identical to `bulletList`.
 */
const CONTAINER_KINDS = new Set<string>([
  "bulletList",
  "orderedList",
  "exampleBlock",
]);

/**
 * A grabbable child = any descendant carrying a real TextObject identity
 * (the `data-uuid` + `data-text-object-kind` decoration pair), excluding
 * the mark-backed `linkedRange`. `querySelector` short-circuits at the
 * FIRST match in document order, so this is O(distance-to-first-item),
 * never O(items) — a 200-item list resolves as fast as a 2-item one.
 */
const GRABBABLE_CHILD_SELECTOR =
  '[data-uuid][data-text-object-kind]:not([data-text-object-kind="linkedRange"])';

/** Recursion guard for container-in-container descent (defensive; real
 *  nesting is shallow). */
const MAX_CONTAINER_DESCENT = 8;

/**
 * Resolve the text-bearing element whose first line defines the block's
 * optical center — **its OWN first visual line**, always (task 394).
 *
 * For a container, that line lives in its first grabbable child (a `<ul>` /
 * `<ol>` has no text of its own, and an `.expex-block`'s only direct text is
 * the `(n)` chip at `0.95em` — the wrong metrics to anchor chrome to), so the
 * descent recurses to the first child in DOCUMENT order; otherwise it descends
 * wrapper NodeViews to the inline-context element via the shared
 * `resolveInlineContextElement`.
 *
 * There is no per-hover HINT, and its absence is the whole of task 394. Task
 * 353 had added a `descendTo` parameter so a container's chrome anchored to the
 * row the POINTER was on — which made "a container and its item share one Y"
 * true at every row, and on a NESTED list stacked one handle per containing
 * level onto that single row (Gabriel's screenshot: four levels, three handles
 * bunched on "locations", the innermost pushed onto the bullet). His
 * renegotiated spec is HIERARCHICAL: every handle sits beside its OWN
 * structure's first line, so the gutter reads as a structural breadcrumb — the
 * outer list beside the outer list's top row, the inner list beside ITS top
 * row, and exactly one handle on the hovered (lowest) node. That is a rule with
 * no special case, which is why it is a DELETION rather than a layout pass on
 * top of the stacking.
 *
 * The same-row machinery (`applySameRowSeparation` + the task-382 ink cap) still
 * governs GENUINE coincidences — hovering a list's first row, or a container
 * whose first child is itself a container — where two levels legitimately share
 * one line. With the levels distributed vertically those cases are ≤2 handles in
 * practice, which is what makes both mechanisms sufficient.
 */
function resolveFirstLineTarget(el: HTMLElement, guard = 0): HTMLElement {
  if (guard < MAX_CONTAINER_DESCENT) {
    const kind = el.getAttribute("data-text-object-kind");
    if (kind && CONTAINER_KINDS.has(kind)) {
      const child = el.querySelector<HTMLElement>(GRABBABLE_CHILD_SELECTOR);
      if (child) return resolveFirstLineTarget(child, guard + 1);
    }
  }
  return resolveInlineContextElement(el);
}

/**
 * Task 425 — is `item`'s line `container`'s TOP ROW?
 *
 * The grab-handle hover SET asks this of every containing level above the
 * hovered item: a container's handle shows ONLY when the hovered line is that
 * container's own top row (Gabriel's rule, superseding task 394's "one handle
 * per containing level"). "Top row" is STRUCTURAL — the container's first
 * ITEM, not its first visual line — so a wrapped first item hovered on its
 * second visual line still answers true, and the answer needs ZERO rect
 * reads.
 *
 * It is literally the descent `resolveFirstLineTarget` performs to PLACE a
 * container's handle, read as a predicate: walk `GRABBABLE_CHILD_SELECTOR`
 * down from `container` through any intermediate containers and ask whether
 * it arrives at `item`. Sharing the chain is the point — "is this the top
 * row" and "where does the container's handle go" cannot disagree, because
 * a container's handle sits beside the very element this walk reaches.
 * O(depth), bounded by `MAX_CONTAINER_DESCENT` like the resolver it mirrors.
 *
 * A non-container ancestor (an outer `listItem` above a nested list) answers
 * `false` unless it IS the item: an item has no "top row" of its own to grant,
 * which is what keeps the set ≤2 on every row under the list schema (a
 * `listItem`'s first child is a paragraph, so no line is the top row of two
 * nested lists at once).
 */
export function isTopRowOf(container: HTMLElement, item: HTMLElement): boolean {
  let cur = container;
  for (let guard = 0; guard <= MAX_CONTAINER_DESCENT; guard++) {
    if (cur === item) return true;
    const kind = cur.getAttribute("data-text-object-kind");
    if (!kind || !CONTAINER_KINDS.has(kind)) return false;
    const child = cur.querySelector<HTMLElement>(GRABBABLE_CHILD_SELECTOR);
    if (!child) return false;
    cur = child;
  }
  return false;
}

/**
 * First-line rect of a text-bearing element. Use `getBoundingClientRect()`:
 * its `.top` is the first line's LINE-BOX top — exactly what `capTopOffset`
 * expects as its base (it adds the half-leading from there). `resolveInline-
 * ContextElement` has already descended past wrapper padding (e.g. `<pre>` →
 * `<code>`) to a text element with no top padding, so the border-box top IS
 * the line-box top.
 *
 * Do NOT use `Range.selectNodeContents(el).getClientRects()[0]` here: on an
 * inline-text element (a prose `<p>`) the browser returns the tight GLYPH
 * RUN (≈ font bounding box), whose top sits ~half-leading BELOW the line-box
 * top — feeding that into `+ capTopOffset` double-counts the leading and
 * drops the anchor ~2px (MEASURED: a 15.2px prose `<p>` in a 24.32px line
 * box reads a run top 2px below its `getBoundingClientRect().top`). The
 * border box is the line box; the glyph run is not.
 */
function firstLineRectOf(target: HTMLElement): DOMRect {
  return target.getBoundingClientRect();
}

/** Fallback px for the em margin tokens when the custom property is missing
 *  / unreadable — the resolved values at the editor's nominal 16px font
 *  (`--margin-handle-gap: 0.625em` → 10px, `--margin-track-width: 1.25em` →
 *  20px). */
const DEFAULT_HANDLE_GAP_PX = 10;
const DEFAULT_TRACK_WIDTH_PX = 20;
/** Fallbacks for the fold-chevron column when the tokens can't be read —
 *  mirrors `--margin-col-chevron` / `--margin-col-chevron-width` in
 *  globals.css. See {@link resolveChevronColumnRight}. */
const DEFAULT_CHEVRON_OFFSET_PX = -44;
const DEFAULT_CHEVRON_WIDTH_PX = 14;

/** Document-root font-size in px — the base a `rem`-authored token resolves
 *  against (CSS `rem` = root em). Falls back to the editor's nominal 16px when
 *  the root font-size is unreadable (SSR / stub). O(1) — one computed-style read. */
function rootFontSizePx(): number {
  if (typeof document === "undefined") return 16;
  const raw = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(raw) && raw > 0 ? raw : 16;
}

/**
 * Resolve a margin length custom property to px. The tokens are authored in `em`
 * (`--margin-handle-gap` / `--margin-track-width`) so they scale with the labeled
 * text; `getComputedStyle` does NOT resolve a custom property's `em` to px (it
 * returns the literal "0.625em"), so we resolve it here against the block's own
 * `font-size`. A `rem` token resolves against the DOCUMENT-ROOT font-size instead
 * (CSS semantics) — and MUST be matched before the `em` branch, since
 * `"1.25rem".endsWith("em")` is `true` and would otherwise mis-scale a rem token
 * against the block font-size. A px value passes through (forward-compat). O(1) —
 * reads an already-fetched computed style (+ one root read only for the rem path).
 *
 * Exported for the geometry-SSOT interpreter-hardening regression test (it asserts
 * a `rem` token resolves against root font-size, not the block font-size — the same
 * "for-test" export convention as {@link resolveMarkerGeometry}). Otherwise an internal
 * of `resolveBlockFrame`.
 */
export function resolveMarginEm(
  cs: CSSStyleDeclaration,
  fontSizePx: number,
  varName: string,
  fallbackPx: number,
): number {
  const raw = cs.getPropertyValue(varName).trim();
  if (raw.endsWith("rem")) {
    const factor = parseFloat(raw);
    return Number.isFinite(factor) ? factor * rootFontSizePx() : fallbackPx;
  }
  if (raw.endsWith("em")) {
    const factor = parseFloat(raw);
    return Number.isFinite(factor) ? factor * fontSizePx : fallbackPx;
  }
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : fallbackPx;
}

/**
 * Resolve the INNER (right) edge of the fold-chevron column reserved on this
 * row — the left margin's outboard occupant (task 526) — or `null` when the
 * row's kind renders no chevron.
 *
 * Deliberately NOT {@link resolveMarginEm}: that resolver treats a
 * non-positive px value as unreadable and falls back, and
 * `--margin-col-chevron` is authored NEGATIVE (a CSS-negative offset from the
 * block's own left edge). Both tokens are px literals, so no em/rem rung is
 * needed here; a future em spelling would want the shared resolver's ladder
 * and a signed px branch, not a second copy of it.
 *
 * `blockLeft` is the block's own border-box left, which is the origin the two
 * chevron renderers position against (see {@link BlockFrame.chevronRight}).
 */
export function resolveChevronColumnRight(
  cs: CSSStyleDeclaration,
  kind: string | null,
  blockLeft: number,
): number | null {
  if (kind === null || !FOLD_CHEVRON_NODE_TYPES.has(kind)) return null;
  const rawOffset = parseFloat(cs.getPropertyValue("--margin-col-chevron"));
  const offset = Number.isFinite(rawOffset)
    ? rawOffset
    : DEFAULT_CHEVRON_OFFSET_PX;
  const rawWidth = parseFloat(
    cs.getPropertyValue("--margin-col-chevron-width"),
  );
  const width =
    Number.isFinite(rawWidth) && rawWidth > 0
      ? rawWidth
      : DEFAULT_CHEVRON_WIDTH_PX;
  return blockLeft + offset + width;
}

/**
 * The two horizontal facts a margin affordance needs about a block's marker,
 * resolved TOGETHER so they can never disagree (task 382 — the reported bug was
 * three passes that each held a different idea of where the bullet is).
 */
export interface MarkerGeometry {
  /** See {@link BlockFrame.markerLeft} — the anchor an affordance hugs. */
  markerLeft: number;
  /** See {@link BlockFrame.inkLeft} — the boundary it may never cross. */
  inkLeft: number;
  /** See {@link BlockFrame.columnRight} — the inner edge of the marker COLUMN
   *  this block's handle occupies, or `null` when it hugs a marker instead. */
  columnRight: number | null;
}

/**
 * MEASURED geometry of a block's own marker element matched by `selector`
 * within `el`. `querySelector` returns the first match in document order —
 * the block's OWN row marker, which always precedes any nested descendant's
 * marker — so a `\pex` with sub-items reads its `(n)`, not a sub-item's `a.`.
 *
 * A measured marker's rect IS the ink, so the anchor and the ink boundary are
 * the same number here: nothing is being estimated.
 *
 * Falls back to `fallbackLeft` when the marker isn't an `HTMLElement` (a
 * transient render before the NodeView marker mounts, or an unfaithful clone
 * that stripped the chrome span). `fallbackLeft` MUST be a margin position to
 * the LEFT of the marker — NEVER `contentLeft` (the text start, RIGHT of the
 * marker), or the handle anchors INTO the content and overlaps the marker
 * (backlog #49 hypothesis 1). The marker column is one track-width wide, so the
 * caller passes `contentLeft − trackWidthPx` — the position the marker would
 * occupy — keeping the fallback handle in the margin where it belongs.
 */
function markerElementGeometry(
  el: HTMLElement,
  selector: string,
  fallbackLeft: number,
): MarkerGeometry {
  const m = el.querySelector(selector);
  const left =
    m instanceof HTMLElement ? m.getBoundingClientRect().left : fallbackLeft;
  // A block with its OWN marker HUGS it (no column to occupy — the column is
  // full of the very glyph this handle labels).
  return { markerLeft: left, inkLeft: left, columnRight: null };
}

/** The glyph a `disc`/`circle`/`square` marker renders. Measured (never a
 *  hardcoded px) so it scales with the font like everything else on this row. */
const BULLET_PROBE = "•";

/**
 * Allowance (em) for the gap a `::marker` box leaves between its glyph's right
 * edge and the item's content edge — the counter suffix's trailing space. It
 * only ever moves the measurement FURTHER LEFT, so it is a conservative
 * allowance in both of the roles {@link listBandGeometry} now gives that
 * measurement: as the row's `inkLeft` (a boundary nothing may cross) and — since
 * task 487 — as the item's ANCHOR, where it keeps the handle's gap measured from
 * the glyph's own left rather than from the space after it.
 */
const MARKER_TRAIL_EM = 0.25;

/**
 * The marker string a list renders at its WIDEST, or `null` when this build
 * can't say. `null` is answered conservatively by the caller (assume the marker
 * fills its whole band) rather than by a guessed width.
 *
 * Widest-in-the-list rather than this item's own marker: the index of one `<li>`
 * costs an O(siblings) walk on every hover placement, while `children.length` is
 * O(1) — and a bound that covers every row of the list is the safe direction
 * (the cap can only end up further left than strictly needed). `globals.css`
 * authors exactly `disc` and `decimal`; any other counter style (including
 * `decimal-leading-zero`, whose padded form this deliberately does not model)
 * falls through to the conservative answer.
 */
function markerProbeText(type: string, list: HTMLElement): string | null {
  if (type === "disc" || type === "circle" || type === "square") {
    return BULLET_PROBE;
  }
  if (type === "decimal") {
    const ol = list as HTMLOListElement;
    const rawStart = Number(ol.start);
    const first = Number.isFinite(rawStart) && rawStart !== 0 ? rawStart : 1;
    const count = Math.max(list.children.length, 1);
    // A `reversed` list counts DOWN from `start`, so its widest marker is the
    // first one; otherwise the last.
    const widest = ol.reversed ? first : first + count - 1;
    return `${widest}.`;
  }
  return null;
}

/**
 * MEASURED left edge of a list marker's ink, or `null` for "no opinion" (no
 * canvas — SSR / a jsdom stub), which leaves the band-middle heuristic to
 * answer alone.
 */
function measuredMarkerInkLeft(
  list: HTMLElement,
  cs: CSSStyleDeclaration,
  liLeft: number,
  padLeftPx: number,
): number | null {
  const type = cs.listStyleType;
  // Nothing renders in the band, so the item's own content edge is the ink.
  if (type === "none") return liLeft;
  const text = markerProbeText(type, list);
  // An un-modeled counter style could render anything up to its whole band.
  if (text === null) return liLeft - padLeftPx;
  const width = measureTextWidth(text, cs);
  if (width === null) return null;
  const fontSizePx = parseFloat(cs.fontSize);
  const trail = Number.isFinite(fontSizePx) ? fontSizePx * MARKER_TRAIL_EM : 0;
  return liLeft - width - trail;
}

/**
 * The marker-band geometry for a list row, given the list element and the
 * item's measured left edge. The ANCHOR and the INK are ONE number here: the
 * left edge of where the row's marker string actually starts.
 *
 * **Task 487 renegotiated the anchor.** It used to be the MIDDLE of the
 * measured `padding-left` band — a stand-in for a glyph the `::marker` pseudo
 * gives no rect for, and one whose whole justification ("the glyph stays in the
 * band's right half") is a fact about a 2em band rather than about the marker.
 * Gabriel's placement ruling deepens the band, and at a deeper band that
 * stand-in drifts steadily further LEFT of the bullet it is standing in for: the
 * item handle would detach from its own marker and drift toward the column the
 * container's handle now occupies. So where the marker string CAN be measured
 * ({@link measuredMarkerInkLeft} — canvas, never a hardcoded glyph width), the
 * measurement is the answer for both fields; the band middle survives as the
 * FALLBACK for the builds that can't measure (SSR / a jsdom stub).
 *
 * The measurement is conservative in its own right — it subtracts a
 * {@link MARKER_TRAIL_EM} allowance, and answers "the whole band" for a counter
 * style this build does not model — so reading it as the ink is a tightening of
 * the estimate, not a loosening of the guard: `inkLeft` still says where the
 * leftmost ink on this row is, and the lane's cap still keeps every handle's
 * box clear of it.
 *
 * ONE `getComputedStyle` for the list (padding, counter style and font all read
 * from it) — the same single read this had before task 382, so the hover
 * placement path's cost class is unchanged.
 */
function listBandGeometry(list: HTMLElement, liLeft: number): MarkerGeometry {
  const cs = getComputedStyle(list);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const bandMiddle = liLeft - padLeft / 2;
  const measured = measuredMarkerInkLeft(list, cs, liLeft, padLeft);
  const ink = measured ?? bandMiddle;
  // A list ITEM's own marker column is FULL on this row — its bullet is in it —
  // so its handle hugs the glyph rather than occupying the column.
  return { markerLeft: ink, inkLeft: ink, columnRight: null };
}

/**
 * Kinds whose own row carries a MARKER COLUMN — a band left of their content
 * where their marker glyph renders, and which is therefore EMPTY on every row
 * of the structure hanging beneath them. A container nested inside one of these
 * puts its handle in that column (task 487); a container nested inside anything
 * else (a blockquote, the document itself) has no column above it to occupy and
 * falls back to the ordinary gutter slot, so it lines up with the paragraph
 * handles in the same gutter rather than hugging the text column.
 *
 * The membership test is not "does this kind have a marker" but the stronger
 * "does the structure nested UNDER it hang from that marker's column" — the
 * column has to be the same one, and empty on this row. `listItem` is the only
 * kind in this schema that passes: a nested list is a block child of the item,
 * so it fills the item's content box and its own border-box left IS the x the
 * item's bullet band ends at.
 *
 * `exampleItem` is deliberately NOT a member, and stating why is the point —
 * it has a marker and still lends no column. Its marker is a GRID cell
 * (`.expex-item-row`: a marker column, a 0.8em gap, then the body), so a
 * structure nested inside it begins at the BODY column, right of the marker,
 * not under it; right-justifying a handle there would land it in the gap
 * between the marker and the text rather than under the marker. And it is
 * unreachable besides: `exampleItem`'s content model admits no list, so a
 * container can never be its child (task 427).
 */
const MARKER_COLUMN_HOST_KINDS = new Set<string>(["listItem"]);

/**
 * The nearest uuid-bearing ancestor of `el`, iff its kind carries a marker
 * column (see {@link MARKER_COLUMN_HOST_KINDS}). O(depth) — one `closest()`,
 * and only on the container branch, which contributes at most one placement per
 * hover.
 */
function parentMarkerColumnHost(el: HTMLElement): HTMLElement | null {
  const host = el.parentElement?.closest<HTMLElement>(
    "[data-uuid][data-text-object-kind]",
  );
  if (!host) return null;
  const kind = host.getAttribute("data-text-object-kind");
  return kind && MARKER_COLUMN_HOST_KINDS.has(kind) ? host : null;
}

/**
 * MEASURED marker geometry for a block, per kind (see
 * {@link BlockFrame.markerLeft} / {@link BlockFrame.inkLeft}). `trackWidthPx` is
 * this block's resolved track-width, and since task 487 its ONE role is the
 * left-of-content FALLBACK for the two example marker kinds (#49) — the position
 * the `(n)` / `a.` column occupies when that chrome cannot be measured. It was
 * also, until 487, the step the markerless-container branch took off its first
 * item's anchor; that branch reads the container's own border-box left and the
 * level-above's column ({@link BlockFrame.columnRight}) instead, and does not
 * consume this argument at all.
 *
 * Exported for the #49 fallback-direction regression test (it asserts that an
 * example block/item whose marker chrome is missing anchors LEFT of content,
 * not on it) and the task-382 ink-boundary legs. Otherwise an internal of
 * `resolveBlockFrame`.
 */
export function resolveMarkerGeometry(
  el: HTMLElement,
  kind: string | null,
  contentLeft: number,
  trackWidthPx: number,
): MarkerGeometry {
  switch (kind) {
    case "exampleBlock":
      // Fallback (marker unresolved) = one track-width LEFT of content, the
      // position the `(n)` column occupies — never `contentLeft` (#49: a
      // contentLeft fallback puts the handle on the text, right of the marker).
      return markerElementGeometry(
        el,
        ".expex-number",
        contentLeft - trackWidthPx,
      );
    case "exampleItem":
      return markerElementGeometry(
        el,
        ".expex-item-marker",
        contentLeft - trackWidthPx,
      );
    case "listItem": {
      const list = el.closest("ul, ol");
      if (!(list instanceof HTMLElement)) {
        return { markerLeft: contentLeft, inkLeft: contentLeft, columnRight: null };
      }
      return listBandGeometry(list, el.getBoundingClientRect().left);
    }
    case "bulletList":
    case "orderedList": {
      // Markerless container — it has no marker glyph of its OWN on this row,
      // and task 487 is the ruling about what it does instead: it OCCUPIES the
      // marker column of the level ABOVE it — the column its list hangs from.
      //
      // That column's inner edge is the level-above's content edge, and for a
      // block-level list that IS the list's own border-box left: a nested
      // `<ul>` fills its parent `<li>`'s content box, so `listLeft` is exactly
      // the x the parent's own bullet ends at, one row up. Right-justified
      // there, the container's handle sits directly UNDER that bullet, which is
      // Gabriel's rule verbatim ("the outer grab handle should justify right
      // under the bullet point above") and reads as a structural breadcrumb.
      //
      // Its INK boundary is its first item's marker: they share the row, so
      // they share the line neither may cross.
      const listLeft = el.getBoundingClientRect().left;
      const child = el.querySelector<HTMLElement>(GRABBABLE_CHILD_SELECTOR);
      // `el` IS the list, so the band resolves with no `closest()` walk and ONE
      // rect read for the child (task 336 — the pre-fix line read it twice).
      const inkLeft = child
        ? listBandGeometry(el, child.getBoundingClientRect().left).inkLeft
        : contentLeft;
      return {
        // Used only when there is no column to occupy (below): the list then
        // reads as an ordinary markerless block whose content edge is its own
        // left, so its handle takes the same gutter slot every paragraph takes.
        markerLeft: listLeft,
        inkLeft,
        columnRight: parentMarkerColumnHost(el) ? listLeft : null,
      };
    }
    default:
      return { markerLeft: contentLeft, inkLeft: contentLeft, columnRight: null };
  }
}

/**
 * The block's horizontal content edges — the span its first text line occupies,
 * resolved from the SAME `resolveFirstLineTarget` → first-line rect that
 * {@link resolveBlockFrame} uses. This is the ONE content-edge primitive:
 * `resolveBlockFrame` COMPOSES it (so a full frame and a direct
 * `resolveContentEdges` call can never diverge), and affordances that need only
 * the horizontal extent — the drag drop indicator (between-blocks + expex bars)
 * and the figure chrome — call it directly to skip the marker / optical-center
 * work they'd otherwise compute and discard. Pure DOM, O(1)/O(wrapper-
 * descent), no doc walk; safe on the throttled-mousemove drop path.
 */
export interface ContentEdges {
  /** The resolved text element whose first-line box defines the edges. */
  target: HTMLElement;
  /** That element's border box (`getBoundingClientRect()`). */
  firstLineRect: DOMRect;
  /** Viewport x of the content-left edge (`firstLineRect.left`). */
  contentLeft: number;
  /** Content-box width (`firstLineRect.width`). */
  contentWidth: number;
  /** Viewport x of the content-right edge (`contentLeft + contentWidth`). */
  contentRight: number;
}

export function resolveContentEdges(el: HTMLElement): ContentEdges {
  const target = resolveFirstLineTarget(el);
  const firstLineRect = firstLineRectOf(target);
  const contentLeft = firstLineRect.left;
  const contentWidth = firstLineRect.width;
  return {
    target,
    firstLineRect,
    contentLeft,
    contentWidth,
    contentRight: contentLeft + contentWidth,
  };
}

/**
 * Resolve the canonical {@link BlockFrame} for a block's DOM element. Pure
 * DOM + ancestry; safe on the hover/scroll/RAF placement path.
 *
 * Takes the ELEMENT and nothing else. It used to take an `editor` and an
 * optional viewport `cache` as well, and both existed for one reason: to bound
 * an ancestor walk that computed a `depth` field. That field had no reader
 * anywhere in either silo, and the "future margin chrome" its docstring
 * reserved it for was decided otherwise by task 487 (a markerless container
 * OCCUPIES the level-above's marker column — a STRUCTURAL question, answered by
 * {@link BlockFrame.columnRight}, never by counting levels). Walk, field and
 * both parameters retired together, so this resolve costs one less ancestor
 * traversal per hover/scroll/RAF frame. Every remaining field resolves from
 * `el` + ancestry + the `target`'s computed style alone.
 */
export function resolveBlockFrame(el: HTMLElement): BlockFrame {
  // ---- Horizontal content edges (chips 2 / 4a / 4b) ----
  // Composed from the shared `resolveContentEdges` primitive so a full frame
  // and a lean direct `resolveContentEdges` call (drop indicator / figure
  // chrome) read ONE measurement and can never drift.
  const { target, firstLineRect, contentLeft, contentWidth, contentRight } =
    resolveContentEdges(el);

  // ---- The target's computed style: read ONCE, used twice ----
  // Both the vertical axis (via `capBandCenterOffset`'s font metrics) and the
  // em margin tokens below read `target`'s computed style. Reading it here and
  // threading it into the metrics primitive halves this resolve's
  // computed-style count for EVERY block kind (task 336; before the fix the
  // optical-center line issued its own `getComputedStyle` on the same element
  // one line above the read below).
  const cs = getComputedStyle(target);

  // ---- Vertical axis (chip 1) ----
  // Composed from the shared `capBandCenterOffset` primitive (one
  // `measureFontMetrics` read) so this optical center, the marginalia markers,
  // and the selection grab handle can never drift from a copied expression.
  const opticalCenterY = firstLineRect.top + capBandCenterOffset(target, cs);
  // Resolve the em margin tokens against the LABELED TEXT's font, so the gap
  // scales with the prose the user reads and every prose block shares ONE
  // value. `resolveInlineContextElement` descends wrappers to the inline text
  // for paragraphs / example items / headings — AND now the `<li>`→inner-`<p>`
  // case (task 217), so `target` is already the prose element the optical
  // center reads. No separate `fontEl` descent: the em token and the chip-1
  // optical center read the SAME element by construction — and, since task 336,
  // from the SAME `getComputedStyle` call (read above).
  const fontSizePx = parseFloat(cs.fontSize) || DEFAULT_HANDLE_GAP_PX * 1.6;
  const gapPx = resolveMarginEm(
    cs,
    fontSizePx,
    "--margin-handle-gap",
    DEFAULT_HANDLE_GAP_PX,
  );
  const trackWidthPx = resolveMarginEm(
    cs,
    fontSizePx,
    "--margin-track-width",
    DEFAULT_TRACK_WIDTH_PX,
  );
  const kind = el.getAttribute("data-text-object-kind");
  const { markerLeft, inkLeft, columnRight } = resolveMarkerGeometry(
    el,
    kind,
    contentLeft,
    trackWidthPx,
  );
  // Task 526 — the margin's outboard occupant. The rect read is paid ONLY on a
  // chevron-bearing row (the kind gate answers first), so a prose hover costs
  // nothing; `el` is the `[data-uuid]` block element, which for both renderers
  // is the chevron's positioning origin.
  const chevronRight =
    kind !== null && FOLD_CHEVRON_NODE_TYPES.has(kind)
      ? resolveChevronColumnRight(cs, kind, el.getBoundingClientRect().left)
      : null;

  return {
    el,
    target,
    firstLineRect,
    opticalCenterY,
    contentLeft,
    contentWidth,
    contentRight,
    markerLeft,
    columnRight,
    chevronRight,
    inkLeft,
    gapPx,
  };
}
