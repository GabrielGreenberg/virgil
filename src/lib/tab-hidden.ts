/**
 * **The settle edge** — one shared `visibilitychange` subscriber (task 363).
 *
 * A debounced writer coalesces on the bet that nothing needs the value yet.
 * That bet is only honest if it never outlives the moment the value stops
 * being live, so every coalescing writer settles at the same boundary: the tab
 * going HIDDEN. That is the app-switch / tab-switch / window-close edge, and it
 * is the last edge at which an async File System Access write still reliably
 * completes — `pagehide` and `beforeunload` are past the point where a promise
 * chain is guaranteed to run, so a writer that waited for them would be
 * trading a coalesced write for a lost one.
 *
 * One listener, N subscribers: ~20 `usePersistentState` instances are mounted
 * per document (one per sidecar) and up to four documents are kept alive at
 * once, so a per-hook `document.addEventListener` would install ~80 identical
 * listeners for one event. The document listener here is installed on the FIRST
 * subscriber and removed with the last.
 *
 * KEYSTROKE SANCTITY: this is a `document` listener, not an `editor.on(...)`
 * subscriber, and it fires only on a real visibility flip. Typing runs zero
 * code here.
 */

const subscribers = new Set<() => void>();
let attached = false;

function onVisibilityChange(): void {
  if (document.visibilityState !== "hidden") return;
  // Copy first: a subscriber may unsubscribe from inside its own callback.
  for (const fn of [...subscribers]) {
    try {
      fn();
    } catch {
      /* one writer's failure must not strand the rest of the flush */
    }
  }
}

/**
 * Run `fn` whenever the tab becomes hidden. Returns the unsubscribe. A no-op
 * (returning a no-op unsubscribe) outside the browser.
 */
export function onTabHidden(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  subscribers.add(fn);
  if (!attached) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    attached = true;
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && attached) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      attached = false;
    }
  };
}
