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
 *
 * SCOPING (task 111): the flat view prefs (showLabels …) are app-global by
 * design — how you like your outline is not a per-paper fact. The FOLD SET is
 * per-document: fold ids are 4-hex block uuids that are only unique WITHIN a
 * doc (assignUuids/BlockUuidBackfill dedup per doc, not across docs), so one
 * global set both bled folds across papers on uuid collision and let
 * expand/collapse-all in paper B wipe paper A's persisted folds. Folds now
 * live in per-doc buckets (`folds: Map<docId, ids[]>`, LRU-capped), with the
 * pre-scoping flat set kept as a read-only fallback for docs that haven't
 * written a bucket since the migration.
 *
 * CROSS-WINDOW: multi-window is first-class (Cmd-Shift-N). The store
 * re-hydrates from the native `storage` event, so a peer window's write
 * refreshes this window's snapshot instead of going permanently stale — the
 * stale-snapshot whole-blob clobber class useViewPrefs solved with its
 * global-pref bus; here the browser event is sufficient because the whole
 * blob is global (no per-window slice to protect).
 */

export interface OutlinePrefs {
  /**
   * Per-document fold buckets — durable heading/parTitle block uuids (see
   * extractHeadings), keyed by docId. Insertion order = recency (LRU): a
   * bucket write moves its doc to the tail; the head is evicted beyond
   * MAX_FOLD_DOCS. A Map (not a Record) so numeric-looking docIds can't be
   * reordered by JS integer-key semantics.
   */
  folds: ReadonlyMap<string, readonly string[]>;
  /**
   * Pre-scoping flat fold set (legacy `collapsed`), served read-only to any
   * doc with NO bucket so folds survive the shape migration. A doc's first
   * bucket write supersedes it for that doc; it never grows.
   */
  legacyCollapsed: readonly string[] | null;
  showLabels: boolean;
  showTitles: boolean;
  showWordCount: boolean;
  showPosition: boolean;
  showNumbers: boolean;
}

import { subscribeToStorageKey } from "@/lib/cross-window-storage";

const STORAGE_KEY = "virgil-outline-prefs";

/** LRU cap on per-doc fold buckets — bounds blob growth across doc history. */
const MAX_FOLD_DOCS = 64;

const EMPTY_FOLDS: readonly string[] = Object.freeze([]);

const DEFAULTS: OutlinePrefs = {
  folds: new Map(),
  legacyCollapsed: null,
  showLabels: true,
  showTitles: true,
  showWordCount: true,
  showPosition: true,
  showNumbers: false,
};

/** Serializable shape written to localStorage. `folds` persists as entry
 *  pairs (not a Record) to preserve LRU insertion order round-trip. The
 *  legacy shape had a flat `collapsed: string[]` instead — migrated on read. */
interface OutlinePrefsJson {
  folds?: [string, string[]][];
  legacyCollapsed?: string[];
  /** Legacy (pre-doc-scoping) flat fold set. */
  collapsed?: string[];
  showLabels?: boolean;
  showTitles?: boolean;
  showWordCount?: boolean;
  showPosition?: boolean;
  showNumbers?: boolean;
}

function readFromStorage(): OutlinePrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<OutlinePrefsJson>;
    const folds = new Map<string, readonly string[]>();
    if (Array.isArray(parsed.folds)) {
      for (const entry of parsed.folds) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        folds.set(entry[0], Array.isArray(entry[1]) ? entry[1] : []);
      }
    }
    // Migration: a legacy blob has the flat `collapsed` array. Keep it as the
    // read fallback for un-bucketed docs (it can't be attributed to a doc).
    const legacy = Array.isArray(parsed.legacyCollapsed)
      ? parsed.legacyCollapsed
      : Array.isArray(parsed.collapsed) && parsed.collapsed.length > 0
        ? parsed.collapsed
        : null;
    return {
      folds,
      legacyCollapsed: legacy,
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
      folds: [...p.folds.entries()].map(([k, v]) => [k, [...v]]),
      ...(p.legacyCollapsed ? { legacyCollapsed: [...p.legacyCollapsed] } : {}),
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
// React loops. We only ever replace `current` inside the setters (and the
// cross-window `storage` re-hydrate below).
let current: OutlinePrefs = readFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Cross-window re-sync: a peer window's write lands here via the native
// `storage` event (never fired in the writing window itself), so this
// window's snapshot can't go stale and its next write can't clobber the
// peer's from a stale base. This store first carried the fix (task 111); the
// listener contract — including the `key === null` storage.clear() guard that
// must accept only localStorage clears — now lives in ONE place
// (`subscribeToStorageKey`), which the panel color/typography stores ride too
// (task 177). Behavior here is unchanged.
subscribeToStorageKey(STORAGE_KEY, () => {
  current = readFromStorage();
  emit();
});

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

/**
 * The fold-id array for one document: its bucket, else the legacy flat set,
 * else a stable empty array. Referentially stable while that doc's bucket is
 * untouched (bucket arrays carry over by reference on unrelated writes), so
 * a `useMemo(() => new Set(arr), [arr])` over it doesn't churn.
 */
export function getOutlineCollapsedForDoc(
  prefs: OutlinePrefs,
  docId: string,
): readonly string[] {
  return prefs.folds.get(docId) ?? prefs.legacyCollapsed ?? EMPTY_FOLDS;
}

/** Patch one or more flat prefs (not folds). Persists + notifies. */
export function setOutlinePrefs(
  patch: Partial<Omit<OutlinePrefs, "folds" | "legacyCollapsed">>,
) {
  current = { ...current, ...patch };
  writeToStorage(current);
  emit();
}

/**
 * Replace ONE document's fold set, by value or via an updater over the
 * current effective set (bucket or legacy fallback). Only that doc's bucket
 * changes — expand/collapse-all in one paper can no longer touch another's.
 */
export function setOutlineCollapsedForDoc(
  docId: string,
  next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>),
) {
  const prevArr = getOutlineCollapsedForDoc(current, docId);
  const prevSet: ReadonlySet<string> = new Set(prevArr);
  const resolved = typeof next === "function" ? next(prevSet) : next;
  if (resolved === prevSet) return;
  // Value-equality bail — but only once the doc HAS a bucket: an equal-value
  // first write still matters because bucket existence turns off the legacy
  // fallback for this doc.
  if (
    current.folds.has(docId) &&
    resolved.size === prevArr.length &&
    prevArr.every((id) => resolved.has(id))
  ) {
    return;
  }
  const folds = new Map(current.folds);
  folds.delete(docId); // re-insert at the tail = most recently used
  folds.set(docId, [...resolved]);
  while (folds.size > MAX_FOLD_DOCS) {
    const oldest = folds.keys().next().value as string;
    folds.delete(oldest);
  }
  current = { ...current, folds };
  writeToStorage(current);
  emit();
}
