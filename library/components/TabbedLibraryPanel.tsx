"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { BibAuthState, CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import {
  CENTRAL_LIBRARY_ID,
  isBuiltin,
  isCentral,
  isPaper,
  isProject,
  type Library,
  type PanelTabsState,
  type Registry,
} from "@library/lib/library-store";
import { ENTRIES_DT_TYPE, ENTRY_DT_TYPE, TAB_DT_TYPE } from "@library/lib/dnd-types";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { useProjectLibrary } from "@library/lib/project-library-context";
import {
  setListQuery,
  useCentralViewMode,
} from "@library/lib/view-session-store";
import LeftList from "./LeftList";
import LibraryCentralDashboard from "./LibraryCentralDashboard";
import ReaderLRU from "./ReaderLRU";
import type { RowActions } from "./LeftListRow";

/** Primitive entry-action helpers passed down from LibraryView. The panel
 *  composes them into a context-aware {@link RowActions} based on which
 *  library is active (Central → true delete; custom → remove-from-library). */
export interface EntryActions {
  queueDelete: (citekey: string) => void;
  queueBibReview: (citekey: string) => void;
  queuePaperReview: (citekey: string) => void;
  queueImportBib: (citekey: string) => void;
  removeFromLibrary: (libId: string, entryKey: string) => void;
}
import {
  PanelTabStrip,
  type PanelMenuItem,
  type RecentLibrary,
  type TabDef,
} from "./panel-tabs/PanelTabStrip";
import { STRIP_SIDE_PAD } from "@/components/chrome/folder-tab-geometry";

interface Props {
  panel: PanelKey;
  /** View-session scope: '' for the inline Library tab, 'outer:<libId>'
   *  for a tear-out outer-tab instance. Threaded into LeftList so its
   *  per-(panel,libId) query/sort/scroll persist under the right scope. */
  scope: string;
  registry: Registry;
  tabs: PanelTabsState;
  libraryById: Map<string, Library>;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  /** F#4: authoritative reference-universe states (bib-index projection),
   *  used so fileless synthetic rows show the real state, not a hardcode. */
  bibStateByKey?: ReadonlyMap<string, BibAuthState>;
  selectedKeys: ReadonlySet<string>;
  anchorKey: string | null;
  /** Commit a new selection set + anchor. The anchor is the pivot for
   *  future shift-click range selections; pass the most recently
   *  single-clicked or cmd-clicked key. Pass `null` to clear the anchor. */
  onSelectKeys: (keys: ReadonlySet<string>, anchor: string | null) => void;
  /** Open a paper as a tabbed library file in the opposite panel. */
  onOpenPaper: (citekey: string, fromPanel: PanelKey) => void;
  onActivate: (id: string, panel: PanelKey) => void;
  onClose: (id: string, panel: PanelKey) => void;
  onRename: (id: string, label: string) => void;
  onCreate: (panel: PanelKey) => string;
  onOpenRecent: (id: string, panel: PanelKey) => void;
  onMoveTab: (libId: string, toPanel: PanelKey, toIndex: number) => void;
  /** Always batched: a multi-row drop must dispatch a single call so
   *  project-library writes (which read-modify-write references.bib)
   *  don't race. Callers pass `[key]` for single-row drops. */
  onAddEntriesToLibrary: (libId: string, entryKeys: readonly string[]) => void;
  /** Toggle pin on any registered library — paper, custom, or Central. */
  onTogglePinLibrary: (libId: string) => void;
  entryActions: EntryActions;
  /** Render the strip's trailing "+" button + recent-libraries dropdown.
   *  False in 3-column layouts where the navigator owns those affordances;
   *  true in tear-out 2-column layouts for back-compat. */
  showAddTab?: boolean;
  showRecent?: boolean;
  /** FSA handle for the library root. Used by paper-kind tabs to read
   *  main.tex / references.bib / source PDF. */
  handle: FileSystemDirectoryHandle;
  /** Far-left request-state dot tone for a citekey + the "mark viewed"
   *  callback. The 6 s queue/inbox poll behind these is LIFTED to LibraryView
   *  (chip A3): one shared poll feeds BOTH panels instead of one per panel. */
  dotToneFor: (citekey: string | null | undefined) => "red" | "green" | null;
  markViewed: (citekey: string) => void;
  /** Reload master.bib after a save lands inside a paper-kind tab. */
  onBibChanged?: () => void;
  /** Forget the current library folder and prompt for a new one. Surfaced
   *  in the panel-level "⋮" menu (left panel only). Right panel passes
   *  undefined and the menu button is omitted. */
  onChangeFolder?: () => void;
  /** Re-write the Virgil skill bundle into the library folder. Surfaced
   *  beside "Change folder…" in the Central library's "⋮" menu (left panel
   *  only) — the one-click version of a manual skill re-sync. */
  onResync?: () => void;
  /** True while an OS file is dragged over the Library. Forwarded to the tab
   *  strip so the Central tab lights up as the drop-ready target (task 089). */
  fileDragActive?: boolean;
}

