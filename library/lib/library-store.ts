/**
 * Persistence for libraries and per-panel tab state.
 *
 * - Registry (`virgil-library-registry`): every library ever created. The
 *   Central Library always exists with a fixed id; spawned libraries are
 *   appended.
 * - Per-panel tabs (`virgil-library-tabs-<panelKey>`): which libraries are
 *   currently open as tabs in that panel, and which is active.
 *
 * Closed libraries remain in the registry (so they show up in the recent
 * list) but disappear from the panel's open tabs.
 */

export const CENTRAL_LIBRARY_ID = "central";
const CENTRAL_LIBRARY_LABEL = "Central Library";

/** Legacy single-global Project Library id. Retained for back-compat
 *  with persisted registries; no longer seeded into new panels and
 *  superseded by the per-doc project library ids returned by
 *  `projectLibraryIdForDoc()`. */
export const PROJECT_LIBRARY_ID = "project";

const PROJECT_DOC_PREFIX = "project:doc:";

/** Per-doc project library id. One of these is added to the singleton
 *  Library outer tab's left panel for every open Virgil doc. */
export function projectLibraryIdForDoc(docId: string): string {
  return PROJECT_DOC_PREFIX + docId;
}

export function isProjectDocId(id: string): boolean {
  return id.startsWith(PROJECT_DOC_PREFIX);
}

export function docIdFromProjectLibraryId(id: string): string {
  return id.startsWith(PROJECT_DOC_PREFIX)
    ? id.slice(PROJECT_DOC_PREFIX.length)
    : "";
}

/** Built-in libraries — non-closable, non-renamable. Per-doc project
 *  libraries are also non-renamable and their lifecycle is driven by
 *  the doc tab (not user close actions); `isBuiltin` returns true for
 *  them so the same UI gating applies. */
export const BUILTIN_LIBRARY_IDS: readonly string[] = [
  CENTRAL_LIBRARY_ID,
  PROJECT_LIBRARY_ID,
];

export function isBuiltin(id: string): boolean {
  return BUILTIN_LIBRARY_IDS.includes(id) || isProjectDocId(id);
}

const REGISTRY_KEY = "virgil-library-registry";
const PANEL_TABS_PREFIX = "virgil-library-tabs-";

export type LibraryKind = "central" | "project" | "custom" | "paper";

export type Library = {
  id: string;
  label: string;
  createdAt: number;
  /**
   * Discriminator. Built-in central is non-closable + non-renamable.
   * "project" libraries are per-doc — id `project:doc:<docId>` — and
   * driven by the open doc tabs (the user closes them by closing the
   * doc). "custom" is a user-spawned curated list. "paper" is an
   * opened paper file — its body renders the paper viewer instead of
   * a list, and `citekey` / `pinned` carry its viewer state.
   *
   * Optional `docId` is attached to per-doc project libraries so the
   * Library view can route a tab click back to the corresponding
   * Virgil doc tab.
   */
  kind: LibraryKind;
  /** Doc id this project library mirrors. Only set when kind === "project"
   *  and the id was minted via `projectLibraryIdForDoc()`. */
  docId?: string;
  /**
   * Entry membership for "custom" libraries. Each value is either a
   * citekey (for indexed/bib entries) or `__triage__<filename>` for
   * unsorted files. Unused for built-ins (membership is computed) and
   * paper tabs (which render a viewer, not a list).
   */
  entryKeys?: string[];
  /** Citekey backing a "paper" tab. Absent for non-paper kinds. */
  citekey?: string;
  /**
   * Pinned paper tabs survive the replace-on-open behavior — opening
   * another paper from a sibling library opens a new tab instead of
   * overwriting this one. Only meaningful when kind === "paper".
   */
  pinned?: boolean;
};

export type Registry = {
  libraries: Library[];
};

export type PanelTabsState = {
  openIds: string[];
  activeId: string;
};

function centralLibrary(): Library {
  return { id: CENTRAL_LIBRARY_ID, label: CENTRAL_LIBRARY_LABEL, createdAt: 0, kind: "central" };
}

const PAPER_ID_PREFIX = "paper:";

export function paperLibraryId(citekey: string): string {
  return `${PAPER_ID_PREFIX}${citekey}`;
}

export function isPaperId(id: string): boolean {
  return id.startsWith(PAPER_ID_PREFIX);
}

export function isPaper(lib: Library | undefined | null): boolean {
  return !!lib && lib.kind === "paper";
}

/** Backfill `kind` for legacy libraries persisted before the field existed. */
function backfillKind(lib: Library): Library {
  if (lib.kind) return lib;
  if (lib.id === CENTRAL_LIBRARY_ID) return { ...lib, kind: "central" };
  if (lib.id === PROJECT_LIBRARY_ID) return { ...lib, kind: "project" };
  if (isProjectDocId(lib.id)) {
    return {
      ...lib,
      kind: "project",
      docId: lib.docId ?? docIdFromProjectLibraryId(lib.id),
    };
  }
  if (isPaperId(lib.id)) {
    return {
      ...lib,
      kind: "paper",
      citekey: lib.citekey ?? lib.id.slice(PAPER_ID_PREFIX.length),
      pinned: lib.pinned ?? false,
    };
  }
  return { ...lib, kind: "custom" };
}

function defaultRegistry(): Registry {
  return { libraries: [centralLibrary()] };
}

