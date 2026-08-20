import type { ReactNode } from "react";

/**
 * What a source-pod kind may DERIVE from its own bytes.
 *
 * The pod's model is its source; a kind that can say something more about those
 * bytes than "here they are" contributes this — a rendered PREVIEW to show
 * instead of the code surface, and/or a BANNER of chrome shown above the body in
 * both modes. `forestBlock` supplies both halves from one parse
 * (`deriveForestPod`); `texBlock` supplies neither, and its pod is byte-for-byte
 * the pod it was.
 *
 * A null `preview` is an ANSWER — "these bytes have no derived view" — and it is
 * what pins the pod to source mode, which is exactly the state a refusal wants:
 * the badge names the construct and the source it names sits right below it.
 */
export interface SourcePodDerived {
  preview: ReactNode | null;
  banner: ReactNode | null;
}

/** A pure, STABLE derivation over a pod's source. Stable because the pod memoizes
 *  on `(derive, source)`: a per-render closure would re-derive on every render. */
export type SourcePodDerive = (source: string) => SourcePodDerived;
