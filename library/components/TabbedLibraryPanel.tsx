"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import {
  CENTRAL_LIBRARY_ID,
  isBuiltin,
  isCentral,
  isProject,
  type Library,
  type PanelTabsState,
  type Registry,
} from "@library/lib/library-store";
import { ENTRY_DT_TYPE } from "@library/lib/dnd-types";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { useRowDotState } from "@library/hooks/useRowDotState";
import { useProjectLibrary } from "@library/lib/project-library-context";
import LeftList from "./LeftList";
import type { RowActions } from "./LeftListRow";

/** Primitive entry-action helpers passed down from LibraryView. The panel
 *  composes them into a context-aware {@link RowActions} based on which
 *  library is active (Central → true delete; custom → remove-from-library). */
export interface EntryActions {
  queueDelete: (citekey: string) => void;
  queueBibReview: (citekey: string) => void;
  queuePaperReview: (citekey: string) => void;
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
  registry: Registry;
  tabs: PanelTabsState;
  libraryById: Map<string, Library>;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onActivate: (id: string, panel: PanelKey) => void;
  onClose: (id: string, panel: PanelKey) => void;
  onRename: (id: string, label: string) => void;
  onCreate: (panel: PanelKey) => string;
  onOpenRecent: (id: string, panel: PanelKey) => void;
  onMoveTab: (libId: string, toPanel: PanelKey, toIndex: number) => void;
  onAddEntryToLibrary: (libId: string, entryKey: string) => void;
  entryActions: EntryActions;
  /** FSA handle for the library root. Used by the request-state dot hook
   *  to scan queue/ and notifications/inbox.json on a 6s poll. */
  handle: FileSystemDirectoryHandle;
  /** Forget the current library folder and prompt for a new one. Surfaced
   *  in the panel-level "⋮" menu (left panel only). Right panel passes
   *  undefined and the menu button is omitted. */
  onChangeFolder?: () => void;
}

export default function TabbedLibraryPanel({
  panel,
  registry,
  tabs,
  libraryById,
  entries,
  bibByKey,
  selectedKey,
  onSelect,
  onActivate,
  onClose,
  onRename,
  onCreate,
  onOpenRecent,
  onMoveTab,
  onAddEntryToLibrary,
  entryActions,
  handle,
  onChangeFolder,
}: Props) {
  const { toneFor: dotToneFor, markViewed } = useRowDotState(handle);
  const project = useProjectLibrary();

  const tabDefs: TabDef[] = useMemo(
    () =>
      tabs.openIds
        .map((id) => libraryById.get(id))
        .filter((l): l is Library => Boolean(l))
        .map((l) => ({
          id: l.id,
          label: l.label,
          closable: !isBuiltin(l.id),
          renamable: !isBuiltin(l.id),
          menu:
            l.id === CENTRAL_LIBRARY_ID && onChangeFolder
              ? ([{ label: "Change folder…", onClick: onChangeFolder }] satisfies PanelMenuItem[])
              : undefined,
        })),
    [tabs.openIds, libraryById, onChangeFolder],
  );

  const recentLibraries: RecentLibrary[] = useMemo(() => {
    const openSet = new Set(tabs.openIds);
    return registry.libraries
      .filter((l) => !isBuiltin(l.id) && !openSet.has(l.id))
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
      };
    }
    if (isProject(activeLibrary.id)) {
      // Membership comes from the doc's `.bib`; removing an entry here
      // would mean editing the .bib, which belongs in Virgil's Bibliography
      // panel. Keep the AI-review actions; route delete to a hint.
      return {
        deleteLabel: "Edit in Bibliography panel…",
        onDelete: () => {
          window.alert(
            "To remove an entry from this project, edit references.bib via Virgil's Bibliography panel.",
          );
        },
        onBibReview: entryActions.queueBibReview,
        onTextReview: entryActions.queuePaperReview,
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
    };
  }, [activeLibrary, entryActions]);

  const visibleEntries = useMemo<CatalogEntry[]>(() => {
    if (!activeLibrary) return [];
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

  // Panel-wide entry drop zone: dropping a row anywhere in the library
  // panel adds it to the active library. Per-tab targeting is still handled
  // by PanelTabStrip (deeper in the DOM, fires first); when that handler
  // runs e.preventDefault() we defer via the defaultPrevented check so the
  // entry isn't added twice. Skipped when the active library is Central
  // (which already contains everything).
  const [panelDragOver, setPanelDragOver] = useState(false);
  // Drag-to-add only works on user-spawned libraries. Built-ins (Central,
  // Project) compute their membership and ignore drops.
  const dropTargetId = activeLibrary && !isBuiltin(activeLibrary.id) ? activeLibrary.id : null;

  const dataTransferHasEntry = (e: DragEvent<HTMLDivElement>): boolean => {
    const types = e.dataTransfer.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === ENTRY_DT_TYPE) return true;
    }
    return false;
  };

  const handlePanelDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return; // strip handled a per-tab drop
    if (!dropTargetId) return;
    if (!dataTransferHasEntry(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!panelDragOver) setPanelDragOver(true);
  };

  const handlePanelDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setPanelDragOver(false);
  };

  const handlePanelDrop = (e: DragEvent<HTMLDivElement>) => {
    setPanelDragOver(false);
    if (e.defaultPrevented) return; // strip handled a per-tab drop
    if (!dropTargetId) return;
    const entryKey = e.dataTransfer.getData(ENTRY_DT_TYPE);
    if (!entryKey) return;
    e.preventDefault();
    onAddEntryToLibrary(dropTargetId, entryKey);
  };

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
        onDropEntry={onAddEntryToLibrary}
        panelRef={panelRef}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--surface)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--topbar-border)",
          borderRadius: 10,
        }}
      >
        {activeLibrary && isProject(activeLibrary.id) ? (
          <ProjectHeader
            hasDoc={project.hasDoc}
            docLabel={project.docLabel}
            citedOnly={project.citedOnly}
            setCitedOnly={project.setCitedOnly}
            bibCount={project.bibKeys.size}
            citedCount={project.citedKeys.size}
          />
        ) : null}
        {activeLibrary && isProject(activeLibrary.id) && !project.hasDoc ? (
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
              selectedKey={selectedKey}
              onSelect={onSelect}
              rowActions={rowActions}
              dropHighlight={panelDragOver}
              dotToneFor={dotToneFor}
              onRowViewed={(citekey: string | null | undefined) => {
                if (citekey) markViewed(citekey);
              }}
            />
          </div>
        )}
      </div>
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
