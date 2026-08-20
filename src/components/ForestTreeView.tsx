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
import { watchForestHost } from "@/lib/forest/measure-watch";

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

/**
 * A measured label box, plus whether the DOM could actually answer.
 *
 * The flag is not diagnostic decoration: a `degraded` pass is one whose numbers
 * came from estimates, and it is the thing `measure-watch` waits to redo. Every
 * consumer downstream treats the reported width as the PAINTED box (`x = cx −
 * w/2`, the edge endpoints, the roof span), so an estimate that never gets
 * corrected is a permanently mis-drawn tree.
 */
interface MeasuredLabel extends ForestNodeSize {
  degraded: boolean;
}

/**
 * Widen a TEXT width into the BORDER-BOX width the DOM rung would have reported
 * for the same element.
 *
 * The two measurement rungs have to be interchangeable, and the reason is not
 * tidiness: the engine treats the width it is handed AS the painted box (`x =
 * cx − w/2`, and every edge endpoint and roof span reads back from that). A
 * canvas-measured label that omitted its own padding would be drawn off-centre
 * from where it was placed, siblings' real gaps would shrink below the
 * configured one, and the reported layout width would fall short of the painted
 * extent. Exported so the parity can be asserted directly — it is a claim about
 * two rungs agreeing, which no test of either rung alone can see.
 */
export function borderBoxFromTextWidth(
  textWidth: number,
  cs: Pick<
    CSSStyleDeclaration,
    "paddingLeft" | "paddingRight" | "borderLeftWidth" | "borderRightWidth"
  >,
): number {
  return (
    textWidth +
    (parseFloat(cs.paddingLeft) || 0) +
    (parseFloat(cs.paddingRight) || 0) +
    (parseFloat(cs.borderLeftWidth) || 0) +
    (parseFloat(cs.borderRightWidth) || 0)
  );
}

function measureLabel(el: HTMLElement | null, node: ForestRenderNode): MeasuredLabel {
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height, degraded: false };
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
        return { width: borderBoxFromTextWidth(w, cs), height: line, degraded: true };
      }
    }
  }
  return {
    width: Math.max(FALLBACK_CHAR_PX, node.labelText.length * FALLBACK_CHAR_PX),
    height: FALLBACK_LINE_PX,
    degraded: true,
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
  // The re-measure ticket. TWO sources bump it and both are about the world
  // changing under an already-correct derivation: a font-load wave (which
  // changes every width — `onFontReady` clears the shared metric caches and
  // pings here, exactly as the grab handle and the marginalia registry are
  // pinged), and a host that gets a box after being measured without one.
  const [measureWave, setMeasureWave] = useState(0);
  // Did the last pass read real boxes? See `MeasuredLabel.degraded`.
  const degradedRef = useRef(false);

  useEffect(() => onFontReady(() => setMeasureWave((n) => n + 1)), []);

  // A folded section / focus-hidden band / hidden keep-alive pane leaves this
  // NodeView MOUNTED with no box, so the first layout is placed from estimates
  // and NOTHING in the effect deps below ever changes when it is un-hidden.
  // The box going 0 → non-zero is the signal; see `measure-watch.ts`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return watchForestHost(host, {
      degraded: () => degradedRef.current,
      remeasure: () => setMeasureWave((n) => n + 1),
    });
  }, []);

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
    degradedRef.current = sizes.some((s) => s.degraded);
    setLayout(computeForestLayout(tree, sizes));
  }, [tree, nodes, measureWave]);

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
