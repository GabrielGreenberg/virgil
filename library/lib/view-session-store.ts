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
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";
import {
  loadSort,
  loadWidths,
  isReorderableColId,
  isStatusFacet,
  DEFAULT_COL_ORDER,
  type ReorderableColId,
  type ResizableColId,
  type SortState,
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

// Min-floors for the three sizes, mirrored from LibraryView (the resize
// handlers clamp to these). The legacy-size migration applies them so a
// corrupt/sub-min standalone value can't seed a crushed column. Kept in sync
// with LibraryView's LEFT_MIN / NAV_MIN / PAPERS_MIN.
const NAV_WIDTH_MIN = 180;
const MIDDLE_WIDTH_MIN = 220;
const PAPERS_HEIGHT_MIN = 100;

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
  // un-touched list inherits the default {col:'year',dir:'desc'}. The
  // optional `facet` (F#14) is meaningful only when col==="status" — it
  // selects a single index-status facet (pdf/idx/bib/imp) instead of the
  // composite statusRank.
  sort?: SortState;
  // query is per-(panel,libId) so each library remembers its own filter
  // and it survives the LeftList per-tab remount.
  query?: string;
  // scrollTop is per-(panel,libId). Catalog rows container for a list; the
  // reader scroll for a paper:<citekey> "list".
  scrollTop?: number;
  // viewMode is meaningful ONLY on a paper:<citekey> "list" — the paper-detail
  // Text/PDF toggle. Persisted per-(panel,paper) so each source remembers its
  // own Text-vs-PDF posture across reloads AND intra-session paper switches.
  // Absent ⇒ the OPEN-AWARE default resolved by the reader, `usePaperViewMode`:
  // "pdf" when a PDF is on disk, else "text" (a DOCX-only source). A never-
  // toggled paper leaves this unset and rides that default.
  viewMode?: "text" | "pdf";
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
    // F#13: GLOBAL column order (one ordering across every library — a sibling
    // of colWidths in this singleton blob, so it's global-by-construction).
    // A user override; absent ⇒ the consumer falls back to DEFAULT_COL_ORDER.
    // Normalized on read (see normalizeColOrder) so a partial/hand-edited blob
    // can never hide a column.
    colOrder?: ReorderableColId[];
    // Central library landing view. Absent → "dashboard" (the stats home is
    // the default entry point; the heavy virtualized list mounts only when the
    // user explicitly clicks Browse). Persists the user's last explicit choice.
    centralViewMode?: "dashboard" | "list";
    // First-time PDF-drop intro notice. Absent/false ⇒ the post-drop notice
    // shows after each successful file import; once the user checks "Don't
    // show again" it flips true and the notice never reappears. A UI pref
    // (sibling of centralViewMode), so it rides the same global `layout`
    // slice rather than a new top-level field — no emptySession /
    // normalizeSession churn (normalizeLayout spreads raw as-is).
    pdfDropIntroDismissed?: boolean;
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
function readRawBlob(): string | null {
  if (!hasStorage()) return null;
  try {
    return localStorage.getItem(VIEW_SESSION_KEY);
  } catch {
    // Storage access itself threw (private mode etc.) — treat as absent.
    return null;
  }
}

/** Parse + normalize, or `null` when the blob is UNREADABLE by this code
 *  (non-object root, parse error, wrong/missing schema version). Split out so
 *  the two callers below can differ on what "unreadable" should mean. */
function parseSessionBlob(raw: string): LibraryViewSession | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== SCHEMA_VERSION
    ) {
      return null;
    }
    return normalizeSession(parsed as LibraryViewSession);
  } catch {
    return null;
  }
}

function readBlob(): LibraryViewSession | null {
  const raw = readRawBlob();
  if (raw == null) return null; // absent → caller seeds
  // Unreadable at INIT → discard, but DON'T re-seed (the blob exists, just
  // unreadable by this code). Empty session keeps the user from losing the
  // keys; a future migrateSession() ladder would slot in here for v2+.
  return parseSessionBlob(raw) ?? emptySession();
}

