"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useCatalogItems, refreshCatalogStore } from "@library/lib/catalog-store";
import { useMasterBib } from "@library/hooks/useMasterBib";
import { useDropPdf } from "@library/hooks/useDropPdf";
import { useNotificationStream } from "@library/hooks/useNotificationStream";
import { useSetupStatus } from "@library/hooks/useSetupStatus";
import { useUnsortedPdfs } from "@library/hooks/useUnsortedPdfs";
import { useUnsortedBibEntries } from "@library/hooks/useUnsortedBibEntries";
import { useRowDotState } from "@library/hooks/useRowDotState";
import { useLibraryTabs, type UseLibraryTabsOptions } from "@library/hooks/useLibraryTabs";
import { docIdFromProjectLibraryId, isProjectDocId } from "@library/lib/library-store";
import {
  usePanelSelection,
  useLayoutPrefs,
  useLibraryViewSessionFlush,
  usePdfDropIntroDismissed,
  migrateLegacyLayoutSizes,
} from "@library/lib/view-session-store";
import {
  fileExists,
  pickBibFile,
  SUBDIRS,
  writeTextFile,
} from "@library/lib/library-storage";
import { parseBibFile } from "@library/lib/bib-parser";
import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry } from "@library/lib/catalog";
import type { SyncResult } from "@library/lib/skill-sync";
import type { SkillSyncError } from "@library/hooks/useLibraryHandle";
import type { NotificationItem } from "@library/lib/queue";
import DropZone from "./DropZone";
import PdfDropIntroDialog from "./PdfDropIntroDialog";
import LibraryPaneFill from "./LibraryPaneFill";

import Toaster from "./Toaster";
import TabbedLibraryPanel, { type EntryActions } from "./TabbedLibraryPanel";
import LibrariesNavigator from "./LibrariesNavigator";
import { queueBibReview, queueDelete, queueImportBib, queuePaperReview } from "@library/lib/bib-edit";
import { refreshQueueState } from "@library/lib/queue-state-store";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import {
  LEFT_DEFAULT,
  LEFT_MIN,
  LIB_GRID_GUTTER,
  LIB_GRID_TEMPLATE_2COL,
  LIB_GRID_TEMPLATE_3COL,
  LIB_LIST_W_VAR,
  LIB_NAV_W_VAR,
  NAV_DEFAULT,
  NAV_MIN,
  PAPERS_DEFAULT,
  PAPERS_MIN,
  READER_MIN,
} from "./library-grid-template";

/**
 * The Library-tab desktop **field** surface (the chrome the folder panels sit on:
 * outer canvas, the grid behind the resize drag-gaps, and each panel-column wrapper).
 * This is library material — NOT the warm doc/paper manila (`--background`), which is
 * reserved for genuine paper/page content (the folder-tab page fill in
 * `TabbedLibraryPanel`, the reader `.tex` page, the framed PDF). The navigator column
 * and each panel's own padding band already resolve to `--library-bg`; this constant
 * names that field-vs-page invariant in one place so the field can't drift back to
 * manila. See task 052.
 */
const LIBRARY_FIELD_BG = "var(--library-bg)";

