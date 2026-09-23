"use client";

import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView from "./SourcePodNodeView";
import type { ForestBlockOptions } from "@/lib/tiptap/forest-block";
import { FOREST_POD_CONFIG } from "@/lib/forest/pod-config";

/**
 * `forestBlock`'s NodeView — the WHOLE `\begin{forest}…\end{forest}`
 * environment in the shared source pod, with the native TREE renderer as its
 * default body (task 384).
 *
 * The pod's derivation (`deriveForestPod`) answers both halves of the render
 * question from ONE parse: an accepted source renders as a tree, and a source
 * outside the v1 subset renders as a LOUD amber badge naming the construct that
 * was refused, above the untouched bytes. Neither state is persisted anywhere —
 * a refusal is a fact about a parse, re-derived on the next keystroke into the
 * pod, and the `.tex` cannot tell the difference.
 *
 * The pod edits the whole env INCLUDING its delimiters, because the model is
 * the bytes: there is no half of `source` that means something different from
 * the rest. A user who edits the delimiters away simply stops writing a forest
 * env — the next parse carries those bytes as ordinary raw source, which is the
 * same answer Virgil gives every other unmodelled construct, and nothing is
 * lost either way.
 *
 * The Stage-1 `.is-popped` gap is CLOSED (task 730), and closed the way this
 * comment asked for: not by a second per-kind predicate ref, but by deleting
 * the first one. The shared pod resolves "is my float open?" from the node's
 * own `(kind, uuid)` against the float store, so the docked pod dims and goes
 * inert here exactly as it does for `texBlock` — and this NodeView stays what
 * it wants to be, a config and nothing else.
 */
export default function ForestBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  extension,
}: NodeViewProps) {
  const opts = extension.options as ForestBlockOptions;

  return (
    <SourcePodNodeView
      node={node}
      updateAttributes={updateAttributes}
      deleteNode={deleteNode}
      editor={editor}
      cardContext={opts.cardContext === true}
      config={FOREST_POD_CONFIG}
    />
  );
}