/** Strict read for the cross-window sync: `null` for absent OR unreadable.
 *  At init an unreadable blob resolves to an empty session, which is right —
 *  there is no live state to protect. Mid-session it is NOT: adopting an empty
 *  session because a peer (or a hand edit, or a future schema version) wrote
 *  something this code can't parse would wipe the user's live Library view. */
function readValidBlob(): LibraryViewSession | null {
  const raw = readRawBlob();
  return raw == null ? null : parseSessionBlob(raw);
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
    layout: normalizeLayout(raw.layout),
  };
  if (raw.scopes && typeof raw.scopes === "object") {
    for (const [scope, scopeState] of Object.entries(raw.scopes)) {
      out.scopes[scope] = normalizeScope(scopeState as ScopeState);
    }
  }
  return out;
}

/** Defensive sanitize of the persisted `layout` slice. Spreads the raw layout
 *  (preserving sizes / colWidths / centralViewMode as-is) then SANITIZES
 *  `colOrder`: a partial/hand-edited array is filtered to known ids, deduped
 *  (first occurrence wins), and any missing reorderable id is APPENDED so a
 *  column can never be hidden. An absent or fully-invalid colOrder is left
 *  undefined (the consumer falls back to DEFAULT_COL_ORDER). */
function normalizeLayout(
  raw: LibraryViewSession["layout"] | undefined,
): LibraryViewSession["layout"] {
  if (!raw || typeof raw !== "object") return {};
  const out: LibraryViewSession["layout"] = { ...raw };
  out.colOrder = normalizeColOrder(raw.colOrder);
  if (out.colOrder === undefined) delete out.colOrder;
  return out;
}

/** Sanitize a saved colOrder array. Returns a complete permutation of the five
 *  reorderable columns when the input is a (possibly partial) array, or
 *  `undefined` when it's absent/not-an-array — so the absent case stays
 *  undefined rather than baking the default into the blob. */
function normalizeColOrder(
  raw: ReorderableColId[] | undefined,
): ReorderableColId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ReorderableColId[] = [];
  const seen = new Set<ReorderableColId>();
  for (const c of raw) {
    if (isReorderableColId(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  for (const c of DEFAULT_COL_ORDER) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
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
      if (lv && typeof lv === "object") p.lists[libId] = normalizeListView(lv);
    }
  }
  return p;
}

/** Sanitize one persisted ListView slice. Spreads the raw fields as-is, then
 *  canonicalizes the sort so a hand-edited blob can't carry a `facet` on a
 *  non-status column (F#14) — the facet is dropped unless col==="status" and
 *  the value is a known facet. */
