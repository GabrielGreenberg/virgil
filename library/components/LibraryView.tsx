"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "@library/hooks/useCatalog";
import { useMasterBib } from "@library/hooks/useMasterBib";
import { useDropPdf } from "@library/hooks/useDropPdf";
import { useNotificationStream } from "@library/hooks/useNotificationStream";
import { useUnsortedPdfs } from "@library/hooks/useUnsortedPdfs";
import { useLibraryTabs } from "@library/hooks/useLibraryTabs";
import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import type { SyncResult } from "@library/lib/skill-sync";
import type { NotificationItem } from "@library/lib/queue";
import RightDetail from "./RightDetail";
import DropZone from "./DropZone";

import Toaster from "./Toaster";
import TabbedLibraryPanel, { type EntryActions } from "./TabbedLibraryPanel";
import { TAB_DT_TYPE } from "@library/lib/dnd-types";
import { queueBibReview, queueDelete, queuePaperReview } from "@library/lib/bib-edit";

interface Props {
  handle: FileSystemDirectoryHandle;
  onReset: () => void;
  lastSync: SyncResult | null;
}

const LEFT_WIDTH_KEY = "virgil-library-left-width";
const LEFT_MIN = 220;
const LEFT_DEFAULT = 360;

export default function LibraryView({ handle, onReset, lastSync }: Props) {
  const { catalog, reload } = useCatalog(handle);
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);
  const { files: unsortedFiles, reload: reloadUnsorted } = useUnsortedPdfs(handle);
  const dropPdf = useDropPdf(handle);
  const notifications = useNotificationStream(handle);

  // Resizable left panel — width persisted in localStorage so it
  // survives reloads.
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_DEFAULT);
  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(LEFT_WIDTH_KEY) ?? "", 10);
      if (!Number.isNaN(saved)) {
        const maxW = window.innerWidth - 200;
        setLeftWidth(Math.max(LEFT_MIN, Math.min(maxW, saved)));
      }
    } catch {
      // localStorage unavailable — fall back to default.
    }
  }, []);
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(
          LEFT_MIN,
          Math.min(window.innerWidth - 200, startWidth + (ev.clientX - startX)),
        );
        setLeftWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Persist the final value.
        try {
          // Use the latest setter callback to grab the current width.
          setLeftWidth((w) => {
            try {
              localStorage.setItem(LEFT_WIDTH_KEY, String(Math.round(w)));
            } catch {
              // ignore
            }
            return w;
          });
        } catch {
          // ignore
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth],
  );

  // Surface the most recent skill-bundle sync as a transient toast so the
  // user knows when CLAUDE.md / .claude/commands / scripts updated.
  const [syncToasts, setSyncToasts] = useState<NotificationItem[]>([]);
  useEffect(() => {
    if (!lastSync || !lastSync.synced) return;
    setSyncToasts([
      {
        kind: "indexed",
        at: new Date().toISOString(),
        summary: `Skill bundle synced to v${lastSync.version} (${lastSync.filesWritten} files)`,
      },
    ]);
  }, [lastSync]);
  const allToasts = useMemo(
    () => [...syncToasts, ...notifications],
    [syncToasts, notifications],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const libraryTabs = useLibraryTabs();

  // Listen for `virgil-open-library` events dispatched by Bibliography
  // chips. The outer bridge (src/components/editor-layout/event-bridges/
  // library.ts) handles the pane switch; we only need to scroll the
  // matching row into view by setting it as the selected key.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ citekey?: string; itemId?: string }>).detail;
      const key = detail?.citekey ?? detail?.itemId;
      if (key) setSelectedKey(key);
    };
    window.addEventListener("virgil-open-library", onOpen);
    return () => window.removeEventListener("virgil-open-library", onOpen);
  }, []);
  // Per-panel mode is derived: any tabs open on that side → tabs mode;
  // empty → fall back to the doc viewer. Either panel can end up empty
  // (built-ins are draggable like any other library), so both sides need
  // the same swap.
  const leftPanelMode: "detail" | "tabs" =
    libraryTabs.leftTabs.openIds.length > 0 ? "tabs" : "detail";
  const rightPanelMode: "detail" | "tabs" =
    libraryTabs.rightTabs.openIds.length > 0 ? "tabs" : "detail";

  const [leftDetailDragOver, setLeftDetailDragOver] = useState(false);
  const [rightDetailDragOver, setRightDetailDragOver] = useState(false);
  const makeDetailDragOverHandler = (
    setOver: (v: boolean) => void,
  ) => (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer.types;
    let hasTab = false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === TAB_DT_TYPE) {
        hasTab = true;
        break;
      }
    }
    if (!hasTab) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(true);
  };
  const makeDetailDragLeaveHandler = (
    setOver: (v: boolean) => void,
  ) => (e: React.DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setOver(false);
  };
  const makeDetailDropHandler = (
    panel: "left" | "right",
    setOver: (v: boolean) => void,
  ) => (e: React.DragEvent<HTMLDivElement>) => {
    const libId = e.dataTransfer.getData(TAB_DT_TYPE);
    if (!libId) return;
    e.preventDefault();
    setOver(false);
    libraryTabs.moveTab(libId, panel, 0);
  };
  const handleLeftDetailDragOver = makeDetailDragOverHandler(setLeftDetailDragOver);
  const handleLeftDetailDragLeave = makeDetailDragLeaveHandler(setLeftDetailDragOver);
  const handleLeftDetailDrop = makeDetailDropHandler("left", setLeftDetailDragOver);
  const handleRightDetailDragOver = makeDetailDragOverHandler(setRightDetailDragOver);
  const handleRightDetailDragLeave = makeDetailDragLeaveHandler(setRightDetailDragOver);
  const handleRightDetailDrop = makeDetailDropHandler("right", setRightDetailDragOver);

  const bibByKey = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of bibEntries) m.set(e.key, e);
    return m;
  }, [bibEntries]);

  // Synthesize catalog rows from two extra sources so the list reflects
  // everything visible on disk, even before the skills run:
  //   1. master.bib keys without a catalog entry — freshly-typed bib lines
  //      become browsable immediately with all three pills gray.
  //   2. PDFs/DOCX sitting in pdfs/unsorted/ that the triage skill hasn't
  //      picked up yet — these show as raw filenames with citekey
  //      "(triaging)". They appear at the TOP of the merged list (newest
  //      mtime first, courtesy of useUnsortedPdfs) so freshly-dropped
  //      files are visible without scrolling.
  const mergedEntries = useMemo<CatalogEntry[]>(() => {
    const rows: CatalogEntry[] = catalog?.entries ?? [];
    const seenKeys = new Set(rows.map((e) => e.citekey).filter(Boolean) as string[]);
    const seenFilenames = new Set<string>();
    for (const e of rows) {
      if (e.originalFilename) seenFilenames.add(e.originalFilename);
      if (e.pdf.filename) seenFilenames.add(e.pdf.filename);
    }
    const unsortedSynthetic: CatalogEntry[] = [];
    for (const fn of unsortedFiles) {
      if (seenFilenames.has(fn)) continue;
      unsortedSynthetic.push({
        citekey: null,
        originalFilename: fn,
        addedAt: "",
        updatedAt: "",
        pdf: { present: true, filename: fn },
        indexed: { state: "none" },
        bib: { state: "none" },
      });
    }
    const bibOnlySynthetic: CatalogEntry[] = [];
    for (const b of bibEntries) {
      if (seenKeys.has(b.key)) continue;
      bibOnlySynthetic.push({
        citekey: b.key,
        title: b.fields.title,
        authors: b.fields.author ? [b.fields.author] : undefined,
        year: b.fields.year ? Number(b.fields.year) : undefined,
        doi: b.fields.doi,
        addedAt: "",
        updatedAt: "",
        pdf: { present: false },
        indexed: { state: "none" },
        bib: { state: "unverified" },
      });
    }
    return [...unsortedSynthetic, ...rows, ...bibOnlySynthetic];
  }, [catalog, bibEntries, unsortedFiles]);

  const selectedEntry = useMemo<CatalogEntry | null>(() => {
    if (!selectedKey) return null;
    if (selectedKey.startsWith("__triage__")) {
      return mergedEntries.find(
        (e) => `__triage__${e.originalFilename}` === selectedKey,
      ) ?? null;
    }
    return mergedEntries.find((e) => e.citekey === selectedKey) ?? null;
  }, [selectedKey, mergedEntries]);

  const onFiles = useCallback(
    async (files: File[]) => {
      await dropPdf(files);
      void reload();
      void reloadUnsorted();
    },
    [dropPdf, reload, reloadUnsorted],
  );

  // Primitive entry-action helpers. TabbedLibraryPanel composes these into
  // a context-aware RowActions based on whether the active library is
  // Central (true delete via queue intent) or custom (local removal).
  // Skill-driven actions follow the cowork pattern: write an intent file
  // and let the matching skill drain it.
  const entryActions = useMemo<EntryActions>(
    () => ({
      queueDelete: (citekey: string) => {
        void queueDelete(handle, citekey);
      },
      queueBibReview: (citekey: string) => {
        void queueBibReview(handle, citekey);
      },
      queuePaperReview: (citekey: string) => {
        void queuePaperReview(handle, citekey);
      },
      removeFromLibrary: libraryTabs.removeEntryFromLibrary,
    }),
    [handle, libraryTabs.removeEntryFromLibrary],
  );

  // Container-scoped drag tracking. Two responsibilities:
  //   1. Maintain `dragActive` so the lozenge in TopBar and the dashed
  //      DropZone outline can light up while a file is being dragged.
  //   2. Process the drop wherever it lands within the Library tab body,
  //      not just the DropZone — so dropping on the TopBar lozenge works.
  // Listeners are scoped to `containerRef` (not window) so file drops on
  // Virgil's other panes (Doc editor) don't accidentally trigger library
  // ingestion. dragenter/dragleave fire for every child on traversal, so
  // we count enters/leaves and only flip state when the counter crosses 0.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const hasFilesType = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      const arr = Array.from(types as ArrayLike<string>);
      return arr.includes("Files");
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFilesType(e)) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setDragActive(true);
    };
    const onLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragActive(false);
    };
    const onOver = (e: DragEvent) => {
      // Only intercept file drags. For internal tab drags
      // (application/x-virgil-library-tab) let React-level dragover
      // handlers manage preventDefault/dropEffect — otherwise forcing
      // dropEffect="copy" here clashes with effectAllowed="move" on
      // the tab DnD source and the browser rejects the drop.
      if (!hasFilesType(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);
      void onFiles(files);
    };
    node.addEventListener("dragenter", onEnter);
    node.addEventListener("dragleave", onLeave);
    node.addEventListener("dragover", onOver);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", onEnter);
      node.removeEventListener("dragleave", onLeave);
      node.removeEventListener("dragover", onOver);
      node.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        // `flex: 1, minHeight: 0` is more robust than `height: 100%` when
        // mounted inside Virgil's nested flex tree — height: 100% collapses
        // when an ancestor doesn't have an explicit height. Combined with
        // `width: 100%` so the column extends to the full pane width.
        flex: 1,
        minHeight: 0,
        width: "100%",
        background: "var(--background)",
      }}
    >
      <DropZone dragActive={dragActive}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${leftWidth}px 6px 1fr`,
            // Without an explicit row track, the implicit row sizes to
            // `auto` (content), which lets a tall paper push the grid
            // past its container — making the whole page scroll instead
            // of the right pane. `1fr` clamps the row to grid height.
            gridTemplateRows: "1fr",
            height: "100%",
            minHeight: 0,
            background: "var(--background)",
          }}
        >
          <div
            style={{
              overflow: "hidden",
              minHeight: 0,
              minWidth: 0,
              position: "relative",
              background: "var(--background)",
            }}
            onDragOver={
              leftPanelMode === "detail" ? handleLeftDetailDragOver : undefined
            }
            onDragLeave={
              leftPanelMode === "detail" ? handleLeftDetailDragLeave : undefined
            }
            onDrop={
              leftPanelMode === "detail" ? handleLeftDetailDrop : undefined
            }
          >
            {leftPanelMode === "tabs" ? (
              <TabbedLibraryPanel
                panel="left"
                registry={libraryTabs.registry}
                tabs={libraryTabs.leftTabs}
                libraryById={libraryTabs.libraryById}
                entries={mergedEntries}
                bibByKey={bibByKey}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onActivate={libraryTabs.activate}
                onClose={libraryTabs.close}
                onRename={libraryTabs.rename}
                onCreate={libraryTabs.create}
                onOpenRecent={libraryTabs.openRecent}
                onMoveTab={libraryTabs.moveTab}
                onAddEntryToLibrary={libraryTabs.addEntryToLibrary}
                entryActions={entryActions}
                handle={handle}
                onChangeFolder={onReset}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  padding: 6,
                  background: "var(--library-bg)",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    border: "1px solid var(--topbar-border)",
                    borderRadius: 10,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <RightDetail
                    handle={handle}
                    entry={selectedEntry}
                    bib={selectedEntry?.citekey ? bibByKey.get(selectedEntry.citekey) : undefined}
                    onBibChanged={reloadBib}
                  />
                </div>
              </div>
            )}
            {leftPanelMode === "detail" && leftDetailDragOver && (
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
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
            onPointerDown={startResize}
            style={{
              cursor: "col-resize",
              background: "var(--library-bg)",
              transition: "background 120ms",
              touchAction: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "var(--library-bg)";
            }}
          />
          <div
            style={{
              overflow: "hidden",
              minHeight: 0,
              minWidth: 0,
              position: "relative",
              background: "var(--background)",
            }}
            onDragOver={
              rightPanelMode === "detail" ? handleRightDetailDragOver : undefined
            }
            onDragLeave={
              rightPanelMode === "detail" ? handleRightDetailDragLeave : undefined
            }
            onDrop={
              rightPanelMode === "detail" ? handleRightDetailDrop : undefined
            }
          >
            {rightPanelMode === "tabs" ? (
              <TabbedLibraryPanel
                panel="right"
                registry={libraryTabs.registry}
                tabs={libraryTabs.rightTabs}
                libraryById={libraryTabs.libraryById}
                entries={mergedEntries}
                bibByKey={bibByKey}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onActivate={libraryTabs.activate}
                onClose={libraryTabs.close}
                onRename={libraryTabs.rename}
                onCreate={libraryTabs.create}
                onOpenRecent={libraryTabs.openRecent}
                onMoveTab={libraryTabs.moveTab}
                onAddEntryToLibrary={libraryTabs.addEntryToLibrary}
                entryActions={entryActions}
                handle={handle}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  padding: 6,
                  background: "var(--library-bg)",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    border: "1px solid var(--topbar-border)",
                    borderRadius: 10,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <RightDetail
                    handle={handle}
                    entry={selectedEntry}
                    bib={selectedEntry?.citekey ? bibByKey.get(selectedEntry.citekey) : undefined}
                    onBibChanged={reloadBib}
                  />
                </div>
              </div>
            )}
            {rightPanelMode === "detail" && rightDetailDragOver && (
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
        </div>
      </DropZone>
      <Toaster items={allToasts} />
    </div>
  );
}
