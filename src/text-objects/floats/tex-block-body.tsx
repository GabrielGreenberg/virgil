"use client";

/**
 * `texBlock`'s float body — a thin CONFIG over the shared source-pod body.
 *
 * Everything the popout does (the hand-rolled string-attr sync in both
 * directions, the title field, the pod framing, the source-missing banner) is
 * in {@link SourcePodFloatBody}, which `forestBlock` wears too. What is
 * texBlock's own is the kind name, the attr name and the corner chip — the
 * same split the in-place NodeView takes through `SourcePodNodeView`.
 */

import { SourcePodFloatBody } from "./source-pod-body";
import type { TextObjectFloatBodyProps } from "../types";

export function TexBlockBody(props: TextObjectFloatBodyProps) {
  return (
    <SourcePodFloatBody
      {...props}
      config={{ kind: "texBlock", sourceAttr: "code", chipLabel: ".tex" }}
    />
  );
}
