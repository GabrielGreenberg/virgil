/**
 * In-process pub/sub for the unified `ai-requests.json` inbox.
 *
 * The inbox has two in-app writers that both persist `ai-requests.json`:
 *
 *   1. `useAiRequests` — the hook that OWNS the live inbox React state
 *      (drafts / style-merges / manual requests). It setState + persists.
 *   2. `bridgeCardAiRequestFlag` (`ai-request-bridge.ts`) — fires from the
 *      per-panel hooks (notes / todos / cutter / revisions / reports /
 *      footnotes) when a card's `aiRequest` flag toggles. It read-modify-writes
 *      the file directly, **behind the hook's back**.
 *
 * Before this bus, (2) wrote the file but nothing told (1), so a freshly
 * toggled request didn't appear in the AIWindow until a reload/remount — the
 * dominant "not smoothly culled into the inbox" symptom (AI-request pipeline
 * audit, drop D3). This bus closes that gap: the bridge PUBLISHES the
 * authoritative post-write request list on the doc's channel, and the hook
 * SUBSCRIBES and adopts it — so the bridge write and the inbox state can never
 * diverge without a disk round-trip.
 *
 * Keyed by `docId` so a multi-window session's other docs are untouched. This
 * is a wall-clock doc-state signal (fires only on a flag toggle, never on a
 * keystroke), so it's exempt from the keystroke-sanctity subscriber list.
 */

import type { AiRequest } from "@/lib/types";

export type AiRequestsListener = (requests: AiRequest[]) => void;

const listeners = new Map<string, Set<AiRequestsListener>>();

/**
 * Subscribe to `ai-requests.json` change events for `docId`. Returns an
 * unsubscribe fn. The listener receives the full authoritative request list as
 * of the write that fired the event.
 */
export function subscribeAiRequests(
  docId: string,
  fn: AiRequestsListener,
): () => void {
  let set = listeners.get(docId);
  if (!set) {
    set = new Set();
    listeners.set(docId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(docId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(docId);
  };
}

/**
 * Announce that `docId`'s `ai-requests.json` was just written, carrying the new
 * request list. Called by every in-app writer after a successful persist so all
 * live readers converge on the same state. Best-effort: a throwing listener is
 * isolated so one bad subscriber can't wedge the rest.
 */
export function publishAiRequests(docId: string, requests: AiRequest[]): void {
  const set = listeners.get(docId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(requests);
    } catch {
      // A subscriber's re-render/error must not break the publish fan-out.
    }
  }
}
