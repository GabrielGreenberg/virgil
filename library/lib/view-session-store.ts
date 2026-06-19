// Unified Library view-session store.
//
// ONE coherent, versioned localStorage blob holding the Library tab's
// per-machine view state (selection, search query, list scroll, per-list
// sort, left active-tab override, plus the global pins / cited-only /
// layout slices). Replaces the N scattered `useState` + per-key
// `localStorage` effect pairs that lost state on reload (and on the
// Library's many remounts).
//
// ── Why a MODULE-LEVEL SINGLETON, not React context / useState ──────────
// Every Library React mount point fully REMOUNTS on doc-switch / pane-toggle
// (`LibraryTabView` is `key={currentDocId}`; the `activePane` block is
// conditionally mounted). A context/provider/useState store living below
// that boundary would lose its in-memory state on those remounts —
// reproducing the exact bug this fixes. The singleton lives in a module
// variable; consumers subscribe via `useSyncExternalStore`. It survives
// every remount.
//
// See docs/memos/library-audit/persistence-plan.md (the build spec).

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  loadSort,
  loadWidths,
  type ResizableColId,
  type SortColId,
  type SortDir,
} from "./list-columns";

// ── storage key + version ───────────────────────────────────────────────

export const VIEW_SESSION_KEY = "virgil-library-view-session";

export const SCHEMA_VERSION = 1 as const;

/** Debounce window for the shared trailing write. Collapses per-keystroke
 *  (query) and per-scroll-frame (scroll) churn into ≤1 write / 250 ms. */
const WRITE_DEBOUNCE_MS = 250;

// ── legacy keys read ONLY by the one-shot Tier-A seed ───────────────────

const PAPER_PINNED_KEY = "virgil-library-paper-pinned";
const PROJECT_HIDDEN_KEY = "virgil-library-project-hidden";
const PROJECT_PINNED_KEY = "virgil-library-project-pinned";
const CITED_ONLY_KEY = "virgil-library-project-cited-only";
const NAV_WIDTH_KEY = "virgil-library-nav-width";
const MIDDLE_WIDTH_KEY = "virgil-library-left-width"; // back-compat name
const PAPERS_HEIGHT_KEY = "virgil-library-papers-height";

// ── types ───────────────────────────────────────────────────────────────

export type PanelKey = "left" | "right";

export interface PanelTabsState {
  // mirrors library-store.ts PanelTabsState. Tier B only — absent/ignored
  // in Tier A; nothing reads it yet.
  openIds: string[];
  activeId: string;
}

export interface ListView {
  // sort is per-(panel,libId) — the coherence fix. Optional so an
  // un-touched list inherits the default {col:'year',dir:'desc'}.
  sort?: { col: SortColId; dir: SortDir };
  // query is per-(panel,libId) so each library remembers its own filter
  // and it survives the LeftList per-tab remount.
  query?: string;
  // scrollTop is per-(panel,libId). Catalog rows container for a list; the
  // reader scroll for a paper:<citekey> "list".
  scrollTop?: number;
}

export interface PanelState {
  tabs?: PanelTabsState; // Tier B only
  leftPinnedActiveId?: string | null; // left panel only
  selectedKeys: string[]; // per-PANEL row highlight
  anchorKey: string | null; // shift-click pivot; travels with selectedKeys
  lists: Record<string, ListView>; // keyed by libId
}

export interface ScopeState {
  left: PanelState;
  right: PanelState;
}

export interface LibraryViewSession {
  schemaVersion: 1;
  scopes: Record<string, ScopeState>; // '' = singleton, 'outer:<libId>' = tear-out
  // ── global slices (singleton-only writers today; kept global) ─────────
  paperPinned: string[];
  projectHidden: string[];
  projectPinned: string[];
  citedOnly: boolean;
  layout: {
    navWidth?: number;
    middleWidth?: number;
    papersHeight?: number;
    colWidths?: Partial<Record<ResizableColId, number>>;
  };
}

// ── empty / default builders ────────────────────────────────────────────

function emptyPanel(): PanelState {
  return { selectedKeys: [], anchorKey: null, lists: {} };
}

function emptyScope(): ScopeState {
  return { left: emptyPanel(), right: emptyPanel() };
}

/** The fallback session when there is no blob, a corrupt blob, or a
 *  wrong/missing schema version. Worst case lands here and the user keeps
 *  legacy keys (read only on the absent-blob seed path). */
function emptySession(): LibraryViewSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    scopes: {},
    paperPinned: [],
    projectHidden: [],
    projectPinned: [],
    citedOnly: false,
    layout: {},
  };
}

