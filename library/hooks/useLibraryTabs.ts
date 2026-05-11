"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CENTRAL_LIBRARY_ID,
  docIdFromProjectLibraryId,
  isBuiltin,
  isPaperId,
  isProjectDocId,
  loadPanelTabs,
  paperLibraryId,
  projectLibraryIdForDoc,
  savePanelTabs,
  type Library,
  type PanelTabsState,
  type Registry,
} from "@library/lib/library-store";
import { useDiskLibraries } from "@library/hooks/useDiskLibraries";

export type PanelKey = "left" | "right";

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
  /** Synthetic per-doc project libraries derived from `openDocs`, in
   *  doc order. Empty when `projectsEnabled` is false (scoped tear-out
   *  instances). Exposed so the navigator can list project libraries
   *  alongside the registered ones. */
  projectLibraries: Library[];
  activate: (id: string, panel: PanelKey) => void;
  close: (id: string, panel: PanelKey) => void;
  rename: (id: string, label: string) => void;
  create: (panel: PanelKey) => string;
  /**
   * Create a custom library pre-populated from a parsed `.bib` file. The
   * caller is responsible for having already written the source `.bib`
   * to `unsorted/<sourceBibFile>` so the synthesis path can render rows
   * before a triage skill merges the entries into `master.bib`. Opens
   * the new library as the active tab in `panel` (defaults to "left").
   */
  createFromBib: (args: {
    label: string;
    sourceBibFile: string;
    entryKeys: readonly string[];
    panel?: PanelKey;
  }) => string;
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
   * Batched variant of `addEntryToLibrary` — coalesces multiple
   * citekeys into a single disk write. Use for drag-drop of multiple
   * rows or any other multi-entry add path.
   */
  addEntriesToLibrary: (libId: string, entryKeys: readonly string[]) => void;
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
   * the destination's active tab is replaced when unpinned, or the new
   * paper appends when the active tab is pinned (or the panel is empty).
   */
  openPaper: (citekey: string, fromPanel: PanelKey) => void;
  /**
   * Open a non-paper library (Central / project / custom) into `panel`,
   * with the same replace-or-append semantics as openPaper. Project ids
   * route through the doc-activation path so the corresponding Virgil
   * doc tab also comes forward.
   */
  openLibrary: (libId: string, panel: PanelKey) => void;
  /** Toggle the pinned flag on any registered library (Central, custom,
   *  paper). No-op for synthetic per-doc project libraries — they are
   *  not in the registry. */
  togglePinLibrary: (libId: string) => void;
  /**
   * Close the paper-kind tab whose citekey matches, in whichever panel
   * holds it. Used by the tearout flow when a paper inner tab is
   * promoted to an outer Virgil-bar tab.
   */
  closePaperByCitekey: (citekey: string) => void;
};

