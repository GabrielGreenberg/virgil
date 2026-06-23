/**
 * Outline view-preference store.
 *
 * WHY a module-level external store and not per-component `useState`:
 *
 * The Outline panel renders as ONE instance at a time, but that instance is
 * re-mounted when the panel moves between docked and popped-out (the float
 * render loop swaps the wrapping subtree, so React unmounts + remounts the
 * panel body). The previous design held the six view prefs in per-instance
 * `useState`, hydrated from localStorage by a mount effect — so a pop-out
 * dropped the live state to defaults for a frame and, more importantly, any
 * in-flight value not yet flushed was lost. Net effect: prefs "survived
 * reload but not pop-out" (OUT-#7).
 *
 * The fix is to lift the prefs OUT of the component lifecycle into a single
 * shared, localStorage-backed store consumed through `useSyncExternalStore`.
 * Every Outline instance — docked or floating — reads the SAME live snapshot,
 * so the prefs survive BOTH reload (localStorage) and pop-out (state is not
 * tied to any mount). This eliminates the whole class of "per-instance pref
 * lost on remount" bugs rather than patching the one symptom.
 */

export interface OutlinePrefs {
  /** Fold set — durable heading/parTitle ids (uuids; see extractHeadings). */
  collapsed: ReadonlySet<string>;
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  showPosition: boolean;
  showNumbers: boolean;
}

const STORAGE_KEY = "virgil-outline-prefs";

const DEFAULTS: OutlinePrefs = {
  collapsed: new Set<string>(),
  showLabels: true,
  showTitles: true,
  showWordCount: true,
  showPosition: true,
  showNumbers: false,
};

/** Serializable shape written to localStorage (Set → array). */
interface OutlinePrefsJson {
  collapsed: string[];
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  showPosition: boolean;
  showNumbers: boolean;
}

function readFromStorage(): OutlinePrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<OutlinePrefsJson>;
    return {
      collapsed: new Set(Array.isArray(parsed.collapsed) ? parsed.collapsed : []),
      showLabels: parsed.showLabels ?? DEFAULTS.showLabels,
      showTitles: parsed.showTitles ?? DEFAULTS.showTitles,
      showWordCount: parsed.showWordCount ?? DEFAULTS.showWordCount,
      showPosition: parsed.showPosition ?? DEFAULTS.showPosition,
      showNumbers: parsed.showNumbers ?? DEFAULTS.showNumbers,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeToStorage(p: OutlinePrefs) {
  if (typeof window === "undefined") return;
  try {
    const json: OutlinePrefsJson = {
      collapsed: [...p.collapsed],
      showLabels: p.showLabels,
      showTitles: p.showTitles,
      showWordCount: p.showWordCount,
      showPosition: p.showPosition,
      showNumbers: p.showNumbers,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// The single canonical snapshot. `useSyncExternalStore` requires referential
// stability: getSnapshot must return the SAME object until a real change, or
// React loops. We only ever replace `current` inside `setState`.
let current: OutlinePrefs = readFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeOutlinePrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getOutlinePrefsSnapshot(): OutlinePrefs {
  return current;
}

/** SSR snapshot — stable defaults so server and first client render agree. */
export function getOutlinePrefsServerSnapshot(): OutlinePrefs {
  return DEFAULTS;
}

/** Patch one or more flat prefs (not collapsed). Persists + notifies. */
export function setOutlinePrefs(patch: Partial<Omit<OutlinePrefs, "collapsed">>) {
  current = { ...current, ...patch };
  writeToStorage(current);
  emit();
}

/** Replace the fold set, by value or via an updater over the current Set. */
export function setOutlineCollapsed(
  next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>),
) {
  const resolved = typeof next === "function" ? next(current.collapsed) : next;
  if (resolved === current.collapsed) return;
  current = { ...current, collapsed: resolved };
  writeToStorage(current);
  emit();
}
