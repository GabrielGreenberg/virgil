"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? entries.filter((e) => {
          const bib = e.citekey ? bibByKey.get(e.citekey) : undefined;
          const hay = [
            e.citekey ?? "",
            e.title ?? bib?.fields.title ?? "",
            (e.authors ?? []).join(" "),
            bib?.fields.author ?? "",
            String(e.year ?? bib?.fields.year ?? ""),
            e.originalFilename ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : entries;
    return sortEntries(base, bibByKey, sort.col, sort.dir);
  }, [entries, bibByKey, query, sort]);

  const template = useMemo(() => gridTemplate(widths), [widths]);

  // Stable per-row key (citekey for indexed rows, synthesized for triage).
  // Memoized because LeftListRow's onClick closes over the visible ordering
  // for shift-click range computation, and we don't want to recompute on
  // every render.
  const orderedKeys = useMemo(
    () => filtered.map((e) => e.citekey ?? `__triage__${e.originalFilename}`),
    [filtered],
  );

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

  const handleRowClick = useCallback(
    (
      key: string,
      citekey: string | null | undefined,
      e: React.MouseEvent | React.KeyboardEvent,
    ) => {
      const shift = e.shiftKey;
      // ⌘ on macOS, Ctrl elsewhere — both standard for toggle-select.
      const meta = e.metaKey || e.ctrlKey;

      if (shift && anchorKey && orderedKeys.includes(anchorKey)) {
        const a = orderedKeys.indexOf(anchorKey);
        const b = orderedKeys.indexOf(key);
        if (b < 0) return;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const next = new Set(selectedKeys);
        for (let i = lo; i <= hi; i++) next.add(orderedKeys[i]);
        // Anchor stays put so successive shift-clicks pivot around the
        // same origin (matches Finder / VS Code behavior).
        onSelectKeys(next, anchorKey);
        return;
      }

      if (meta) {
        const next = new Set(selectedKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        // Move the anchor to the cmd-clicked row — the row the user
        // most recently committed to as the new pivot.
        onSelectKeys(next, key);
        return;
      }

      // Plain click: replace selection with this row, open the paper.
      onRowViewed(citekey);
      onSelectKeys(new Set([key]), key);
      if (citekey) onOpenPaper(citekey);
    },
    [anchorKey, orderedKeys, selectedKeys, onSelectKeys, onOpenPaper, onRowViewed],
  );

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
            const key = entry.citekey ?? `__triage__${entry.originalFilename}`;
            return (
              <LeftListRow
                key={key}
                entry={entry}
                bib={entry.citekey ? bibByKey.get(entry.citekey) : undefined}
                selected={selectedKeys.has(key)}
                gridTemplate={template}
                entryKey={key}
                selectedKeys={selectedKeys}
                onClick={(e) => handleRowClick(key, entry.citekey, e)}
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
