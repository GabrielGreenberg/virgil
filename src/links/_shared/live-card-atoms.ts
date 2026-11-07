/**
 * The ONE walk over a document's Card-bearing inline atoms for the `src/links`
 * liveness questions (task 1508).
 *
 * Three walkers here — the inline-atom lifecycle's snapshot, its cheap
 * liveness re-check, and the highlight reconciler's ghost-halo prune — each
 * spelled the vocabulary by hand: `type.name === "footnote"` / `"citation"`
 * and `footnoteId || linkId`. That agreed with the atom registry only by
 * coincidence: a citation carrying only the unified mirror was dead to them,
 * a footnote carrying only it was alive to them and absent from DocStructure,
 * and a third Card-bearing atom would have been missed by all three. Both the
 * node name and the id now come from {@link cardAtomIdOf} — the same door
 * DocStructure reads — so the answers cannot differ.
 *
 * Card-bearing atoms are PM leaves (a footnote's body is an attr, not
 * children), so the walk never descends into one; nested atoms inside a
 * footnote body are tracked out-of-band and are not this walk's question.
 *
 * O(nodes in doc) — dispatch / mount / prune-effect only, never per keystroke.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { CardAtomKind } from "@/lib/tiptap/atom-registry";
import { cardAtomIdOf } from "@/lib/tiptap/doc-structure/entity-extractor";

/** Visit every Card-bearing atom that carries an id, in document order. */
export function forEachCardAtom(
  doc: PMNode,
  visit: (atom: { kind: CardAtomKind; id: string; node: PMNode }) => void,
): void {
  doc.descendants((node) => {
    const atom = cardAtomIdOf(node);
    if (!atom) return true;
    if (atom.id) visit({ ...atom, node });
    return false;
  });
}

/** Every live Card-bearing atom id in `doc`. */
export function liveCardAtomIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  forEachCardAtom(doc, ({ id }) => ids.add(id));
  return ids;
}