function normalizeListView(raw: ListView): ListView {
  const out: ListView = { ...raw };
  if (out.sort) {
    const { col, dir, facet } = out.sort;
    const keepFacet = col === "status" && isStatusFacet(facet) ? facet : undefined;
    out.sort = keepFacet ? { col, dir, facet: keepFacet } : { col, dir };
  }
  return out;
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
  // NOTE: the three column/pod SIZES (navWidth/middleWidth/papersHeight) are
  // deliberately NOT seeded here. Seeding them froze a possibly-stale snapshot
  // of the legacy standalone keys (the old resize handler kept writing those
  // keys, never this blob), so a seeded value could shadow a fresher standalone
  // value forever. Their one-shot adoption now lives in
  // `migrateLegacyLayoutSizes()` (adopt-freshest-then-delete-the-key), the
  // single authoritative ingest path — see below.
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
    // Seed the merge base: this IS what storage held at hydrate time. A
    // separate copy, so later in-place mutations of `session` can't reach it.
    lastPersisted = JSON.parse(JSON.stringify(existing)) as LibraryViewSession;
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
  let json: string;
  try {
    json = JSON.stringify(s);
  } catch {
    return;
  }
  // Idempotent: an unchanged blob writes nothing, so a no-op debounce flush
  // never wakes the other windows (task 179). The return says whether storage
  // now HOLDS this value — advance the merge base only then, so a quota /
  // private-mode failure leaves the last known-on-disk snapshot standing
  // instead of pretending our in-memory changes were written.
  if (writeStorageIfChanged(VIEW_SESSION_KEY, json)) {
    lastPersisted = JSON.parse(json) as LibraryViewSession;
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

/* ── cross-window sync (task 179, following 177) ─────────────────────────
 *
 * This store is the awkward member of the stale-snapshot class: it caches the
 * session at module scope AND its write is debounced 250 ms, so a peer's
 * `storage` event routinely lands while our own change is still only in
 * memory. Adopting the peer blob would drop that change; ignoring the peer
 * keeps the stale base that clobbers the peer on the next flush.
 *
 * So the sync does a THREE-WAY MERGE — the same shape as a git merge, and for
 * the same reason: two writers, one shared ancestor.
 *
 *   base   = `lastPersisted`, the snapshot this window last KNEW was on disk
 *   ours   = the live in-memory `session` (base + our unflushed changes)
 *   theirs = the peer's blob
 *
 * Per node: if we didn't change it, take theirs; if they didn't, keep ours; if
 * both did, recurse into objects and let ours win at a genuinely conflicting
 * leaf (the local user's most recent intent). The pending timer then flushes
 * the merged blob, so the peer converges on the same result.
 *
 * Why a value-diff against a base rather than a set of dirty paths declared by
 * the setters: a path list is only ever as fine-grained as the bookkeeping
 * remembers to be, and everything here lives under ONE map (`scopes[""]` is
 * the singleton scope every non-tear-out consumer uses — both panels'
 * selection, tabs, and every per-library sort/query/scroll). A `scopes.<id>`
 * granularity would swap that whole subtree and silently drop a peer's edit to
 * a different panel inside it — the same clobber, just narrower. The base diff
 * gets leaf granularity for free and needs nothing from the setters, including
 * the in-place `setListScrollQuiet` mutation (base is a deep copy, so an
 * in-place write still reads as "ours changed").
 */

/** The session as last known to be IN STORAGE — the merge base. Advanced only
 *  on a write that actually landed, and to the peer's blob on a sync. */
let lastPersisted: LibraryViewSession | null = null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Three-way merge of two plain-JSON trees over their common ancestor.
 *  Arrays are treated as leaves (an ordered list — merging elementwise would
 *  invent orderings neither window asked for). */
function merge3(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(ours, base)) return theirs;   // untouched here → peer wins
  if (deepEqual(theirs, base)) return ours;   // untouched there → we win
  if (isPlainObject(ours) && isPlainObject(theirs)) {
    const b = isPlainObject(base) ? base : {};
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const inOurs = k in ours;
      const inTheirs = k in theirs;
      if (inOurs && inTheirs) {
        out[k] = merge3(b[k], ours[k], theirs[k]);
      } else if (inOurs) {
        // Absent from theirs: a peer DELETE if we left the key alone,
        // otherwise our own edit (or addition) and it stands.
        if (!(k in b) || !deepEqual(ours[k], b[k])) out[k] = ours[k];
      } else {
        // Absent from ours: symmetric — honor our delete, else take theirs.
        if (!(k in b) || !deepEqual(theirs[k], b[k])) out[k] = theirs[k];
      }
    }
    return out;
  }
  // Conflicting leaves (or an object-vs-leaf type change): the local user's
  // most recent intent wins; the flush then propagates it to the peer.
  return ours;
}

