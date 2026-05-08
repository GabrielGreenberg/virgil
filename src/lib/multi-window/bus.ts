/**
 * Cross-window event bus over BroadcastChannel.
 *
 * Every Virgil window opens a single channel and uses this module to
 * publish + subscribe to typed events. The bus is the only mechanism
 * by which one window tells another about state changes (a tab opened,
 * a doc handoff was requested, a global pref changed). The actual
 * persistence still flows through IndexedDB / localStorage; the bus
 * just notifies peers that they should re-read.
 *
 * BroadcastChannel is same-origin, no auth or routing required, and
 * messages are not received by the publishing window — exactly the
 * semantics we want.
 */

import { useEffect } from "react";

import { getWindowId } from "./window-id";

export type BusEvent =
  | { type: "doc-opened"; windowId: string; docId: string }
  | { type: "doc-closed"; windowId: string; docId: string }
  | {
      type: "doc-handoff-request";
      fromWindowId: string;
      toWindowId: string;
      docId: string;
    }
  | { type: "doc-handoff-released"; docId: string; byWindowId: string }
  | { type: "global-pref-changed"; key: string; value: unknown }
  | { type: "window-registry-ping"; windowId: string };

const CHANNEL_NAME = "virgil";

let channel: BroadcastChannel | null = null;
const handlers = new Set<(e: BusEvent) => void>();

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!("BroadcastChannel" in window)) return null;
  if (channel) return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (e) => {
    const data = e.data as BusEvent | undefined;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    for (const fn of handlers) {
      try {
        fn(data);
      } catch (err) {
        console.error("bus handler threw", err);
      }
    }
  });
  return channel;
}

/** Publish an event to every other Virgil window in this origin.
 *  No-op when BroadcastChannel is unavailable (Safari < 15.4, very old
 *  Firefox); the calling code should still work in those environments,
 *  just without cross-window awareness. */
export function publish(event: BusEvent): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage(event);
  } catch (err) {
    console.error("bus publish failed", err);
  }
}

/** Subscribe to every event on the bus. Returns an unsubscribe fn.
 *  Filtering by `type` is the caller's responsibility — the bus has
 *  no per-type subscription split because the volume is low and the
 *  union is small. */
export function subscribe(fn: (e: BusEvent) => void): () => void {
  getChannel(); // ensure listener is wired
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

/** React hook form. Re-subscribes when `fn` identity changes; callers
 *  that want stable behavior should wrap their handler in useCallback. */
export function useBus(fn: (e: BusEvent) => void): void {
  useEffect(() => subscribe(fn), [fn]);
}

/** True iff cross-window plumbing is available in this browser. Used
 *  to feature-gate the "New Window" command so Safari doesn't show a
 *  menu item that wouldn't work coherently. */
export function multiWindowSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "BroadcastChannel" in window &&
    "locks" in navigator &&
    typeof navigator.locks?.request === "function"
  );
}

/** Helper for handoff: publish a request and resolve once the target
 *  window has released. Resolves false on timeout. */
export function awaitRelease(docId: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const unsub = subscribe((e) => {
      if (done) return;
      if (e.type === "doc-handoff-released" && e.docId === docId) {
        done = true;
        unsub();
        resolve(true);
      }
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      unsub();
      resolve(false);
    }, timeoutMs);
  });
}

/** Re-export for callers that need the local id alongside bus access. */
export { getWindowId };