export default function TabbedLibraryPanel({
  panel,
  scope,
  registry,
  tabs,
  libraryById,
  entries,
  bibByKey,
  bibStateByKey,
  selectedKeys,
  anchorKey,
  onSelectKeys,
  onOpenPaper,
  onActivate,
  onClose,
  onRename,
  onCreate,
  onOpenRecent,
  onMoveTab,
  onAddEntriesToLibrary,
  onTogglePinLibrary,
  entryActions,
  handle,
  dotToneFor,
  markViewed,
  onBibChanged,
  onChangeFolder,
  onResync,
  showAddTab = false,
  showRecent = false,
  fileDragActive = false,
}: Props) {
  const project = useProjectLibrary();
  // Central-library landing view ("dashboard" | "list"). Global slice; default
  // "dashboard" so the heavy virtualized LeftList stays unmounted until Browse.
  const { centralViewMode, setCentralViewMode } = useCentralViewMode();

  const tabDefs: TabDef[] = useMemo(
    () =>
      tabs.openIds
        .map((id) => libraryById.get(id))
        .filter((l): l is Library => Boolean(l))
        .map((l) => {
          const paper = isPaper(l);
          return {
            id: l.id,
            label: l.label,
            // Every tab gets a close button now — Central removes itself
            // from the strip (it stays in the registry / navigator);
            // project tabs route through the underlying doc-close path
            // (handled in useLibraryTabs.close).
            closable: true,
            renamable: !isBuiltin(l.id) && !paper,
            pinned: !!l.pinned,
            onTogglePin: () => onTogglePinLibrary(l.id),
            paperCitekey: paper ? l.citekey : undefined,
            // Custom libraries are draggable to the Virgil bar to spawn
            // their own outer tab. Central, paper-kind, and per-doc
            // project tabs are excluded — Central is the baseline,
            // papers tear out via the paper drag payload, and project
            // tabs are derived from the open Virgil docs (closing the
            // doc removes its tab).
            outerDraggableLibraryId:
              !paper && !isBuiltin(l.id) ? l.id : undefined,
            menu:
              l.id === CENTRAL_LIBRARY_ID && (onChangeFolder || onResync)
                ? ([
                    ...(onResync
                      ? [{ label: "Re-sync skills", onClick: onResync }]
                      : []),
                    ...(onChangeFolder
                      ? [{ label: "Change folder…", onClick: onChangeFolder }]
                      : []),
                  ] satisfies PanelMenuItem[])
                : undefined,
          } satisfies TabDef;
        }),
    [tabs.openIds, libraryById, onChangeFolder, onResync, onTogglePinLibrary],
  );

  const recentLibraries: RecentLibrary[] = useMemo(() => {
    const openSet = new Set(tabs.openIds);
    return registry.libraries
      .filter((l) => !isBuiltin(l.id) && !isPaper(l) && !openSet.has(l.id))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((l) => ({ id: l.id, label: l.label }));
  }, [registry.libraries, tabs.openIds]);

  const activeLibrary = libraryById.get(tabs.activeId);

  // Compose row actions based on which library is active. In Central, the
  // destructive action is a true delete (queue intent file + confirm). In
  // a custom library, it's just a local membership removal — no skill
  // call, no confirm, different label.
  const rowActions = useMemo<RowActions>(() => {
    if (!activeLibrary || isCentral(activeLibrary.id)) {
      return {
        deleteLabel: "Delete…",
        onDelete: (citekey: string) => {
          const ok = window.confirm(
            `Delete ${citekey}?\n\nThis queues a delete request — the skill will remove the source file, indexed paper, bib entry, and catalog row.`,
          );
          if (!ok) return;
          entryActions.queueDelete(citekey);
        },
        onBibReview: entryActions.queueBibReview,
        onTextReview: entryActions.queuePaperReview,
        onImportBib: entryActions.queueImportBib,
      };
    }
    if (isProject(activeLibrary.id)) {
      // Membership comes from the doc's references.bib. Deleting from a
      // project library mutates that file directly — the central library
      // and master.bib are untouched. Warn the user before writing,
      // since any \cite{key} commands already in the document will be
      // left dangling.
      const libId = activeLibrary.id;
      return {
        deleteLabel: "Remove from references.bib…",
        onDelete: (citekey: string) => {
          const ok = window.confirm(
            `Remove ${citekey} from this project's references.bib?\n\nThe entry stays in the central library — only this document's bibliography is affected. Any \\cite{${citekey}} commands already in the text will reference a missing entry.`,
          );
          if (!ok) return;
          entryActions.removeFromLibrary(libId, citekey);
        },
        onBibReview: entryActions.queueBibReview,
        onTextReview: entryActions.queuePaperReview,
        onImportBib: entryActions.queueImportBib,
      };
    }
    const libId = activeLibrary.id;
    return {
      deleteLabel: "Remove from library",
      // Indexed entries use citekey as their entryKey, which is what the
      // menu hands us; triage rows can't enter custom libraries via this
      // path (their menu is disabled when citekey is null).
      onDelete: (citekey: string) => entryActions.removeFromLibrary(libId, citekey),
      onBibReview: entryActions.queueBibReview,
      onTextReview: entryActions.queuePaperReview,
      onImportBib: entryActions.queueImportBib,
    };
  }, [activeLibrary, entryActions]);

  const visibleEntries = useMemo<CatalogEntry[]>(() => {
    if (!activeLibrary) return [];
    if (isPaper(activeLibrary)) return [];
    if (isCentral(activeLibrary.id)) return entries;
    if (isProject(activeLibrary.id)) {
      // Project tab: one row per key in the doc's bib (filtered to the
      // cite-set when "cited only" is on). For each key, prefer the
      // existing catalog row (so status pills, paper render, etc. work);
      // fall back to a synthesized bib-only row when the key isn't yet
      // indexed by the library.
      if (!project.hasDoc) return [];
      const filterSet = project.citedOnly ? project.citedKeys : project.bibKeys;
      const catalogByKey = new Map<string, CatalogEntry>();
      for (const e of entries) {
        if (e.citekey) catalogByKey.set(e.citekey, e);
      }
      const out: CatalogEntry[] = [];
      for (const key of filterSet) {
        const indexed = catalogByKey.get(key);
        if (indexed) {
          out.push(indexed);
          continue;
        }
        const meta = project.bibMeta.get(key);
        out.push({
          citekey: key,
          title: meta?.title,
          authors: meta?.authors,
          year: meta?.year,
          doi: meta?.doi,
          addedAt: "",
          updatedAt: "",
          pdf: { present: false },
          indexed: { state: "none" },
          // F#4: real projected state for the fileless reference, default "none".
          bib: { state: bibStateByKey?.get(key) ?? "none" },
        });
      }
      return out;
    }
    const allowedKeys = new Set(activeLibrary.entryKeys ?? []);
    return entries.filter((e) => {
      const k = e.citekey ?? `__triage__${e.originalFilename}`;
      return allowedKeys.has(k);
    });
  }, [activeLibrary, entries, project, bibStateByKey]);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // Panel-wide drop zone — accepts:
  //   - Entry rows (ENTRY_DT_TYPE): adds to the active library if it's a
  //     drop-eligible custom library. Per-tab targeting still wins
  //     (PanelTabStrip handles it deeper in the DOM and preventDefaults).
  //   - Library/paper tabs (TAB_DT_TYPE): drops into this panel. The
  //     strip handles in-strip drops; this catches drops anywhere else
  //     in the panel area, which is the intuitive target when the panel
  //     is empty.
  const [panelDragOver, setPanelDragOver] = useState<null | "entry" | "tab">(null);
  // Drop targets:
  //   - "custom" libraries: append to entryKeys (registry mutation).
  //   - "project" (per-doc) libraries: append the bib entry to the doc's
  //     references.bib via a window-event handler in `LibraryTabView`.
  // Central / paper / unknown reject the drop.
  const dropTargetId =
    activeLibrary &&
    !isPaper(activeLibrary) &&
    (activeLibrary.kind === "custom" || activeLibrary.kind === "project")
      ? activeLibrary.id
      : null;

  const dataTransferHas = (
    e: DragEvent<HTMLDivElement>,
    type: string,
  ): boolean => {
    const types = e.dataTransfer.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === type) return true;
    }
    return false;
  };

  // Read the multi-row payload if present (JSON array of entry keys),
  // falling back to the single-key payload for back-compat. Returns []
  // when neither is present, or the JSON is malformed.
  const readEntryKeys = (e: DragEvent<HTMLDivElement>): string[] => {
    const multi = e.dataTransfer.getData(ENTRIES_DT_TYPE);
    if (multi) {
      try {
        const parsed = JSON.parse(multi);
        if (
          Array.isArray(parsed) &&
          parsed.every((k): k is string => typeof k === "string")
        ) {
          return parsed;
        }
      } catch {
        // fall through to single-key
      }
    }
    const single = e.dataTransfer.getData(ENTRY_DT_TYPE);
    return single ? [single] : [];
  };

  const handlePanelDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return; // strip handled per-tab targeting
    if (dataTransferHas(e, TAB_DT_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (panelDragOver !== "tab") setPanelDragOver("tab");
      return;
    }
    if (!dropTargetId) return;
    if (!dataTransferHas(e, ENTRY_DT_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (panelDragOver !== "entry") setPanelDragOver("entry");
  };

  const handlePanelDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setPanelDragOver(null);
  };

  const handlePanelDrop = (e: DragEvent<HTMLDivElement>) => {
    setPanelDragOver(null);
    if (e.defaultPrevented) return; // strip handled per-tab drop
    const tabLibId = e.dataTransfer.getData(TAB_DT_TYPE);
    if (tabLibId) {
      e.preventDefault();
      onMoveTab(tabLibId, panel, tabs.openIds.length);
      return;
    }
    if (!dropTargetId) return;
    const keys = readEntryKeys(e);
    if (keys.length === 0) return;
    e.preventDefault();
    onAddEntriesToLibrary(dropTargetId, keys);
  };

  // Memoized so LeftList's `onOpenPaper`/`onRowViewed` props stay stable —
  // that's what keeps LeftList's `onActivate` callback (and therefore every
  // memoized row) from being invalidated on each panel re-render.
  const handleOpenPaper = useCallback(
    (citekey: string) => onOpenPaper(citekey, panel),
    [onOpenPaper, panel],
  );
  const handleRowViewed = useCallback(
    (citekey: string | null | undefined) => {
      if (citekey) markViewed(citekey);
    },
    [markViewed],
  );

  return (
    <div
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        position: "relative",
        padding: 6,
        background: "var(--library-bg)",
      }}
    >
      {/* Unifying "folder + page" frame. The rounded border + overflow live
       *  HERE, enclosing the tab strip AND the body as one continuous
       *  surface — NOT on the body div (which used to carry its own
       *  competing rounded card, causing the active tab's corners to spill
       *  into the body's top corners and the catalog header to read as a
       *  separate clipped seam). The strip's tabs poke up at the top of this
       *  frame; the body fills below; the active tab's bottom merges into the
       *  body via its swoop stroke. Background is --surface so the seam reads
       *  cleanly (paper-kind bodies override to --background below). This is
       *  also the node the tab drag-ghost clones, so the ghost now carries
       *  the whole folder silhouette. */}
      <div
        ref={panelRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          // No outer "pod" frame: the tab strip sits bare on the library
          // backdrop, and the page outline (border + rounded corners) lives on
          // the BODY below, so the active tab integrates into the page edge and
          // the outline continues under the inactive tabs. (Was a unifying
          // border/radius/overflow wrapper.) That last clause only became TRUE
          // in task 324 — the strip's own opaque --library-bg had been painting
          // over the body's border row across the whole panel width; see the
          // seam-row comment in PanelTabStrip.tsx. Transparent here because the
          // FIELD is painted once, by the panel container above (padding 6 +
          // --library-bg), and every descendant paints over it.
          background: "transparent",
        }}
      >
      <PanelTabStrip
        panel={panel}
        tabs={tabDefs}
        activeId={tabs.activeId}
        recentLibraries={recentLibraries}
        onActivate={(id) => onActivate(id, panel)}
        onClose={(id) => onClose(id, panel)}
        onRename={onRename}
        onCreate={() => onCreate(panel)}
        onOpenRecent={(id) => onOpenRecent(id, panel)}
        onMoveTab={onMoveTab}
        onDropEntries={onAddEntriesToLibrary}
        panelRef={panelRef}
        showAddTab={showAddTab}
        showRecent={showRecent}
        fileDragActive={fileDragActive}
      />
      {activeLibrary ? (
        // Body region = the "page". Its outline is a plain CSS border owned by
        // the layout engine — it tracks every resize (including mid-drag)
        // natively, with no measurement, no ResizeObserver, no park/reconcile
        // protocol (the task-047 measured-SVG frame + its task-090 parking are
        // deleted). Tangency with the tab silhouette is a radius-token
        // relationship: border-radius consumes var(--library-manila-radius)
        // === the numeric MANILA_RADIUS the tab caps' shoulder arcs use
        // (locked by folder-tab-geometry.test.ts). The body is inset
        // horizontally by STRIP_SIDE_PAD (the same pad the tab strip uses), so
        // its rounded TOP corners begin exactly under the outermost tabs'
        // swoop feet — the task-047 "no wing" invariant, now a pure layout
        // relationship.
        //
        // THIS BORDER IS THE SOLE PAINTER OF THE BASELINE ROW (task 324), and
        // the only thing allowed to cover any of it is the ACTIVE tab's own
        // footprint: the tab's open-bottomed stroke + its 1px bottom fill row
        // (the caps' bridge rects + the middle div's fill) paint above this
        // border because the strip is z-index 20 while the body is z-auto — so
        // the tab merges into the page while the border continues, uncovered,
        // beside it. The strip itself paints NOTHING: an opaque background
        // there covers this row across the FULL panel width (backgrounds fill
        // the PADDING box, and the strip's -1px bottom margin puts this row
        // inside its 1px bottom padding), which is what made the page outline
        // read as "spotty" from task 048 until 324. Any future strip-level
        // paint must stop above the seam row.
        // Paper-kind tabs fill the warm Virgil canvas; other kinds use --surface.
        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            // Inset by the shared STRIP_SIDE_PAD so the page edges align under
            // the tab swoop feet (no wing) — the gutter to either side reads as
            // library field, matching the strip's own side padding.
            margin: `0 ${STRIP_SIDE_PAD}px`,
            background: isPaper(activeLibrary)
              ? "var(--background)"
              : "var(--surface)",
            border: "1px solid var(--library-edge)",
            borderRadius: "var(--library-manila-radius)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isPaper(activeLibrary) ? (
            // L3 keep-alive: an LRU of the last N reader papers stays mounted
            // (hidden) so switching between inner paper tabs is instant. Reuses
            // the same KeepAliveSlot/visibility primitive as the main-doc bounce.
            <ReaderLRU
              handle={handle}
              activeCitekey={activeLibrary.citekey ?? null}
              entries={entries}
              bibByKey={bibByKey}
              bibStateByKey={bibStateByKey}
              onBibChanged={onBibChanged}
              scope={scope}
              panel={panel}
            />
          ) : (
            <>
              {isProject(activeLibrary.id) ? (
                <ProjectHeader
                  hasDoc={project.hasDoc}
                  docLabel={project.docLabel}
                  citedOnly={project.citedOnly}
                  setCitedOnly={project.setCitedOnly}
                  bibCount={project.bibKeys.size}
                  citedCount={project.citedKeys.size}
                />
              ) : null}
              {isProject(activeLibrary.id) && !project.hasDoc ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                    color: "var(--muted)",
                    fontStyle: "italic",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Open a document tab to see its bibliography here.
                </div>
              ) : (
                // BODY-CONTENT BRANCH POINT. Non-paper libraries render here.
                // Central defaults to a no-browse stats dashboard (ASK 7); the
                // heavy virtualized LeftList stays UNMOUNTED until the user hits
                // Browse (that's the whole perf point). Project / custom
                // libraries — and Central once Browse is chosen — render the
                // LeftList. A persistent [Dashboard | Browse] switch rides the
                // Central header in list mode so the user can flip back.
                isCentral(activeLibrary.id) && centralViewMode === "dashboard" ? (
                  <LibraryCentralDashboard
                    entries={visibleEntries}
                    bibByKey={bibByKey}
                    libraryName={activeLibrary.label}
                    onOpenPaper={handleOpenPaper}
                    onBrowse={() => setCentralViewMode("list")}
                    onBrowseWithQuery={(q) => {
                      // Pre-fill the list's persisted query slice (the same one
                      // LeftList reads via useListView), then switch to list.
                      setListQuery(scope, panel, activeLibrary.id, q);
                      setCentralViewMode("list");
                    }}
                  />
                ) : (
                  <>
                    {isCentral(activeLibrary.id) ? (
                      <CentralListHeader
                        onDashboard={() => setCentralViewMode("dashboard")}
                      />
                    ) : null}
                    <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                      <LeftList
                        entries={visibleEntries}
                        bibByKey={bibByKey}
                        scope={scope}
                        panel={panel}
                        libId={activeLibrary.id}
                        selectedKeys={selectedKeys}
                        anchorKey={anchorKey}
                        onSelectKeys={onSelectKeys}
                        onOpenPaper={handleOpenPaper}
                        rowActions={rowActions}
                        dropHighlight={panelDragOver === "entry"}
                        dotToneFor={dotToneFor}
                        onRowViewed={handleRowViewed}
                      />
                    </div>
                  </>
                )
              )}
            </>
          )}
        </div>
      ) : (
        <EmptyPanelBody />
      )}
      </div>
      {panelDragOver === "tab" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(124, 94, 60, 0.08)",
            border: "2px dashed var(--accent)",
            pointerEvents: "none",
            zIndex: 30,
          }}
        />
      )}
    </div>
  );
}