function defaultPanelTabs(): PanelTabsState {
  return {
    openIds: [CENTRAL_LIBRARY_ID],
    activeId: CENTRAL_LIBRARY_ID,
  };
}

export function loadRegistry(): Registry {
  if (typeof localStorage === "undefined") return defaultRegistry();
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return defaultRegistry();
    const parsed = JSON.parse(raw) as Registry;
    if (!parsed?.libraries || !Array.isArray(parsed.libraries)) {
      return defaultRegistry();
    }
    parsed.libraries = parsed.libraries.map(backfillKind);
    // Always ensure Central exists, and force its label to the canonical
    // value (not user-renamable).
    const central = parsed.libraries.find((l) => l.id === CENTRAL_LIBRARY_ID);
    if (central) {
      central.label = CENTRAL_LIBRARY_LABEL;
      central.kind = "central";
    } else {
      parsed.libraries.unshift(centralLibrary());
    }
    // Drop the legacy single-global Project Library and any per-doc
    // project entries — those are now derived from the open doc set
    // and synthesized on the fly by `useLibraryTabs`. Persisting them
    // would only confuse the next hydration.
    parsed.libraries = parsed.libraries.filter(
      (l) => l.id !== PROJECT_LIBRARY_ID && !isProjectDocId(l.id),
    );
    return parsed;
  } catch {
    return defaultRegistry();
  }
}

export function saveRegistry(registry: Registry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // ignore
  }
  // Tell every other registry consumer in this window to re-load. The
  // browser's `storage` event only fires for cross-window writes, but
  // multiple `useLibraryTabs` instances live in the same window (inline
  // Library + each library outer tab) and need to stay in sync.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(REGISTRY_CHANGED_EVENT));
    } catch {
      // ignore
    }
  }
}

/** Window-level event fired after the shared registry is written. Every
 *  `useLibraryTabs` instance and `useLibraryRegistry` listener re-loads
 *  on receive, so a write from outside the hook (e.g. an entry drop on
 *  a Virgil-bar library outer tab) propagates to all open views. */
export const REGISTRY_CHANGED_EVENT = "virgil-library-registry-changed";

/**
 * Idempotently append `entryKey` to a library's `entryKeys`. Used by
 * the outer Virgil bar's drop handler to add a paper to a library
 * without owning a `useLibraryTabs` instance. No-ops on Central /
 * Project / paper-kind libraries, which all derive membership from
 * other sources (catalog / doc bib / single citekey).
 */
export function addEntryToLibraryGlobal(libId: string, entryKey: string): void {
  if (!libId || !entryKey) return;
  const r = loadRegistry();
  let changed = false;
  const next: Registry = {
    libraries: r.libraries.map((l) => {
      if (l.id !== libId) return l;
      if (l.kind !== "custom") return l;
      const cur = l.entryKeys ?? [];
      if (cur.includes(entryKey)) return l;
      changed = true;
      return { ...l, entryKeys: [...cur, entryKey] };
    }),
  };
  if (changed) saveRegistry(next);
}

/** Build the localStorage key for a panel's tab record. When `scope` is
 *  empty, the legacy unscoped key (`virgil-library-tabs-left`/`-right`)
 *  is used — preserving back-compat for the inline Library tab. Scoped
 *  callers (each library outer tab) get isolated keys. */
function panelTabsStorageKey(panelKey: string, scope?: string): string {
  if (!scope) return PANEL_TABS_PREFIX + panelKey;
  return `${PANEL_TABS_PREFIX}${scope}-${panelKey}`;
}

export function loadPanelTabs(
  panelKey: string,
  opts?: { scope?: string; fallback?: PanelTabsState },
): PanelTabsState {
  // First-run default: just Central on the left, empty on the right.
  // Per-doc project tabs are derived from the open doc set at render
  // time and never seeded into the persisted layout. Scoped callers
  // (library outer tabs) can override via opts.fallback.
  const fallback: PanelTabsState = opts?.fallback ?? (
    panelKey === "left"
      ? {
          openIds: [CENTRAL_LIBRARY_ID],
          activeId: CENTRAL_LIBRARY_ID,
        }
      : { openIds: [], activeId: "" }
  );
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(panelTabsStorageKey(panelKey, opts?.scope));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PanelTabsState;
    if (!Array.isArray(parsed?.openIds)) return fallback;
    // Strip any persisted project ids — derived now, not stored.
    parsed.openIds = parsed.openIds.filter(
      (id) => id !== PROJECT_LIBRARY_ID && !isProjectDocId(id),
    );
    if (parsed.openIds.length === 0) {
      parsed.activeId = "";
    } else if (!parsed.openIds.includes(parsed.activeId)) {
      parsed.activeId = parsed.openIds[0];
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function savePanelTabs(
  panelKey: string,
  state: PanelTabsState,
  opts?: { scope?: string },
): void {
  try {
    localStorage.setItem(
      panelTabsStorageKey(panelKey, opts?.scope),
      JSON.stringify(state),
    );
  } catch {
    // ignore
  }
}

export function isCentral(id: string): boolean {
  return id === CENTRAL_LIBRARY_ID;
}

export function isProject(id: string): boolean {
  return id === PROJECT_LIBRARY_ID || isProjectDocId(id);
}

export function newLibraryId(): string {
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
