"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import {
  DEFAULT_WIDTHS,
  RESIZER_WIDTH,
  type ResizableColId,
  type SortColId,
  type SortDir,
  clampWidth,
  gridTemplate,
  sortEntries,
} from "@library/lib/list-columns";
import LeftListRow, {
  ACTION_COL_WIDTH,
  STATUS_DOT_COL_WIDTH,
  type RowActions,
} from "./LeftListRow";
import { type PanelKey } from "@library/hooks/useLibraryTabs";
import { useLayoutPrefs, useListView } from "@library/lib/view-session-store";
import { searchCatalogFuzzy } from "@library/lib/catalog-search";

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

  // Keep a ref to the live widths so the resize-handler closure can read
  // the start width synchronously (the resize loop mutates a local draft
  // and only commits to the store on pointer-up).
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // Typing must stay snappy: defer the query so the input reflects each
  // keystroke immediately while the filter catches up on a low-priority
  // render. The keystroke-sanctity stance for the list — the text box is
  // never blocked by the catalog scan.
  const deferredQuery = useDeferredValue(query);

  // Sort the FULL catalog once per (entries, bibByKey, sort) — NOT per
  // keystroke. Sorting is the expensive O(n log n) collated pass; lifting it
  // out of the per-keystroke path is the T2 fix.
  const sorted = useMemo(
    () => sortEntries(entries, bibByKey, sort.col, sort.dir),
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

  const template = useMemo(() => gridTemplate(widths), [widths]);

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
  // One-shot restore guard, keyed by libId so switching libraries re-arms.
  const restoredForRef = useRef<string | null>(null);
  // RAF coalescing for the scroll save (≤1 store update per frame; the
  // store's own 250 ms debounce then coalesces the localStorage writes —
  // no synchronous write per scroll tick).
  const scrollRafRef = useRef<number | null>(null);
  const handleRowsScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = rowsRef.current;
      if (el) setScroll(el.scrollTop);
    });
  }, [setScroll]);
  // Reset the one-shot guard when the active library changes so the new
  // list restores its own saved position.
  useEffect(() => {
    restoredForRef.current = null;
  }, [libId]);
  // One-shot restore: after the first NON-EMPTY render with a real
  // scrollHeight (so we never clamp to 0 on an empty / zero-height list),
  // apply the saved scrollTop once. If content streams in (catalog 6 s
  // poll), this re-runs on `filtered` change until it lands.
  useLayoutEffect(() => {
    if (restoredForRef.current === libId) return;
    const el = rowsRef.current;
    if (!el) return;
    if (filtered.length === 0) return; // empty list — keep the saved value
    if (el.scrollHeight <= el.clientHeight) return; // not scrollable yet
    if (scrollTop > 0) el.scrollTop = scrollTop;
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

  const handleSort = useCallback(
    (col: SortColId) => {
      const next: { col: SortColId; dir: SortDir } =
        sort.col === col
          ? { col, dir: sort.dir === "asc" ? "desc" : "asc" }
          : { col, dir: defaultDirFor(col) };
      setSort(next);
    },
    [sort, setSort],
  );

  const handleResize = useCallback(
    (leftCol: ResizableColId | null, rightCol: ResizableColId | null) => {
      return (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startLeftW = leftCol ? widthsRef.current[leftCol] : 0;
        const startRightW = rightCol ? widthsRef.current[rightCol] : 0;
        const onMove = (ev: PointerEvent) => {
          const rawDelta = ev.clientX - startX;
          // Constrain the boundary delta against BOTH columns' clamps so
          // total fixed width is preserved (otherwise the 1fr title
          // absorbs the difference and the status column shifts visibly).
          let delta = rawDelta;
          if (leftCol) {
            delta = clampWidth(leftCol, startLeftW + delta) - startLeftW;
          }
          if (rightCol) {
            delta = startRightW - clampWidth(rightCol, startRightW - delta);
          }
          const cur = widthsRef.current;
          const patch: Partial<Record<ResizableColId, number>> = {};
          let changed = false;
          if (leftCol) {
            const v = startLeftW + delta;
            if (cur[leftCol] !== v) { patch[leftCol] = v; changed = true; }
          }
          if (rightCol) {
            const v = startRightW - delta;
            if (cur[rightCol] !== v) { patch[rightCol] = v; changed = true; }
          }
          // Write through the store: the in-memory update is synchronous
          // (live drag feedback via the useLayoutPrefs re-render) while the
          // store's 250 ms debounce coalesces the localStorage writes.
          if (changed) {
            setLayout({ colWidths: { ...cur, ...patch } });
          }
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          // Final commit so the last frame's value is persisted (the store
          // flushes it on the trailing debounce / pagehide).
          setLayout({ colWidths: { ...widthsRef.current } });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      };
    },
    [setLayout],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
            borderRadius: 4,
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
            gridTemplateColumns: template,
            alignItems: "stretch",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <SortHeader col="year" label="year" activeSort={sort} onSort={handleSort} />
          <Resizer onPointerDown={handleResize("year", null)} />
          <SortHeader col="author" label="author" activeSort={sort} onSort={handleSort} />
          <Resizer onPointerDown={handleResize("author", null)} />
          <SortHeader col="title" label="title" activeSort={sort} onSort={handleSort} />
          <Resizer onPointerDown={handleResize(null, "status")} />
          <SortHeader col="status" label="status" activeSort={sort} onSort={handleSort} />
          <Resizer onPointerDown={handleResize("status", "citekey")} />
          <SortHeader col="citekey" label="citekey" activeSort={sort} onSort={handleSort} />
          <div
            title="Bibliography imported into master.bib"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              color: "var(--muted)",
              userSelect: "none",
            }}
          >
            imp
          </div>
        </div>
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
          filtered.map((entry) => {
            const key = keyOf(entry);
            return (
              <LeftListRow
                key={key}
                entry={entry}
                bib={entry.citekey ? bibByKey.get(entry.citekey) : undefined}
                selected={selectedKeys.has(key)}
                gridTemplate={template}
                entryKey={key}
                onActivate={onActivate}
                resolveDragKeys={resolveDragKeys}
                actions={rowActions}
                dotTone={dotToneFor(entry.citekey)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header cell
// ────────────────────────────────────────────────────────────────────────

interface SortHeaderProps {
  col: SortColId;
  label: string;
  align?: "left" | "right";
  activeSort: { col: SortColId; dir: SortDir };
  onSort: (col: SortColId) => void;
}

function SortHeader({ col, label, align = "left", activeSort, onSort }: SortHeaderProps) {
  const active = activeSort.col === col;
  const arrow = active ? (activeSort.dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      title={`Sort by ${label}`}
      style={{
        background: "transparent",
        border: "none",
        padding: "6px 8px",
        textAlign: align,
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: active ? "var(--accent)" : "var(--muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
      <span style={{ fontFamily: "var(--mono)" }}>{arrow}</span>
    </button>
  );
}

function Resizer({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onPointerDown}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
      style={{
        width: RESIZER_WIDTH,
        cursor: "col-resize",
        background: "transparent",
        transition: "background 120ms",
        touchAction: "none",
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
  if (col === "year" || col === "status") return "desc";
  return "asc";
}

/** Stable per-row key: the citekey for indexed rows, a synthesized key for
 *  triage rows (no citekey yet). One definition shared by the sort/filter
 *  memos, the shift-click range math, the virtualizer item-key, and render. */
function keyOf(e: CatalogEntry): string {
  return e.citekey ?? `__triage__${e.originalFilename}`;
}
