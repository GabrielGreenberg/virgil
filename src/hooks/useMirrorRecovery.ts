"use client";

import { useSyncExternalStore } from "react";

import {
  getRecoveryOffer,
  subscribeMirrorRecovery,
  type MirrorRecoveryOffer,
} from "@/lib/mirror-recovery";

/** The standing recovery offer for a doc, or `null`. Frozen + identity-stable,
 *  so a subscriber for doc A re-renders on a doc B change and then bails. */
export function useMirrorRecoveryOffer(
  docId: string | null | undefined,
): MirrorRecoveryOffer | null {
  return useSyncExternalStore(
    subscribeMirrorRecovery,
    () => getRecoveryOffer(docId),
    () => null,
  );
}
