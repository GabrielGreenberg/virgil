import { Decoration } from "@tiptap/pm/view";
import { DATA_CARD_SELECTED, DATA_CARD_HOVERED } from "@/lib/view-only-chrome";

/**
 * The ANCHOR channel of the transient-highlight engine — paints the four card
 * hover/selection attributes
 * (`data-card-selected` / `data-card-hovered` / `data-paragraph-kind` /
 * `data-margin-side`) onto IN-EDITOR NODE/ATOM anchor targets via ProseMirror
 * decorations, so PM OWNS the attributes and never treats them as a foreign
 * mutation.
 *
 * THE BUG THIS FIXES (root-root). `useAnchorHighlightReconciler` used to RAW
 * `setAttribute` these four attrs onto the anchored block's live DOM element.
 * For a `listItem` / `heading` (whose `data-uuid` is a `Decoration.node` from
 * `uuid-attr.ts`, and which lack a wrapper-guarded NodeView `ignoreMutation`),
 * ProseMirror's MutationObserver sees the foreign attribute as a node mutation
 * and REDRAWS the node — detaching the old element and inserting a fresh one.
 * Consequences: the margin marker is culled (separately healed at the
 * marginalia-registry layer), the hover HIGHLIGHT is lost (it lands on the
 * detached element; the fresh node has no attr and the reconciler won't
 * re-fire), and per-hover layout churn. Modeled on `UuidAttrDecorator`
 * (`uuid-attr.ts`), which already paints `data-uuid` as a decoration for
 * exactly this reason.
 *
 * SCOPE — NODE/ATOM ONLY. This plugin paints exactly the two target shapes
 * that suffer the `Decoration.node` redraw:
 *   - paragraph / Mode-A block → `Decoration.node(pos, pos+nodeSize, attrs)`
 *   - inline atom (footnote / citation) → `Decoration.node(pos, pos+nodeSize)`
 * The attribute VALUES exactly reproduce what the reconciler used to write
 * (`paragraph` for Mode-A halos, `true` for atoms), so the existing
 * `globals.css` accent-rail + atom rules paint byte-identically.
 *
 * Mode-B TEXT RANGES are deliberately NOT painted here. A `Decoration.inline`
 * over a TEXT node wraps it in a FRESH inner `<span>` (TextViewDesc
 * `applyOuterDeco`, `needsWrap` for nodeType 3), so the attrs would land on a
 * CHILD of `.linked-anchor`, not on `.linked-anchor` itself — and the
 * consuming CSS requires attr+class on the SAME element
 * (`.linked-anchor[data-card-hovered="true"]`). A `.linked-anchor` is a plain
 * mark span (not a `Decoration.node`-owned block), so a raw setAttribute on it
 * causes no redraw AND satisfies the CSS. Mode-B therefore stays on the
 * reconciler's raw-setAttribute path (`useAnchorHighlightReconciler.ts`), the
 * same path it used pre-decoration; it was never part of the redraw root
 * cause. (The plugin's target type is node-only for this reason.)
 *
 * Panel cards (`[data-card-key]`) are NOT touched here — they are React DOM,
 * not PM nodes, so a raw `setAttribute` there causes no redraw and stays in
 * the reconciler.
 *
 * ONE PLUGIN PROTOCOL (task 880). This file used to carry its own plugin — a
 * `{targets}` meta, a whole-set setter, a map-then-rebuild `apply` — a second
 * copy of `transient-highlight.ts`'s engine that had already DRIFTED (its
 * setter dispatched a no-op transaction on every empty reconcile; the engine's
 * bails). The plugin, key, meta and setter now live ONCE, in the engine, as its
 * `anchor` channel; `setAnchorHighlightTargets` there is the named door. What
 * stays here is what is genuinely anchor-specific: the attr VOCABULARY and the
 * one `Decoration.node` builder the engine calls for a `shape: "node"` target.
 * Keystroke sanctity is therefore the engine's: rebuild only on the channel's
 * own meta, map-only otherwise, zero cost while nothing is painted.
 */

// The two attention attr NAMES come from the view-only vocabulary, not from a
// local copy: the print block neutralises view-only paint BY these names, and a
// rename that reached only one side would silently print a selection halo
// (task 523).
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** One in-editor NODE/ATOM highlight target — already resolved to live PM
 *  coordinates by the reconciler (via `resolveLink`). The reconciler owns the
 *  selection-vs-hover precedence and the attr VALUES; this plugin only paints
 *  what it is handed. Mode-B text ranges are intentionally NOT representable
 *  here (see the module docstring) — they are painted by the reconciler's raw
 *  `.linked-anchor` setAttribute path. */
export type AnchorHighlightTarget = {
  /** `Decoration.node` over a block or inline atom (paragraph / heading /
   *  listItem / footnote / citation). The engine's shape discriminant: it is
   *  what routes this target to {@link anchorNodeDecoration} rather than to
   *  the inline band builder. */
  shape: "node";
  from: number;
  /** `from + node.nodeSize` at resolve time. */
  to: number;
  attrs: Record<string, string>;
};

/** The four attrs this plugin owns, in the value vocabulary the CSS reads. */
export interface AnchorHighlightAttrs {
  /** `"paragraph"` for a Mode-A block halo, `"true"` for atoms / ranges. */
  value: "paragraph" | "true";
  /** `data-paragraph-kind` css token, or null (atoms / unknown kind). */
  kind: string | null;
  /** `data-margin-side`, or null. */
  side: "left" | "right" | null;
}

/** Build the `data-card-selected` attr bag for a node/inline target. */
export function selectedAttrs(a: AnchorHighlightAttrs): Record<string, string> {
  const attrs: Record<string, string> = { [DATA_CARD_SELECTED]: a.value };
  if (a.kind) attrs[DATA_PARAGRAPH_KIND] = a.kind;
  if (a.side) attrs[DATA_MARGIN_SIDE] = a.side;
  return attrs;
}

/** Build the `data-card-hovered` attr bag for a node/inline target.
 *  `withKindSide` is false when selection already painted kind/side on the
 *  SAME element (selection wins — mirrors the reconciler's old
 *  `!selectedEls.has(el)` guard). */
export function hoveredAttrs(
  a: AnchorHighlightAttrs,
  withKindSide: boolean,
): Record<string, string> {
  const attrs: Record<string, string> = { [DATA_CARD_HOVERED]: a.value };
  if (withKindSide) {
    if (a.kind) attrs[DATA_PARAGRAPH_KIND] = a.kind;
    if (a.side) attrs[DATA_MARGIN_SIDE] = a.side;
  }
  return attrs;
}

/**
 * The ONE decoration a `shape: "node"` target becomes. Called by the
 * transient-highlight engine's set builder, which has already range-checked
 * the target against the doc. `Decoration.node` throws on a span that is not
 * exactly one node (a target resolved a frame ago, then an interleaved edit) —
 * return null and let the next reconcile re-paint, rather than crash the view.
 */
export function anchorNodeDecoration(t: AnchorHighlightTarget): Decoration | null {
  try {
    return Decoration.node(t.from, t.to, t.attrs);
  } catch {
    return null;
  }
}
