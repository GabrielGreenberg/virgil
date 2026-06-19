"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
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
import { useRowDotState } from "@library/hooks/useRowDotState";
import { useProjectLibrary } from "@library/lib/project-library-context";
import LeftList from "./LeftList";
import PaperFileBody from "./PaperFileBody";
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
  /** FSA handle for the library root. Used by the request-state dot hook
   *  to scan .virgil/queue/ and .virgil/notifications/inbox.json on a 6s poll, and by
   *  paper-kind tabs to read main.tex / references.bib / source PDF. */
  handle: FileSystemDirectoryHandle;
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
}

export default function TabbedLibraryPanel({
  panel,
  scope,
  registry,
  tabs,
  libraryById,
  entries,
  bibByKey,
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
  onBibChanged,
  onChangeFolder,
  onResync,
  showAddTab = false,
  showRecent = false,
}: Props) {
  const { toneFor: dotToneFor, markViewed } = useRowDotState(handle);
  const project = useProjectLibrary();

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
          bib: { state: "unverified" },
        });
      }
      return out;
    }
    const allowedKeys = new Set(activeLibrary.entryKeys ?? []);
    return entries.filter((e) => {
      const k = e.citekey ?? `__triage__${e.originalFilename}`;
      return allowedKeys.has(k);
    });
  }, [activeLibrary, entries, project]);

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

  const handleOpenPaper = (citekey: string) => onOpenPaper(citekey, panel);

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
      <div
        ref={panelRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
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
      />
      {activeLibrary ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            // Paper-kind tabs fill the warm Virgil canvas so the body
            // extends the active tab's color into the editor pod's
            // frame — same ground the editor/view sits on elsewhere.
            // Other library kinds (Central, project, custom) keep the
            // crisp white surface.
            background: isPaper(activeLibrary) ? "var(--background)" : "var(--surface)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--topbar-border)",
            borderRadius: 10,
          }}
        >
          {isPaper(activeLibrary) ? (
            <PaperFileBody
              handle={handle}
              citekey={activeLibrary.citekey ?? null}
              entries={entries}
              bibByKey={bibByKey}
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
                    onRowViewed={(citekey: string | null | undefined) => {
                      if (citekey) markViewed(citekey);
                    }}
                  />
                </div>
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
        borderBottom: "1px solid var(--border)",
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
