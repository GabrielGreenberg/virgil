"use client";

import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView from "./SourcePodNodeView";
import type { ForestBlockOptions } from "@/lib/tiptap/forest-block";

/**
 * `forestBlock`'s NodeView — stage 1 (task 383): the WHOLE
 * `\begin{forest}…\end{forest}` environment in the shared source pod, edited as
 * bytes. Task 384 replaces this body with the native tree renderer + its loud
 * refusal badge; until then the pod is the honest rendering, and it is already
 * strictly better than the unmodelled-env carrier it replaces (a grab handle, a
 * title, a fold, a float, an anchor identity of its own).
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
      config={{
        hostClass: "forest-block",
        sourceAttr: "source",
        chipLabel: "forest",
        kindLabel: "forest tree",
        emptyLabel: "(empty tree)",
        confirmMessage:
          "This will remove the forest tree and its source. You can undo with Cmd+Z.",
      }}
    />
  );
}