subscribeToStorageKey(VIEW_SESSION_KEY, () => {
  // Nothing hydrated in this window yet → the next `ensureInit` reads the
  // peer's blob straight from storage anyway.
  if (!initialized || !session) return;
  const peer = readValidBlob();
  // Absent, cleared, or unreadable (corrupt / a future schema version): keep
  // the live session rather than resetting the user's Library view.
  if (!peer) return;
  session = normalizeSession(
    merge3(lastPersisted ?? session, session, peer) as LibraryViewSession,
  );
  // Storage now holds the peer's blob — that, not our merged result, is the
  // ancestor the next sync must diff against.
  lastPersisted = peer;
  notify();
  // A pending debounced write now carries the merged blob, so the peer
  // converges too. With nothing pending there is nothing to flush.
});

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
  sort: SortState,
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

/** Persist the paper-detail Text/PDF view mode on a `paper:<citekey>` list.
 *  Notifying (the toggle re-renders the detail pane immediately); the write
 *  rides the shared 250 ms debounce. */
export function setListViewMode(
  scope: string,
  panel: PanelKey,
  libId: string,
  mode: "text" | "pdf",
): void {
  const s = ensureInit();
  commit(
    withScopePanel(s, scope, panel, (p) => withList(p, libId, { viewMode: mode })),
  );
}

/**
 * Reset the paper-detail view mode to the fresh-open default when a paper is
 * (re)opened. User decision (2026-06-23): "always reset to PDF on open" — a
 * prior in-session Text toggle must NOT stick across reopens. So this is called
 * ONCE per paper open (keyed on citekey) by the sole consumer, RightDetail.
 *
 * The mode the toggle writes via `setListViewMode` still wins for the rest of
 * the session — this only fires on the OPEN, snapping the stored posture back
 * to PDF (when a PDF exists) or Text (DOCX-only sources with no PDF on disk, so
 * the PDF default never strands them). Idempotent in effect: it always sets the
 * mode to the open-default, so re-running it on the same open is harmless.
 *
 * No-op on a FRESH open: an UNSEEDED slice is treated as already at the open
 * default (`existing ?? open`), so this commits ONLY when a PERSISTED choice
 * diverges — there is nothing to override on a first open. `usePaperViewMode`'s
 * own read is open-aware with the SAME formula, so render 1 already paints the
 * right branch; seeding the slice here would be a redundant post-paint write.
 * (Also skips the common PDF-source reopen already at "pdf".)
 */
export function resetPaperViewModeOnOpen(
  scope: string,
  panel: PanelKey,
  libId: string,
  pdfAvailable: boolean,
): void {
  const open: "text" | "pdf" = pdfAvailable ? "pdf" : "text";
  const s = ensureInit();
  const existing = s.scopes[scope]?.[panel]?.lists[libId]?.viewMode ?? open;
  if (existing === open) return;
  commit(
    withScopePanel(s, scope, panel, (p) => withList(p, libId, { viewMode: open })),
  );
}

/**
 * Scroll-position write that does NOT notify subscribers (keystroke-sanctity:
 * scrolling a list fires per-frame; re-rendering every `useListView`/selection
 * consumer each frame is the kind of doc-size-proportional churn the subsystem
 * forbids). `scrollTop` is write-mostly — no live subscriber reads it (LeftList
 * restores it once via a one-shot guard; PaperRender reads it imperatively from
 * `getSession()`). So we mutate the value IN PLACE on the existing slice,
 * keeping every object ref identical (the `useListView` snapshot stays
 * identity-stable → zero re-renders), and only arm the debounced localStorage
 * write. The slice's first-ever touch (no slice yet) falls back to the
 * notifying path once to create it; thereafter every scroll is quiet.
 */
