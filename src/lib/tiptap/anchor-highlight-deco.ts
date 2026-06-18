import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * AnchorHighlightDecorator — paints the four card hover/selection attributes
 * (`data-card-selected` / `data-card-hovered` / `data-paragraph-kind` /
 * `data-margin-side`) onto IN-EDITOR anchor targets via ProseMirror
 * decorations, so PM OWNS the attributes and never treats them as a foreign
 * mutation.
 *
 * THE BUG THIS FIXES (root-root). `useAnchorHighlightReconciler` used to RAW
 * `setAttribute` these four attrs onto the anchored block's live DOM element.
 * For a `listItem` / `heading` (whose `data-uuid` is a `Decoration.node` from
 * `uuid-attr.ts`, and which lack a wrapper-guarded NodeView `ignoreMutation`),
 * ProseMirror's MutationObserver sees the foreign attribute as a node mutation
 * and REDRAWS the node — detaching the old element and inserting a fresh one.
 * Consequences: the gutter marker is culled (separately healed at the
 * marginalia-registry layer), the hover HIGHLIGHT is lost (it lands on the
 * detached element; the fresh node has no attr and the reconciler won't
 * re-fire), and per-hover layout churn. Modeled on `UuidAttrDecorator`
 * (`uuid-attr.ts`), which already paints `data-uuid` as a decoration for
 * exactly this reason.
 *
 * Three in-editor target shapes (mirroring `LinkResolution`):
 *   - paragraph / Mode-A block → `Decoration.node(pos, pos+nodeSize, attrs)`
 *   - inline atom (footnote / citation) → `Decoration.node(pos, pos+nodeSize)`
 *   - text-range (Mode B) → `Decoration.inline(from, to, attrs)` over the
 *     `linkedAnchor` mark span
 * The attribute VALUES exactly reproduce what the reconciler used to write
 * (`paragraph` for Mode-A halos, `true` for atoms / ranges), so the existing
 * `globals.css` accent-rail + atom/range rules paint byte-identically.
 *
 * Panel cards (`[data-card-key]`) are NOT touched here — they are React DOM,
 * not PM nodes, so a raw `setAttribute` there causes no redraw and stays in
 * the reconciler.
 *
 * KEYSTROKE SANCTITY. The decoration set is rebuilt ONLY when a transaction
 * carries the `anchorHighlightKey` meta (dispatched from the reconciler on a
 * hover/selection change). On every other transaction — including a plain
 * keystroke — `apply` only `DecorationSet.map(tr.mapping, tr.doc)`s the
 * existing set (O(#highlight-decorations); never more than a couple), and
 * returns. No doc walk, no recompute, no structural emit. The bridge dispatch
 * is a meta-only transaction (`!tr.docChanged`), so `DocStructureObserver`
 * produces no diff and the bus stays silent.
 */

const DATA_CARD_SELECTED = "data-card-selected";
const DATA_CARD_HOVERED = "data-card-hovered";
const DATA_PARAGRAPH_KIND = "data-paragraph-kind";
const DATA_MARGIN_SIDE = "data-margin-side";

/** One in-editor highlight target — already resolved to live PM coordinates
 *  by the reconciler (via `resolveLink`). The reconciler owns the
 *  selection-vs-hover precedence and the attr VALUES; this plugin only paints
 *  what it is handed. */
export type AnchorHighlightTarget =
  | {
      /** `Decoration.node` over a block or inline atom (paragraph / heading /
       *  listItem / footnote / citation). */
      shape: "node";
      from: number;
      /** `from + node.nodeSize` at resolve time. */
      to: number;
      attrs: Record<string, string>;
    }
  | {
      /** `Decoration.inline` over a Mode-B `linkedAnchor` range. */
      shape: "inline";
      from: number;
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

/** Meta payload: the full desired in-editor target list for this frame. The
 *  plugin replaces its whole set from this — the reconciler is idempotent and
 *  always sends the complete picture, so there is no incremental add/remove. */
type AnchorHighlightMeta = { targets: AnchorHighlightTarget[] };

export const anchorHighlightKey = new PluginKey<DecorationSet>(
  "anchorHighlightDeco",
);

function buildSet(
  doc: EditorState["doc"],
  targets: AnchorHighlightTarget[],
): DecorationSet {
  if (targets.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const t of targets) {
    // Defensive clamp: a target resolved a frame ago could be out of range
    // after an interleaved edit. `Decoration.node` throws on a non-node
    // span; skip rather than crash the view.
    if (t.from < 0 || t.to > doc.content.size || t.to <= t.from) continue;
    try {
      decos.push(
        t.shape === "node"
          ? Decoration.node(t.from, t.to, t.attrs)
          : Decoration.inline(t.from, t.to, t.attrs),
      );
    } catch {
      // Out-of-sync target (e.g. `Decoration.node` over a non-node range
      // after a concurrent edit). Drop it; the next reconcile re-paints.
    }
  }
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * Replace the in-editor highlight decorations with `targets`. Dispatches a
 * META-ONLY transaction (no doc change), so it never disturbs the document,
 * the autosaver, or the DocStructureObserver. Idempotent at the caller: pass
 * the COMPLETE desired set every frame.
 */
export function setAnchorHighlightTargets(
  view: EditorView,
  targets: AnchorHighlightTarget[],
): void {
  const meta: AnchorHighlightMeta = { targets };
  view.dispatch(view.state.tr.setMeta(anchorHighlightKey, meta));
}

export const AnchorHighlightDecorator = Extension.create({
  name: "anchorHighlightDecorator",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: anchorHighlightKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr: Transaction, value: DecorationSet) {
            // KEYSTROKE-SANCTITY: forward-map existing decorations on every
            // transaction (O(#decorations), tiny — never a doc walk).
            let set = value.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(anchorHighlightKey) as
              | AnchorHighlightMeta
              | undefined;
            // Rebuild ONLY when the reconciler pushed a new hover/selection
            // frame. A plain keystroke carries no meta → we keep the mapped
            // set and return without recomputing.
            if (meta) set = buildSet(tr.doc, meta.targets);
            return set;
          },
        },
        props: {
          decorations(state) {
            return anchorHighlightKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
