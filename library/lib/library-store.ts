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

export const PROJECT_LIBRARY_ID = "project";
const PROJECT_LIBRARY_LABEL = "Project Library";

/** Built-in libraries — non-closable, non-renamable. Their `entryKeys` is
 *  always undefined (membership is computed at render time, not stored). */
export const BUILTIN_LIBRARY_IDS: readonly string[] = [
  CENTRAL_LIBRARY_ID,
  PROJECT_LIBRARY_ID,
];

export function isBuiltin(id: string): boolean {
  return BUILTIN_LIBRARY_IDS.includes(id);
}

const REGISTRY_KEY = "virgil-library-registry";
const PANEL_TABS_PREFIX = "virgil-library-tabs-";

export type Library = {
  id: string;
  label: string;
  createdAt: number;
  /**
   * Entry membership for spawned libraries. Each value is either a
   * citekey (for indexed/bib entries) or `__triage__<filename>` for
   * unsorted files. Absent / undefined for Central, which always shows
   * the full catalog.
   */
  entryKeys?: string[];
};

export type Registry = {
  libraries: Library[];
};

export type PanelTabsState = {
  openIds: string[];
  activeId: string;
};

function centralLibrary(): Library {
  return { id: CENTRAL_LIBRARY_ID, label: CENTRAL_LIBRARY_LABEL, createdAt: 0 };
}

function projectLibrary(): Library {
  return { id: PROJECT_LIBRARY_ID, label: PROJECT_LIBRARY_LABEL, createdAt: 0 };
}

function defaultRegistry(): Registry {
  return { libraries: [centralLibrary(), projectLibrary()] };
}

function defaultPanelTabs(): PanelTabsState {
  return {
    openIds: [CENTRAL_LIBRARY_ID, PROJECT_LIBRARY_ID],
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
    // Always ensure Central exists, and force its label to the canonical
    // value (not user-renamable).
    const central = parsed.libraries.find((l) => l.id === CENTRAL_LIBRARY_ID);
    if (central) {
      central.label = CENTRAL_LIBRARY_LABEL;
    } else {
      parsed.libraries.unshift(centralLibrary());
    }
    // Same for the Project library — added in a later migration; older
    // registries won't have it, so insert right after Central.
    const project = parsed.libraries.find((l) => l.id === PROJECT_LIBRARY_ID);
    if (project) {
      project.label = PROJECT_LIBRARY_LABEL;
    } else {
      const centralIdx = parsed.libraries.findIndex(
        (l) => l.id === CENTRAL_LIBRARY_ID,
      );
      parsed.libraries.splice(centralIdx + 1, 0, projectLibrary());
    }
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
}

export function loadPanelTabs(panelKey: string): PanelTabsState {
  // First-run default: Central + Project on the left, empty on the right.
  // After that, we trust the saved layout — the user can drag built-ins
  // anywhere they want and dragging both away leaves a panel empty (which
  // the LibraryView swaps to the paper-detail viewer).
  const fallback: PanelTabsState =
    panelKey === "left"
      ? {
          openIds: [CENTRAL_LIBRARY_ID, PROJECT_LIBRARY_ID],
          activeId: CENTRAL_LIBRARY_ID,
        }
      : { openIds: [], activeId: "" };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PANEL_TABS_PREFIX + panelKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PanelTabsState;
    if (!Array.isArray(parsed?.openIds)) return fallback;
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

export function savePanelTabs(panelKey: string, state: PanelTabsState): void {
  try {
    localStorage.setItem(PANEL_TABS_PREFIX + panelKey, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function isCentral(id: string): boolean {
  return id === CENTRAL_LIBRARY_ID;
}

export function isProject(id: string): boolean {
  return id === PROJECT_LIBRARY_ID;
}

export function newLibraryId(): string {
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
