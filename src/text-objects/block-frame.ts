/**
 * block-frame.ts — the ONE canonical per-block geometry source for every
 * gutter affordance (grab handle today; the drop indicator and figure
 * chrome in later chips). Resolve a block's frame once and every affordance
 * reads the SAME numbers, so they align BY CONSTRUCTION rather than by
 * coincidence (the bug this replaces: each handle measured its own block,
 * so a container and its first item only happened to land within ~2px).
 *
 * Chip 1 builds this module and uses it for the VERTICAL axis only
 * (`opticalCenterY`). The interface is designed to GROW: chip 2 adds
 * `contentLeft` (the block's text-start X) and a measured `markerLeft`
 * (bullet / `(n)` marker X) so the handle's horizontal column derives from
 * the same source; keep new fields viewport-space and resolvable from `el`
 * + ancestry alone.
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
 * Per-block geometry, all in VIEWPORT coordinates. Designed to GROW (chip 2
 * adds `contentLeft` + a measured `markerLeft`).
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
   * bounded by the editor root. O(depth). Chip 2 reads this for the gutter
   * column indent.
   */
  depth: number;
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

/**
 * Resolve the canonical {@link BlockFrame} for a block's DOM element. Pure
 * DOM + ancestry; safe on the hover/scroll/RAF placement path.
 *
 * `editor` / `cache` are accepted so the frame can grow (chip 2 reads the
 * editor-column geometry from `cache` for the horizontal columns); this
 * chip uses them only to bound the depth walk to the editor root.
 */
export function resolveBlockFrame(
  el: HTMLElement,
  editor: Editor,
  cache: EditorViewportCache,
): BlockFrame {
  const target = resolveFirstLineTarget(el);
  const firstLineRect = firstLineRectOf(target);
  const opticalCenterY =
    firstLineRect.top + capTopOffset(target) + capHeight(target) / 2;
  const root: HTMLElement | null =
    cache?.editorEl ?? (editor?.view?.dom as HTMLElement | null) ?? null;
  const depth = countUuidAncestors(el, root);
  return { el, firstLineRect, opticalCenterY, depth };
}
