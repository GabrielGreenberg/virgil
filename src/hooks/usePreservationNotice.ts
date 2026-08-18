"use client";

import { useSyncExternalStore } from "react";
import {
  getPreservationNotice,
  subscribePreservationNotices,
  type PreservationNotice,
} from "@/lib/preservation-notice";

/**
 * React read of the standing preservation refusal for a doc — the surface the
 * preservation banner consumes (task 357 hole 4).
 *
 * The same `useSyncExternalStore` shape `useExternalChanges` has, and for the
 * same reason: the fact is produced deep inside a storage backend on a promise
 * nobody awaits, and the store's per-doc snapshot is a FROZEN object whose
 * identity changes only when that doc's notice does — so this never tears and
 * an unrelated doc's refusal costs one bailed render.
 *
 * KEYSTROKE SANCTITY: no editor subscription, no polling. The store notifies
 * only when a gate refuses or the user acknowledges — never per keystroke.
 */
export function usePreservationNotice(
  docId: string | null,
): PreservationNotice | null {
  return useSyncExternalStore(
    subscribePreservationNotices,
    () => getPreservationNotice(docId),
    () => null, // server: no document, no refusal
  );
}
