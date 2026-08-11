"use client";

import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import {
  COL_TEMPLATE_REF,
  COL_TEMPLATE_VAR,
  DEFAULT_WIDTHS,
  FACETS,
  RESIZER_WIDTH,
  STATUS_SUBGRID,
  type ReorderableColId,
  type ResizableColId,
  type SortColId,
  type SortDir,
  type SortState,
  type StatusFacet,
  clampWidth,
  defaultDirForStatusFacet,
  gridTemplate,
  isReorderableColId,
  resizeNeighborsForBoundary,
  resolveColOrder,
  sortEntries,
} from "@library/lib/list-columns";
import LeftListRow, {
  ACTION_COL_WIDTH,
  OPEN_COL_WIDTH,
  STATUS_DOT_COL_WIDTH,
  type RowActions,
} from "./LeftListRow";
import { type PanelKey } from "@library/hooks/useLibraryTabs";
import { useLayoutPrefs, useListView } from "@library/lib/view-session-store";
import { searchCatalogFuzzy } from "@library/lib/catalog-search";
import { ROW_HEIGHT, computeListWindow } from "@library/lib/list-window";
import { FONT_MONO } from "@/lib/font-stacks";

// The header grid and every row consume ONE inherited template var
// (COL_TEMPLATE_VAR / COL_TEMPLATE_REF from list-columns.ts), defined on the
// list root. During a column-boundary drag the pane-resize engine rewrites
// the var imperatively per frame — header and rows track by CSS inheritance,
// zero React work — and the store commits exactly ONCE on release (R5: the
// old handler routed setLayout through the view-session store per
// pointermove, re-rendering LibraryView-wide every frame). The indirection
// is also what keeps `LeftListRow`'s memo armed: the row prop is the
// constant var reference, so a width change never re-renders a row.

interface Props {
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  /** View-session scope: '' for the inline Library tab, 'outer:<libId>'
   *  for a tear-out outer-tab instance. */
  scope: string;
  /** Which panel this list lives in (per-panel persistence key). */
  panel: PanelKey;
  /** The active library's id — the per-(panel,libId) key under which this
   *  list's query / sort / scroll are persisted in the view-session store. */
  libId: string;
  /** Highlighted rows. A plain click replaces this with a single key; a
   *  cmd/ctrl-click toggles one key; a shift-click adds the range from
   *  `anchorKey` to the clicked row in the current sort/filter order. */
  selectedKeys: ReadonlySet<string>;
  /** Pivot for shift-click range selection — the most recently
   *  single-clicked or cmd-clicked row. */
  anchorKey: string | null;
  /** Commit a new selection set + anchor. */
  onSelectKeys: (keys: ReadonlySet<string>, anchor: string | null) => void;
  /** Open the paper as a tabbed library file in the opposite panel. */
  onOpenPaper: (citekey: string) => void;
  /** Per-row action callbacks for the three-dots menu. */
  rowActions: RowActions;
  /** Render an accent outline around the rows scroll area (below the search
   * box and column headers). Used by TabbedLibraryPanel to indicate the
   * library is an active drop target during entry-row drags. */
  dropHighlight?: boolean;
  /** Far-left request-state dot tone for a citekey. Returns null for rows
   *  with no pending request and no unread completion notification. */
  dotToneFor: (citekey: string | null | undefined) => "red" | "green" | null;
  /** Called when a row is clicked, before onSelect — bumps the row's
   *  "last viewed" timestamp so a green dot clears immediately. */
  onRowViewed: (citekey: string | null | undefined) => void;
}

