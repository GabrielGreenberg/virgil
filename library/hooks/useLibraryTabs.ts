"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CENTRAL_LIBRARY_ID,
  REGISTRY_CHANGED_EVENT,
  docIdFromProjectLibraryId,
  isBuiltin,
  isPaper,
  isPaperId,
  isProjectDocId,
  loadPanelTabs,
  loadRegistry,
  newLibraryId,
  paperLibraryId,
  projectLibraryIdForDoc,
  savePanelTabs,
  saveRegistry,
  type Library,
  type PanelTabsState,
  type Registry,
} from "@library/lib/library-store";

export type PanelKey = "left" | "right";

function defaultRegistry(): Registry {
  return {
    libraries: [
      { id: CENTRAL_LIBRARY_ID, label: "Central Library", createdAt: 0, kind: "central" },
    ],
  };
}

function defaultLeft(): PanelTabsState {
  return {
    openIds: [CENTRAL_LIBRARY_ID],
    activeId: CENTRAL_LIBRARY_ID,
  };
}

function defaultRight(): PanelTabsState {
  return { openIds: [], activeId: "" };
}

/** Doc summary supplied by the singleton Library outer tab — one per
 *  open Virgil doc tab. Each spec yields a per-doc project library
 *  inner tab (id = `projectLibraryIdForDoc(id)`). */
export interface OpenDocSpec {
  id: string;
  label: string;
}

export type LibraryTabsApi = {
  registry: Registry;
  leftTabs: PanelTabsState;
  rightTabs: PanelTabsState;
  libraryById: Map<string, Library>;
  activate: (id: string, panel: PanelKey) => void;
  close: (id: string, panel: PanelKey) => void;
  rename: (id: string, label: string) => void;
  create: (panel: PanelKey) => string;
  openRecent: (id: string, panel: PanelKey) => void;
  /**
   * Move a tab to a destination position. toIndex is the index in the
   * destination panel's openIds at the moment of drop. Source panel is
   * inferred (we already know where the libId currently lives).
   */
  moveTab: (libId: string, toPanel: PanelKey, toIndex: number) => void;
  /**
   * Add an entry (citekey or `__triage__<filename>` key) to a spawned
   * library. No-op for Central (already contains everything). Idempotent.
   */
  addEntryToLibrary: (libId: string, entryKey: string) => void;
  /**
   * Inverse of addEntryToLibrary — removes from a spawned library's
   * membership. No-op for Central (which has no explicit membership;
   * deletion there goes through queueDelete).
   */
  removeEntryFromLibrary: (libId: string, entryKey: string) => void;
  /**
   * Open a paper as a "library file" — a tab whose body renders the
   * paper viewer. The destination panel is the opposite of `fromPanel`
   * (so clicking from the left opens on the right). If the paper is
   * already open in either panel, that tab is activated. Otherwise,
   * if the destination's currently active tab is an unpinned paper,
   * the new paper *replaces* it; if pinned (or non-paper), the new
   * paper is appended as a sibling tab.
   */
  openPaper: (citekey: string, fromPanel: PanelKey) => void;
  /** Toggle the pinned flag on a paper-kind library. No-op otherwise. */
  togglePinPaper: (libId: string) => void;
  /**
   * Close the paper-kind tab whose citekey matches, in whichever panel
   * holds it. Used by the tearout flow when a paper inner tab is
   * promoted to an outer Virgil-bar tab.
   */
  closePaperByCitekey: (citekey: string) => void;
};

export interface UseLibraryTabsOptions {
  /** localStorage namespace for this hook's panel state. Empty / undefined
   *  uses the legacy unscoped keys (the singleton Library outer tab).
   *  Scoped callers (each tear-out library outer tab) get isolated keys
   *  via this prefix. */
  scope?: string;
  /** Initial seed when no record exists yet for this scope. Default seed
   *  is just `[Central]` on the left + empty right. */
  seed?: { left: PanelTabsState; right: PanelTabsState };
  /** Open Virgil doc tabs. Only meaningful for the singleton (unscoped)
   *  instance — each doc projects a per-doc Project library inner tab
   *  into the left panel right after Central. The list is treated as
   *  authoritative: tabs not listed disappear when their doc closes. */
  openDocs?: OpenDocSpec[];
  /** Currently active Virgil doc id. The matching project tab is the
   *  active inner tab on the left panel (unless the user explicitly
   *  clicked Central or another non-project tab). */
  currentDocId?: string | null;
  /** Called when the user clicks a per-doc project inner tab — wired to
   *  `useFiles().activateDocPane` so clicking the project tab also
   *  brings the corresponding Virgil doc tab forward. */
  onActivateDoc?: (docId: string) => void;
}

