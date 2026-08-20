"use client";

/**
 * `forestBlock`'s float body — the source-pod twin of {@link TexBlockBody},
 * one attr over: `source` holds the WHOLE `\begin{forest}…\end{forest}`
 * environment, so the popout edits the environment's bytes exactly as the
 * in-place pod does.
 *
 * The in-place body renders the TREE (task 384); this float stays source-only —
 * a popout is where you go to edit the bytes, and the in-place pod's own corner
 * toggle already reaches the source without lifting. What does travel is the
 * refusal BADGE, so a lifted block still says why it would not render.
 */

import { SourcePodFloatBody } from "./source-pod-body";
import { deriveForestPod } from "@/lib/forest/pod-config";
import type { TextObjectFloatBodyProps } from "../types";

export function ForestBlockBody(props: TextObjectFloatBodyProps) {
  return (
    <SourcePodFloatBody
      {...props}
      config={{
        kind: "forestBlock",
        sourceAttr: "source",
        chipLabel: "forest",
        // The float is source-only; the derivation's BANNER half still travels,
        // so lifting a refused tree does not lose the diagnosis.
        derive: deriveForestPod,
      }}
    />
  );
}
