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
 *
 * **One preview, two renderers (task 1171).** The static projection and the
 * live card-context preview `SourcePodNodeView` paints are the SAME picture —
 * the T1 tier's parity claim says so — but they used to be spelled twice: the
 * NodeView drew a title line and an italic empty label with Tailwind + inline
 * styles, while this module emitted a bare `<pre>`. So a titled pod lost its
 * title at T1 and an empty one showed a blank box. Now both read ONE model
 * (`sourcePodPreview`) and ONE class vocabulary (`SOURCE_POD_PREVIEW_CLASSES`,
 * styled once in `globals.css`); only the RENDERER differs — a DOMOutputSpec
 * here, JSX in the NodeView — and `source-pod-preview-parity.test.tsx` pins
 * the two to the same visible text.
 */

/**
 * The card-preview class vocabulary — every class either renderer may wear.
 * Styled ONLY in `globals.css` ("source-pod card preview"); neither renderer
 * carries its own look.
 */
export const SOURCE_POD_PREVIEW_CLASSES = {
  /** The wrapper (the node's own div statically, the NodeViewWrapper live). */
  wrapper: "source-pod-card-preview",
  /** The optional title line above the source. */
  title: "source-pod-card-preview-title",
  /** The `<pre>` of the source. */
  source: "source-pod-static-source",
  /** The italic label an EMPTY pod shows inside its `<pre>`. */
  empty: "source-pod-card-preview-empty",
} as const;

/** Back-compat name for the `<pre>` class (task 388). */
export const SOURCE_POD_STATIC_CLASS = SOURCE_POD_PREVIEW_CLASSES.source;

/** What a source pod's card preview SHOWS — the one model both renderers read. */
export interface SourcePodPreviewModel {
  /** The user's title, or null when the pod has none. */
  title: string | null;
  /** The bytes, or the kind's empty label when there are none. */
  body: { kind: "source"; text: string } | { kind: "empty"; label: string };
}

/**
 * Derive the preview from a pod's attrs. `title` is `parTitle` as stored
 * (null / "" both mean "untitled", the same reading the live pod gives it);
 * `emptyLabel` is the kind's own `SourcePodConfig.emptyLabel`.
 */
export function sourcePodPreview(
  source: string | null | undefined,
  title: string | null | undefined,
  emptyLabel: string,
): SourcePodPreviewModel {
  return {
    title: title || null,
    body: source
      ? { kind: "source", text: source }
      : { kind: "empty", label: emptyLabel },
  };
}

type Spec = [string, Record<string, string>, ...(Spec | string)[]];

/**
 * The child specs a source-pod node's `renderHTML` appends after its attrs:
 * an optional title `<div>`, then the `<pre>` (the source, or the empty label
 * in a span).
 *
 * A ProseMirror `DOMOutputSpec` child that is a bare string becomes a TEXT
 * node, so the source is escaped by the serializer rather than interpolated —
 * and the node stays `atom: true` (a LEAF), so `parseHTML` reads the source
 * and the title back off the ATTRIBUTES and never descends into these
 * children. The projection is therefore display-only in both directions: a
 * paste back into Virgil cannot turn the title line into a paragraph or the
 * bytes into a second copy.
 */
export function sourcePodStaticBody(model: SourcePodPreviewModel): Spec[] {
  const c = SOURCE_POD_PREVIEW_CLASSES;
  const pre: Spec =
    model.body.kind === "source"
      ? ["pre", { class: c.source }, model.body.text]
      : ["pre", { class: c.source }, ["span", { class: c.empty }, model.body.label]];
  return model.title ? [["div", { class: c.title }, model.title], pre] : [pre];
}