export function useLibraryTabs(opts: UseLibraryTabsOptions = {}): LibraryTabsApi {
  const { scope, seed, openDocs, currentDocId, onActivateDoc } = opts;
  // Project-doc projection only applies to the singleton (unscoped) Library
  // outer tab. Tear-out scoped instances ignore openDocs entirely.
  const projectsEnabled = !scope;
  const [registry, setRegistry] = useState<Registry>(defaultRegistry);
  const [leftTabs, setLeftTabs] = useState<PanelTabsState>(
    () => seed?.left ?? defaultLeft(),
  );
  const [rightTabs, setRightTabs] = useState<PanelTabsState>(
    () => seed?.right ?? defaultRight(),
  );
  const [hydrated, setHydrated] = useState(false);
  // The user's most-recent explicit click (within the singleton's left
  // panel) on a non-project tab. When set, it overrides the
  // currentDocId-driven default activeId — so the user can stay focused
  // on Central even when the active doc changes. Cleared to null when
  // the user clicks any project tab (back to the default behavior).
  const [leftPinnedActiveId, setLeftPinnedActiveId] = useState<string | null>(
    null,
  );

  // Mirror latest state in refs so synchronous handlers (drag/drop) can
  // read it without going through the setState-updater dance — those
  // updaters don't run synchronously, so `fromPanel = ...` side effects
  // inside them silently fail to land before downstream code runs.
  const leftTabsRef = useRef(leftTabs);
  const rightTabsRef = useRef(rightTabs);
  const registryRef = useRef(registry);
  leftTabsRef.current = leftTabs;
  rightTabsRef.current = rightTabs;
  registryRef.current = registry;

  useEffect(() => {
    setRegistry(loadRegistry());
    setLeftTabs(
      loadPanelTabs("left", { scope, fallback: seed?.left }),
    );
    setRightTabs(
      loadPanelTabs("right", { scope, fallback: seed?.right }),
    );
    setHydrated(true);
    // Hydrate once per mount; scope/seed are treated as initial-mount-only
    // configuration (changing them would require a remount of the consumer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveRegistry(registry);
  }, [registry, hydrated]);

  // Sync registry across instances. When ANY consumer writes the shared
  // registry (a sibling `useLibraryTabs`, the Virgil-bar drop handler,
  // etc.), `saveRegistry` dispatches REGISTRY_CHANGED_EVENT — re-load
  // and adopt the fresh value if it differs from our cached state.
  // Comparing the JSON serialisation is good enough at this scale and
  // avoids feedback loops (each instance fires the event from its own
  // persist effect, but the comparison short-circuits the no-op cases).
  useEffect(() => {
    const handler = () => {
      const fresh = loadRegistry();
      setRegistry((prev) =>
        JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
      );
    };
    window.addEventListener(REGISTRY_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REGISTRY_CHANGED_EVENT, handler);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("left", leftTabs, { scope });
  }, [leftTabs, hydrated, scope]);
  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("right", rightTabs, { scope });
  }, [rightTabs, hydrated, scope]);

  // Synthetic Library entries for the per-doc project inner tabs. Not
  // persisted in the registry — derived per-render from `openDocs`.
  const projectLibsByDocId = useMemo(() => {
    const m = new Map<string, Library>();
    if (!projectsEnabled || !openDocs) return m;
    for (const d of openDocs) {
      const id = projectLibraryIdForDoc(d.id);
      m.set(d.id, {
        id,
        label: d.label,
        createdAt: 0,
        kind: "project",
        docId: d.id,
      });
    }
    return m;
  }, [projectsEnabled, openDocs]);

  const libraryById = useMemo(() => {
    const m = new Map<string, Library>();
    for (const l of registry.libraries) m.set(l.id, l);
    for (const lib of projectLibsByDocId.values()) m.set(lib.id, lib);
    return m;
  }, [registry, projectLibsByDocId]);

  // Public leftTabs: persisted `leftTabs` state holds Central + any
  // user-added extras (custom/paper). Per-doc project tabs are spliced
  // in right after Central. activeId follows currentDocId unless the
  // user has explicitly pinned a non-project tab.
  const displayedLeftTabs = useMemo<PanelTabsState>(() => {
    if (!projectsEnabled) return leftTabs;
    const projectIds = (openDocs ?? []).map((d) =>
      projectLibraryIdForDoc(d.id),
    );
    const persisted = leftTabs.openIds.filter(
      (id) => !isProjectDocId(id),
    );
    const centralIdx = persisted.indexOf(CENTRAL_LIBRARY_ID);
    const openIds =
      centralIdx === 0
        ? [CENTRAL_LIBRARY_ID, ...projectIds, ...persisted.slice(1)]
        : [...projectIds, ...persisted];
    let activeId = leftTabs.activeId;
    const pinned = leftPinnedActiveId;
    if (pinned && openIds.includes(pinned)) {
      activeId = pinned;
    } else if (currentDocId) {
      const projId = projectLibraryIdForDoc(currentDocId);
      if (openIds.includes(projId)) activeId = projId;
    }
    if (!openIds.includes(activeId)) activeId = openIds[0] ?? "";
    return { openIds, activeId };
  }, [
    projectsEnabled,
    leftTabs,
    openDocs,
    currentDocId,
    leftPinnedActiveId,
  ]);

  // Pin (or clear pin) for the left panel of the singleton instance.
  // Project ids clear the pin so the default "follow currentDocId" path
  // returns; non-project ids pin so currentDocId changes don't yank the
  // user off the tab they're looking at.
  const pinIfLeft = useCallback(
    (panel: PanelKey, id: string) => {
      if (panel !== "left" || !projectsEnabled) return;
      if (isProjectDocId(id)) {
        setLeftPinnedActiveId(null);
        return;
      }
      setLeftPinnedActiveId(id);
    },
    [projectsEnabled],
  );

  const activate = useCallback(
    (id: string, panel: PanelKey) => {
      if (panel === "left" && projectsEnabled && isProjectDocId(id)) {
        const docId = docIdFromProjectLibraryId(id);
        if (docId && onActivateDoc) onActivateDoc(docId);
        setLeftPinnedActiveId(null);
        return;
      }
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) => (t.activeId === id ? t : { ...t, activeId: id }));
      pinIfLeft(panel, id);
    },
    [projectsEnabled, onActivateDoc, pinIfLeft],
  );

  const close = useCallback((id: string, panel: PanelKey) => {
    if (isBuiltin(id)) return;
    // Per-doc project tabs are derived from open docs — closing happens
    // when the doc tab itself closes. Ignore any direct close attempts.
    if (isProjectDocId(id)) return;
    const setter = panel === "left" ? setLeftTabs : setRightTabs;
    setter((t) => {
      const idx = t.openIds.indexOf(id);
      if (idx < 0) return t;
      const nextOpen = t.openIds.filter((x) => x !== id);
      let nextActive = t.activeId;
      if (t.activeId === id) {
        nextActive = t.openIds[idx - 1] ?? nextOpen[0] ?? "";
      }
      return { openIds: nextOpen, activeId: nextActive };
    });
  }, []);

  const rename = useCallback((id: string, label: string) => {
    if (isBuiltin(id)) return;
    setRegistry((r) => ({
      libraries: r.libraries.map((l) =>
        l.id === id ? { ...l, label } : l,
      ),
    }));
  }, []);

  const create = useCallback(
    (panel: PanelKey): string => {
      const id = newLibraryId();
      const lib: Library = { id, label: "Untitled", createdAt: Date.now(), kind: "custom" };
      setRegistry((r) => ({ libraries: [...r.libraries, lib] }));
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) => ({ openIds: [...t.openIds, id], activeId: id }));
      pinIfLeft(panel, id);
      return id;
    },
    [pinIfLeft],
  );

  const openRecent = useCallback(
    (id: string, panel: PanelKey) => {
      if (isBuiltin(id)) return; // built-ins live on the left panel only.
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) =>
        t.openIds.includes(id)
          ? { ...t, activeId: id }
          : { openIds: [...t.openIds, id], activeId: id },
      );
      pinIfLeft(panel, id);
    },
    [pinIfLeft],
  );

  const moveTab = useCallback(
    (libId: string, toPanel: PanelKey, toIndex: number) => {
      // Find current panel from the refs (synchronous read).
      let fromPanel: PanelKey | null = null;
      if (leftTabsRef.current.openIds.includes(libId)) fromPanel = "left";
      else if (rightTabsRef.current.openIds.includes(libId)) fromPanel = "right";
      if (!fromPanel) return;

      if (fromPanel === toPanel) {
        // Reorder within the same panel.
        const setter = fromPanel === "left" ? setLeftTabs : setRightTabs;
        setter((t) => {
          const fromIdx = t.openIds.indexOf(libId);
          if (fromIdx < 0) return t;
          const target = Math.min(toIndex, t.openIds.length);
          const next = [...t.openIds];
          next.splice(fromIdx, 1);
          const adjusted = target > fromIdx ? target - 1 : target;
          next.splice(adjusted, 0, libId);
          return { openIds: next, activeId: libId };
        });
        pinIfLeft(toPanel, libId);
        return;
      }

      // Cross-panel: remove from source, add to destination.
      const sourceSetter = fromPanel === "left" ? setLeftTabs : setRightTabs;
      sourceSetter((t) => {
        const idx = t.openIds.indexOf(libId);
        if (idx < 0) return t;
        const nextOpen = t.openIds.filter((x) => x !== libId);
        let nextActive = t.activeId;
        if (t.activeId === libId) {
          nextActive = t.openIds[idx - 1] ?? nextOpen[0] ?? "";
        }
        return { openIds: nextOpen, activeId: nextActive };
      });

      const destSetter = toPanel === "left" ? setLeftTabs : setRightTabs;
      destSetter((t) => {
        if (t.openIds.includes(libId)) return { ...t, activeId: libId };
        const target = Math.min(Math.max(0, toIndex), t.openIds.length);
        const next = [...t.openIds];
        next.splice(target, 0, libId);
        return { openIds: next, activeId: libId };
      });
      pinIfLeft(toPanel, libId);
    },
    [pinIfLeft],
  );

  const addEntryToLibrary = useCallback(
    (libId: string, entryKey: string) => {
      // Built-ins compute their membership — drop targets are user-spawned
      // libraries only.
      if (isBuiltin(libId)) return;
      if (!entryKey) return;
      setRegistry((r) => ({
        libraries: r.libraries.map((l) => {
          if (l.id !== libId) return l;
          const cur = l.entryKeys ?? [];
          if (cur.includes(entryKey)) return l;
          return { ...l, entryKeys: [...cur, entryKey] };
        }),
      }));
    },
    [],
  );

  // Inverse of addEntryToLibrary — only removes from the local membership
  // list. Central rejects this op (you can't "remove" from Central without
  // a real delete; that path goes through queueDelete instead).
  const removeEntryFromLibrary = useCallback(
    (libId: string, entryKey: string) => {
      if (isBuiltin(libId)) return;
      if (!entryKey) return;
      setRegistry((r) => ({
        libraries: r.libraries.map((l) => {
          if (l.id !== libId) return l;
          const cur = l.entryKeys ?? [];
          if (!cur.includes(entryKey)) return l;
          return { ...l, entryKeys: cur.filter((k) => k !== entryKey) };
        }),
      }));
    },
    [],
  );

  const openPaper = useCallback(
    (citekey: string, fromPanel: PanelKey) => {
      if (!citekey) return;
      const newId = paperLibraryId(citekey);
      const destPanel: PanelKey = fromPanel === "left" ? "right" : "left";

      // If this paper is already open anywhere, just activate it. We do
      // NOT move tabs across panels on click — the tab stays where the
      // user put it; we just bring it forward.
      const leftHas = leftTabsRef.current.openIds.includes(newId);
      const rightHas = rightTabsRef.current.openIds.includes(newId);
      if (leftHas || rightHas) {
        const panel: PanelKey = leftHas ? "left" : "right";
        const setter = panel === "left" ? setLeftTabs : setRightTabs;
        setter((t) => (t.activeId === newId ? t : { ...t, activeId: newId }));
        pinIfLeft(panel, newId);
        return;
      }

      // Ensure the registry has this paper; create on demand.
      setRegistry((r) => {
        if (r.libraries.some((l) => l.id === newId)) return r;
        const lib: Library = {
          id: newId,
          label: citekey,
          createdAt: Date.now(),
          kind: "paper",
          citekey,
          pinned: false,
        };
        return { libraries: [...r.libraries, lib] };
      });

      // Replace-or-append in the destination panel.
      const destSetter = destPanel === "left" ? setLeftTabs : setRightTabs;
      const libsRef = registryRef.current.libraries;
      destSetter((t) => {
        const activeIdx = t.openIds.indexOf(t.activeId);
        const activeLib =
          activeIdx >= 0
            ? libsRef.find((l) => l.id === t.openIds[activeIdx])
            : undefined;
        const replaceTarget =
          activeLib && activeLib.kind === "paper" && !activeLib.pinned
            ? activeLib.id
            : null;
        if (replaceTarget) {
          const next = t.openIds.map((id) => (id === replaceTarget ? newId : id));
          return { openIds: next, activeId: newId };
        }
        return { openIds: [...t.openIds, newId], activeId: newId };
      });
      pinIfLeft(destPanel, newId);
    },
    [pinIfLeft],
  );

  const togglePinPaper = useCallback((libId: string) => {
    if (!isPaperId(libId)) return;
    setRegistry((r) => ({
      libraries: r.libraries.map((l) =>
        l.id === libId && isPaper(l) ? { ...l, pinned: !l.pinned } : l,
      ),
    }));
  }, []);

  const closePaperByCitekey = useCallback(
    (citekey: string) => {
      if (!citekey) return;
      const id = paperLibraryId(citekey);
      if (leftTabsRef.current.openIds.includes(id)) close(id, "left");
      else if (rightTabsRef.current.openIds.includes(id)) close(id, "right");
    },
    [close],
  );

  return {
    registry,
    leftTabs: displayedLeftTabs,
    rightTabs,
    libraryById,
    activate,
    close,
    rename,
    create,
    openRecent,
    moveTab,
    addEntryToLibrary,
    removeEntryFromLibrary,
    openPaper,
    togglePinPaper,
    closePaperByCitekey,
  };
}
