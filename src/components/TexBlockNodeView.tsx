"use client";

import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView from "./SourcePodNodeView";
import type { TexBlockOptions } from "@/lib/tiptap/tex-block";
import { TEX_POD_CONFIG } from "@/lib/tiptap/tex-pod-config";

/**
 * `texBlock`'s NodeView — a thin CONFIG over the shared source pod.
 *
 * Every pixel of the pod chrome (title affordance, fold chevron, collapsed
 * preview, hover sensor, CodeMirror pod, delete confirm, card-context static
 * preview) lives in {@link SourcePodNodeView}, which `forestBlock` wears too.
 * What is texBlock's own is the strings and the attr name — and since task 730
 * that is ALL it is: the `.is-popped` predicate it used to read from its own
 * extension options is now resolved by the pod from the node's `(kind, uuid)`,
 * so the one wearer that had the dimming no longer has a private channel for
 * it and the one that lacked it (`forestBlock`) inherits it.
 */
export default function TexBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  extension,
}: NodeViewProps) {
  const opts = extension.options as TexBlockOptions;

  return (
    <SourcePodNodeView
      node={node}
      updateAttributes={updateAttributes}
      deleteNode={deleteNode}
      editor={editor}
      cardContext={opts.cardContext === true}
      config={TEX_POD_CONFIG}
    />
  );
}