// ── module singleton state ──────────────────────────────────────────────

let session: LibraryViewSession | null = null;
let initialized = false;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

// ── persistence helpers (ALL localStorage access wrapped in try/catch) ──

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readNum(key: string): number | undefined {
  if (!hasStorage()) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function readStringArray(key: string): string[] {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Versioned reader. NEVER throws. Discards to an EMPTY session on any
 * parse error / non-object root / wrong-or-missing schemaVersion — so a
 * corrupt blob falls back to legacy keys (via the seed) rather than
 * wiping state. Returns `null` when the blob is simply ABSENT, so the
 * caller knows to run the one-shot seed.
 */
function readBlob(): LibraryViewSession | null {
  if (!hasStorage()) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(VIEW_SESSION_KEY);
  } catch {
    // Storage access itself threw (private mode etc.) — treat as absent.
    return null;
  }
  if (raw == null) return null; // absent → caller seeds
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== SCHEMA_VERSION
    ) {
      // Non-object root or wrong/missing version → discard, but DON'T
      // re-seed (the blob exists, just unreadable by this code). Empty
      // session keeps the user from losing the keys; a future
      // migrateSession() ladder would slot in here for v2+.
      return emptySession();
    }
    return normalizeSession(parsed as LibraryViewSession);
  } catch {
    return emptySession();
  }
}

/** Coerce a parsed blob into a well-formed session, filling any missing
 *  fields with defaults. Defensive against partial / hand-edited blobs;
 *  never throws. */
function normalizeSession(raw: LibraryViewSession): LibraryViewSession {
  const base = emptySession();
  const out: LibraryViewSession = {
    schemaVersion: SCHEMA_VERSION,
    scopes: {},
    paperPinned: Array.isArray(raw.paperPinned)
      ? raw.paperPinned.filter((v): v is string => typeof v === "string")
      : base.paperPinned,
    projectHidden: Array.isArray(raw.projectHidden)
      ? raw.projectHidden.filter((v): v is string => typeof v === "string")
      : base.projectHidden,
    projectPinned: Array.isArray(raw.projectPinned)
      ? raw.projectPinned.filter((v): v is string => typeof v === "string")
      : base.projectPinned,
    citedOnly: raw.citedOnly === true,
    layout:
      raw.layout && typeof raw.layout === "object" ? { ...raw.layout } : {},
  };
  if (raw.scopes && typeof raw.scopes === "object") {
    for (const [scope, scopeState] of Object.entries(raw.scopes)) {
      out.scopes[scope] = normalizeScope(scopeState as ScopeState);
    }
  }
  return out;
}

function normalizeScope(raw: ScopeState | undefined): ScopeState {
  return {
    left: normalizePanel(raw?.left),
    right: normalizePanel(raw?.right),
  };
}

function normalizePanel(raw: PanelState | undefined): PanelState {
  const p = emptyPanel();
  if (!raw || typeof raw !== "object") return p;
  if (Array.isArray(raw.selectedKeys)) {
    p.selectedKeys = raw.selectedKeys.filter(
      (v): v is string => typeof v === "string",
    );
  }
  p.anchorKey = typeof raw.anchorKey === "string" ? raw.anchorKey : null;
  if (typeof raw.leftPinnedActiveId === "string" || raw.leftPinnedActiveId === null) {
    p.leftPinnedActiveId = raw.leftPinnedActiveId;
  }
  if (raw.tabs && typeof raw.tabs === "object") p.tabs = raw.tabs;
  if (raw.lists && typeof raw.lists === "object") {
    for (const [libId, lv] of Object.entries(raw.lists)) {
      if (lv && typeof lv === "object") p.lists[libId] = { ...lv };
    }
  }
  return p;
}

/**
 * One-shot Tier-A read-through seed. Runs ONLY when the blob is absent.
 * Pulls the legacy global keys into the new blob so a mid-stream user
 * keeps everything. NEVER overwrites an existing blob and NEVER deletes a
 * legacy key. Re-running it is a pure no-op (gated by the `initialized`
 * flag + the absent-blob check in `ensureInit`).
 */
