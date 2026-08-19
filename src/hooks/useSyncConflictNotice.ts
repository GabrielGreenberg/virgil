"use client";

import { useSyncExternalStore } from "react";
import {
  getSyncConflictNotice,
  subscribeSyncConflictNotices,
  type SyncConflictNotice,
} from "@/lib/sync-conflict-notice";

/**
 * React read of the standing sync-conflict report for a doc (task 363).
 *
 * The same `useSyncExternalStore` shape `usePreservationNotice` and
 * `useExternalChanges` have, and for the same reason: the fact is produced by a
 * fire-and-forget scan at doc activation, and the store's per-doc snapshot is a
 * FROZEN object whose identity changes only when that doc's report does.
 *
 * KEYSTROKE SANCTITY: no editor subscription, no polling. The store notifies
 * once per scan and once per dismissal — never per keystroke.
 */
export function useSyncConflictNotice(
  docId: string | null,
): SyncConflictNotice | null {
  return useSyncExternalStore(
    subscribeSyncConflictNotices,
    () => getSyncConflictNotice(docId),
    () => null, // server: no folder, no forks
  );
}