interface Props {
  handle: FileSystemDirectoryHandle;
  onReset: () => void;
  lastSync: SyncResult | null;
  /** Surfaced skill-bundle sync failure (loud banner). */
  syncError: SkillSyncError | null;
  /** Manually re-run the skill sync (Retry + the "Re-sync skills" menu). */
  onResync: () => void;
  onDismissSyncError: () => void;
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

// The three column/pod sizes live in the unified view-session-store's
// `layout` slice (`useLayoutPrefs` → layout.{middleWidth,navWidth,papersHeight})
// instead of three standalone `useState` + localStorage pairs. Same scope as
// before: the store's `layout` is a per-origin localStorage slice (the store
// has no window-id partitioning — its `scopes` keys distinguish inline vs
// tear-out panels, not browser windows), exactly like the standalone keys it
// replaces. The legacy standalone size keys (virgil-library-{left,nav,papers}-*)
// are owned by the store: `migrateLegacyLayoutSizes()` adopts them once on
// mount and deletes them.
//
// The min-floors / defaults / gutter width / grid-track templates live in
// `library-grid-template.ts` (the floors MUST match the store's
// NAV_WIDTH_MIN / MIDDLE_WIDTH_MIN / PAPERS_HEIGHT_MIN).

/** Stored-size read guard: a persisted value is used only when it's a finite
 *  number (a hand-edited blob can't inject `"300"`/null into a CSS var). */
function sizeOr(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export default function LibraryView({
  handle,
  onReset,
  lastSync,
  syncError,
  onResync,
  onDismissSyncError,
  tabsOptions,
  showNavigator = true,
  belowNavigator,
}: Props) {
  // Single shared catalog poll (catalog-store), not a second per-tab loop.
  // The store resolves the same library-root handle this tab was given and
  // refcounts one 6s poll across every catalog consumer (Bibliography panel,
  // pickers, this tab) — see catalog-store.ts. refreshCatalogStore() forces an
  // immediate re-read after a local mutation (drag-drop).
  const { entries: catalogEntries } = useCatalogItems();
  const { entries: bibEntries, bibStateByKey, reload: reloadBib } = useMasterBib(handle);
  const { files: unsortedFiles, reload: reloadUnsorted } = useUnsortedPdfs(handle);
  const { byFile: unsortedBibByFile, reload: reloadUnsortedBib } =
    useUnsortedBibEntries(handle);
  const dropPdf = useDropPdf(handle);
  // First-time post-drop intro notice. Shown after a successful file import
  // until the user opts out via "Don't show again" (persisted, task 089).
  const { dismissed: pdfIntroDismissed, setDismissed: setPdfIntroDismissed } =
    usePdfDropIntroDismissed();
  const [dropIntro, setDropIntro] = useState<{ fileNames: string[] } | null>(
    null,
  );
  const notifications = useNotificationStream(handle);
  const setupStatus = useSetupStatus(handle);
  // Request-state dots: ONE shared 6 s queue/inbox poll for BOTH panels
  // (chip A3) — previously each TabbedLibraryPanel ran its own instance.
  const { toneFor: dotToneFor, markViewed } = useRowDotState(handle);

  // Resizable middle panel + nav column + papers pod — sizes persisted in the
  // unified view-session-store's `layout` slice so they survive reloads AND
  // the Library's many remounts. (The middle-column field is named
  // `middleWidth`; the older standalone localStorage key was "left" for the
  // pre-3-column layout.)
  const { layout, setLayout } = useLayoutPrefs();
  // The STORED sizes feed the grid's CSS vars as-is: the hard viewport
  // constraints live in the grid template itself (clamp()/minmax() — see
  // library-grid-template.ts), so an oversized width persisted on a wider
  // monitor is clamped BY LAYOUT, reactively, and re-expands when the window
  // grows again. This replaces the old render-time `window.innerWidth` clamps,
  // which were non-reactive and composed independently (the R8 class — their
  // sum could exceed the viewport and collapse the 1fr reader to 0).
  const leftWidth = sizeOr(layout.middleWidth, LEFT_DEFAULT);
  const navWidth = sizeOr(layout.navWidth, NAV_DEFAULT);
  const papersHeight = sizeOr(layout.papersHeight, PAPERS_DEFAULT);
  const navColumnRef = useRef<HTMLDivElement | null>(null);
  // The resizable grid node + the list (middle) panel column + the My Papers
  // pod node. The pane-resize engine writes live drag geometry STRAIGHT to
  // these nodes (CSS vars / flex-basis — never per-frame React state) and
  // commits to the store exactly once on release.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const listColumnRef = useRef<HTMLDivElement | null>(null);
  const papersPodRef = useRef<HTMLDivElement | null>(null);

  // One-shot migration of the legacy standalone size keys into the store, for
  // users whose `virgil-library-view-session` blob predates the layout-fold.
  // Idempotent via key-deletion inside the store (NOT a per-mount ref), so a
  // later reload never re-clobbers a size the user set through the store — see
  // `migrateLegacyLayoutSizes`. The adopted value is the freshest (the old
  // resize handler kept the standalone key live, never this blob).
  useEffect(() => {
    migrateLegacyLayoutSizes();
  }, []);

  // All three resizers run on the shared pane-resize engine
  // (src/lib/pane-resize): pointer capture on the handle, RAF-coalesced
  // imperative apply() (a CSS-var / flex-basis write — never per-frame React
  // state, so LeftList's memoized rows and both panels stay untouched for the
  // whole gesture), commit() to the store exactly once on release, and
  // begin/end edges on the app-wide pane-drag bus (which the tab-chrome
  // observers park on — task 090's contract, now bus-wide). The committed
  // value equals the last live value, so the post-release render reconciles
  // to the identical geometry (no jump).
  //
  // Pointer-UX clamp bound, snapshotted once per gesture in getValue() (the
  // engine's documented single read point on the start edge). It MIRRORS the
  // grid template's hard constraint so the divider tracks the pointer instead
  // of dead-zoning against the CSS clamp; the template stays the authority.
  // One shared ref is safe: the engine allows a single pane gesture app-wide,
  // and every gesture re-snapshots it at start.
  //
  // restore() (Escape cancel): these getValue()s return RENDERED track sizes
  // (offsetWidth/offsetHeight), which the grid template's clamp() can render
  // SMALLER than the stored value on a narrow window. The engine's default
  // cancel would pin that clamped px into the imperative var — and React
  // never rewrites it while the store is unchanged (style diffs against
  // previous props, not the DOM) — permanently forfeiting the template's
  // re-expand-on-window-grow guarantee (library-grid-template.ts). So cancel
  // re-syncs the DOM from the STORE value instead. The closures read the
  // pre-drag store values: no commit happens mid-gesture, so they can't be
  // stale.
  const dragMaxRef = useRef(Number.POSITIVE_INFINITY);

  const navResizeHandle = usePaneResizeHandle({
    id: "library-nav",
    axis: "x",
    getValue: () => {
      const gridW = gridRef.current?.offsetWidth ?? 0;
      // Mirror of the nav track's CSS max: leave the list + reader mins.
      dragMaxRef.current =
        gridW > 0
          ? gridW - (LEFT_MIN + READER_MIN + 2 * LIB_GRID_GUTTER)
          : Number.POSITIVE_INFINITY;
      return navColumnRef.current?.offsetWidth ?? navWidth;
    },
    clamp: (px) => Math.max(NAV_MIN, Math.min(dragMaxRef.current, px)),
    apply: (px) => {
      gridRef.current?.style.setProperty(LIB_NAV_W_VAR, `${px}px`);
    },
    commit: (px) => setLayout({ navWidth: Math.round(px) }),
    restore: () => {
      gridRef.current?.style.setProperty(LIB_NAV_W_VAR, `${navWidth}px`);
    },
  });

  const listResizeHandle = usePaneResizeHandle({
    id: "library-list",
    axis: "x",
    getValue: () => {
      const gridW = gridRef.current?.offsetWidth ?? 0;
      // Mirror of the list track's CSS max: leave the RESOLVED nav track
      // (fixed for the duration of this gesture) + the reader min.
      const navSpan = showNavigator
        ? (navColumnRef.current?.offsetWidth ?? 0) + LIB_GRID_GUTTER
        : 0;
      dragMaxRef.current =
        gridW > 0
          ? gridW - navSpan - (READER_MIN + LIB_GRID_GUTTER)
          : Number.POSITIVE_INFINITY;
      return listColumnRef.current?.offsetWidth ?? leftWidth;
    },
    clamp: (px) => Math.max(LEFT_MIN, Math.min(dragMaxRef.current, px)),
    apply: (px) => {
      gridRef.current?.style.setProperty(LIB_LIST_W_VAR, `${px}px`);
    },
    commit: (px) => setLayout({ middleWidth: Math.round(px) }),
    restore: () => {
      gridRef.current?.style.setProperty(LIB_LIST_W_VAR, `${leftWidth}px`);
    },
  });

  // Vertical resizer between Libraries (top) and My Papers (bottom).
  // Dragging up grows the My Papers pod; dragging down shrinks it. Both pods
  // clamp to at least PAPERS_MIN so neither disappears.
  const papersResizeHandle = usePaneResizeHandle({
    id: "library-papers",
    axis: "y",
    // The pod sits BELOW its separator: dragging up (toward the axis origin)
    // grows it.
    direction: -1,
    getValue: () => {
      const colH = navColumnRef.current?.offsetHeight ?? 0;
      dragMaxRef.current =
        colH > 0
          ? Math.max(PAPERS_MIN, colH - PAPERS_MIN - LIB_GRID_GUTTER)
          : Number.POSITIVE_INFINITY;
      return papersPodRef.current?.offsetHeight ?? papersHeight;
    },
    clamp: (px) => Math.max(PAPERS_MIN, Math.min(dragMaxRef.current, px)),
    apply: (px) => {
      const pod = papersPodRef.current;
      if (pod) pod.style.flexBasis = `${px}px`;
    },
    commit: (px) => setLayout({ papersHeight: Math.round(px) }),
    restore: () => {
      const pod = papersPodRef.current;
      if (pod) pod.style.flexBasis = `${papersHeight}px`;
    },
  });

  // Surface the most recent skill-bundle sync as a transient toast so the
  // user knows when CLAUDE.md / .claude/commands / scripts updated.
  const [syncToasts, setSyncToasts] = useState<NotificationItem[]>([]);
  useEffect(() => {
    // Only announce when a sync actually WROTE files — a version-match
    // no-op shouldn't nag the user to restart their cowork session.
    if (!lastSync || !lastSync.synced || lastSync.filesWritten <= 0) return;
    setSyncToasts([
      {
        kind: "indexed",
        at: new Date().toISOString(),
        summary: `Skills updated to v${lastSync.version} — restart your Claude Code cowork session to pick up the new commands.`,
      },
    ]);
  }, [lastSync]);
  const allToasts = useMemo(
    () => [...syncToasts, ...setupStatus.notice, ...notifications],
    [syncToasts, setupStatus.notice, notifications],
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
  //
  // Persistence: selection now lives in the unified view-session store
  // (per-PANEL, per-scope) so it survives a reload AND the Library's many
  // remounts. The store is a module singleton, not React state.
  const scope = tabsOptions?.scope ?? "";
  const leftSelection = usePanelSelection(scope, "left");
  const rightSelection = usePanelSelection(scope, "right");
  // Mount the pagehide/visibilitychange flush once per Library instance
  // (idempotent — safe for the inline + tear-out instances to both mount).
  useLibraryViewSessionFlush();
  // Pass the FSA handle so the disk-libraries hook (consumed inside
  // useLibraryTabs) can read/write `.virgil/libraries/<slug>.json`.
  // Custom-library state is durable on disk, not localStorage.
  const libraryTabs = useLibraryTabs({ ...tabsOptions, handle });

  // Listen for `virgil-open-library` events dispatched by Bibliography
  // chips. The outer bridge (src/components/editor-layout/event-bridges/
  // library.ts) handles the pane switch; we open the paper file from the
  // left panel so it lands as a tab on the right.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ citekey?: string; itemId?: string; target?: string }>).detail;
      // `target: "tab"` opens the entry as its own outer Virgil-bar paper tab
      // (handled by the outer bridge) — don't also select + open it as an
      // inner tab inside the (possibly background) Library view.
      if (detail?.target === "tab") return;
      const key = detail?.citekey ?? detail?.itemId;
      if (!key) return;
      // The source row lives in the left panel's list (openPaper lands the
      // paper tab on the right), so highlight the left panel's selection.
      leftSelection.setSelection(new Set([key]), key);
      libraryTabs.openPaper(key, "left");
    };
    window.addEventListener("virgil-open-library", onOpen);
    return () => window.removeEventListener("virgil-open-library", onOpen);
  }, [libraryTabs.openPaper, leftSelection.setSelection]);

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

