"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CENTRAL_LIBRARY_ID,
  PROJECT_LIBRARY_ID,
  isBuiltin,
  loadPanelTabs,
  loadRegistry,
  newLibraryId,
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
      { id: CENTRAL_LIBRARY_ID, label: "Central Library", createdAt: 0 },
      { id: PROJECT_LIBRARY_ID, label: "Project Library", createdAt: 0 },
    ],
  };
}

function defaultLeft(): PanelTabsState {
  return {
    openIds: [CENTRAL_LIBRARY_ID, PROJECT_LIBRARY_ID],
    activeId: CENTRAL_LIBRARY_ID,
  };
}

function defaultRight(): PanelTabsState {
  return { openIds: [], activeId: "" };
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
};

export function useLibraryTabs(): LibraryTabsApi {
  const [registry, setRegistry] = useState<Registry>(defaultRegistry);
  const [leftTabs, setLeftTabs] = useState<PanelTabsState>(defaultLeft);
  const [rightTabs, setRightTabs] = useState<PanelTabsState>(defaultRight);
  const [hydrated, setHydrated] = useState(false);

  // Mirror latest state in refs so synchronous handlers (drag/drop) can
  // read it without going through the setState-updater dance — those
  // updaters don't run synchronously, so `fromPanel = ...` side effects
  // inside them silently fail to land before downstream code runs.
  const leftTabsRef = useRef(leftTabs);
  const rightTabsRef = useRef(rightTabs);
  leftTabsRef.current = leftTabs;
  rightTabsRef.current = rightTabs;

  useEffect(() => {
    setRegistry(loadRegistry());
    setLeftTabs(loadPanelTabs("left"));
    setRightTabs(loadPanelTabs("right"));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveRegistry(registry);
  }, [registry, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("left", leftTabs);
  }, [leftTabs, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("right", rightTabs);
  }, [rightTabs, hydrated]);

  const libraryById = useMemo(() => {
    const m = new Map<string, Library>();
    for (const l of registry.libraries) m.set(l.id, l);
    return m;
  }, [registry]);

  const activate = useCallback((id: string, panel: PanelKey) => {
    const setter = panel === "left" ? setLeftTabs : setRightTabs;
    setter((t) => (t.activeId === id ? t : { ...t, activeId: id }));
  }, []);

  const close = useCallback((id: string, panel: PanelKey) => {
    if (isBuiltin(id)) return;
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

  const create = useCallback((panel: PanelKey): string => {
    const id = newLibraryId();
    const lib: Library = { id, label: "Untitled", createdAt: Date.now() };
    setRegistry((r) => ({ libraries: [...r.libraries, lib] }));
    const setter = panel === "left" ? setLeftTabs : setRightTabs;
    setter((t) => ({ openIds: [...t.openIds, id], activeId: id }));
    return id;
  }, []);

  const openRecent = useCallback((id: string, panel: PanelKey) => {
    if (isBuiltin(id)) return; // built-ins live on the left panel only.
    const setter = panel === "left" ? setLeftTabs : setRightTabs;
    setter((t) =>
      t.openIds.includes(id)
        ? { ...t, activeId: id }
        : { openIds: [...t.openIds, id], activeId: id },
    );
  }, []);

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
    },
    [],
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

  return {
    registry,
    leftTabs,
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
  };
}
