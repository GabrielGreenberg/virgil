"use client";

import { useSyncExternalStore } from "react";
import {
  getSidecarRefusal,
  subscribeSidecarRefusals,
  type SidecarRefusal,
} from "@/lib/sidecar-refusal";

/**
 * React read of the standing sidecar refusal for a doc (task 630) — the same
 * `useSyncExternalStore` shape `usePreservationNotice` has, and for the same
 * reason: the fact is produced on a fire-and-forget write promise, and the
 * store's per-doc snapshot is a FROZEN object whose identity changes only when
 * that doc's refusal does, so this never tears and an unrelated doc's refusal
 * costs one bailed render.
 *
 * KEYSTROKE SANCTITY: no editor subscription, no polling. The store notifies
 * only when a sidecar write is refused or the user acknowledges it.
 */
export function useSidecarRefusal(docId: string | null): SidecarRefusal | null {
  return useSyncExternalStore(
    subscribeSidecarRefusals,
    () => getSidecarRefusal(docId),
    () => null, // server: no document, no refusal
  );
}
