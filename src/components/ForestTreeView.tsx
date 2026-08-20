"use client";

/**
 * The forest tree RENDERER — measured labels + a pure layout + an SVG edge
 * layer. A view over `forestBlock.source` and nothing else.
 *
 * Three properties are load-bearing, and each is asserted rather than assumed:
 *
 * - **One measure pass per `source` change.** Labels render once at the origin
 *   (hidden), every box is read in ONE batch, the pure engine places them, and
 *   a second render writes the positions. Nothing re-measures on a scroll, a
 *   resize, or another block's keystroke — the tree's geometry is a function of
 *   its own bytes and the current font, so those are its only two triggers.
 * - **No editor subscription.** This component never sees the editor. Typing in
 *   another paragraph costs it nothing at all, which is the keystroke-sanctity
 *   law's question for a derived view, and `window.__forestRenderStats()` is
 *   how it is answered.
 * - **Math is the SAME paint the document uses** — `renderMath`, the exported
 *   KaTeX pass the live NodeView and the static card tier both run — so a
 *   `$\alpha$` in a node label is the same ink, the same error sentinel and the
 *   same `--math-color` as one in prose.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderMath } from "@/lib/tiptap/math";
import { measureTextWidth, onFontReady, resolveLineHeightPx } from "@/lib/text-metrics";
import type { ForestRenderNode } from "@/lib/forest/grammar";
import {
  computeForestLayout,
  flattenForestTree,
  type ForestLayout,
  type ForestNodeSize,
} from "@/lib/forest/layout";
import { noteForestWork } from "@/lib/forest/stats";

/**
 * The degraded size for a label nothing could measure — no attached DOM box and
 * no canvas (SSR, jsdom, a hidden pane). Stated as a DEGRADE rather than a
 * layout constant: a tree drawn from estimates is readable and slightly off,
 * where a tree drawn from zeros collapses every node onto one point. The real
 * path is the DOM read below; the canvas rung is the same `measureTextWidth`
 * the marker-ink boundary uses.
 */
const FALLBACK_CHAR_PX = 7.2;
const FALLBACK_LINE_PX = 18;

function measureLabel(el: HTMLElement | null, node: ForestRenderNode): ForestNodeSize {
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    // No box (detached / display:none) — ask the canvas for the width of the
    // flat label, which is exact for a text-only label and an approximation
    // for one carrying math.
    if (typeof window !== "undefined") {
      const cs = window.getComputedStyle(el);
      const w = measureTextWidth(node.labelText, cs);
      if (w !== null) {
        const fontSizePx = parseFloat(cs.fontSize);
        const line = Number.isFinite(fontSizePx)
          ? resolveLineHeightPx(cs, fontSizePx)
          : FALLBACK_LINE_PX;
        return { width: w, height: line };
      }
    }
  }
  return {
    width: Math.max(FALLBACK_CHAR_PX, node.labelText.length * FALLBACK_CHAR_PX),
    height: FALLBACK_LINE_PX,
  };
}

/** The tree as one line of bracket notation — the screen-reader string, and
 *  what a copy of the rendered block should read as. */
export function forestTreeToText(node: ForestRenderNode): string {
  const inner = node.children.map(forestTreeToText).join(" ");
  const label = node.labelText;
  if (!inner) return `[${label}]`;
  return `[${label} ${inner}]`;
}

function ForestTreeViewImpl({ tree }: { tree: ForestRenderNode }) {
  noteForestWork("render");
  const nodes = useMemo(() => flattenForestTree(tree), [tree]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [layout, setLayout] = useState<ForestLayout | null>(null);
  // A font-load wave changes every measured width; `onFontReady` clears the
  // shared metric caches and pings here, exactly as the grab handle and the
  // marginalia registry are pinged. One counter bump, off any hot path.
  const [fontWave, setFontWave] = useState(0);

  useEffect(() => onFontReady(() => setFontWave((n) => n + 1)), []);

  // Math FIRST — the boxes are measured below and a label whose KaTeX has not
  // painted yet measures as empty. Effects run in declaration order, which is
  // what makes this ordering a fact rather than a hope.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>("[data-forest-math]").forEach((el) => {
      renderMath(el, el.dataset.forestMath ?? "", false);
    });
  }, [nodes]);

  useLayoutEffect(() => {
    noteForestWork("measure");
    const sizes = nodes.map((node, i) => measureLabel(labelRefs.current[i], node));
    setLayout(computeForestLayout(tree, sizes));
  }, [tree, nodes, fontWave]);

  const placed = layout?.nodes;

  return (
    <div
      ref={hostRef}
      className="forest-tree"
      role="img"
      aria-label={`Syntax tree ${forestTreeToText(tree)}`}
      style={{
        width: layout ? `${layout.width}px` : undefined,
        height: layout ? `${layout.height}px` : undefined,
        // Hidden — not unmounted — until the first layout lands: the labels
        // must be in the document to be measured at all.
        visibility: layout ? "visible" : "hidden",
      }}
    >
      {layout && (
        <svg
          className="forest-tree-edges"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
          focusable="false"
        >
          {layout.edges.map((e, i) => (
            <line
              key={`e${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              className="forest-tree-edge"
            />
          ))}
          {layout.roofs.map((r, i) => (
            <polygon
              key={`r${i}`}
              points={`${r.apexX},${r.apexY} ${r.leftX},${r.baseY} ${r.rightX},${r.baseY}`}
              className="forest-tree-roof"
            />
          ))}
        </svg>
      )}
      {nodes.map((node, i) => {
        const box = placed?.[i];
        return (
          <div
            key={i}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            className="forest-node"
            style={{ left: box ? `${box.x}px` : 0, top: box ? `${box.y}px` : 0 }}
          >
            {node.label.map((seg, s) =>
              seg.kind === "math" ? (
                <span
                  key={s}
                  className="forest-node-math"
                  data-forest-math={seg.value}
                />
              ) : (
                <span key={s}>{seg.value}</span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The equality bail — explicit, and BEFORE anything else runs.
 *
 * `tree` is produced by one memoized parse per `source` (see the pod's
 * `derive`), so an unchanged source hands back the identical object and this
 * comparator short-circuits the whole subtree: no re-measure, no re-layout, no
 * KaTeX re-paint. Written out rather than left to `memo`'s default so the bail
 * is a stated contract with a cost leg behind it, not a default someone can
 * remove by adding a second prop.
 */
export const ForestTreeView = memo(
  ForestTreeViewImpl,
  (prev, next) => prev.tree === next.tree,
);
export default ForestTreeView;
