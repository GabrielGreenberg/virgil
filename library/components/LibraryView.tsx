"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCatalog } from "@library/hooks/useCatalog";
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

import Toaster from "./Toaster";
import TabbedLibraryPanel, { type EntryActions } from "./TabbedLibraryPanel";
import LibrariesNavigator from "./LibrariesNavigator";
import { queueBibReview, queueDelete, queueImportBib, queuePaperReview } from "@library/lib/bib-edit";

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

// The three column/pod sizes now live in the unified view-session-store's
// `layout` slice (`useLayoutPrefs` → layout.{middleWidth,navWidth,papersHeight})
// instead of three standalone `useState` + localStorage pairs. The store was
// already DEAD-SEEDING those layout fields from the legacy keys below but
// nothing read them back — folding the readers onto the store closes that
// mismatch. Same scope as before: the store's `layout` is a per-origin
// localStorage slice (the store has no window-id partitioning — its `scopes`
// keys distinguish inline vs tear-out panels, not browser windows), exactly
// like the standalone keys it replaces. The legacy keys are kept ONLY as a
// one-shot migration source for users whose blob predates this change (the
// store's absent-blob seed already covers brand-new users).
//
// The legacy standalone size keys (virgil-library-{left,nav,papers}-*) are now
// owned by the store: `migrateLegacyLayoutSizes()` adopts them once on mount
// and deletes them. Only the min-floors + defaults live here, shared with the
// resize handlers and the load-time viewport clamp. (Mins MUST match the
// store's NAV_WIDTH_MIN / MIDDLE_WIDTH_MIN / PAPERS_HEIGHT_MIN.)
const LEFT_MIN = 220;
const LEFT_DEFAULT = 360;

const NAV_MIN = 180;
const NAV_DEFAULT = 220;

