"use client";

/**
 * `forestBlock`'s float body — the source-pod twin of {@link TexBlockBody},
 * one attr over: `source` holds the WHOLE `\begin{forest}…\end{forest}`
 * environment, so the popout edits the environment's bytes exactly as the
 * in-place pod does.
 *
 * Task 384 replaces the in-place body with the native tree renderer; the float
 * is where the source stays reachable when it does.
 */

import { SourcePodFloatBody } from "./source-pod-body";
import type { TextObjectFloatBodyProps } from "../types";

export function ForestBlockBody(props: TextObjectFloatBodyProps) {
  return (
    <SourcePodFloatBody
      {...props}
      config={{ kind: "forestBlock", sourceAttr: "source", chipLabel: "forest" }}
    />
  );
}