  // Synthesize catalog rows from three extra sources so the list reflects
  // everything visible on disk, even before the skills run:
  //   1. master.bib keys without a catalog entry — freshly-typed bib lines
  //      become browsable immediately with all three pills gray.
  //   2. PDFs/DOCX sitting in unsorted/ that the triage skill hasn't
  //      picked up yet — these show as raw filenames with citekey
  //      "(triaging)". They appear at the TOP of the merged list (newest
  //      mtime first, courtesy of useUnsortedPdfs) so freshly-dropped
  //      files are visible without scrolling.
  //   3. Citation entries inside `.bib` files sitting in unsorted/ — the
  //      product of "+ Add from .bib" imports. These render as bib-only
  //      rows with the citekey from the source file. After the triage
  //      skill merges the entries into master.bib and deletes the source,
  //      branch (1) takes over — citekey unchanged, library membership
  //      unchanged, no UI flicker.
  const mergedEntries = useMemo<CatalogEntry[]>(() => {
    const rows: CatalogEntry[] = catalogEntries;
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
        // F#4: the authoritative auth state for a fileless reference lives in
        // the bib-index (projected from master.bib's "% bib.state" comment).
        // Default "none" (honest "not yet authenticated") rather than the old
        // hardcoded "unverified" that mislabelled the whole reference universe.
        bib: { state: bibStateByKey.get(b.key) ?? "none" },
      });
      seenKeys.add(b.key);
    }
    const unsortedBibSynthetic: CatalogEntry[] = [];
    for (const entries of unsortedBibByFile.values()) {
      for (const b of entries) {
        if (!b.key || seenKeys.has(b.key)) continue;
        const authorField = b.fields.author;
        unsortedBibSynthetic.push({
          citekey: b.key,
          title: b.fields.title,
          authors: authorField
            ? authorField.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean)
            : undefined,
          year: b.fields.year ? Number(b.fields.year) : undefined,
          doi: b.fields.doi,
          addedAt: "",
          updatedAt: "",
          pdf: { present: false },
          indexed: { state: "none" },
          // Freshly-imported .bib entries (not in master.bib yet) carry no
          // authoritative state — honest "none" until a skill authenticates.
          bib: { state: bibStateByKey.get(b.key) ?? "none" },
        });
        seenKeys.add(b.key);
      }
    }
    return [
      ...unsortedSynthetic,
      ...rows,
      ...bibOnlySynthetic,
      ...unsortedBibSynthetic,
    ];
  }, [catalogEntries, bibEntries, bibStateByKey, unsortedFiles, unsortedBibByFile]);

  // Row keys that actually exist in the merged catalog. A row's selection
  // key is its citekey, falling back to its original filename for
  // un-triaged files (mirrors LeftListRow's key derivation).
  const liveRowKeys = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const e of mergedEntries) {
      const k = e.citekey ?? e.originalFilename;
      if (k) s.add(k);
    }
    return s;
  }, [mergedEntries]);

  // One-shot stale-key prune on restore. A restored selection may carry
  // keys for rows that were deleted/reindexed away while the session was
  // persisted. Wait for the FIRST non-empty merged catalog, then drop any
  // selected key absent from the live row set — once per panel. Gated on
  // non-empty so we never prune before the catalog has loaded (restore-
  // race tolerance: keys for rows that haven't resolved yet are kept).
  const selectionPrunedRef = useRef(false);
  useEffect(() => {
    if (selectionPrunedRef.current) return;
    if (liveRowKeys.size === 0) return; // catalog not loaded yet — keep all
    selectionPrunedRef.current = true;
    for (const sel of [leftSelection, rightSelection] as const) {
      const kept = [...sel.selectedKeys].filter((k) => liveRowKeys.has(k));
      if (kept.length !== sel.selectedKeys.size) {
        const anchor =
          sel.anchorKey && liveRowKeys.has(sel.anchorKey) ? sel.anchorKey : null;
        sel.setSelection(new Set(kept), anchor);
      }
    }
    // Intentionally one-shot: only `liveRowKeys` drives re-evaluation, and
    // the ref short-circuits after the first non-empty pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRowKeys]);

  const onFiles = useCallback(
    async (files: File[]) => {
      const results = await dropPdf(files);
      void refreshCatalogStore();
      void reloadUnsorted();
      // Surface the first-time intro notice only when at least one source
      // actually imported (dropPdf filters non-source files + reports per-file
      // ok/error), and only while the user hasn't opted out for good.
      const imported = results.filter((r) => r.ok).map((r) => r.name);
      if (imported.length > 0 && !pdfIntroDismissed) {
        setDropIntro({ fileNames: imported });
      }
    },
    [dropPdf, reloadUnsorted, pdfIntroDismissed],
  );

  // Primitive entry-action helpers. TabbedLibraryPanel composes these into
  // a context-aware RowActions based on whether the active library is
  // Central (true delete via queue intent) or custom (local removal).
  // Skill-driven actions follow the cowork pattern: write an intent file
  // and let the matching skill drain it. Each write then pushes through
  // `refreshQueueState()` — the queue's one notification channel — so the row
  // dot and any OPEN reader header for that paper see the request immediately
  // instead of waiting out a 6 s poll (or, for a kept-alive header, forever).
  const entryActions = useMemo<EntryActions>(
    () => ({
      queueDelete: (citekey: string) => {
        void queueDelete(handle, citekey).then(() => refreshQueueState());
      },
      queueBibReview: (citekey: string) => {
        void queueBibReview(handle, citekey).then(() => refreshQueueState());
      },
      queuePaperReview: (citekey: string) => {
        void queuePaperReview(handle, citekey).then(() => refreshQueueState());
      },
      queueImportBib: (citekey: string) => {
        void queueImportBib(handle, citekey).then(() => refreshQueueState());
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

  // "+ Add from .bib" — open the system file picker, parse the chosen
  // .bib, write it into unsorted/ (so a triage skill can later merge its
  // entries into master.bib), and create a new custom library populated
  // with the parsed citekeys. Until the skill drains the file, the
  // synthesis branch in `mergedEntries` (above) renders bib-only rows
  // for those citekeys; afterward the same citekeys resolve through the
  // master.bib path and the library transitions seamlessly.
  // Shared first half of both .bib import paths (F#5): open the system
  // file picker, parse the chosen .bib, and write it into unsorted/ under a
  // unique filename so a triage skill can later fold its entries into
  // master.bib. Returns the parsed citekeys + the on-disk filename + the
  // bare basename, or null when the user cancels / nothing usable is found.
  const stagePickedBib = useCallback(async (): Promise<{
    entryKeys: string[];
    onDiskName: string;
    base: string;
  } | null> => {
    const picked = await pickBibFile();
    if (!picked) return null; // user cancelled or environment lacks the API

    let parsed: BibEntry[] = [];
    try {
      parsed = parseBibFile(picked.text);
    } catch (err) {
      console.warn("[library] failed to parse picked .bib", err);
    }
    if (parsed.length === 0) {
      console.warn(
        `[library] no entries found in ${picked.filename} — skipping import`,
      );
      return null;
    }

    // Pick a unique on-disk filename in unsorted/ so re-imports of the
    // same source file don't clobber each other. `foo.bib` → `foo-2.bib`.
    const dotIdx = picked.filename.lastIndexOf(".");
    const base = dotIdx > 0 ? picked.filename.slice(0, dotIdx) : picked.filename;
    const ext = dotIdx > 0 ? picked.filename.slice(dotIdx) : ".bib";
    let attempt = 1;
    let onDiskName = picked.filename;
    while (await fileExists(handle, `${SUBDIRS.unsorted}/${onDiskName}`)) {
      attempt += 1;
      onDiskName = `${base}-${attempt}${ext}`;
      if (attempt > 999) break; // pathological safety valve
    }
    try {
      await writeTextFile(handle, `${SUBDIRS.unsorted}/${onDiskName}`, picked.text);
    } catch (err) {
      console.error("[library] failed to write picked .bib to unsorted/", err);
      return null;
    }

    const entryKeys = parsed.map((e) => e.key).filter(Boolean);
    return { entryKeys, onDiskName, base };
  }, [handle]);

  // "New library from .bib" — stage the picked file, then spin up a NEW
  // custom library populated with the parsed citekeys.
  const handleCreateLibraryFromBib = useCallback(async () => {
    const staged = await stagePickedBib();
    if (!staged) return;

    // De-duplicate the navigator label against existing custom libraries.
    const existingLabels = new Set(
      libraryTabs.registry.libraries
        .filter((l) => l.kind === "custom")
        .map((l) => l.label),
    );
    let label = staged.base;
    let labelAttempt = 1;
    while (existingLabels.has(label)) {
      labelAttempt += 1;
      label = `${staged.base} (${labelAttempt})`;
      if (labelAttempt > 999) break;
    }

    libraryTabs.createFromBib({
      label,
      sourceBibFile: staged.onDiskName,
      entryKeys: staged.entryKeys,
      panel: "left",
    });
    // Immediate poll so the synthesized rows show the moment the new tab
    // is clicked, rather than waiting for the 6 s tick.
    void reloadUnsortedBib();
  }, [stagePickedBib, libraryTabs, reloadUnsortedBib]);

  // "Add from .bib…" on an EXISTING custom library (F#5) — stage the picked
  // file, then add its parsed citekeys to that library's manifest
  // (membership). Same staging flow; only the destination differs.
  const handleAddBibToLibrary = useCallback(
    async (libId: string) => {
      const staged = await stagePickedBib();
      if (!staged) return;
      if (staged.entryKeys.length > 0) {
        libraryTabs.addEntriesToLibrary(libId, staged.entryKeys);
      }
      void reloadUnsortedBib();
    },
    [stagePickedBib, libraryTabs, reloadUnsortedBib],
  );

  // "Delete library" on a custom library (F#5) — lightweight confirm, then
  // drop the manifest. Papers + master.bib entries are untouched (a manifest
  // is only a membership list).
  const handleDeleteLibrary = useCallback(
    (libId: string) => {
      const lib = libraryTabs.registry.libraries.find((l) => l.id === libId);
      if (!lib || lib.kind !== "custom") return;
      const ok = window.confirm(
        `Delete the library "${lib.label}"?\n\nThis removes the collection only — its papers and bibliography entries stay in your library.`,
      );
      if (!ok) return;
      libraryTabs.remove(libId);
    },
    [libraryTabs],
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

  const renderPanel = (panel: "left" | "right") => {
    const sel = panel === "left" ? leftSelection : rightSelection;
    return (
    <TabbedLibraryPanel
      panel={panel}
      scope={scope}
      registry={libraryTabs.registry}
      tabs={panel === "left" ? libraryTabs.leftTabs : libraryTabs.rightTabs}
      libraryById={libraryTabs.libraryById}
      entries={mergedEntries}
      bibByKey={bibByKey}
      bibStateByKey={bibStateByKey}
      selectedKeys={sel.selectedKeys}
      anchorKey={sel.anchorKey}
      // Pass the store setter directly — it's already referentially stable
      // (memoized in usePanelSelection), so the row memo chain isn't broken
      // by a fresh inline closure each render.
      onSelectKeys={sel.setSelection}
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
      dotToneFor={dotToneFor}
      markViewed={markViewed}
      onBibChanged={reloadBib}
      onChangeFolder={panel === "left" ? onReset : undefined}
      onResync={panel === "left" ? onResync : undefined}
      // 2-column tear-out mode keeps the strip's "+" and recent dropdown.
      // 3-column inline mode hides them — the navigator owns those affordances.
      showAddTab={!showNavigator}
      showRecent={!showNavigator}
      // Light the Central tab as the drop-ready target during an OS-file drag
      // (task 089). The container-level drop handler still ingests the file.
      fileDragActive={dragActive}
    />
    );
  };

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
      onCreateLibraryFromBib={handleCreateLibraryFromBib}
      onAddEntriesToLibrary={handleAddEntriesToLibrary}
      onRenameLibrary={libraryTabs.rename}
      onResync={onResync}
      onChangeFolder={onReset}
      onDeleteLibrary={handleDeleteLibrary}
      onAddBibToLibrary={handleAddBibToLibrary}
    />
  ) : null;

  return (
    // Pane-fill (flex:1 / minWidth:0 / minHeight:0 / width:100%) is now the
    // shared SSOT in LibraryPaneFill — the same box every pre-load state uses,
    // so the loaded view and its splash siblings fill the pane identically
    // (task 085; the original inline-fill comment moved onto the wrapper).
    <LibraryPaneFill ref={containerRef} style={{ background: LIBRARY_FIELD_BG }}>
      {/* Loud, dismissible skill-sync failure banner. A failed/stale skill
          sync must never again silently strand the library on old skills —
          so the bare console.error in useLibraryHandle now surfaces here
          with a Retry (which re-grants FSA permission on NotAllowedError). */}
      {syncError && (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            fontSize: 13,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            borderBottom:
              "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{syncError.message}</span>
          <button
            onClick={onResync}
            style={{
              flexShrink: 0,
              padding: "3px 10px",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--danger)",
              background: "var(--surface)",
              border: "1px solid currentColor",
            }}
          >
            {syncError.permission ? "Grant & retry" : "Retry"}
          </button>
          <button
            onClick={onDismissSyncError}
            aria-label="Dismiss skill-sync error"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              padding: 2,
              cursor: "pointer",
              color: "var(--danger)",
              background: "transparent",
              border: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
      <DropZone dragActive={dragActive}>
        <div
          ref={gridRef}
          style={
            {
              display: "grid",
              // The column sizes ride these CSS vars; the template wraps them
              // in the hard clamp()/minmax() constraints (see
              // library-grid-template.ts — the reader can never collapse to
              // 0). The pane-resize engine retargets the vars imperatively
              // per drag frame; the store commit re-renders to the identical
              // geometry on release.
              [LIB_NAV_W_VAR]: `${navWidth}px`,
              [LIB_LIST_W_VAR]: `${leftWidth}px`,
              // Three columns when the navigator is shown; two when it's
              // hidden (tear-out outer-tab mode). Each column is followed
              // by a 6px resizer except the last.
              gridTemplateColumns: showNavigator
                ? LIB_GRID_TEMPLATE_3COL
                : LIB_GRID_TEMPLATE_2COL,
              // Without an explicit row track, the implicit row sizes to
              // `auto` (content), which lets a tall paper push the grid
              // past its container — making the whole page scroll instead
              // of the right pane. `1fr` clamps the row to grid height.
              gridTemplateRows: "1fr",
              height: "100%",
              minHeight: 0,
              background: LIBRARY_FIELD_BG,
            } as CSSProperties
          }
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
                    {/* No role/aria-label: a gutter is pointer-only, and the
                        engine's props carry `aria-hidden` (task 189 — see
                        PaneResizeHandleProps + STYLE_GUIDE "Resize gutters"). */}
                    <div
                      className="drag-gap drag-gap-h band-grip"
                      {...papersResizeHandle}
                      style={{
                        ...papersResizeHandle.style,
                        height: LIB_GRID_GUTTER,
                        flexShrink: 0,
                      }}
                    />
                    <div
                      ref={papersPodRef}
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
                className="drag-gap drag-gap-v band-grip"
                {...navResizeHandle}
              />
            </>
          )}
          <div
            ref={listColumnRef}
            style={{
              overflow: "hidden",
              minHeight: 0,
              minWidth: 0,
              position: "relative",
              background: LIBRARY_FIELD_BG,
            }}
          >
            {renderPanel("left")}
          </div>
          <div
            className="drag-gap drag-gap-v band-grip"
            {...listResizeHandle}
          />
          <div
            style={{
              overflow: "hidden",
              minHeight: 0,
              minWidth: 0,
              position: "relative",
              background: LIBRARY_FIELD_BG,
            }}
          >
            {renderPanel("right")}
          </div>
        </div>
      </DropZone>
      <Toaster items={allToasts} />
      {dropIntro && (
        <PdfDropIntroDialog
          fileNames={dropIntro.fileNames}
          onClose={(dontShowAgain) => {
            if (dontShowAgain) setPdfIntroDismissed(true);
            setDropIntro(null);
          }}
        />
      )}
    </LibraryPaneFill>
  );
}
