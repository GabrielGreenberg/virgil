/**
 * block-frame.ts — the ONE canonical per-block geometry source for every
 * gutter affordance (grab handle, drop indicator, and figure chrome).
 * Resolve a block's frame once and every affordance
 * reads the SAME numbers, so they align BY CONSTRUCTION rather than by
 * coincidence (the bug this replaces: each handle measured its own block,
 * so a container and its first item only happened to land within ~2px).
 *
 * Chip 1 built the VERTICAL axis (`opticalCenterY`); chip 2 adds the
 * HORIZONTAL axis — `contentLeft` (the block's text-start X), a MEASURED
 * `markerLeft` (the block's leftmost marker glyph: bullet band / `(n)` /
 * `a.` / plain text), and `gapPx` (the em handle-gap resolved against THIS
 * block's font). Every gutter affordance now hugs `markerLeft − gapPx − <its
 * own width>`, so a container and its first item align BY CONSTRUCTION. All
 * fields are viewport-space and resolvable from `el` + ancestry alone.
 *
 * Chip 4a wires the DRAG DROP-INDICATOR onto the same frame: the between-blocks
 * bar and the expex drop bars now take their x from this `contentLeft` and
 * their span from `contentWidth`, so the drop bar lines up with the grab
 * handles (and the block content) by construction rather than via an
 * independent `getBoundingClientRect().left` measurement (the §4 bug). The drop
 * path reads only `contentLeft` / `contentWidth` (never `depth`), so it calls
 * the resolver without a viewport cache (see {@link resolveBlockFrame}).
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

import type { Editor } from "@tiptap/react";
import type { EditorViewportCache } from "@/hooks/useEditorViewportCache";
import {
  capHeight,
  capTopOffset,
  resolveInlineContextElement,
} from "@/lib/text-metrics";

/**
 * Per-block geometry, all in VIEWPORT coordinates — the ONE source every
 * gutter affordance reads, so they align by construction.
 */
