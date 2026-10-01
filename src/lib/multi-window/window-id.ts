/**
 * Per-window UUID. Stored in sessionStorage so it survives a reload of
 * the same window but dies when the window closes. Every per-window
 * record in IndexedDB / localStorage (tabs, view prefs, dock state)
 * keys off this value.
 *
 * sessionStorage is NOT proof of uniqueness: the browser's "Duplicate tab"
 * (and a session restore that reopens one tab twice) copies it wholesale,
 * so two live windows can read the same stored id. The uniqueness check
 * lives at the one place that can know — the liveness lock
 * (`claimWindowIdentity` in `window-liveness.ts`, task 871) — which calls
 * `remintWindowId()` when a live twin already holds the stored id.
 *
 * SSR-safe: returns "ssr" during server render. Real client code only
 * reads it inside effects, so the placeholder never hits storage.
 */

const KEY = "virgil-window-id";

let cached: string | null = null;

export function getWindowId(): string {
  if (typeof window === "undefined") return "ssr";
  if (cached) return cached;
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    if (!cached) cached = crypto.randomUUID();
    return cached;
  }
}

/** Replace this window's id with a fresh one (stored, so a reload of the
 *  twin keeps its NEW id). Only `claimWindowIdentity` calls this — when the
 *  inherited id is held by another live window. */
export function remintWindowId(): string {
  const fresh = crypto.randomUUID();
  cached = fresh;
  try {
    sessionStorage.setItem(KEY, fresh);
  } catch {
    /* in-memory id still unique for this page's life */
  }
  return fresh;
}

/** Test seam. */
export function __resetWindowIdForTest(): void {
  cached = null;
}
