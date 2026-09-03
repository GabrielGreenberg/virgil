/**
 * **The two tab edges** — one shared `visibilitychange` (+ window `focus`)
 * subscriber publishing the SETTLE edge (task 363) and the RETURN edge
 * (task 542).
 *
 * ## The settle edge — `onTabHidden`
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
 * ## The return edge — `onTabReturn`
 *
 * The mirror image, for READERS of disk state rather than writers of it. A
 * standing notice derived from a folder listing (the sync-conflict pill) or
 * from file bytes (the DiskWatcher's external-change badge) has no way to learn
 * about an out-of-band change — and out-of-band changes are, by construction,
 * made while the user is NOT looking at this tab: cleaning conflicted copies in
 * Finder, a sync daemon landing a fork, an editor writing the `.tex`. So the
 * moment the user COMES BACK is exactly the edge that observes them, and it is
 * the one edge such a reader needs. Two events carry it, and both are
 * subscribed because neither alone is the whole answer:
 *
 * - `visibilitychange` → `visible`: a tab switch, an un-minimize, a fully
 *   occluded window coming forward.
 * - window `focus`: the PWA window regaining OS focus WITHOUT ever having been
 *   hidden — the ordinary macOS case, where a partly covered window stays
 *   `visible` the whole time the user is in Finder beside it.
 *
 * On a plain tab switch the two fire back to back, so a return is COALESCED:
 * one delivery per {@link RETURN_COALESCE_MS} window. A subscriber therefore
 * pays one unit of work per genuine return, never one per event.
 *
 * ## Why one module
 *
 * One listener, N subscribers: ~20 `usePersistentState` instances are mounted
 * per document (one per sidecar) and up to four documents are kept alive at
 * once, so a per-hook `document.addEventListener` would install ~80 identical
 * listeners for one event. The document/window listeners here are installed on
 * the FIRST subscriber of EITHER edge and removed with the last.
 *
 * KEYSTROKE SANCTITY: these are `document`/`window` listeners, not
 * `editor.on(...)` subscribers, and they fire only on a real visibility or
 * focus flip. Typing runs zero code here.
 */

const hiddenSubscribers = new Set<() => void>();
const returnSubscribers = new Set<() => void>();
let attached = false;

/** Two return events inside this window are ONE return — a tab switch fires
 *  `visibilitychange` and window `focus` back to back. */
export const RETURN_COALESCE_MS = 250;
let lastReturnAt = -Infinity;

function deliver(subs: Set<() => void>): void {
  // Copy first: a subscriber may unsubscribe from inside its own callback.
  for (const fn of [...subs]) {
    try {
      fn();
    } catch {
      /* one subscriber's failure must not strand the rest of the edge */
    }
  }
}

function fireReturn(): void {
  if (returnSubscribers.size === 0) return;
  const now = Date.now();
  if (now - lastReturnAt < RETURN_COALESCE_MS) return;
  lastReturnAt = now;
  deliver(returnSubscribers);
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    deliver(hiddenSubscribers);
    return;
  }
  fireReturn();
}

function onWindowFocus(): void {
  fireReturn();
}

function attachIfNeeded(): void {
  if (attached) return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onWindowFocus);
  }
  attached = true;
}

function detachIfIdle(): void {
  if (!attached) return;
  if (hiddenSubscribers.size > 0 || returnSubscribers.size > 0) return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (typeof window !== "undefined") {
    window.removeEventListener("focus", onWindowFocus);
  }
  attached = false;
}

/**
 * Run `fn` whenever the tab becomes hidden. Returns the unsubscribe. A no-op
 * (returning a no-op unsubscribe) outside the browser.
 */
export function onTabHidden(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  hiddenSubscribers.add(fn);
  attachIfNeeded();
  return () => {
    hiddenSubscribers.delete(fn);
    detachIfIdle();
  };
}

/**
 * Run `fn` whenever the user RETURNS to this tab — it becomes visible again, or
 * the window regains focus — coalesced to one call per return. Returns the
 * unsubscribe. A no-op (returning a no-op unsubscribe) outside the browser.
 *
 * Never fires on subscribe: a reader that wants an initial pass performs it
 * itself, so subscribing cannot double a doc-open read.
 */
export function onTabReturn(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  returnSubscribers.add(fn);
  attachIfNeeded();
  return () => {
    returnSubscribers.delete(fn);
    detachIfIdle();
  };
}

/** Test door: forget the last return, so a suite's next return is delivered
 *  whatever the previous test did inside the coalescing window. */
export function __resetTabReturnForTests(): void {
  lastReturnAt = -Infinity;
}