export interface BlockFrame {
  /** The block's outer DOM element (the `[data-uuid]` node DOM — the same
   *  element `editor.view.nodeDOM(pos)` returns, since `data-uuid` is a
   *  node decoration). */
  el: HTMLElement;
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
   * `firstLineRect.top + capTopOffset + capHeight/2`. THE canonical
   * vertical anchor for gutter chrome — center an affordance's glyph on
   * this and it sits on the optical middle of the text it labels,
   * independent of font size / line-height.
   */
  opticalCenterY: number;
  /**
   * Nesting depth = count of ancestor elements carrying `data-uuid`,
   * bounded by the editor root. O(depth). Exposed for future gutter chrome
   * (the chip-2 horizontal axis steps via the markerless-container
   * track-width below, not via depth).
   */
  depth: number;
  /**
   * The block's text content-left in viewport coords (= `firstLineRect.left`).
   * For a markerless block (paragraph / heading / blockquote / codeBlock /
   * titleField / framed atom) this IS the marker reference; exposed separately
   * from {@link markerLeft} so a selection handle (which labels text, not a
   * marker) and the drop indicator (chip 4a) can anchor to text-start.
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
   * single horizontal anchor every gutter affordance hugs. Per kind:
   *   • exampleBlock → its `(n)` number (`.expex-number`) left.
   *   • exampleItem  → its `a./b.` marker (`.expex-item-marker`) left.
   *   • listItem     → the bullet band: the parent list's marker indent,
   *     anchored at the MIDDLE of the measured `padding-left` band
   *     (`li.left − padding-left / 2`). The `::marker` pseudo isn't
   *     rect-able, so we never read a hardcoded glyph width — the band is
   *     em-scaling and reliably between its left edge and the `<li>` content.
   *   • bulletList / orderedList (markerless container) → one TRACK-WIDTH
   *     left of the first grabbable child's markerLeft, so a container handle
   *     stacks a uniform step left of its first item's handle (`⠿⠿ • text`).
   *   • everything else (no marker) → `contentLeft`.
   * An affordance's left edge = `markerLeft − gapPx − <its own width>`, so its
   * RIGHT edge sits one uniform {@link gapPx} left of the marker.
   */
  markerLeft: number;
  /**
   * `--gutter-handle-gap` resolved (em → px) against THIS block's font, so the
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
 * optical center. For a container, descend to its first grabbable child and
 * recurse (a container-in-container resolves to the innermost first row);
 * otherwise descend wrapper NodeViews to the inline-context element via the
 * shared `resolveInlineContextElement`.
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

/** Count ancestor elements carrying `data-uuid`, stopping at the editor
 *  root (exclusive). O(depth). */
function countUuidAncestors(el: HTMLElement, root: HTMLElement | null): number {
  let depth = 0;
  let cur = el.parentElement;
  while (cur && cur !== root) {
    if (cur.hasAttribute("data-uuid")) depth++;
    cur = cur.parentElement;
  }
  return depth;
}

/** Fallback px for the em gutter tokens when the custom property is missing
 *  / unreadable — the resolved values at the editor's nominal 16px font
 *  (`--gutter-handle-gap: 0.625em` → 10px, `--gutter-track-width: 1.25em` →
 *  20px). */
const DEFAULT_HANDLE_GAP_PX = 10;
const DEFAULT_TRACK_WIDTH_PX = 20;

/**
 * Resolve a gutter length custom property to px against a font size. The
 * tokens are authored in `em` (`--gutter-handle-gap` / `--gutter-track-width`)
 * so they scale with the labeled text; `getComputedStyle` does NOT resolve a
 * custom property's `em` to px (it returns the literal "0.625em"), so we
 * resolve it here against the block's own `font-size`. A px value passes
 * through (forward-compat). O(1) — reads an already-fetched computed style.
 */
function resolveGutterEm(
  cs: CSSStyleDeclaration,
  fontSizePx: number,
  varName: string,
  fallbackPx: number,
): number {
  const raw = cs.getPropertyValue(varName).trim();
  if (raw.endsWith("em")) {
    const factor = parseFloat(raw);
    return Number.isFinite(factor) ? factor * fontSizePx : fallbackPx;
  }
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : fallbackPx;
}

/**
 * MEASURED left edge of a block's own marker element matched by `selector`
 * within `el`. `querySelector` returns the first match in document order —
 * the block's OWN row marker, which always precedes any nested descendant's
 * marker — so a `\pex` with sub-items reads its `(n)`, not a sub-item's `a.`.
 *
 * Falls back to `fallbackLeft` when the marker isn't an `HTMLElement` (a
 * transient render before the NodeView marker mounts, or an unfaithful clone
 * that stripped the chrome span). `fallbackLeft` MUST be a gutter position to
 * the LEFT of the marker — NEVER `contentLeft` (the text start, RIGHT of the
 * marker), or the handle anchors INTO the content and overlaps the marker
 * (backlog #49 hypothesis 1). The marker column is one track-width wide, so the
 * caller passes `contentLeft − trackWidthPx` — the position the marker would
 * occupy — keeping the fallback handle in the gutter where it belongs.
 */
function markerElementLeft(
  el: HTMLElement,
  selector: string,
  fallbackLeft: number,
): number {
  const m = el.querySelector(selector);
  return m instanceof HTMLElement
    ? m.getBoundingClientRect().left
    : fallbackLeft;
}

/**
 * The marker-band anchor for a list `<li>`. The bullet / number renders in the
 * parent `<ul>`/`<ol>`'s `padding-left` band (`list-style-position: outside`),
 * which the `::marker` pseudo doesn't expose to `getBoundingClientRect`.
 * Anchor to the MIDDLE of that measured band (`li.left − paddingLeft / 2`):
 * em-scaling (the padding is `1.5em`), never a hardcoded glyph width, and
 * reliably between the band's left edge and the `<li>` content — so the handle
 * clears the glyph without diving toward the chevron column, and a wide `10.`
 * marker can't break it. Falls back to `contentLeft` if no list ancestor.
 */
function bulletBandAnchor(li: HTMLElement, contentLeft: number): number {
  const list = li.closest("ul, ol");
  if (!(list instanceof HTMLElement)) return contentLeft;
  const padLeft = parseFloat(getComputedStyle(list).paddingLeft) || 0;
  return li.getBoundingClientRect().left - padLeft / 2;
}

/**
 * MEASURED leftmost-marker left edge for a block, per kind (see
 * {@link BlockFrame.markerLeft}). `trackWidthPx` is this block's resolved
 * track-width, consumed by the markerless-container branch AND as the
 * left-of-content fallback for the example marker kinds (#49).
 *
 * Exported for the #49 fallback-direction regression test (it asserts that an
 * example block/item whose marker chrome is missing anchors LEFT of content,
 * not on it). Otherwise an internal of `resolveBlockFrame`.
 */
export function resolveMarkerLeft(
  el: HTMLElement,
  kind: string | null,
  contentLeft: number,
  trackWidthPx: number,
): number {
  switch (kind) {
    case "exampleBlock":
      // Fallback (marker unresolved) = one track-width LEFT of content, the
      // position the `(n)` column occupies — never `contentLeft` (#49: a
      // contentLeft fallback puts the handle on the text, right of the marker).
      return markerElementLeft(el, ".expex-number", contentLeft - trackWidthPx);
    case "exampleItem":
      return markerElementLeft(
        el,
        ".expex-item-marker",
        contentLeft - trackWidthPx,
      );
    case "listItem":
      return bulletBandAnchor(el, contentLeft);
    case "bulletList":
    case "orderedList": {
      // Markerless container — no own marker glyph. Step one track-width left
      // of the first grabbable child's marker so the container handle stacks a
      // uniform gap left of its first item's handle (`⠿⠿ • text`).
      const child = el.querySelector<HTMLElement>(GRABBABLE_CHILD_SELECTOR);
      if (!child) return contentLeft - trackWidthPx;
      const childLeft = child.getBoundingClientRect().left;
      return bulletBandAnchor(child, childLeft) - trackWidthPx;
    }
    default:
      return contentLeft;
  }
}

/**
 * The block's horizontal content edges — the span its first text line occupies,
 * resolved from the SAME `resolveFirstLineTarget` → first-line rect that
 * {@link resolveBlockFrame} uses. This is the ONE content-edge primitive:
 * `resolveBlockFrame` COMPOSES it (so a full frame and a direct
 * `resolveContentEdges` call can never diverge), and affordances that need only
 * the horizontal extent — the drag drop indicator (between-blocks + expex bars)
 * and the figure chrome — call it directly to skip the marker / optical-center /
 * depth work they'd otherwise compute and discard. Pure DOM, O(1)/O(wrapper-
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
 * `editor` / `cache` bound the depth walk to the editor root. `cache` is
 * OPTIONAL: it supplies `editorEl` only as the depth-walk root, and
 * `cache.editorEl` IS `editor.view.dom` (useEditorViewportCache.ts), so
 * omitting it changes nothing but `depth`'s root fallback (identical element).
 * The drop indicator (chip 4a) reads only `contentLeft` / `contentWidth` — not
 * `depth` — and the drop hit-test holds no viewport cache, so it calls this
 * without one. The horizontal fields resolve from `el` + ancestry + the
 * `target`'s computed style alone.
 */
export function resolveBlockFrame(
  el: HTMLElement,
  editor: Editor,
  cache?: EditorViewportCache | null,
): BlockFrame {
  // ---- Horizontal content edges (chips 2 / 4a / 4b) ----
  // Composed from the shared `resolveContentEdges` primitive so a full frame
  // and a lean direct `resolveContentEdges` call (drop indicator / figure
  // chrome) read ONE measurement and can never drift.
  const { target, firstLineRect, contentLeft, contentWidth, contentRight } =
    resolveContentEdges(el);

  // ---- Vertical axis (chip 1) ----
  const opticalCenterY =
    firstLineRect.top + capTopOffset(target) + capHeight(target) / 2;
  const root: HTMLElement | null =
    cache?.editorEl ?? (editor?.view?.dom as HTMLElement | null) ?? null;
  const depth = countUuidAncestors(el, root);
  // Resolve the em gutter tokens against the LABELED TEXT's font, so the gap
  // scales with the prose the user reads and every prose block shares ONE
  // value. `resolveInlineContextElement` descends wrappers to the inline text
  // for paragraphs / example items / headings, but leaves a bare `<li>` at its
  // own (root 16px) size rather than its inner `<p>`'s prose (15.2px) size —
  // so descend that one case here, keeping `target` (and thus the chip-1
  // optical center) untouched. One getComputedStyle on an element already on
  // the placement path.
  const fontEl =
    target.tagName === "LI"
      ? (target.querySelector<HTMLElement>(":scope > p") ?? target)
      : target;
  const cs = getComputedStyle(fontEl);
  const fontSizePx = parseFloat(cs.fontSize) || DEFAULT_HANDLE_GAP_PX * 1.6;
  const gapPx = resolveGutterEm(
    cs,
    fontSizePx,
    "--gutter-handle-gap",
    DEFAULT_HANDLE_GAP_PX,
  );
  const trackWidthPx = resolveGutterEm(
    cs,
    fontSizePx,
    "--gutter-track-width",
    DEFAULT_TRACK_WIDTH_PX,
  );
  const markerLeft = resolveMarkerLeft(
    el,
    el.getAttribute("data-text-object-kind"),
    contentLeft,
    trackWidthPx,
  );

  return {
    el,
    firstLineRect,
    opticalCenterY,
    depth,
    contentLeft,
    contentWidth,
    contentRight,
    markerLeft,
    gapPx,
  };
}
