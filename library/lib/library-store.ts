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
   * When true, opening another library or paper in the panel APPENDS as
   * a sibling tab instead of REPLACING this one. Applies to every kind:
   * Central, custom, and paper tabs all use the same mechanic. Per-doc
   * project tabs ignore the flag (they are synthesized per-render and
   * not registered).
   */
  pinned?: boolean;
  /**
   * Filename of the source `.bib` in `unsorted/`, when this custom
   * library was created via "+ Add from .bib". The frontend renders
   * synthesized rows from this file's parsed entries until a triage
   * skill merges them into `master.bib` and deletes the source file.
   * Cleared on next mount once the file is gone from `unsorted/`.
   */
  sourceBibFile?: string;
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
 * Idempotently append `entryKey` to a library's membership. Used by
 * the outer Virgil bar's drop handler to add a paper to a custom
 * library without owning a `useLibraryTabs` instance.
 *
 * Sync-from-the-caller's-view: the disk read-modify-write fires in
 * the background. After the disk write succeeds, the function
 * dispatches `REGISTRY_CHANGED_EVENT` so every in-window consumer
 * re-reads. No-ops when the FSA handle isn't available, when the
 * target id is built-in / project / paper-kind, or when the disk
 * doesn't have a matching manifest (a stale tab id from another
 * folder).
 *
 * Errors are logged but never thrown — drop handlers expect a void
 * sync API.
 */
export function addEntryToLibraryGlobal(libId: string, entryKey: string): void {
  if (!libId || !entryKey) return;
  if (isBuiltin(libId) || isPaperId(libId) || isProjectDocId(libId)) return;
  void (async () => {
    try {
      // Lazy imports to avoid a circular dep between library-store
      // (sync, localStorage-only by convention) and library-storage /
      // library-folder (FSA-aware). The bridge is intentional: this
      // one function is the only place library-store reaches into the
      // FSA layer.
      const { getLibraryHandle, queryReadWritePermission } = await import(
        "./library-folder"
      );
      const { listLibraryManifests, writeLibraryManifest } = await import(
        "./library-storage"
      );
      const handle = await getLibraryHandle();
      if (!handle) return;
      const perm = await queryReadWritePermission(handle);
      if (perm !== "granted") return;
      const list = await listLibraryManifests(handle);
      const match = list.find((item) => item.manifest.id === libId);
      if (!match) return;
      const cur = match.manifest.citekeys;
      if (cur.includes(entryKey)) return;
      const updated = {
        ...match.manifest,
        citekeys: [...cur, entryKey],
        updatedAt: Date.now(),
      };
      await writeLibraryManifest(handle, match.filename, updated);
      try {
        window.dispatchEvent(new CustomEvent(REGISTRY_CHANGED_EVENT));
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error(
        "[library] addEntryToLibraryGlobal: failed to write manifest",
        err,
      );
    }
  })();
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

/**
 * Filesystem-safe slug for a library's label. Used as the `<slug>` in
 * `.virgil/libraries/<slug>.json`. Lowercases ASCII, replaces every
 * non-alphanumeric run with `-`, and trims edge dashes. Falls back to
 * `library` when the input collapses to empty (e.g. a label that's
 * only emoji), and never returns longer than 80 chars so paths stay
 * sane on every platform.
 */
export function slugifyLibraryLabel(label: string): string {
  const slug = (label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "library";
}

/**
 * Append `-2`, `-3`, … to `slug` until it doesn't appear in
 * `existing`. Used at write time to keep manifest filenames unique
 * within `.virgil/libraries/`. The first attempt is the bare slug;
 * the suffix only kicks in on collision so single-library folders
 * stay tidy.
 */
export function dedupeSlug(slug: string, existing: ReadonlySet<string>): string {
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) {
    n += 1;
    if (n > 9999) break; // pathological safety valve
  }
  return `${slug}-${n}`;
}

/** Build the canonical filename for a library manifest. */
export function libraryManifestFilename(slug: string): string {
  return `${slug}.json`;
}