function seedFromLegacy(): LibraryViewSession {
  const s = emptySession();
  s.paperPinned = readStringArray(PAPER_PINNED_KEY);
  s.projectHidden = readStringArray(PROJECT_HIDDEN_KEY);
  s.projectPinned = readStringArray(PROJECT_PINNED_KEY);
  if (hasStorage()) {
    try {
      s.citedOnly = localStorage.getItem(CITED_ONLY_KEY) === "1";
    } catch {
      s.citedOnly = false;
    }
  }
  // Widths: reuse the validated loader (clamps + fills defaults).
  try {
    s.layout.colWidths = { ...loadWidths() };
  } catch {
    /* leave undefined */
  }
  const navWidth = readNum(NAV_WIDTH_KEY);
  if (navWidth !== undefined) s.layout.navWidth = navWidth;
  const middleWidth = readNum(MIDDLE_WIDTH_KEY);
  if (middleWidth !== undefined) s.layout.middleWidth = middleWidth;
  const papersHeight = readNum(PAPERS_HEIGHT_KEY);
  if (papersHeight !== undefined) s.layout.papersHeight = papersHeight;
  // col-sort → the DEFAULT sort of the SINGLETON central list only. Every
  // other (panel,libId) inherits {col:'year',dir:'desc'} until the user
  // sorts it (the coherence fix).
  try {
    const sort = loadSort();
    const scope = ensureScope(s, "");
    scope.left.lists["central"] = { sort };
  } catch {
    /* leave default */
  }
  return s;
}

/** Lazy init: read the blob once; seed from legacy ONLY when absent. */
function ensureInit(): LibraryViewSession {
  if (initialized && session) return session;
  const existing = readBlob();
  if (existing) {
    session = existing;
  } else {
    // Absent blob → one-shot seed, then immediately persist so the blob
    // exists and the seed never runs again.
    session = seedFromLegacy();
    persistNow(session);
  }
  initialized = true;
  return session;
}

// ── write path (shared 250 ms debounce + flush) ─────────────────────────

function persistNow(s: LibraryViewSession): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(VIEW_SESSION_KEY, JSON.stringify(s));
  } catch {
    // Quota / private-mode: leave the user where they are. The in-memory
    // session is still authoritative for this page lifetime.
  }
}

function armWrite(): void {
  if (typeof window === "undefined") {
    // Non-browser (SSR/node test without timers): write straight through.
    if (session) persistNow(session);
    return;
  }
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (session) persistNow(session);
  }, WRITE_DEBOUNCE_MS);
}

/** Clear the pending timer and write immediately. Gated by callers on the
 *  "pending write exists" sentinel (`writeTimer !== null`) for the
 *  pagehide/visibilitychange flush, exactly like useDocument. Safe to call
 *  when nothing is pending. */
