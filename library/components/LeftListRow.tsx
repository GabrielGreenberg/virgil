"use client";

import { useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { ENTRIES_DT_TYPE, ENTRY_DT_TYPE } from "@library/lib/dnd-types";
import { attachClampedDragGhost } from "@/lib/drag-ghost";
import { Dot, StatusPills } from "./StatusPill";
import RowActionMenu from "./RowActionMenu";

export interface RowActions {
  /** Behavior depends on the active library:
   *   - In Central: enqueue a true delete (caller is expected to have
   *     confirmed already).
   *   - In a custom library: just remove from that library's membership
   *     list — no confirm.
   *  The label switches accordingly via `deleteLabel`. */
  onDelete: (citekey: string) => void;
  onBibReview: (citekey: string) => void;
  onTextReview: (citekey: string) => void;
  /** Menu label for the destructive action — "Delete…" in Central,
   *  "Remove from library" in a custom library. */
  deleteLabel: string;
}

interface Props {
  entry: CatalogEntry;
  bib: BibEntry | undefined;
  selected: boolean;
  gridTemplate: string;
  /** Stable identifier — citekey for indexed entries, `__triage__<filename>`
   * for unsorted ones. Used as the dataTransfer payload when dragging the
   * row to another library. */
  entryKey: string;
  /** Full multi-select set (so a drag from a selected row can carry the
   *  whole selection). When the dragged row isn't in the set, the drag
   *  carries just `entryKey`. */
  selectedKeys: ReadonlySet<string>;
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
  actions: RowActions;
  /** Far-left request-state dot. Red = a queue request is outstanding for
   *  this citekey; green = a completion notification has fired and the
   *  user hasn't selected the row since. Null = no dot. */
  dotTone: "red" | "green" | null;
}

/** Width of the always-visible action-menu column on the right edge. */
export const ACTION_COL_WIDTH = 32;

/** Width of the always-visible request-state dot column on the left edge. */
export const STATUS_DOT_COL_WIDTH = 16;

export default function LeftListRow({ entry, bib, selected, gridTemplate, entryKey, selectedKeys, onClick, actions, dotTone }: Props) {
  // Bib wins over catalog: master.bib is the authoritative source for
  // bibliographic display fields. Catalog title/authors/year is a snapshot
  // taken at index time and can drift after /authenticate-bib runs.
  const title =
    bib?.fields.title ??
    entry.title ??
    entry.originalFilename ??
    "(untitled)";
  const firstAuthor = formatFirstAuthor(entry, bib);
  const year = bib?.fields.year ?? (entry.year != null ? String(entry.year) : "");
  const citekeyLabel = entry.citekey ?? "(triaging)";

  // The menu actions key off citekey, so triage rows (no citekey yet) get
  // a disabled menu — there's nothing to review or delete by name.
  const ck = entry.citekey;

  const [copied, setCopied] = useState(false);
  const handleCopyCitekey = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ck) return;
    try {
      await navigator.clipboard.writeText(ck);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        // Multi-row drag: if the grabbed row is part of the current
        // selection, carry every selected key. Otherwise the drag
        // operates on just this row, regardless of what else is
        // highlighted (matches Finder / VS Code behavior).
        const keys =
          selectedKeys.has(entryKey) && selectedKeys.size > 1
            ? Array.from(selectedKeys)
            : [entryKey];
        e.dataTransfer.setData(ENTRY_DT_TYPE, entryKey);
        e.dataTransfer.setData(ENTRIES_DT_TYPE, JSON.stringify(keys));
        // copy semantics — drops are additive, the source row stays put.
        e.dataTransfer.effectAllowed = "copy";
        const rowEl = e.currentTarget as HTMLElement;
        const rect = rowEl.getBoundingClientRect();
        attachClampedDragGhost({
          dragStartEvent: e,
          buildGhost: () => {
            const ghost = rowEl.cloneNode(true) as HTMLElement;
            ghost.style.width = `${rect.width}px`;
            ghost.style.background = "var(--surface, #ffffff)";
            ghost.style.border = "1px solid var(--border-light, #d5d3ce)";
            ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.18)";
            ghost.style.opacity = "0.92";
            ghost.style.borderRadius = "3px";
            if (keys.length > 1) {
              ghost.style.position = "relative";
              const badge = document.createElement("div");
              badge.textContent = String(keys.length);
              badge.style.cssText =
                "position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 6px;background:var(--accent,#7c5ed4);color:#fff;border-radius:9999px;font-size:10px;font-weight:600;line-height:18px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.25);";
              ghost.appendChild(badge);
            }
            return ghost;
          },
          cursorOffsetX: e.clientX - rect.left,
          cursorOffsetY: e.clientY - rect.top,
        });
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
      title={`${title}${firstAuthor ? ` — ${firstAuthor}` : ""}${year ? ` (${year})` : ""}`}
      style={{
        display: "flex",
        alignItems: "stretch",
        width: "100%",
        textAlign: "left",
        background: selected ? "var(--accent-light)" : "transparent",
        borderBottom: "1px solid var(--border-light)",
        boxShadow: selected ? "inset 2px 0 0 var(--accent)" : "none",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: "20px",
        minHeight: 28,
        boxSizing: "border-box",
      }}
    >
      {/* Far-left request-state dot. Mirrors the right-edge action-menu
          column — fixed-width flex sibling outside the resizable grid so
          the column resize math stays untouched. */}
      <div
        style={{
          flexShrink: 0,
          width: STATUS_DOT_COL_WIDTH,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {dotTone && (
          <Dot
            tone={dotTone}
            title={
              dotTone === "red"
                ? "Request pending — waiting for Claude"
                : "New result — click to mark as seen"
            }
          />
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          padding: "4px 0",
        }}
      >
        {/* year */}
        <span
          style={{
            color: "var(--muted)",
            textAlign: "left",
            paddingLeft: 8,
            paddingRight: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {year || "—"}
        </span>
        <Spacer />
        {/* author */}
        <Cell>
          <span
            style={{
              color: "var(--foreground)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              paddingLeft: 8,
            }}
          >
            {firstAuthor || "—"}
          </span>
        </Cell>
        <Spacer />
        {/* title */}
        <Cell>
          <span
            style={{
              color: "var(--foreground)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              paddingLeft: 8,
            }}
          >
            {title}
          </span>
        </Cell>
        <Spacer />
        {/* status */}
        <Cell>
          <span style={{ display: "block", paddingLeft: 8 }}>
            <StatusPills
              pdfPresent={entry.pdf.present}
              indexed={entry.indexed.state}
              bib={entry.bib.state}
            />
          </span>
        </Cell>
        <Spacer />
        {/* citekey + copy button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minWidth: 0,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--accent)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            {citekeyLabel}
          </code>
          {ck && (
            <button
              type="button"
              className="iconbtn-sm"
              aria-label="Copy citekey"
              title={copied ? "Copied" : "Copy citekey"}
              draggable={false}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleCopyCitekey}
              style={{ flexShrink: 0 }}
            >
              {copied ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="2.5,6.5 5,9 9.5,3.5" />
                </svg>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
                  <path d="M2 8V2.5A1 1 0 0 1 3 1.5h5.5" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      {/* Always-visible action-menu column. Stays pinned on the right
          regardless of how compressed the grid is — it's a flex sibling
          with `flex-shrink: 0`, not a grid track, so it isn't clipped
          when the fixed columns overflow. */}
      <div
        style={{
          flexShrink: 0,
          width: ACTION_COL_WIDTH,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RowActionMenu
          disabled={!ck}
          deleteLabel={actions.deleteLabel}
          onDelete={() => ck && actions.onDelete(ck)}
          onBibReview={() => ck && actions.onBibReview(ck)}
          onTextReview={() => ck && actions.onTextReview(ck)}
        />
      </div>
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minWidth: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function Spacer() {
  // Empty cell that occupies the grid track corresponding to a header
  // resizer, so headers and rows stay aligned.
  return <div />;
}

function formatFirstAuthor(entry: CatalogEntry, bib: BibEntry | undefined): string {
  let raw = "";
  let total = 0;
  let isEditor = false;

  if (bib?.fields.author) {
    const parts = bib.fields.author.split(" and ");
    raw = parts[0];
    total = parts.length;
  } else if (bib?.fields.editor) {
    const parts = bib.fields.editor.split(" and ");
    raw = parts[0];
    total = parts.length;
    isEditor = true;
  } else if (entry.authors && entry.authors.length > 0) {
    raw = entry.authors[0];
    total = entry.authors.length;
  }

  raw = raw.trim();
  if (!raw) return "";

  let surname: string;
  if (raw.includes(",")) {
    surname = raw.split(",", 1)[0].trim();
  } else {
    const words = raw.split(/\s+/);
    surname = words[words.length - 1];
  }

  if (isEditor) {
    return total > 1 ? `${surname} et al. (eds.)` : `${surname} (ed.)`;
  }
  return total > 1 ? `${surname} et al.` : surname;
}
