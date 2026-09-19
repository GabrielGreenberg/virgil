import type { Fragment, Node as PMNode, Slice } from "prosemirror-model";
import { MEANINGFUL_BLOCK_ATOM_NODE_NAMES } from "@/text-objects/text-object-registry";

/**
 * **THE capture/schema-symmetry predicate for a WRAP action** (task 641).
 *
 * `AGENTS.md` → "Capture/schema symmetry — never delete what you cannot
 * restore": a destructive action must never delete content its capture
 * destination cannot represent. The card spine states that law for card bodies
 * (`canMountInCardBody`, validated BEFORE the delete is dispatched). This is the
 * same law for the three WRAP paths in the action registry, which all do
 *
 * ```ts
 * if (!empty) tr = tr.deleteSelection();
 * tr = tr.replaceSelectionWith(node);
 * ```
 *
 * after harvesting the selection into a payload their new node CAN hold. The
 * harvest is lossy by construction — `texRun` / `mathRun` keep plain TEXT
 * (`textBetween`), `exampleRun` keeps INLINE leaves
 * (`extractInlineFromSlice`) — so everything else in the selected slice is
 * deleted and never restored.
 *
 * Before 641 the rule was written TWICE and forgotten ONCE: `texRun` and
 * `mathRun` each carried a hand-rolled bail for the one shape that was
 * reported (a selection holding an inline atom and NO text), and `exampleRun`
 * carried none at all — so `\\ex` over a selected `displayMath` / `figureBlock`
 * / `graphicsBlock` replaced it with an empty example template and the block was
 * simply gone. One predicate, asked by all three, is what stops the fourth wrap
 * path forgetting it again.
 *
 * The question is asked of the SLICE, not of the harvest result, because "the
 * harvest came back empty" is a PROXY for the real question and misses every
 * MIXED selection — text plus a citation pill, prose plus a figure — which the
 * proxy waves through while the delete destroys the atom anyway.
 */

/**
 * What a wrap path's capture can carry out of a selection. Not a mode switch on
 * the question (the question is one: *does the capture represent the slice?*) —
 * it NAMES the capture, which is the only thing that differs between the three
 * callers.
 *
 *   • `"text"` — `state.doc.textBetween(...)`: plain characters only
 *     (`texRun`'s `\\tex` block `code`, `mathRun`'s `latex`). An inline atom, a
 *     block atom, a text object: none survive.
 *   • `"inline"` — `extractInlineFromSlice`: every INLINE leaf, with block
 *     scaffolding flattened away (`exampleRun`'s `inline*` item paragraph).
 *     Text and inline atoms survive; block-level identity does not.
 */
export type CaptureVocabulary = "text" | "inline";

/**
 * Does `capture`'s vocabulary represent EVERYTHING `slice` holds — i.e. is it
 * safe to `deleteSelection()` over it?
 *
 * Fails CLOSED (the same direction as `blockRangeHostsBlockInsert` and
 * `inlineRangeAllowsAtom`): the first node the capture has no vocabulary for
 * answers `false`, and the caller must REFUSE rather than delete. A slice that
 * holds nothing (`content.size === 0`) is trivially captured.
 *
 * The walk mirrors each capture exactly:
 *   • an INLINE node is captured when the vocabulary admits it — `"inline"`
 *     takes every one, `"text"` only real text (plus `hardBreak`, which both
 *     `textBetween` forms flatten to a line break / nothing rather than losing
 *     content);
 *   • a non-inline node is DESCENDED into, because flattening plain
 *     scaffolding (a paragraph, a list item, a blockquote) into its inline
 *     leaves is the harvest's intended behaviour and loses no content;
 *   • …UNLESS it is a block ATOM (nothing to descend into — `displayMath`,
 *     `graphicsBlock`, `texBlock`, `forestBlock`) or one of the
 *     `MEANINGFUL_BLOCK_ATOM_NODE_NAMES` — the registry-derived "non-trivial to
 *     lose" set the destructive-confirm probe already reads, which adds
 *     `figureBlock`, whose `src` / `extras` / `label` the flattening drops while
 *     keeping its caption's characters. Those are the loss. A `paragraph` /
 *     `heading` / `listItem` / `blockquote` is in neither set, so ordinary prose
 *     scaffolding flattens exactly as it always did. (The schema `group` is NOT
 *     the distinguisher it looks like: `paragraph` is `"block textObject"` too.)
 *
 * Pure (no React/DOM, no editor), bounded by the selection slice — never a
 * whole-document walk — and run on a user gesture, never per keystroke.
 */
export function sliceIsFullyCapturedBy(
  slice: Slice,
  capture: CaptureVocabulary,
): boolean {
  let complete = true;
  const walk = (fragment: Fragment) => {
    fragment.forEach((child: PMNode) => {
      if (!complete) return;
      if (child.isInline) {
        const kept =
          capture === "inline" || child.isText || child.type.name === "hardBreak";
        if (!kept) complete = false;
        return;
      }
      if (child.isAtom || MEANINGFUL_BLOCK_ATOM_NODE_NAMES.has(child.type.name)) {
        complete = false;
        return;
      }
      walk(child.content);
    });
  };
  walk(slice.content);
  return complete;
}