export function flushNow(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (session) persistNow(session);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Apply a structural change: swap in the new session ref, notify
 *  subscribers (UI is instant), then arm the debounced write. */
function commit(next: LibraryViewSession): void {
  session = next;
  notify();
  armWrite();
}

// ── immutable slice rebuilders (new refs only along the changed path) ───

function ensureScope(s: LibraryViewSession, scope: string): ScopeState {
  // Mutating helper used during seed construction (before the session is
  // shared). For commits we always build a fresh tree below.
  if (!s.scopes[scope]) s.scopes[scope] = emptyScope();
  return s.scopes[scope];
}

function withScopePanel(
  s: LibraryViewSession,
  scope: string,
  panel: PanelKey,
  fn: (p: PanelState) => PanelState,
): LibraryViewSession {
  const prevScope = s.scopes[scope] ?? emptyScope();
  const prevPanel = prevScope[panel] ?? emptyPanel();
  const nextPanel = fn(prevPanel);
  const nextScope: ScopeState = { ...prevScope, [panel]: nextPanel };
  return { ...s, scopes: { ...s.scopes, [scope]: nextScope } };
}

// ── public snapshot + subscription ──────────────────────────────────────

/** Sync snapshot. Lazy-inits + seeds once on first access. */
export function getSession(): LibraryViewSession {
  return ensureInit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── granular mutators ───────────────────────────────────────────────────

export function setPanelTabs(
  scope: string,
  panel: PanelKey,
  tabs: PanelTabsState,
): void {
  const s = ensureInit();
  commit(withScopePanel(s, scope, panel, (p) => ({ ...p, tabs })));
}

export function setSelection(
  scope: string,
  panel: PanelKey,
  sel: { selectedKeys: string[]; anchorKey: string | null },
): void {
  const s = ensureInit();
  commit(
    withScopePanel(s, scope, panel, (p) => ({
      ...p,
      selectedKeys: [...sel.selectedKeys],
      anchorKey: sel.anchorKey,
    })),
  );
}

export function setLeftPinnedActiveId(scope: string, id: string | null): void {
  const s = ensureInit();
  commit(
    withScopePanel(s, scope, "left", (p) => ({ ...p, leftPinnedActiveId: id })),
  );
}

function withList(
  p: PanelState,
  libId: string,
  patch: Partial<ListView>,
): PanelState {
  const prev = p.lists[libId] ?? {};
  return {
    ...p,
    lists: { ...p.lists, [libId]: { ...prev, ...patch } },
  };
}

export function setListSort(
  scope: string,
  panel: PanelKey,
  libId: string,
  sort: { col: SortColId; dir: SortDir },
): void {
  const s = ensureInit();
  commit(withScopePanel(s, scope, panel, (p) => withList(p, libId, { sort })));
}

export function setListQuery(
  scope: string,
  panel: PanelKey,
  libId: string,
  q: string,
): void {
  const s = ensureInit();
  commit(withScopePanel(s, scope, panel, (p) => withList(p, libId, { query: q })));
}

export function setListScroll(
  scope: string,
  panel: PanelKey,
  libId: string,
  top: number,
): void {
  const s = ensureInit();
  commit(
    withScopePanel(s, scope, panel, (p) => withList(p, libId, { scrollTop: top })),
  );
}

export function togglePaperPin(id: string): void {
  const s = ensureInit();
  const has = s.paperPinned.includes(id);
  const next = has
    ? s.paperPinned.filter((x) => x !== id)
    : [...s.paperPinned, id];
  commit({ ...s, paperPinned: next });
}

export function setProjectHidden(ids: string[]): void {
  const s = ensureInit();
  commit({ ...s, projectHidden: [...ids] });
}

export function setProjectPinned(ids: string[]): void {
  const s = ensureInit();
  commit({ ...s, projectPinned: [...ids] });
}

export function setCitedOnly(v: boolean): void {
  const s = ensureInit();
  commit({ ...s, citedOnly: v });
}

export function setLayout(patch: Partial<LibraryViewSession["layout"]>): void {
  const s = ensureInit();
  commit({ ...s, layout: { ...s.layout, ...patch } });
}

// ── selector-side helpers (cached-equality snapshots) ───────────────────

const DEFAULT_SORT: { col: SortColId; dir: SortDir } = { col: "year", dir: "desc" };

// Stable singletons for the absent/default slices. The readers MUST return a
// referentially-stable value when the slice is missing — `useSyncExternalStore`
// caches on identity, so minting a fresh `emptyPanel()` / `{}` per call would
// defeat the hooks' snapshot caches and loop ("getSnapshot should be cached").
// These are treated as read-only; mutators never touch them (they build fresh
// trees via `withScopePanel` / `withList`).
const EMPTY_PANEL: PanelState = emptyPanel();
const EMPTY_LIST_VIEW: ListView = {};

function readScopePanel(scope: string, panel: PanelKey): PanelState {
  const s = ensureInit();
  return s.scopes[scope]?.[panel] ?? EMPTY_PANEL;
}

function readListView(scope: string, panel: PanelKey, libId: string): ListView {
  return readScopePanel(scope, panel).lists[libId] ?? EMPTY_LIST_VIEW;
}

// ── React hooks (layered on useSyncExternalStore) ───────────────────────

/** Whole-snapshot hook. Re-renders on ANY change. Prefer the granular
 *  selectors below for panel-scoped consumers. */
export function useLibraryViewSession(): LibraryViewSession {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

/** Per-panel selection (selectedKeys + anchorKey + setter). Returns a
 *  cached Set so a panel-A change doesn't re-render panel-B consumers. */
export function usePanelSelection(
  scope: string,
  panel: PanelKey,
): {
  selectedKeys: ReadonlySet<string>;
  anchorKey: string | null;
  setSelection: (keys: ReadonlySet<string>, anchor: string | null) => void;
} {
  // Cache the WHOLE returned snapshot keyed by the source array reference
  // AND the anchorKey, so the snapshot is referentially stable while the
  // panel slice is unchanged. useSyncExternalStore requires getSnapshot to
  // return an identical reference between calls when nothing changed —
  // returning a fresh object literal (even with a cached inner Set) loops
  // ("getSnapshot should be cached" / "Maximum update depth exceeded"). The
  // default-empty mount returns the same `emptyPanel().selectedKeys` shape;
  // caching the whole snap keeps that case stable across calls too.
  type Snap = {
    selectedKeys: ReadonlySet<string>;
    anchorKey: string | null;
  };
  const cacheRef = useRef<{
    srcKeys: string[];
    anchorKey: string | null;
    snap: Snap;
  } | null>(null);
  const getSnap = useCallback((): Snap => {
    const p = readScopePanel(scope, panel);
    let c = cacheRef.current;
    if (!c || c.srcKeys !== p.selectedKeys || c.anchorKey !== p.anchorKey) {
      c = {
        srcKeys: p.selectedKeys,
        anchorKey: p.anchorKey,
        snap: { selectedKeys: new Set(p.selectedKeys), anchorKey: p.anchorKey },
      };
      cacheRef.current = c;
    }
    return c.snap;
  }, [scope, panel]);
  const snap = useSyncExternalStore(subscribe, getSnap, getSnap);
  const setSelectionCb = useCallback(
    (keys: ReadonlySet<string>, anchor: string | null) => {
      setSelection(scope, panel, { selectedKeys: [...keys], anchorKey: anchor });
    },
    [scope, panel],
  );
  return {
    selectedKeys: snap.selectedKeys,
    anchorKey: snap.anchorKey,
    setSelection: setSelectionCb,
  };
}

/** Per-(panel,library) list view: sort (with default fallback), query,
 *  scrollTop + setters. */
export function useListView(
  scope: string,
  panel: PanelKey,
  libId: string,
): {
  sort: { col: SortColId; dir: SortDir };
  query: string;
  scrollTop: number;
  setSort: (s: { col: SortColId; dir: SortDir }) => void;
  setQuery: (q: string) => void;
  setScroll: (top: number) => void;
} {
  // `readListView` returns the stable module-level `EMPTY_LIST_VIEW` for the
  // absent/default slice, so `lv` is referentially stable across calls in the
  // common (un-sorted, un-queried) case and this cache holds — no loop. The
  // populated path is stable too: the store hands back the same ListView ref
  // until a mutation rebuilds that slice.
  const cacheRef = useRef<{ src: ListView; view: ListView } | null>(null);
  const getSnap = useCallback((): ListView => {
    const lv = readListView(scope, panel, libId);
    if (!cacheRef.current || cacheRef.current.src !== lv) {
      cacheRef.current = { src: lv, view: lv };
    }
    return cacheRef.current.view;
  }, [scope, panel, libId]);
  const lv = useSyncExternalStore(subscribe, getSnap, getSnap);
  const setSort = useCallback(
    (s: { col: SortColId; dir: SortDir }) => setListSort(scope, panel, libId, s),
    [scope, panel, libId],
  );
  const setQuery = useCallback(
    (q: string) => setListQuery(scope, panel, libId, q),
    [scope, panel, libId],
  );
  const setScroll = useCallback(
    (top: number) => setListScroll(scope, panel, libId, top),
    [scope, panel, libId],
  );
  return {
    sort: lv.sort ?? DEFAULT_SORT,
    query: lv.query ?? "",
    scrollTop: lv.scrollTop ?? 0,
    setSort,
    setQuery,
    setScroll,
  };
}

/** Global layout prefs (widths / heights / col widths). */
export function useLayoutPrefs(): {
  layout: LibraryViewSession["layout"];
  setLayout: (p: Partial<LibraryViewSession["layout"]>) => void;
} {
  const getSnap = useCallback(() => ensureInit().layout, []);
  const layout = useSyncExternalStore(subscribe, getSnap, getSnap);
  return { layout, setLayout };
}

/** Global cited-only toggle (survives the ProjectLibraryProvider remount). */
export function useCitedOnly(): {
  citedOnly: boolean;
  setCitedOnly: (v: boolean) => void;
} {
  const getSnap = useCallback(() => ensureInit().citedOnly, []);
  const citedOnly = useSyncExternalStore(subscribe, getSnap, getSnap);
  return { citedOnly, setCitedOnly };
}

/**
 * Register the pagehide + visibilitychange flush ONCE. Idempotent — safe
 * even if two Library instances mount it (inline '' scope + a tear-out
 * outer:<libId>), because the writer is debounced and serializes the
 * single blob. Each handler is gated on the "pending write exists"
 * sentinel (`writeTimer !== null`, checked inside `flushNow`'s caller).
 */
export function useLibraryViewSessionFlush(): void {
  useEffect(() => {
    const onPageHide = () => {
      // Only flush when there's pending work — otherwise every mounted
      // instance re-writes on every pagehide.
      if (writeTimer !== null) flushNow();
    };
    const onVisibility = () => {
      if (document.hidden && writeTimer !== null) flushNow();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

// ── test-only reset (NOT for production use) ────────────────────────────

/** Reset the module singleton. Intended for unit tests that need a fresh
 *  store after manipulating localStorage. No-op cost in production (never
 *  called). */
export function __resetViewSessionForTests(): void {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  session = null;
  initialized = false;
  listeners.clear();
}
