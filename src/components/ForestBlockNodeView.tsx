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
 * Stage-1 gap, stated rather than implied: no `.is-popped` dimming. That chrome
 * reads a per-kind predicate (`texBlockIsPoppedRef`) threaded from EditorPane
 * through Editor → buildEditorExtensions; generalizing it to a
 * `(kind, uuid)` predicate is the right fix and belongs with the renderer work,
 * not bolted on as a second per-kind ref.
 */
export default function ForestBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  extension,
}: NodeViewProps) {
  const opts = extension.options as ForestBlockOptions;

  return (
    <SourcePodNodeView
      node={node}
      updateAttributes={updateAttributes}
      deleteNode={deleteNode}
      cardContext={opts.cardContext === true}
      config={FOREST_POD_CONFIG}
    />
  );
}
