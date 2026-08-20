"use client";

import type { NodeViewProps } from "@tiptap/react";
import SourcePodNodeView from "./SourcePodNodeView";
import type { TexBlockOptions } from "@/lib/tiptap/tex-block";

/**
 * `texBlock`'s NodeView — a thin CONFIG over the shared source pod.
 *
 * Every pixel of the pod chrome (title affordance, fold chevron, collapsed
 * preview, hover sensor, CodeMirror pod, delete confirm, card-context static
 * preview) lives in {@link SourcePodNodeView}, which `forestBlock` wears too.
 * What is texBlock's own is the strings and the attr name — plus `isPopped`,
 * which it reads from its extension options.
 */
export default function TexBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  extension,
}: NodeViewProps) {
  const uuid = (node.attrs.uuid as string | null) || null;

  // Pull the popped predicate out of the extension's configure options.
  // The lift gesture itself lives in the editor-level TextObjectGrabHandle
  // (src/text-objects/TextObjectGrabHandle.tsx); the NodeView only needs
  // to know "am I popped out" so it can render the .is-popped chrome.
  const opts = extension.options as TexBlockOptions;
  const isPoppedRef = opts.isPoppedRef;
  const isPopped = !!(uuid && isPoppedRef?.current?.current?.(uuid));

  return (
    <SourcePodNodeView
      node={node}
      updateAttributes={updateAttributes}
      deleteNode={deleteNode}
      cardContext={opts.cardContext === true}
      config={{
        hostClass: "tex-block",
        sourceAttr: "code",
        chipLabel: ".tex",
        kindLabel: "LaTeX block",
        emptyLabel: "(empty .tex)",
        confirmMessage:
          "This will remove the LaTeX block and its contents. You can undo with Cmd+Z.",
        isPopped,
      }}
    />
  );
}