export interface UseLibraryTabsOptions {
  /** FSA root handle for the library folder. The custom-library
   *  manifests live at `<handle>/.virgil/libraries/<slug>.json`. May
   *  be `null` while the user is still on the picker / permission
   *  gate; in that state custom libraries are empty and mutations
   *  are no-ops. */
  handle?: FileSystemDirectoryHandle | null;
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

const PROJECT_HIDDEN_KEY = "virgil-library-project-hidden";
const PROJECT_PINNED_KEY = "virgil-library-project-pinned";
/** Separate persistence for paper-tab pin state. Replaces the legacy
 *  `pinned` flag on paper-kind rows of `virgil-library-registry`,
 *  which is no longer read after the disk-libraries refactor. */
const PAPER_PINNED_KEY = "virgil-library-paper-pinned";

function loadIdSet(key: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, set: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

const CENTRAL_LIBRARY: Library = {
  id: CENTRAL_LIBRARY_ID,
  label: "Central Library",
  createdAt: 0,
  kind: "central",
};

/** Derive paper-kind libraries from the panel-tab state. Paper libs
 *  are no longer persisted in the registry; they're reconstructed from
 *  whatever paper IDs appear in either panel's `openIds`, with their
 *  `pinned` flag read from the dedicated `paperPinnedIds` set. The
 *  one-time cost of derivation is trivial (a few ids per render). */
function derivePaperLibraries(
  leftIds: readonly string[],
  rightIds: readonly string[],
  paperPinnedIds: ReadonlySet<string>,
): Library[] {
  const seen = new Set<string>();
  const out: Library[] = [];
  for (const id of [...leftIds, ...rightIds]) {
    if (!isPaperId(id) || seen.has(id)) continue;
    seen.add(id);
    const citekey = id.slice("paper:".length);
    out.push({
      id,
      label: citekey,
      createdAt: 0,
      kind: "paper",
      citekey,
      pinned: paperPinnedIds.has(id),
    });
  }
  return out;
}

export function useLibraryTabs(opts: UseLibraryTabsOptions = {}): LibraryTabsApi {
  const { handle = null, scope, seed, openDocs, currentDocId, onActivateDoc } = opts;
  // Project-doc projection only applies to the singleton (unscoped) Library
  // outer tab. Tear-out scoped instances ignore openDocs entirely.
  const projectsEnabled = !scope;
  // Custom libraries live on disk via `useDiskLibraries`. Built-in
  // (Central) is constant; paper libs are derived from panel tabs;
  // project libs are derived from openDocs. The unified `registry`
  // returned to consumers is composed below.
  const diskLibs = useDiskLibraries(handle);
  const [paperPinnedIds, setPaperPinnedIds] = useState<Set<string>>(
    () => new Set(),
  );
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
  // Project library tabs the user has explicitly closed. The underlying
  // Virgil doc stays open — closing the inner tab just hides it from the
  // middle column. Re-clicking the project library in the navigator (or
  // activating its doc) clears the hidden flag.
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Project library tabs the user has pinned. Persisted alongside hidden
  // ids so the pin/unpin state survives reloads even though project libs
  // themselves are synthetic (not in the registry).
  const [projectPinnedIds, setProjectPinnedIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Build the unified registry view: [Central, ...customs, ...papers].
  // Custom libs come from the disk hook (always sorted by createdAt);
  // paper libs are reconstructed from open panel tabs.
  const paperLibraries = useMemo(
    () =>
      derivePaperLibraries(leftTabs.openIds, rightTabs.openIds, paperPinnedIds),
    [leftTabs.openIds, rightTabs.openIds, paperPinnedIds],
  );

  const registry = useMemo<Registry>(
    () => ({
      libraries: [CENTRAL_LIBRARY, ...diskLibs.libraries, ...paperLibraries],
    }),
    [diskLibs.libraries, paperLibraries],
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
    setLeftTabs(
      loadPanelTabs("left", { scope, fallback: seed?.left }),
    );
    setRightTabs(
      loadPanelTabs("right", { scope, fallback: seed?.right }),
    );
    if (projectsEnabled) {
      setHiddenProjectIds(loadIdSet(PROJECT_HIDDEN_KEY));
      setProjectPinnedIds(loadIdSet(PROJECT_PINNED_KEY));
      setPaperPinnedIds(loadIdSet(PAPER_PINNED_KEY));
    }
    setHydrated(true);
    // Hydrate once per mount; scope/seed are treated as initial-mount-only
    // configuration (changing them would require a remount of the consumer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("left", leftTabs, { scope });
  }, [leftTabs, hydrated, scope]);
  useEffect(() => {
    if (!hydrated) return;
    savePanelTabs("right", rightTabs, { scope });
  }, [rightTabs, hydrated, scope]);
  useEffect(() => {
    if (!hydrated || !projectsEnabled) return;
    saveIdSet(PROJECT_HIDDEN_KEY, hiddenProjectIds);
  }, [hiddenProjectIds, hydrated, projectsEnabled]);
  useEffect(() => {
    if (!hydrated || !projectsEnabled) return;
    saveIdSet(PROJECT_PINNED_KEY, projectPinnedIds);
  }, [projectPinnedIds, hydrated, projectsEnabled]);
  useEffect(() => {
    if (!hydrated || !projectsEnabled) return;
    saveIdSet(PAPER_PINNED_KEY, paperPinnedIds);
  }, [paperPinnedIds, hydrated, projectsEnabled]);

  // Synthetic Library entries for the per-doc project inner tabs. Not
  // persisted in the registry — derived per-render from `openDocs`. The
  // `pinned` flag IS persisted (see PROJECT_PINNED_KEY) and rehydrates
  // even though the underlying lib is synthetic.
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
        pinned: projectPinnedIds.has(id),
      });
    }
    return m;
  }, [projectsEnabled, openDocs, projectPinnedIds]);

  const libraryById = useMemo(() => {
    const m = new Map<string, Library>();
    for (const l of registry.libraries) m.set(l.id, l);
    for (const lib of projectLibsByDocId.values()) m.set(lib.id, lib);
    return m;
  }, [registry, projectLibsByDocId]);

  // Per-doc project libraries in doc order (matches the openDocs list).
  // Exposed so the navigator can list them under a Project section without
  // re-deriving from the openDocs prop.
  const projectLibraries = useMemo<Library[]>(() => {
    if (!openDocs || openDocs.length === 0) return [];
    const out: Library[] = [];
    for (const d of openDocs) {
      const lib = projectLibsByDocId.get(d.id);
      if (lib) out.push(lib);
    }
    return out;
  }, [openDocs, projectLibsByDocId]);

  // Public leftTabs: persisted `leftTabs` state holds Central + any
  // user-added extras (custom/paper). Per-doc project tabs are spliced
  // in right after Central. activeId follows currentDocId unless the
  // user has explicitly pinned a non-project tab.
  const displayedLeftTabs = useMemo<PanelTabsState>(() => {
    if (!projectsEnabled) return leftTabs;
    // Project ids the user explicitly closed are hidden from the strip
    // (the underlying doc is still open — it just doesn't surface a
    // project library tab here until the user re-opens it via the
    // navigator).
    const projectIds = (openDocs ?? [])
      .map((d) => projectLibraryIdForDoc(d.id))
      .filter((id) => !hiddenProjectIds.has(id));
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
    hiddenProjectIds,
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

  // Helper: when the user activates or re-opens a project library, also
  // un-hide it (so its tab returns to the strip).
  const unhideProject = useCallback((id: string) => {
    setHiddenProjectIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const activate = useCallback(
    (id: string, panel: PanelKey) => {
      if (panel === "left" && projectsEnabled && isProjectDocId(id)) {
        const docId = docIdFromProjectLibraryId(id);
        if (docId && onActivateDoc) onActivateDoc(docId);
        unhideProject(id);
        setLeftPinnedActiveId(null);
        return;
      }
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) => (t.activeId === id ? t : { ...t, activeId: id }));
      pinIfLeft(panel, id);
    },
    [projectsEnabled, onActivateDoc, pinIfLeft, unhideProject],
  );

  const close = useCallback((id: string, panel: PanelKey) => {
    // Per-doc project tabs are synthetic, so we can't simply remove them
    // from openIds (they're spliced in by `displayedLeftTabs`). Instead,
    // mark the id as hidden — the synthesizer skips hidden ids and the
    // tab disappears from the strip until the user re-opens it via the
    // navigator (or activates the underlying doc). The doc itself is
    // untouched.
    if (isProjectDocId(id)) {
      setHiddenProjectIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      return;
    }
    // Central, customs, and papers all remove from openIds. Central
    // remains in the registry (and the navigator); the user can re-open
    // it any time. Customs/papers stay in the registry for "recent"
    // recall via the navigator (customs) or the catalog (papers).
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

  const rename = useCallback(
    (id: string, label: string) => {
      if (isBuiltin(id)) return;
      // Custom libraries → disk hook handles the manifest rewrite +
      // file rename. Paper libs are read-only labels (= the citekey),
      // so they ignore renames silently.
      diskLibs.rename(id, label);
    },
    [diskLibs],
  );

  const create = useCallback(
    (panel: PanelKey): string => {
      // diskLibs.create is sync from the caller's view — it returns
      // the new Library immediately and writes to disk in the
      // background. The id is stable and usable right away.
      const lib = diskLibs.create("Untitled");
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) => ({ openIds: [...t.openIds, lib.id], activeId: lib.id }));
      pinIfLeft(panel, lib.id);
      return lib.id;
    },
    [diskLibs, pinIfLeft],
  );

  const createFromBib = useCallback(
    (args: {
      label: string;
      sourceBibFile: string;
      entryKeys: readonly string[];
      panel?: PanelKey;
    }): string => {
      const panel: PanelKey = args.panel ?? "left";
      const lib = diskLibs.createFromBib({
        label: args.label,
        sourceBibFile: args.sourceBibFile,
        citekeys: args.entryKeys,
      });
      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      setter((t) => ({ openIds: [...t.openIds, lib.id], activeId: lib.id }));
      pinIfLeft(panel, lib.id);
      return lib.id;
    },
    [diskLibs, pinIfLeft],
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
      diskLibs.addEntries(libId, [entryKey]);
    },
    [diskLibs],
  );

  /** Batched plural variant — single disk write per drop, regardless
   *  of how many keys came in. Use this whenever you have an array;
   *  prefer it over a `for` loop of `addEntryToLibrary`. */
  const addEntriesToLibrary = useCallback(
    (libId: string, entryKeys: readonly string[]) => {
      if (isBuiltin(libId)) return;
      if (entryKeys.length === 0) return;
      diskLibs.addEntries(libId, entryKeys);
    },
    [diskLibs],
  );

  // Inverse of addEntryToLibrary — only removes from the local membership
  // list. Central rejects this op (you can't "remove" from Central without
  // a real delete; that path goes through queueDelete instead).
  const removeEntryFromLibrary = useCallback(
    (libId: string, entryKey: string) => {
      if (isBuiltin(libId)) return;
      if (!entryKey) return;
      diskLibs.removeEntry(libId, entryKey);
    },
    [diskLibs],
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

      // No registry write needed — paper libs are derived from
      // panel-tab `openIds` via `derivePaperLibraries`. Once `newId`
      // lands in either panel below, the next render rebuilds the
      // paper-libs list automatically.

      // Replace-or-append in the destination panel. Any unpinned active
      // tab is replaceable now (paper or library) — the same mechanic
      // that drives navigator clicks via openLibrary.
      const destSetter = destPanel === "left" ? setLeftTabs : setRightTabs;
      const libsRef = registryRef.current.libraries;
      destSetter((t) => {
        const activeIdx = t.openIds.indexOf(t.activeId);
        const activeLib =
          activeIdx >= 0
            ? libsRef.find((l) => l.id === t.openIds[activeIdx])
            : undefined;
        const replaceTarget =
          activeLib && !activeLib.pinned ? activeLib.id : null;
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

  // Open a non-paper library into `panel` with the same replace-or-append
  // contract as openPaper. Project ids route through the doc-activation
  // path (the project tab is already spliced into displayedLeftTabs from
  // openDocs, so we just bring its doc forward).
  const openLibrary = useCallback(
    (libId: string, panel: PanelKey) => {
      if (!libId) return;

      if (panel === "left" && projectsEnabled && isProjectDocId(libId)) {
        const docId = docIdFromProjectLibraryId(libId);
        if (docId && onActivateDoc) onActivateDoc(docId);
        unhideProject(libId);
        setLeftPinnedActiveId(null);
        return;
      }

      const leftHas = leftTabsRef.current.openIds.includes(libId);
      const rightHas = rightTabsRef.current.openIds.includes(libId);
      if (leftHas || rightHas) {
        const inPanel: PanelKey = leftHas ? "left" : "right";
        const setter = inPanel === "left" ? setLeftTabs : setRightTabs;
        setter((t) => (t.activeId === libId ? t : { ...t, activeId: libId }));
        pinIfLeft(inPanel, libId);
        return;
      }

      const setter = panel === "left" ? setLeftTabs : setRightTabs;
      const libsRef = registryRef.current.libraries;
      setter((t) => {
        const activeIdx = t.openIds.indexOf(t.activeId);
        const activeLib =
          activeIdx >= 0
            ? libsRef.find((l) => l.id === t.openIds[activeIdx])
            : undefined;
        const replaceTarget =
          activeLib && !activeLib.pinned ? activeLib.id : null;
        if (replaceTarget) {
          const next = t.openIds.map((id) => (id === replaceTarget ? libId : id));
          return { openIds: next, activeId: libId };
        }
        return { openIds: [...t.openIds, libId], activeId: libId };
      });
      pinIfLeft(panel, libId);
    },
    [projectsEnabled, onActivateDoc, pinIfLeft, unhideProject],
  );

  const togglePinLibrary = useCallback(
    (libId: string) => {
      // Project libs aren't in the registry — pin state lives in a
      // separate persisted set keyed by project library id.
      if (isProjectDocId(libId)) {
        setProjectPinnedIds((prev) => {
          const next = new Set(prev);
          if (next.has(libId)) next.delete(libId);
          else next.add(libId);
          return next;
        });
        return;
      }
      // Paper libs: pin state lives in a similar persisted set
      // (PAPER_PINNED_KEY). Paper libs are derived per-render from
      // panel-tab openIds, so there's nothing to mutate in any
      // registry — just flip the membership of the set.
      if (isPaperId(libId)) {
        setPaperPinnedIds((prev) => {
          const next = new Set(prev);
          if (next.has(libId)) next.delete(libId);
          else next.add(libId);
          return next;
        });
        return;
      }
      // Custom libs: disk hook owns persistence.
      diskLibs.togglePin(libId);
    },
    [diskLibs],
  );

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
    projectLibraries,
    activate,
    close,
    rename,
    create,
    createFromBib,
    openRecent,
    moveTab,
    addEntryToLibrary,
    addEntriesToLibrary,
    removeEntryFromLibrary,
    openPaper,
    openLibrary,
    togglePinLibrary,
    closePaperByCitekey,
  };
}