export function setListScrollQuiet(
  scope: string,
  panel: PanelKey,
  libId: string,
  top: number,
): void {
  const s = ensureInit();
  const existing = s.scopes[scope]?.[panel]?.lists[libId];
  if (!existing) {
    // No slice to mutate yet → create it via the normal (notifying) path
    // exactly once. The next scroll frame finds the slice and goes quiet.
    setListScroll(scope, panel, libId, top);
    return;
  }
  existing.scrollTop = top;
  // No cross-window bookkeeping needed for this in-place mutation: the merge
  // base (`lastPersisted`) is a separate deep copy, so the write still reads
  // as "ours changed" to `merge3` (task 179).
  armWrite();
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

/** Read + min-floor a legacy standalone size key. Returns undefined when the
 *  key is absent/invalid. */
function readLegacySize(key: string, min: number): number | undefined {
  const n = readNum(key);
  if (n === undefined) return undefined;
  return Math.max(min, Math.round(n));
}

function removeLegacyKey(key: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* private-mode / quota — leave it; a stale key is harmless next run. */
  }
}

/**
 * One-shot reconciliation of the three legacy standalone size keys
 * (`virgil-library-{nav,left,papers}-*`) into the unified store's `layout`
 * slice. Call once on mount from the Library view.
 *
 * Under the OLD code these keys were the LIVE values (the resize handler wrote
 * them on pointer-up) while the store's `layout` sizes were only ever a frozen
 * seed snapshot. So on upgrade the standalone key — when present — is the
 * freshest value and WINS over whatever the seed may have frozen. After
 * adopting (clamped to the min-floor), the legacy key is DELETED so this never
 * re-clobbers a value the user later sets through the store (the new resize
 * handler writes the store ONLY, never the standalone key). Deletion — not a
 * per-mount ref — is what makes this idempotent across reloads: once the keys
 * are gone, subsequent runs are a no-op and the store is the single source of
 * truth. Returns true if it adopted at least one value (for tests).
 */
export function migrateLegacyLayoutSizes(): boolean {
  if (!hasStorage()) return false;
  const s = ensureInit();
  const patch: Partial<LibraryViewSession["layout"]> = {};
  const nav = readLegacySize(NAV_WIDTH_KEY, NAV_WIDTH_MIN);
  if (nav !== undefined) {
    if (nav !== s.layout.navWidth) patch.navWidth = nav;
    removeLegacyKey(NAV_WIDTH_KEY);
  }
  const mid = readLegacySize(MIDDLE_WIDTH_KEY, MIDDLE_WIDTH_MIN);
  if (mid !== undefined) {
    if (mid !== s.layout.middleWidth) patch.middleWidth = mid;
    removeLegacyKey(MIDDLE_WIDTH_KEY);
  }
  const pap = readLegacySize(PAPERS_HEIGHT_KEY, PAPERS_HEIGHT_MIN);
  if (pap !== undefined) {
    if (pap !== s.layout.papersHeight) patch.papersHeight = pap;
    removeLegacyKey(PAPERS_HEIGHT_KEY);
  }
  if (Object.keys(patch).length > 0) {
    setLayout(patch);
    return true;
  }
  return false;
}

// ── selector-side helpers (cached-equality snapshots) ───────────────────