export default function LeftList({
  entries,
  bibByKey,
  scope,
  panel,
  libId,
  selectedKeys,
  anchorKey,
  onSelectKeys,
  onOpenPaper,
  rowActions,
  dropHighlight = false,
  dotToneFor,
  onRowViewed,
}: Props) {
  // Query + sort are persisted per-(panel,libId) in the view-session store
  // (sort is the coherence fix — each library remembers its own column);
  // both survive reload AND the LeftList per-tab remount.
  const { query, setQuery, sort, setSort, scrollTop, setScroll } = useListView(
    scope,
    panel,
    libId,
  );
  // Column widths are GLOBAL (one set across every list), stored in the
  // view-session layout slice. Merge the persisted partial with the
  // clamped defaults so gridTemplate always has a complete record.
  const { layout, setLayout } = useLayoutPrefs();
  const widths = useMemo<Record<ResizableColId, number>>(() => {
    const out = { ...DEFAULT_WIDTHS };
    const saved = layout.colWidths;
    if (saved) {
      for (const k of Object.keys(DEFAULT_WIDTHS) as ResizableColId[]) {
        const v = saved[k];
        if (typeof v === "number" && Number.isFinite(v)) out[k] = clampWidth(k, v);
      }
    }
    return out;
  }, [layout.colWidths]);

  // Keep a ref to the live widths so a Resizer's gesture can snapshot the
  // start widths synchronously at drag start (the drag projects a boundary
  // delta onto that snapshot and only commits to the store on release).
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  // The list root — owner of the shared `--lib-col-template` var the drag
  // engine rewrites per frame.
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const commitColWidths = useCallback(
    (w: Record<ResizableColId, number>) => setLayout({ colWidths: w }),
    [setLayout],
  );

  // Typing must stay snappy: defer the query so the input reflects each
  // keystroke immediately while the filter catches up on a low-priority
  // render. The keystroke-sanctity stance for the list — the text box is
  // never blocked by the catalog scan.
  const deferredQuery = useDeferredValue(query);

  // Sort the FULL catalog once per (entries, bibByKey, sort) — NOT per
  // keystroke. Sorting is the expensive O(n log n) collated pass; lifting it
  // out of the per-keystroke path is the T2 fix.
  const sorted = useMemo(
    () => sortEntries(entries, bibByKey, sort.col, sort.dir, sort.facet),
    [entries, bibByKey, sort],
  );

  // Per keystroke: only the WeakMap-cached fuzzy scan (its index is built
  // once per `entries` identity, so a keystroke is a token match, not a
  // re-synthesis) + an O(n) membership filter over the already-sorted array.
  // Flexible, multi-token, diacritic-folding matching via the shared
  // `searchBibFuzzy` (one matcher across the Bibliography panel, bib pickers,
  // citekey picker, and the Library catalog). Sort order stays the SSOT for
  // display — the fuse relevance order is discarded and `filter` is
  // order-preserving, so this matches the prior behavior exactly, minus the
  // per-keystroke re-sort.
  const filtered = useMemo(() => {
    const q = deferredQuery.trim();
    if (!q) return sorted;
    const matched = searchCatalogFuzzy(entries, bibByKey, deferredQuery);
    const keep = new Set(matched.map(keyOf));
    return sorted.filter((e) => keep.has(keyOf(e)));
  }, [sorted, entries, bibByKey, deferredQuery]);

  // GLOBAL column order (F#13), stored alongside colWidths in the layout slice.
  // Normalized once here so it's a complete permutation and referentially
  // stable between renders (its identity changes ONLY when `layout.colOrder`
  // changes — i.e. on a drag-reorder commit, never on a keystroke). Passing
  // this stable array to the memo()'d LeftListRow does NOT defeat the bail.
  const colOrder = useMemo<ReorderableColId[]>(
    () => resolveColOrder(layout.colOrder),
    [layout.colOrder],
  );

  const template = useMemo(
    () => gridTemplate(widths, colOrder),
    [widths, colOrder],
  );

  // Visible ordering as keys — used by the shift-click range math (read via
  // a ref from the stable activation handler below). Memoized on `filtered`.
  const orderedKeys = useMemo(() => filtered.map(keyOf), [filtered]);

  // Live mirrors of selection + ordering so the STABLE activation handler
  // and the drag-key resolver read current values at event time WITHOUT
  // taking them as deps. That keeps those callbacks referentially stable
  // across selection / keystroke / 6 s-poll re-renders, which is what lets
  // each memoized `LeftListRow` skip — pass primitives + stable fns, never
  // the selection Set or a per-row closure.
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  const anchorKeyRef = useRef(anchorKey);
  anchorKeyRef.current = anchorKey;
  const orderedKeysRef = useRef(orderedKeys);
  orderedKeysRef.current = orderedKeys;

  // ── Catalog scroll save/restore (survives reload + per-tab remount) ──
  // The rows container; its scrollTop is persisted per-(panel,libId).
  const rowsRef = useRef<HTMLDivElement | null>(null);
  // The translated slice container — measured to self-correct the row height.
  const innerRef = useRef<HTMLDivElement | null>(null);
  // One-shot restore guard, keyed by libId so switching libraries re-arms.
  const restoredForRef = useRef<string | null>(null);

  // ── Virtualization (chip C7) ─────────────────────────────────────────
  // Render only the rows intersecting the viewport (+ overscan). `viewport`
  // tracks the scroll container's scrollTop + clientHeight; `rowHeight` is
  // seeded from the measured constant and self-corrected from the first real
  // row so the spacer math stays pixel-exact regardless of theme/zoom. Both
  // are cheap state — a scroll frame re-renders ONLY ~viewport rows, never
  // all N (the keystroke-sanctity cap for the catalog list at any size).
  const [viewport, setViewport] = useState<{ scrollTop: number; height: number }>({
    scrollTop: 0,
    height: 0,
  });
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);

  // RAF coalescing for the scroll save + window update (≤1 per frame; the
  // store's own 250 ms debounce then coalesces the localStorage writes —
  // no synchronous write per scroll tick).
  const scrollRafRef = useRef<number | null>(null);
  const handleRowsScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = rowsRef.current;
      if (!el) return;
      setScroll(el.scrollTop); // persist (quiet — no subscriber re-render)
      // Drive the window. Guard so a no-op scroll frame doesn't re-render.
      setViewport((v) =>
        v.scrollTop === el.scrollTop && v.height === el.clientHeight
          ? v
          : { scrollTop: el.scrollTop, height: el.clientHeight },
      );
    });
  }, [setScroll]);

  // Measure the viewport height on mount + on resize (the window needs the
  // container height; the scroll handler only fires on scroll). Guarded for
  // jsdom / SSR where ResizeObserver may be absent.
  useLayoutEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const measure = () =>
      setViewport((v) =>
        v.height === el.clientHeight && v.scrollTop === el.scrollTop
          ? v
          : { scrollTop: el.scrollTop, height: el.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // One-shot restore: after the first NON-EMPTY render with a real
  // scrollHeight (so we never clamp to 0 on an empty / zero-height list),
  // apply the saved scrollTop once. If content streams in (catalog 6 s
  // poll), this re-runs on `filtered` change until it lands — but the guard
  // below makes it idempotent per library.
  //
  // The guard `restoredForRef.current === libId` is self-re-arming: on a
  // library switch the ref holds the OLD id (≠ the new libId), so the restore
  // runs once for the new list and stamps the ref. A separate reset effect
  // would null the ref AFTER this layout effect and trigger a SECOND restore
  // on the next `filtered` change (yanking the user back) — so there is none.
  //
  // The apply is UNCONDITIONAL over the offset domain — saved 0 included. This
  // component is REUSED (no `key`) across a `libId` switch, so `el.scrollTop`
  // and the `viewport` state survive from the OUTGOING library. If we only
  // wrote when `scrollTop > 0` (as an earlier revision did), switching to a
  // never-scrolled library (saved 0) would skip the write yet still stamp the
  // ref — leaking the outgoing library's offset into the reused list and
  // painting it mid-list instead of at row 0. "Restore" must be total over the
  // offset domain, not truthy-only.
  useLayoutEffect(() => {
    if (restoredForRef.current === libId) return;
    const el = rowsRef.current;
    if (!el) return;
    if (filtered.length === 0) return; // empty list — keep the saved value
    if (el.scrollHeight <= el.clientHeight) return; // not scrollable yet
    el.scrollTop = scrollTop;
    // Seed the window to the restored offset (0 included). This runs in a
    // useLayoutEffect, so React flushes this state update SYNCHRONOUSLY before
    // paint — the first painted frame already renders the rows at the restored
    // offset (overscan covers any residual), instead of painting the reused /
    // leaked offset then jumping once the scroll event lands.
    setViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    restoredForRef.current = libId;
    // `scrollTop` is read once at restore time; we intentionally don't
    // re-restore when it changes (that's the live user scroll feeding back).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libId, filtered]);
  // Cancel a pending scroll-save RAF on unmount.
  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );

  // ── C6: defer the (heavy) paper open behind idle time ────────────────
  // A plain click commits the highlight synchronously (instant), but the
  // actual open — which mounts a full read-only <EditorPane> (disk read +
  // parseLatex + TipTap) — is coalesced: rapidly clicking or holding the
  // arrow through rows schedules-then-cancels, so only the row the user
  // settles on mounts a reader. A lone click fires at the next idle tick
  // (≈ immediately, bounded by the 200 ms timeout). `openPaper` is
  // idempotent for an already-active tab, so a repeat citekey is a cheap
  // no-op. Read `onOpenPaper` through a ref so `scheduleOpen` stays stable.
  const onOpenPaperRef = useRef(onOpenPaper);
  onOpenPaperRef.current = onOpenPaper;
  const pendingOpenRef = useRef<number | null>(null);
  const cancelPendingOpen = useCallback(() => {
    if (pendingOpenRef.current === null) return;
    const id = pendingOpenRef.current;
    pendingOpenRef.current = null;
    if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  }, []);
  const scheduleOpen = useCallback(
    (citekey: string) => {
      cancelPendingOpen();
      const run = () => {
        pendingOpenRef.current = null;
        onOpenPaperRef.current(citekey);
      };
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        pendingOpenRef.current = window.requestIdleCallback(run, { timeout: 200 });
      } else {
        pendingOpenRef.current = window.setTimeout(run, 150);
      }
    },
    [cancelPendingOpen],
  );
  // Cancel any pending open on unmount (explicit cleanup-arrow form: the
  // RETURNED fn is the unmount teardown, so a tab-switch / unmount can't fire
  // a deferred open into a torn-down tree).
  useEffect(() => () => cancelPendingOpen(), [cancelPendingOpen]);

  // Stable activation handler (click / Enter / Space) — reads the live
  // selection/anchor/ordering from refs so its identity never changes,
  // keeping the row memo intact. Receives the row's own key + citekey.
  const onActivate = useCallback(
    (
      key: string,
      citekey: string | null | undefined,
      e: React.MouseEvent | React.KeyboardEvent,
    ) => {
      const shift = e.shiftKey;
      // ⌘ on macOS, Ctrl elsewhere — both standard for toggle-select.
      const meta = e.metaKey || e.ctrlKey;
      const selected = selectedKeysRef.current;
      const anchor = anchorKeyRef.current;
      const ordered = orderedKeysRef.current;

      if (shift && anchor && ordered.includes(anchor)) {
        const a = ordered.indexOf(anchor);
        const b = ordered.indexOf(key);
        if (b < 0) return;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const next = new Set(selected);
        for (let i = lo; i <= hi; i++) next.add(ordered[i]);
        // Anchor stays put so successive shift-clicks pivot around the
        // same origin (matches Finder / VS Code behavior).
        onSelectKeys(next, anchor);
        return;
      }

      if (meta) {
        const next = new Set(selected);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        // Move the anchor to the cmd-clicked row — the row the user
        // most recently committed to as the new pivot.
        onSelectKeys(next, key);
        return;
      }

      // Plain click: replace selection with this row (instant highlight) +
      // bump the viewed stamp; DEFER the heavy paper open (C6).
      onRowViewed(citekey);
      onSelectKeys(new Set([key]), key);
      if (citekey) scheduleOpen(citekey);
    },
    [onSelectKeys, onRowViewed, scheduleOpen],
  );

  // Stable drag-payload resolver: reads the live selection from a ref so the
  // row needn't take the selection Set as a prop.
  const resolveDragKeys = useCallback((ek: string): string[] => {
    const sel = selectedKeysRef.current;
    return sel.has(ek) && sel.size > 1 ? Array.from(sel) : [ek];
  }, []);

  // Column label-click. For STATUS this is the COMPOSITE statusRank sort
  // (clears any active facet — facet is undefined, reached only via the
  // sub-bar). A re-click on the already-active column (same col AND, for
  // status, no facet) flips direction.
  const handleSort = useCallback(
    (col: SortColId) => {
      const isReclick =
        sort.col === col && (col !== "status" || sort.facet === undefined);
      const next: SortState = isReclick
        ? { col, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { col, dir: defaultDirFor(col) };
      setSort(next);
    },
    [sort, setSort],
  );

  // Sub-bar facet click (F#14). Picking a facet sorts that single status facet
  // best-first; re-clicking the ACTIVE facet flips direction (the same dir
  // toggle the columns use). Runs on the already-debounced sort path — the
  // `sorted` memo gates on the `sort` identity, never per keystroke.
  const handleSortStatusFacet = useCallback(
    (facet: StatusFacet) => {
      const active = sort.col === "status" && sort.facet === facet;
      const next: SortState = active
        ? { col: "status", dir: sort.dir === "asc" ? "desc" : "asc", facet }
        : { col: "status", dir: defaultDirForStatusFacet(), facet };
      setSort(next);
    },
    [sort, setSort],
  );

  // ── Header drag-reorder (F#13) ───────────────────────────────────────
  // Commit a new GLOBAL column order when the user drops a dragged header
  // onto another. `side` says whether the drop landed before or after the
  // target column (computed from the pointer-x vs the target's midpoint).
  // Only touches the layout slice — zero document/editor work, fires only on
  // a deliberate drop (never per keystroke).
  const onReorder = useCallback(
    (fromId: ReorderableColId, overId: ReorderableColId, side: "before" | "after") => {
      if (fromId === overId) return;
      const next = colOrder.filter((c) => c !== fromId);
      const at = next.indexOf(overId) + (side === "after" ? 1 : 0);
      next.splice(at, 0, fromId);
      // No-op guard: skip the commit when the order is unchanged.
      if (next.length === colOrder.length && next.every((c, i) => c === colOrder[i])) {
        return;
      }
      setLayout({ colOrder: next });
    },
    [colOrder, setLayout],
  );

  // ── Window (chip C7) ─────────────────────────────────────────────────
  // Before the container is measured, fall back to a generous viewport so the
  // first paint fills any reasonable panel (then ResizeObserver trims it).
  const effectiveHeight = viewport.height > 0 ? viewport.height : 1200;
  const win = useMemo(
    () =>
      computeListWindow({
        scrollTop: viewport.scrollTop,
        viewportHeight: effectiveHeight,
        rowHeight,
        count: filtered.length,
      }),
    [viewport.scrollTop, effectiveHeight, rowHeight, filtered.length],
  );
  const visibleRows = useMemo(
    () => filtered.slice(win.startIndex, win.endIndex),
    [filtered, win.startIndex, win.endIndex],
  );
  // Self-correct the row height from the first real row so the spacer math is
  // pixel-exact. Runs once the slice paints; no-op in jsdom (offsetHeight 0).
  useLayoutEffect(() => {
    const firstRow = innerRef.current?.firstElementChild as HTMLElement | null;
    if (!firstRow) return;
    const h = firstRow.offsetHeight;
    if (h > 0 && Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
  }, [visibleRows, rowHeight]);

  return (
    <div
      ref={listRootRef}
      style={
        {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          // The ONE place the column template lives — header + rows inherit
          // it. React re-writes it only on a store commit (release/reorder);
          // the drag engine retargets it imperatively per frame.
          [COL_TEMPLATE_VAR]: template,
        } as CSSProperties
      }
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, author, citekey…"
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-sm)",
            background: "var(--background)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
          {filtered.length} of {entries.length} papers
        </div>
      </div>

      {/* Header row — flex(left-dot + grid + right-action) mirrors
          LeftListRow's three-part flex layout so headers line up with row
          contents pixel-for-pixel. */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 1,
          fontSize: 11,
        }}
      >
        <div style={{ flexShrink: 0, width: STATUS_DOT_COL_WIDTH }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COL_TEMPLATE_REF,
            alignItems: "stretch",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Order-driven headers + interleaved resizers (F#13). The resizer
              between boundary i pulls the px-resizable neighbors derived from
              the LIVE order (the 1fr `title` can sit anywhere). */}
          {colOrder.map((col, i) => {
            const n =
              i < colOrder.length - 1
                ? resizeNeighborsForBoundary(colOrder, i)
                : null;
            return (
              <Fragment key={col}>
                {col === "status" ? (
                  <StatusSortHeader
                    activeSort={sort}
                    onSortFacet={handleSortStatusFacet}
                    onReorder={onReorder}
                  />
                ) : (
                  <SortHeader
                    col={col}
                    label={col}
                    activeSort={sort}
                    onSort={handleSort}
                    onReorder={onReorder}
                  />
                )}
                {n && (
                  <Resizer
                    leftCol={n.left}
                    rightCol={n.right}
                    listRootRef={listRootRef}
                    widthsRef={widthsRef}
                    colOrder={colOrder}
                    onCommitWidths={commitColWidths}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
        {/* F#9 open-in-tab column spacer + the ⋮ action column spacer —
            mirror the row's two trailing flex siblings so header/rows align. */}
        <div style={{ flexShrink: 0, width: OPEN_COL_WIDTH }} />
        <div style={{ flexShrink: 0, width: ACTION_COL_WIDTH }} />
      </div>

      <div
        ref={rowsRef}
        onScroll={handleRowsScroll}
        style={{
          overflowY: "auto",
          flex: 1,
          outline: dropHighlight ? "2px solid var(--accent)" : "none",
          outlineOffset: -2,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
            {entries.length === 0
              ? "No papers yet. Drop a PDF to begin, or add entries to master.bib."
              : "No papers match this search."}
          </div>
        ) : (
          // Virtualized: a full-height spacer drives the scrollbar; the visible
          // slice is offset by `padTop`. Only ~viewport rows are in the DOM.
          <div style={{ height: win.totalHeight, position: "relative" }}>
            <div
              ref={innerRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${win.padTop}px)`,
              }}
            >
              {visibleRows.map((entry) => {
                const key = keyOf(entry);
                return (
                  <LeftListRow
                    key={key}
                    entry={entry}
                    bib={entry.citekey ? bibByKey.get(entry.citekey) : undefined}
                    selected={selectedKeys.has(key)}
                    gridTemplate={COL_TEMPLATE_REF}
                    colOrder={colOrder}
                    entryKey={key}
                    onActivate={onActivate}
                    resolveDragKeys={resolveDragKeys}
                    actions={rowActions}
                    dotTone={dotToneFor(entry.citekey)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header cell
// ────────────────────────────────────────────────────────────────────────

/** dataTransfer MIME for a dragged column header (F#13). Private to this
 *  drag — distinct from the entry-row DnD types so the two never cross. */
const COL_DT_TYPE = "application/x-virgil-colid";

interface SortHeaderProps {
  col: ReorderableColId;
  label: string;
  align?: "left" | "right";
  activeSort: SortState;
  onSort: (col: SortColId) => void;
  /** Commit a drag-reorder: move `from` to before/after this header (F#13). */
  onReorder: (
    from: ReorderableColId,
    over: ReorderableColId,
    side: "before" | "after",
  ) => void;
}

function SortHeader({ col, label, align = "left", activeSort, onSort, onReorder }: SortHeaderProps) {
  // The label is "active" only for the COMPOSITE sort — when a status facet is
  // chosen via the sub-bar (F#14) the facet owns the active state, not the
  // label. Non-status columns never carry a facet, so this is a no-op for them.
  const active = activeSort.col === col && activeSort.facet === undefined;
  const arrow = active ? (activeSort.dir === "asc" ? " ↑" : " ↓") : "";
  // A stationary click fires onClick (sort); a press-and-move past the
  // browser's drag threshold fires the native drag instead (reorder). The
  // ref suppresses a stray click that some browsers synthesize after a drag.
  const draggingRef = useRef(false);
  const [dropSide, setDropSide] = useState<"before" | "after" | null>(null);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        draggingRef.current = true;
        e.dataTransfer.setData(COL_DT_TYPE, col);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        // Cleared on a microtask so the post-drag click guard still sees it.
        setDropSide(null);
        setTimeout(() => {
          draggingRef.current = false;
        }, 0);
      }}
      onDragOver={(e) => {
        // Only a column drag is a valid drop target here.
        if (!e.dataTransfer.types.includes(COL_DT_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        setDropSide((prev) => (prev === side ? prev : side));
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(COL_DT_TYPE);
        setDropSide(null);
        if (!from) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        if (isReorderableColId(from)) onReorder(from, col, side);
      }}
      onClick={() => {
        // Suppress the stray click a drag can synthesize on release.
        if (draggingRef.current) return;
        onSort(col);
      }}
      title={`Sort by ${label} · drag to reorder`}
      style={{
        // Selected-column highlight: a taupe fill (not just text colour) with
        // AA-safe ink text when this column is the active sort (F#12 tokens).
        background: active ? "var(--control-selected-tint)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        padding: "6px 8px",
        textAlign: align,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: active ? "var(--control-selected-ink)" : "var(--muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        // Insertion indicator: a heavy accent edge on the side the drop lands.
        boxShadow:
          dropSide === "before"
            ? "inset 2px 0 0 var(--accent)"
            : dropSide === "after"
              ? "inset -2px 0 0 var(--accent)"
              : "none",
      }}
    >
      {label}
      <span style={{ fontFamily: FONT_MONO }}>{arrow}</span>
    </button>
  );
}

/** Glyph for each facet's sub-bar segment — mirrors the StatusPills order. */
const FACET_GLYPH: Record<StatusFacet, string> = {
  pdf: "pdf",
  idx: "idx",
  bib: "bib",
  imp: "imp",
};

/**
 * The STATUS header (F#14, one line): a single facet rail — 4 equal-width
 * segments in the shared `FACETS` glyph order (pdf · idx · bib · imp) sharing
 * `STATUS_SUBGRID` with the row's status cell so the labels sit pixel-for-pixel
 * over the row pills. Clicking a segment sorts by that facet (click again to
 * reverse); the active facet gets a taupe background highlight + arrow. The rail
 * is also the STATUS column's drag-reorder handle (F#13).
 *
 * The old two-row layout (a "STATUS" label row over the rail) is gone so the
 * header reads as a single line aligned with the other column headers. Removing
 * the label also removed the click target for the COMPOSITE statusRank sort —
 * sorting is now per-facet only.
 */
function StatusSortHeader({
  activeSort,
  onSortFacet,
  onReorder,
}: {
  activeSort: SortState;
  onSortFacet: (facet: StatusFacet) => void;
  onReorder: (
    from: ReorderableColId,
    over: ReorderableColId,
    side: "before" | "after",
  ) => void;
}) {
  return (
    <FacetSubBar
      activeSort={activeSort}
      onSortFacet={onSortFacet}
      onReorder={onReorder}
    />
  );
}

/** The single-line STATUS facet rail. Four equal-width clickable segments in
 *  `FACETS` order, sharing `STATUS_SUBGRID` + the row's `0 8px` inset with the
 *  StatusPills cell so each glyph sits over its row pill. The active facet gets
 *  a taupe background highlight + arrow (no bottom-border bar). Doubles as the
 *  STATUS column's drag-reorder handle (F#13): each segment is a drag source
 *  (col = "status") and the rail is a drop target. */
function FacetSubBar({
  activeSort,
  onSortFacet,
  onReorder,
}: {
  activeSort: SortState;
  onSortFacet: (facet: StatusFacet) => void;
  onReorder: (
    from: ReorderableColId,
    over: ReorderableColId,
    side: "before" | "after",
  ) => void;
}) {
  const activeFacet =
    activeSort.col === "status" ? activeSort.facet : undefined;
  // A stationary click sorts; a press-and-drag reorders the column (mirrors
  // SortHeader). The ref suppresses the stray click some browsers synthesize
  // after a drag.
  const draggingRef = useRef(false);
  const [dropSide, setDropSide] = useState<"before" | "after" | null>(null);
  return (
    <div
      role="group"
      aria-label="Sort by status facet · drag to reorder the column"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(COL_DT_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        setDropSide((prev) => (prev === side ? prev : side));
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(COL_DT_TYPE);
        setDropSide(null);
        if (!from) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
        if (isReorderableColId(from)) onReorder(from, "status", side);
      }}
      style={{
        // Shared with the row's StatusPills grid cell (STATUS_SUBGRID + the
        // matching `0 8px` inset) so the four labels sit directly over the four
        // row pills and scale together on resize.
        display: "grid",
        gridTemplateColumns: STATUS_SUBGRID,
        padding: "0 8px",
        alignItems: "stretch",
        // Insertion indicator when another column is dragged over (F#13).
        boxShadow:
          dropSide === "before"
            ? "inset 2px 0 0 var(--accent)"
            : dropSide === "after"
              ? "inset -2px 0 0 var(--accent)"
              : "none",
      }}
    >
      {FACETS.map((facet) => {
        const active = activeFacet === facet;
        const arrow = active ? (activeSort.dir === "asc" ? "▲" : "▼") : "";
        return (
          <button
            key={facet}
            type="button"
            draggable
            onDragStart={(e) => {
              draggingRef.current = true;
              e.dataTransfer.setData(COL_DT_TYPE, "status");
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDropSide(null);
              setTimeout(() => {
                draggingRef.current = false;
              }, 0);
            }}
            onClick={() => {
              if (draggingRef.current) return;
              onSortFacet(facet);
            }}
            title={`Sort by ${facet} (best first; click again to reverse) · drag to reorder`}
            aria-label={`Sort by ${facet}`}
            aria-pressed={active}
            style={{
              display: "flex",
              alignItems: "center",
              // Left-anchor the glyph within its track (matching the row pill's
              // ~6px inset) so the label sits over the pill below.
              justifyContent: "flex-start",
              gap: 2,
              minWidth: 0,
              // Match SortHeader's 6px vertical rhythm so the rail sits on the
              // same baseline as the other one-line column headers.
              padding: "6px 6px",
              border: "none",
              borderRadius: "var(--radius-sm)",
              // Selected-column highlight: a taupe fill (not just text colour)
              // with AA-safe ink text (F#12 tokens). Applies to the active facet
              // here and to the active regular header in SortHeader.
              background: active ? "var(--control-selected-tint)" : "transparent",
              cursor: "pointer",
              fontFamily: FONT_MONO,
              fontSize: 10,
              lineHeight: "12px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: active ? "var(--control-selected-ink)" : "var(--muted)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {FACET_GLYPH[facet]}
            </span>
            {arrow && (
              <span aria-hidden="true" style={{ fontSize: 8 }}>
                {arrow}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Resizer({
  leftCol,
  rightCol,
  listRootRef,
  widthsRef,
  colOrder,
  onCommitWidths,
}: {
  /** The px-resizable neighbors this boundary pulls (title → null side). */
  leftCol: ResizableColId | null;
  rightCol: ResizableColId | null;
  listRootRef: RefObject<HTMLDivElement | null>;
  /** Live store widths — snapshotted once per gesture at drag start. */
  widthsRef: RefObject<Record<ResizableColId, number>>;
  colOrder: readonly ReorderableColId[];
  /** ONE store commit on release with the complete widths record. */
  onCommitWidths: (w: Record<ResizableColId, number>) => void;
}) {
  // Boundary-drag start snapshot, taken in getValue() — the engine's
  // documented once-per-gesture read point on the start edge. The gesture's
  // scalar value is the boundary DELTA (0 at start); apply() projects it onto
  // the up-to-two neighbor widths and rewrites the inherited template var on
  // the list root — no React state, no store write, until commit().
  const startRef = useRef<{
    widths: Record<ResizableColId, number>;
    leftW: number;
    rightW: number;
  } | null>(null);

  const widthsForDelta = (delta: number): Record<ResizableColId, number> => {
    const start = startRef.current;
    if (!start) return { ...widthsRef.current };
    const next = { ...start.widths };
    if (leftCol) next[leftCol] = start.leftW + delta;
    if (rightCol) next[rightCol] = start.rightW - delta;
    return next;
  };

  const handle = usePaneResizeHandle({
    id: `library-columns:${leftCol ?? "fr"}|${rightCol ?? "fr"}`,
    axis: "x",
    getValue: () => {
      const snapshot = { ...widthsRef.current };
      startRef.current = {
        widths: snapshot,
        leftW: leftCol ? snapshot[leftCol] : 0,
        rightW: rightCol ? snapshot[rightCol] : 0,
      };
      return 0;
    },
    clamp: (delta) => {
      const start = startRef.current;
      if (!start) return delta;
      // Constrain the boundary delta against BOTH columns' clamps so total
      // fixed width is preserved (otherwise the 1fr title absorbs the
      // difference and the status column shifts visibly) — the existing
      // per-column min/max floors (clampWidth) are the authority.
      let d = delta;
      if (leftCol) d = clampWidth(leftCol, start.leftW + d) - start.leftW;
      if (rightCol) d = start.rightW - clampWidth(rightCol, start.rightW - d);
      return d;
    },
    apply: (delta) => {
      listRootRef.current?.style.setProperty(
        COL_TEMPLATE_VAR,
        gridTemplate(widthsForDelta(delta), colOrder),
      );
    },
    commit: (delta) => {
      onCommitWidths(widthsForDelta(delta));
    },
  });

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      {...handle}
      onPointerDown={(e) => {
        // Keep the press out of the header cells' drag-reorder machinery.
        e.stopPropagation();
        handle.onPointerDown(e);
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
      style={{
        ...handle.style,
        width: RESIZER_WIDTH,
        cursor: "col-resize",
        background: "transparent",
        transition: "background 120ms",
        // Stretch the visible-on-hover bar down through every row by
        // letting the wrapping list scroll independently. This div sits
        // in the header's grid track; the row Spacers occupy the same
        // track in each row but render no background, so the column
        // boundary is effectively invisible until the user hovers the
        // header bar.
      }}
    />
  );
}

function defaultDirFor(col: SortColId): SortDir {
  if (col === "year") return "desc";
  // STATUS composite: "asc" so the most-complete entries (statusRank best = 0)
  // sort to the top — the spec's "most-complete-first" label default (F#14).
  if (col === "status") return "asc";
  return "asc";
}

/** Stable per-row key: the citekey for indexed rows, a synthesized key for
 *  triage rows (no citekey yet). One definition shared by the sort/filter
 *  memos, the shift-click range math, the virtualizer item-key, and render. */
function keyOf(e: CatalogEntry): string {
  return e.citekey ?? `__triage__${e.originalFilename}`;
}