function EmptyPanelBody() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--muted)",
        fontStyle: "italic",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      Open a library or paper to view it here.
    </div>
  );
}

/** Slim header for the Central library while it's in LIST mode. Hosts a
 *  persistent [ Dashboard | Browse ] segmented switch so the user can always
 *  return to the stats home — not only via the dashboard's own CTA. Mirrors
 *  ProjectHeader's top-corner-radius treatment so it reads as the top of the
 *  one continuous folder surface. The dashboard itself owns the inverse
 *  affordance (its "Browse all →" button), so both directions are reachable
 *  from a persistent, obvious control. */
function CentralListHeader({ onDashboard }: { onDashboard: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "6px 10px",
        borderTopLeftRadius: "var(--library-manila-radius)",
        borderTopRightRadius: "var(--library-manila-radius)",
        borderBottom: "1px solid var(--border-light)",
        background: "var(--surface)",
        flexShrink: 0,
      }}
    >
      <div className="lib-viewswitch" role="group" aria-label="Central library view">
        <button
          type="button"
          className="lib-viewswitch-btn"
          aria-pressed={false}
          onClick={onDashboard}
        >
          Dashboard
        </button>
        <button
          type="button"
          className="lib-viewswitch-btn"
          aria-pressed={true}
          // Already in Browse/list mode — pressed + inert.
          onClick={() => {}}
        >
          Browse
        </button>
      </div>
    </div>
  );
}

