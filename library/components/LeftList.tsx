"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  loadSort,
  loadWidths,
  saveSort,
  saveWidths,
  sortEntries,
} from "@library/lib/list-columns";
import LeftListRow, {
  ACTION_COL_WIDTH,
  STATUS_DOT_COL_WIDTH,
  type RowActions,
} from "./LeftListRow";

interface Props {
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
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
  selectedKey,
  onSelect,
  rowActions,
  dropHighlight = false,
  dotToneFor,
  onRowViewed,
}: Props) {
  const [query, setQuery] = useState("");
  const [widths, setWidths] = useState<Record<ResizableColId, number>>(DEFAULT_WIDTHS);
  const [sort, setSort] = useState<{ col: SortColId; dir: SortDir }>({
    col: "year",
    dir: "desc",
  });

  // Hydrate from localStorage on mount (client-only — server render uses
  // the defaults so HTML is stable).
  useEffect(() => {
    setWidths(loadWidths());
    setSort(loadSort());
  }, []);

  // Keep a ref to the live widths so the resize-handler closure can read
  // the start width synchronously (state setter callbacks are async).
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

  const handleSort = useCallback((col: SortColId) => {
    setSort((cur) => {
      const next: { col: SortColId; dir: SortDir } =
        cur.col === col
          ? { col, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { col, dir: defaultDirFor(col) };
      saveSort(next);
      return next;
    });
  }, []);

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
          setWidths((cur) => {
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
            const next = { ...cur };
            let changed = false;
            if (leftCol) {
              const v = startLeftW + delta;
              if (cur[leftCol] !== v) { next[leftCol] = v; changed = true; }
            }
            if (rightCol) {
              const v = startRightW - delta;
              if (cur[rightCol] !== v) { next[rightCol] = v; changed = true; }
            }
            return changed ? next : cur;
          });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          saveWidths(widthsRef.current);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      };
    },
    [],
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
        </div>
        <div style={{ flexShrink: 0, width: ACTION_COL_WIDTH }} />
      </div>

      <div
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
                selected={selectedKey === key}
                gridTemplate={template}
                entryKey={key}
                onClick={() => {
                  onRowViewed(entry.citekey);
                  onSelect(selectedKey === key ? null : key);
                }}
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
