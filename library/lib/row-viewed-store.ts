/**
 * Per-citekey "last viewed" timestamps. Used by the LeftListRow status dot
 * to decide whether a row's most recent completion notification has been
 * acknowledged by the user (i.e. the user clicked the row after the
 * notification arrived).
 *
 * Per-browser via localStorage; no writes back to the library folder.
 */

const KEY = "virgil-library-row-viewed-at";

export type ViewedMap = Record<string, string>;

export function loadViewedMap(): ViewedMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ViewedMap;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveViewedMap(map: ViewedMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function markViewedNow(citekey: string): string {
  const at = new Date().toISOString();
  const map = loadViewedMap();
  map[citekey] = at;
  saveViewedMap(map);
  return at;
}