interface ProjectHeaderProps {
  hasDoc: boolean;
  docLabel?: string;
  citedOnly: boolean;
  setCitedOnly: (value: boolean) => void;
  bibCount: number;
  citedCount: number;
}

function ProjectHeader({
  hasDoc,
  docLabel,
  citedOnly,
  setCitedOnly,
  bibCount,
  citedCount,
}: ProjectHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 10px",
        // Top corners match the unifying wrapper's R=10 so the header reads
        // as the top of the one continuous folder surface (the wrapper's
        // overflow:hidden also clips to this radius — belt-and-suspenders).
        borderTopLeftRadius: "var(--library-manila-radius)",
        borderTopRightRadius: "var(--library-manila-radius)",
        // Flattened from a hard 1px --border seam to a subtle divider: it
        // separates the controls from the catalog list without reading as a
        // separate clipped card edge.
        borderBottom: "1px solid var(--border-light)",
        background: "var(--surface)",
        gap: 8,
        flexShrink: 0,
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: "var(--muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={hasDoc ? docLabel : undefined}
      >
        {hasDoc
          ? citedOnly
            ? `${citedCount} cited / ${bibCount} in bib`
            : `${bibCount} entries in references.bib`
          : "No document open"}
      </span>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          cursor: hasDoc ? "pointer" : "not-allowed",
          color: hasDoc ? "var(--foreground)" : "var(--muted)",
          opacity: hasDoc ? 1 : 0.5,
          userSelect: "none",
          fontSize: 12,
        }}
      >
        <input
          type="checkbox"
          checked={citedOnly}
          disabled={!hasDoc}
          onChange={(e) => setCitedOnly(e.target.checked)}
        />
        Cited only
      </label>
    </div>
  );
}
