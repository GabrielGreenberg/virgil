"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCatalog } from "@library/hooks/useCatalog";
import { useMasterBib } from "@library/hooks/useMasterBib";
import { useDropPdf } from "@library/hooks/useDropPdf";
import { useNotificationStream } from "@library/hooks/useNotificationStream";
import { useUnsortedPdfs } from "@library/hooks/useUnsortedPdfs";
import { useLibraryTabs, type UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import { docIdFromProjectLibraryId, isProjectDocId } from "@library/lib/library-store";
import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import type { SyncResult } from "@library/lib/skill-sync";
import type { NotificationItem } from "@library/lib/queue";
import DropZone from "./DropZone";

import Toaster from "./Toaster";
import TabbedLibraryPanel, { type EntryActions } from "./TabbedLibraryPanel";
import LibrariesNavigator from "./LibrariesNavigator";
import { queueBibReview, queueDelete, queuePaperReview } from "@library/lib/bib-edit";

interface Props {
  handle: FileSystemDirectoryHandle;
  onReset: () => void;
  lastSync: SyncResult | null;
  /** Optional scope/seed for `useLibraryTabs`. The inline Library tab
   *  passes nothing (default unscoped keys); each library outer tab
   *  passes its own scope so its panel state is isolated. */
  tabsOptions?: UseLibraryTabsOptions;
  /** Render the leftmost "Libraries" navigator column. Defaults to true
   *  (inline Library tab); tear-out outer-tab callers pass false to keep
   *  the focused 2-column layout. */
  showNavigator?: boolean;
  /** Optional content rendered as a sibling pod underneath the
   *  LibrariesNavigator in the leftmost column. Used by `LibraryTabView`
   *  to inject a "My Papers" pod that depends on src/-side data
   *  (FsaDocMeta, openFile, etc.) the library subsystem can't reach. */
  belowNavigator?: ReactNode;
}

// Persisted column widths. The middle-column key is named "left" for
// back-compat with the pre-3-column persisted state; treat it as the
// "library file" column going forward (the column with library tabs +
// entry list).
const LEFT_WIDTH_KEY = "virgil-library-left-width";
const LEFT_MIN = 220;
const LEFT_DEFAULT = 360;

const NAV_WIDTH_KEY = "virgil-library-nav-width";
const NAV_MIN = 180;
const NAV_DEFAULT = 220;

// Height of the My Papers pod in the navigator column. The Libraries pod
// above takes the remaining space; both stay at least 100px tall so the
// drag bar can't smash either pod into invisibility.
const PAPERS_HEIGHT_KEY = "virgil-library-papers-height";
const PAPERS_MIN = 100;
const PAPERS_DEFAULT = 240;

export default function LibraryView({
  handle,
  onReset,
  lastSync,
  tabsOptions,
  showNavigator = true,
  belowNavigator,
}: Props) {
  const { catalog, reload } = useCatalog(handle);
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);
  const { files: unsortedFiles, reload: reloadUnsorted } = useUnsortedPdfs(handle);
  const dropPdf = useDropPdf(handle);
  const notifications = useNotificationStream(handle);

  // Resizable middle panel — width persisted in localStorage so it
  // survives reloads. (Key is named "left" for back-compat with the
  // pre-3-column layout; semantically this is the middle column now.)
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_DEFAULT);
  const [navWidth, setNavWidth] = useState<number>(NAV_DEFAULT);
  const [papersHeight, setPapersHeight] = useState<number>(PAPERS_DEFAULT);
  const navColumnRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem(LEFT_WIDTH_KEY) ?? "", 10);
      if (!Number.isNaN(saved)) {
        const maxW = window.innerWidth - 200;
        setLeftWidth(Math.max(LEFT_MIN, Math.min(maxW, saved)));
      }
      const navSaved = parseInt(
        localStorage.getItem(NAV_WIDTH_KEY) ?? "",
        10,
      );
      if (!Number.isNaN(navSaved)) {
        const maxW = window.innerWidth - 300;
        setNavWidth(Math.max(NAV_MIN, Math.min(maxW, navSaved)));
      }
      const papersSaved = parseInt(
        localStorage.getItem(PAPERS_HEIGHT_KEY) ?? "",
        10,
      );
      if (!Number.isNaN(papersSaved)) {
        setPapersHeight(Math.max(PAPERS_MIN, papersSaved));
      }
    } catch {
      // localStorage unavailable — fall back to default.
    }
  }, []);
  const makeResizeHandler = useCallback(
    (
      currentWidth: number,
      setWidth: (next: number | ((w: number) => number)) => void,
      minWidth: number,
      maxOffset: number,
      storageKey: string,
    ) =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = currentWidth;
        const onMove = (ev: PointerEvent) => {
          const next = Math.max(
            minWidth,
            Math.min(
              window.innerWidth - maxOffset,
              startWidth + (ev.clientX - startX),
            ),
          );
          setWidth(next);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          try {
            setWidth((w) => {
              try {
                localStorage.setItem(storageKey, String(Math.round(w)));
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
    [],
  );
  const startResize = useMemo(
    () => makeResizeHandler(leftWidth, setLeftWidth, LEFT_MIN, 200, LEFT_WIDTH_KEY),
    [leftWidth, makeResizeHandler],
  );
  // Vertical resizer between Libraries (top) and My Papers (bottom).
  // Dragging up grows the My Papers pod; dragging down shrinks it.
  // Both pods clamp to at least PAPERS_MIN so neither disappears.
  const startPapersResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = papersHeight;
      const onMove = (ev: PointerEvent) => {
        const colH = navColumnRef.current?.getBoundingClientRect().height ?? 0;
        const maxH = Math.max(PAPERS_MIN, colH - PAPERS_MIN - 6);
        const next = Math.max(
          PAPERS_MIN,
          Math.min(maxH, startHeight - (ev.clientY - startY)),
        );
        setPapersHeight(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          setPapersHeight((h) => {
            try {
              localStorage.setItem(PAPERS_HEIGHT_KEY, String(Math.round(h)));
            } catch {
              // ignore
            }
            return h;
          });
        } catch {
          // ignore
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [papersHeight],
  );
  const startNavResize = useMemo(
    () => makeResizeHandler(navWidth, setNavWidth, NAV_MIN, 300, NAV_WIDTH_KEY),
    [navWidth, makeResizeHandler],
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

  // Selection drives row-highlighting only — opening a paper now spawns
  // a paper-kind library file in the opposite panel rather than rendering
  // into a dedicated detail pane.
  //
  // Multi-select model:
  //   - `selectedKeys` is the full set of highlighted rows.
  //   - `anchorKey` is the row that anchors a future shift-click range.
  //     It's set on plain click and cmd/ctrl-click; left untouched on
  //     shift-click so successive shift-clicks pivot around the same
  //     anchor.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const libraryTabs = useLibraryTabs(tabsOptions);

  // Listen for `virgil-open-library` events dispatched by Bibliography
  // chips. The outer bridge (src/components/editor-layout/event-bridges/
  // library.ts) handles the pane switch; we open the paper file from the
  // left panel so it lands as a tab on the right.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ citekey?: string; itemId?: string }>).detail;
      const key = detail?.citekey ?? detail?.itemId;
      if (!key) return;
      setSelectedKeys(new Set([key]));
      setAnchorKey(key);
      libraryTabs.openPaper(key, "left");
    };
    window.addEventListener("virgil-open-library", onOpen);
    return () => window.removeEventListener("virgil-open-library", onOpen);
  }, [libraryTabs.openPaper]);

  // Tearout: when a paper inner tab is dropped on the Virgil bar, the
  // outer-bar drop handler dispatches this event; we close the donor
  // inner tab so the paper exists in only one place at a time.
  useEffect(() => {
    const onTearout = (e: Event) => {
      const detail = (e as CustomEvent<{ citekey?: string }>).detail;
      const key = detail?.citekey;
      if (!key) return;
      libraryTabs.closePaperByCitekey(key);
    };
    window.addEventListener("virgil-library-close-paper-tab", onTearout);
    return () =>
      window.removeEventListener("virgil-library-close-paper-tab", onTearout);
  }, [libraryTabs.closePaperByCitekey]);

  const bibByKey = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of bibEntries) m.set(e.key, e);
    return m;
  }, [bibEntries]);

  // Wrap libraryTabs.addEntryToLibrary so drops onto a per-doc Project
  // library tab dispatch a window event with the resolved bib entries —
  // `LibraryTabView` listens and appends to the doc's references.bib in
  // a single read-modify-write. Custom-library drops fall through to
  // the registry mutation (functional setState — safe to call in a loop).
  // Central / paper / unknown libIds are no-ops.
  //
  // The batched signature (string[] instead of string) is critical: a
  // multi-row drop must not fan out into N parallel async writes, since
  // each would read the same starting bib and overwrite the others.
  const handleAddEntriesToLibrary = useCallback(
    (libId: string, entryKeys: readonly string[]) => {
      if (entryKeys.length === 0) return;
      if (isProjectDocId(libId)) {
        const docId = docIdFromProjectLibraryId(libId);
        if (!docId) return;
        const bibEntries = entryKeys
          .map((k) => bibByKey.get(k))
          .filter((e): e is NonNullable<typeof e> => Boolean(e));
        if (bibEntries.length === 0) return;
        window.dispatchEvent(
          new CustomEvent("virgil-library-add-to-project-bib", {
            detail: { docId, bibEntries },
          }),
        );
        return;
      }
      for (const k of entryKeys) libraryTabs.addEntryToLibrary(libId, k);
    },
    [bibByKey, libraryTabs.addEntryToLibrary],
  );

  // Synthesize catalog rows from two extra sources so the list reflects
  // everything visible on disk, even before the skills run:
  //   1. master.bib keys without a catalog entry — freshly-typed bib lines
  //      become browsable immediately with all three pills gray.
  //   2. PDFs/DOCX sitting in unsorted/ that the triage skill hasn't
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
      // Custom-library memberships are tracked in registry.libraries;
      // project-library "memberships" are entries in the open doc's
      // references.bib. The library subsystem can't import `@/lib/storage`,
      // so project removals dispatch a window event picked up by
      // `LibraryTabView` (mirrors the add path in `handleAddEntryToLibrary`).
      removeFromLibrary: (libId: string, entryKey: string) => {
        if (isProjectDocId(libId)) {
          const docId = docIdFromProjectLibraryId(libId);
          if (docId) {
            window.dispatchEvent(
              new CustomEvent("virgil-library-remove-from-project-bib", {
                detail: { docId, citekey: entryKey },
              }),
            );
          }
          return;
        }
        libraryTabs.removeEntryFromLibrary(libId, entryKey);
      },
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

  const renderPanel = (panel: "left" | "right") => (
    <TabbedLibraryPanel
      panel={panel}
      registry={libraryTabs.registry}
      tabs={panel === "left" ? libraryTabs.leftTabs : libraryTabs.rightTabs}
      libraryById={libraryTabs.libraryById}
      entries={mergedEntries}
      bibByKey={bibByKey}
      selectedKeys={selectedKeys}
      anchorKey={anchorKey}
      onSelectKeys={(keys, anchor) => {
        setSelectedKeys(keys);
        setAnchorKey(anchor);
      }}
      onOpenPaper={libraryTabs.openPaper}
      onActivate={libraryTabs.activate}
      onClose={libraryTabs.close}
      onRename={libraryTabs.rename}
      onCreate={libraryTabs.create}
      onOpenRecent={libraryTabs.openRecent}
      onMoveTab={libraryTabs.moveTab}
      onAddEntriesToLibrary={handleAddEntriesToLibrary}
      onTogglePinLibrary={libraryTabs.togglePinLibrary}
      entryActions={entryActions}
      handle={handle}
      onBibChanged={reloadBib}
      onChangeFolder={panel === "left" ? onReset : undefined}
      // 2-column tear-out mode keeps the strip's "+" and recent dropdown.
      // 3-column inline mode hides them — the navigator owns those affordances.
      showAddTab={!showNavigator}
      showRecent={!showNavigator}
    />
  );

  // Set of library ids currently open in either panel. Used by the
  // navigator to render a small "open" dot next to non-active rows.
  const openLibraryIds = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const id of libraryTabs.leftTabs.openIds) s.add(id);
    for (const id of libraryTabs.rightTabs.openIds) s.add(id);
    return s;
  }, [libraryTabs.leftTabs.openIds, libraryTabs.rightTabs.openIds]);

  const navigator = showNavigator ? (
    <LibrariesNavigator
      registry={libraryTabs.registry}
      projectLibraries={libraryTabs.projectLibraries}
      activeMiddleId={libraryTabs.leftTabs.activeId}
      openLibraryIds={openLibraryIds}
      onOpenLibrary={(id) => libraryTabs.openLibrary(id, "left")}
      onCreateLibrary={() => libraryTabs.create("left")}
      onAddEntriesToLibrary={handleAddEntriesToLibrary}
      onRenameLibrary={libraryTabs.rename}
    />
  ) : null;

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
            // Three columns when the navigator is shown; two when it's
            // hidden (tear-out outer-tab mode). Each column is followed
            // by a 6px resizer except the last.
            gridTemplateColumns: showNavigator
              ? `${navWidth}px 6px ${leftWidth}px 6px 1fr`
              : `${leftWidth}px 6px 1fr`,
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
          {showNavigator && (
            <>
              <div
                ref={navColumnRef}
                style={{
                  overflow: "hidden",
                  minHeight: 0,
                  minWidth: 0,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  padding: 6,
                  background: "var(--library-bg)",
                }}
              >
                {/* Libraries pod takes the remaining space; My Papers
                    pod (when present) gets an explicit pixel height the
                    user can drag via the horizontal separator. */}
                <div
                  style={{
                    flex: 1,
                    minHeight: PAPERS_MIN,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {navigator}
                </div>
                {belowNavigator && (
                  <>
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize My Papers pod"
                      onPointerDown={startPapersResize}
                      style={{
                        height: 6,
                        cursor: "row-resize",
                        background: "var(--library-bg)",
                        transition: "background 120ms",
                        touchAction: "none",
                        flexShrink: 0,
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
                        flex: `0 0 ${papersHeight}px`,
                        minHeight: PAPERS_MIN,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      {belowNavigator}
                    </div>
                  </>
                )}
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Libraries navigator"
                onPointerDown={startNavResize}
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
            </>
          )}
          <div
            style={{
              overflow: "hidden",
              minHeight: 0,
              minWidth: 0,
              position: "relative",
              background: "var(--background)",
            }}
          >
            {renderPanel("left")}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize library file panel"
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
          >
            {renderPanel("right")}
          </div>
        </div>
      </DropZone>
      <Toaster items={allToasts} />
    </div>
  );
}