const DEFAULT_SORT: SortState = { col: "year", dir: "desc" };

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
  sort: SortState;
  query: string;
  scrollTop: number;
  setSort: (s: SortState) => void;
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
    (s: SortState) => setListSort(scope, panel, libId, s),
    [scope, panel, libId],
  );
  const setQuery = useCallback(
    (q: string) => setListQuery(scope, panel, libId, q),
    [scope, panel, libId],
  );
  const setScroll = useCallback(
    // Quiet (non-notifying) write — scrolling must not re-render subscribers
    // each frame. See `setListScrollQuiet`.
    (top: number) => setListScrollQuiet(scope, panel, libId, top),
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

/**
 * Per-(panel, paper) Text/PDF view mode for the paper-detail header toggle.
 * `libId` is the `paper:<citekey>` key (the same slice the reader scroll uses).
 * Returns the current mode plus a setter. The default for an UNSEEDED slice is
 * **open-aware**: `pdfOnDisk ? "pdf" : "text"` — a DOCX-only source (no PDF on
 * disk) resolves straight to "text" on the FIRST read, so render 1 already
 * paints the right branch. This is the SSOT the field comment on `viewMode`
 * (`ListView`) points at; it removed the old open-blind `?? "pdf"` default that
 * flashed the PDF branch for one paint on every DOCX open before the post-paint
 * reset corrected it.
 *
 * View-mode is SESSION-ONLY in effect (user decision 2026-06-23: "always reset
 * to PDF on open"). The store still HOLDS the value — so the live toggle
 * re-renders the detail pane and an intra-session re-render restores the user's
 * current choice — but RightDetail calls `resetPaperViewModeOnOpen()` once per
 * paper open, snapping any PERSISTED posture back to the open default. Because
 * this read is now open-aware, that reset is a no-op on a FRESH open (nothing to
 * override) — it only fires when a persisted choice diverges from the open
 * default. DOCX-only sources reset to "text"; this subsumes the old post-load
 * coercion.
 */
export function usePaperViewMode(
  scope: string,
  panel: PanelKey,
  libId: string,
  pdfOnDisk: boolean,
): {
  viewMode: "text" | "pdf";
  setViewMode: (m: "text" | "pdf") => void;
} {
  // The store hands back the stable module-level EMPTY_LIST_VIEW for the
  // absent slice, so reading `.viewMode` directly (a primitive) is snapshot-
  // safe without the object-identity caching `useListView` needs. The absent
  // default is open-aware so the FIRST paint is correct (no PDF-branch flash on
  // a DOCX-only open); `pdfOnDisk` in deps re-reads if availability resolves
  // late.
  const getSnap = useCallback(
    () => readListView(scope, panel, libId).viewMode ?? (pdfOnDisk ? "pdf" : "text"),
    [scope, panel, libId, pdfOnDisk],
  );
  const viewMode = useSyncExternalStore(subscribe, getSnap, getSnap);
  const setViewMode = useCallback(
    (m: "text" | "pdf") => setListViewMode(scope, panel, libId, m),
    [scope, panel, libId],
  );
  return { viewMode, setViewMode };
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

/**
 * Central library landing view ("dashboard" | "list"), global slice.
 * Absent value resolves to "dashboard" for ALL users (the stats home is the
 * default entry point — the heavy list mounts only on an explicit Browse).
 * Once the user picks Browse (→ "list") or returns to the dashboard, the choice
 * persists across reloads, exactly like the Text/PDF posture per paper.
 */
export function useCentralViewMode(): {
  centralViewMode: "dashboard" | "list";
  setCentralViewMode: (m: "dashboard" | "list") => void;
} {
  const getSnap = useCallback(
    () => ensureInit().layout.centralViewMode ?? "dashboard",
    [],
  );
  const centralViewMode = useSyncExternalStore(subscribe, getSnap, getSnap);
  const setCentralViewMode = useCallback(
    (m: "dashboard" | "list") => setLayout({ centralViewMode: m }),
    [],
  );
  return { centralViewMode, setCentralViewMode };
}

/**
 * First-time PDF-drop intro notice, global slice. `dismissed` is false until
 * the user checks "Don't show again" on the post-drop notice, after which it
 * stays true across reloads (persisted in the shared `layout` blob, exactly
 * like centralViewMode). The Library shows the notice after a successful file
 * import only while this is false.
 */
export function usePdfDropIntroDismissed(): {
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
} {
  const getSnap = useCallback(
    () => ensureInit().layout.pdfDropIntroDismissed === true,
    [],
  );
  const dismissed = useSyncExternalStore(subscribe, getSnap, getSnap);
  const setDismissed = useCallback(
    (v: boolean) => setLayout({ pdfDropIntroDismissed: v }),
    [],
  );
  return { dismissed, setDismissed };
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
  lastPersisted = null; // the merge base is part of the singleton
  listeners.clear();
}
