/**
 * Per-window UUID. Stored in sessionStorage so it survives a reload of
 * the same window but dies when the window closes. Every per-window
 * record in IndexedDB / localStorage (tabs, view prefs, dock state)
 * keys off this value.
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
