"use client";

/**
 * Recent papers list shown on the empty state when no doc is open. Rows
 * sort by `lastAccessedAt` desc and clicking one calls `onOpen(id)` so
 * the parent (EditorLayout / useFiles) can activate the tab.
 *
 * `RecentPaperRow` is the ONE painter of a recent-paper row: the tab-strip
 * "+" dropdown (`TabPlusMenu`) renders it too, passing its menu primitive's
 * item props through (task 866 — the menu had hand-copied the row).
 */

import type { FsaDocMeta } from "@/lib/doc-index";
import type { MenuItemProps } from "./menu/types";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  RECENT_PAPERS_START_SCREEN_LIMIT,
  selectRecentDocs,
} from "@/lib/recent-docs";

interface Props {
  docs: FsaDocMeta[];
  onOpen: (id: string) => void;
  /** Doc ids to exclude (e.g. tabs already open). */
  excludeIds?: string[];
  /**
   * How many rows to show. Defaults to this surface's own
   * `RECENT_PAPERS_START_SCREEN_LIMIT` (10) — the number is named there,
   * beside the rule that orders the rows, rather than spelled here.
   */
  limit?: number;
}

export function RecentPapersList({
  docs,
  onOpen,
  excludeIds,
  limit = RECENT_PAPERS_START_SCREEN_LIMIT,
}: Props) {
  const rows = selectRecentDocs(docs, { excludeIds, limit });

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col w-full">
      <div className="text-[11px] uppercase tracking-wide text-ink-subtle mb-2 px-1">
        Recent papers
      </div>
      <ul className="flex flex-col gap-0.5">
        {rows.map((doc) => (
          <li key={doc.id}>
            <RecentPaperRow doc={doc} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One recent paper: folder icon, name (+ folder subtitle when it differs),
 * and how long ago it was opened. Standalone (the start screen) it is a plain
 * button that calls `onOpen`. Inside a `<Menu>` the caller passes `itemProps`
 * — the primitive's `getItemProps()`, whose `onClick` runs the item — and
 * `active`, which paints the roving highlight.
 */
export function RecentPaperRow({
  doc,
  onOpen,
  itemProps,
  active = false,
}: {
  doc: FsaDocMeta;
  onOpen?: (id: string) => void;
  itemProps?: MenuItemProps;
  active?: boolean;
}) {
  const subtitle =
    doc.folderName && doc.folderName !== doc.name ? doc.folderName : null;
  return (
    <button
      {...itemProps}
      type="button"
      onClick={itemProps ? itemProps.onClick : () => onOpen?.(doc.id)}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover-on-light text-left"
      style={
        active
          ? { ...itemProps?.style, background: "var(--menu-roving-bg)" }
          : itemProps?.style
      }
    >
      <FolderIcon />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm text-ink-strong truncate">{doc.name}</span>
        {subtitle && (
          <span className="text-[11px] text-ink-subtle truncate">
            {subtitle}
          </span>
        )}
      </span>
      <span className="text-[11px] text-ink-subtle shrink-0">
        {formatRelativeTime(doc.lastAccessedAt)}
      </span>
    </button>
  );
}

/** The folder glyph — the recent row's, and the "+" menu's "Open folder…". */
export function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-subtle shrink-0"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}
