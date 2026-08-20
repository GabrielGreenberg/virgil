/**
 * The STATIC projection of a source pod's bytes — what `renderHTML` emits for
 * a node whose model is its source (`texBlock`, `forestBlock`).
 *
 * **Why a node's `renderHTML` has to carry the source at all.** A block atom
 * keeps its content in ATTRS, so a `renderHTML` that emits only a wrapper
 * `<div>` projects to NOTHING wherever the NodeView is not what renders it —
 * and there are two such surfaces. The T1 static card tier
 * (`renderBorrowedHtml` → `generateHTML`, the card-presence ladder) is the one
 * with a stated parity claim: its own doctrine is that a collapsed card body
 * paints "visually identical" to the live tier, and the live tier for these two
 * kinds is `SourcePodNodeView`'s card-context `<pre>` of the source. Measured
 * on the pre-388 tree, the static tier painted an EMPTY DIV for both — a blank
 * gap where the live tier shows the bytes, with nothing thrown and nothing
 * logged. The second surface is the CLIPBOARD: ProseMirror serializes a copied
 * slice through the node spec's `toDOM`, never the NodeView, so copying a tree
 * or a raw-LaTeX block into another application yielded an empty element.
 *
 * The rule this states, in the shape task 387 gave the projection family:
 * **every projection of a card body is total over the block-atom vocabulary its
 * schema registers** — `richJsonToLatex`, `richJsonToPlainText`, and the static
 * HTML tier alike. This is the third one.
 *
 * It is spelled ONCE, here, rather than in each node's `renderHTML`, because
 * the CLASS is a cross-layer contract: `globals.css` styles the same name, and
 * two hand-written copies is how a third wearer arrives with a `<pre>` nothing
 * styles.
 */

/** Class on the static `<pre>`; styled in globals.css beside the pod chrome. */
export const SOURCE_POD_STATIC_CLASS = "source-pod-static-source";

/**
 * The child spec a source-pod node's `renderHTML` appends after its attrs.
 *
 * A ProseMirror `DOMOutputSpec` child that is a bare string becomes a TEXT
 * node, so the source is escaped by the serializer rather than interpolated —
 * and the node stays `atom: true`, so `parseHTML` reads the source back off the
 * ATTRIBUTE and ignores this child entirely. The projection is therefore
 * display-only in both directions: it cannot round-trip into a second copy of
 * the bytes.
 */
export function sourcePodStaticBody(
  source: string,
): [string, Record<string, string>, string] {
  return ["pre", { class: SOURCE_POD_STATIC_CLASS }, source];
}