// Height of the My Papers pod in the navigator column. The Libraries pod
// above takes the remaining space; both stay at least 100px tall so the
// drag bar can't smash either pod into invisibility.
const PAPERS_MIN = 100;
const PAPERS_DEFAULT = 240;

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
  const { catalog, reload } = useCatalog(handle);
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);
  const { files: unsortedFiles, reload: reloadUnsorted } = useUnsortedPdfs(handle);
  const { byFile: unsortedBibByFile, reload: reloadUnsortedBib } =
    useUnsortedBibEntries(handle);
  const dropPdf = useDropPdf(handle);
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
  // Clamp the stored widths to the viewport on read so an oversized width
  // persisted on a wider monitor can't starve the content pane when reopened
  // on a narrower screen (mirrors the load-time clamp the pre-store code
  // applied). Only the RENDERED width is clamped — the stored value is left
  // intact so it re-expands when the window grows again.
  const viewportW =
    typeof window !== "undefined" ? window.innerWidth : Number.POSITIVE_INFINITY;
  const leftWidth = Math.max(
    LEFT_MIN,
    Math.min(layout.middleWidth ?? LEFT_DEFAULT, viewportW - 200),
  );
  const navWidth = Math.max(
    NAV_MIN,
    Math.min(layout.navWidth ?? NAV_DEFAULT, viewportW - 300),
  );
  const papersHeight = layout.papersHeight ?? PAPERS_DEFAULT;
  const navColumnRef = useRef<HTMLDivElement | null>(null);
  // The resizable grid node + the My Papers pod node. The resizers write live
  // drag feedback STRAIGHT to these DOM nodes (no per-frame React state) and
  // commit to the store only on pointer-up — see makeResizeHandler.
  const gridRef = useRef<HTMLDivElement | null>(null);
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

  // Write the grid track string STRAIGHT to the live grid node. Mirrors the
  // JSX `gridTemplateColumns` below (3-col with navigator, 2-col without).
  const applyGridTemplate = useCallback(
    (nav: number, mid: number) => {
      const el = gridRef.current;
      if (!el) return;
      el.style.gridTemplateColumns = showNavigator
        ? `${nav}px 6px ${mid}px 6px 1fr`
        : `${mid}px 6px 1fr`;
    },
    [showNavigator],
  );
  // A column resizer drives its live drag feedback IMPERATIVELY (writing the
  // grid track to the DOM via `applyLive`) and commits the size to the store
  // exactly ONCE on pointer-up (`commit`). This keeps a deliberate drag
  // gesture entirely off the React render path: a per-frame store commit would
  // re-render all of LibraryView — and with it the middle column's LeftList
  // and its non-memoized rows — on every pointer-move frame. The committed
  // value equals the last live value, so the post-drag render reconciles to
  // the identical template (no jump). Persistence stays in the unified store,
  // so sizes still survive reload.
  const makeResizeHandler = useCallback(
    (
      currentWidth: number,
      minWidth: number,
      maxOffset: number,
      applyLive: (next: number) => void,
      commit: (next: number) => void,
    ) =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = currentWidth;
        let latest = startWidth;
        const onMove = (ev: PointerEvent) => {
          latest = Math.max(
            minWidth,
            Math.min(
              window.innerWidth - maxOffset,
              startWidth + (ev.clientX - startX),
            ),
          );
          applyLive(latest);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          commit(Math.round(latest));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      },
    [],
  );
  const startResize = useMemo(
    () =>
      makeResizeHandler(
        leftWidth,
        LEFT_MIN,
        200,
        // Live: only the middle width changes; the nav width stays put.
        (next) => applyGridTemplate(navWidth, next),
        (next) => setLayout({ middleWidth: next }),
      ),
    [leftWidth, navWidth, makeResizeHandler, applyGridTemplate, setLayout],
  );
  // Vertical resizer between Libraries (top) and My Papers (bottom).
  // Dragging up grows the My Papers pod; dragging down shrinks it. Both pods
  // clamp to at least PAPERS_MIN so neither disappears. Like the column
  // resizers, the live drag writes `flex-basis` straight to the pod node and
  // commits to the store only on pointer-up.
  const startPapersResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = papersHeight;
      let latest = startHeight;
      const onMove = (ev: PointerEvent) => {
        const colH = navColumnRef.current?.getBoundingClientRect().height ?? 0;
        const maxH = Math.max(PAPERS_MIN, colH - PAPERS_MIN - 6);
        latest = Math.max(
          PAPERS_MIN,
          Math.min(maxH, startHeight - (ev.clientY - startY)),
        );
        const pod = papersPodRef.current;
        if (pod) pod.style.flexBasis = `${latest}px`;
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setLayout({ papersHeight: Math.round(latest) });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [papersHeight, setLayout],
  );
  const startNavResize = useMemo(
    () =>
      makeResizeHandler(
        navWidth,
        NAV_MIN,
        300,
        // Live: only the nav width changes; the middle width stays put.
        (next) => applyGridTemplate(next, leftWidth),
        (next) => setLayout({ navWidth: next }),
      ),
    [navWidth, leftWidth, makeResizeHandler, applyGridTemplate, setLayout],
  );

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
          bib: { state: "unverified" },
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
  }, [catalog, bibEntries, unsortedFiles, unsortedBibByFile]);

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
      queueImportBib: (citekey: string) => {
        void queueImportBib(handle, citekey);
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
  const handleCreateLibraryFromBib = useCallback(async () => {
    const picked = await pickBibFile();
    if (!picked) return; // user cancelled or environment lacks the API

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
      return;
    }

    // Pick a unique on-disk filename in unsorted/ so re-imports of the
    // same source file don't clobber each other. `foo.bib` → `foo-2.bib`,
    // `foo-3.bib`, etc.
    const dotIdx = picked.filename.lastIndexOf(".");
    const base =
      dotIdx > 0 ? picked.filename.slice(0, dotIdx) : picked.filename;
    const ext = dotIdx > 0 ? picked.filename.slice(dotIdx) : ".bib";
    let attempt = 1;
    let onDiskName = picked.filename;
    while (
      await fileExists(handle, `${SUBDIRS.unsorted}/${onDiskName}`)
    ) {
      attempt += 1;
      onDiskName = `${base}-${attempt}${ext}`;
      if (attempt > 999) break; // pathological safety valve
    }
    try {
      await writeTextFile(
        handle,
        `${SUBDIRS.unsorted}/${onDiskName}`,
        picked.text,
      );
    } catch (err) {
      console.error("[library] failed to write picked .bib to unsorted/", err);
      return;
    }

    // De-duplicate citekeys against existing custom-library labels for
    // the navigator label. The on-disk filename uniqueness is independent
    // of the label uniqueness — both can drift ("foo (2)" vs "foo-2.bib").
    const existingLabels = new Set(
      libraryTabs.registry.libraries
        .filter((l) => l.kind === "custom")
        .map((l) => l.label),
    );
    let label = base;
    let labelAttempt = 1;
    while (existingLabels.has(label)) {
      labelAttempt += 1;
      label = `${base} (${labelAttempt})`;
      if (labelAttempt > 999) break;
    }

    const entryKeys = parsed.map((e) => e.key).filter(Boolean);
    libraryTabs.createFromBib({
      label,
      sourceBibFile: onDiskName,
      entryKeys,
      panel: "left",
    });
    // Trigger an immediate poll instead of waiting for the 6 s tick so
    // the synthesized rows show up the moment the user clicks the new
    // library tab.
    void reloadUnsortedBib();
  }, [handle, libraryTabs, reloadUnsortedBib]);

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
              borderRadius: 4,
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
