"use client";

/**
 * Recent papers list shown on the empty state when no doc is open. Rows
 * sort by `lastAccessedAt` desc and clicking one calls `onOpen(id)` so
 * the parent (EditorLayout / useFiles) can activate the tab.
 *
 * `RecentPaperRow` is the ONE painter of a recent-paper row: the tab-strip
 * "+" dropdown (`TabPlusMenu`) renders it too, passing its menu primitive's
 * item props through (task 866 — the menu had hand-copied the row).
 *
 * Task 1102: a row can be FORGOTTEN. Given `onRemove`, the row grows a
 * hover-revealed "Remove from Recents" X — so a paper whose folder is gone can
 * be cleaned up without opening it. The X calls `useFiles.deleteFile`, which
 * drops the index row and never touches the disk. One painter, so both
 * consumers (start screen, "+" menu) get the same affordance.
 */

import type { FsaDocMeta } from "@/lib/doc-index";
import type { MenuItemProps } from "./menu/types";
import { menuRowRovingStyle } from "./menu/row-tone";
import { formatRelativeTime } from "@/lib/relative-time";
import { iconHint } from "@/components/Hint";
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
  /** Forget a paper (never deletes files). Omitted = no remove affordance. */
  onRemove?: (id: string) => void;
}

export function RecentPapersList({
  docs,
  onOpen,
  excludeIds,
  limit = RECENT_PAPERS_START_SCREEN_LIMIT,
  onRemove,
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
            <RecentPaperRow doc={doc} onOpen={onOpen} onRemove={onRemove} />
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
  onRemove,
  itemProps,
  active = false,
}: {
  doc: FsaDocMeta;
  onOpen?: (id: string) => void;
  onRemove?: (id: string) => void;
  itemProps?: MenuItemProps;
  active?: boolean;
}) {
  const row = <RecentPaperOpenButton doc={doc} onOpen={onOpen} itemProps={itemProps} active={active} />;
  if (!onRemove) return row;
  // The X is a SIBLING of the open button, never nested in it (a button in a
  // button is invalid and would also fire the open).
  return (
    <div className="group relative flex items-center">
      {row}
      <button
        type="button"
        className="iconbtn-xs absolute right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-[var(--background)]"
        data-testid="recent-paper-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(doc.id);
        }}
        {...iconHint({
          label: `Remove ${doc.name} from Recents`,
          hint: "Forgets the paper in Virgil. No files are deleted.",
        })}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3 L11 11" />
          <path d="M11 3 L3 11" />
        </svg>
      </button>
    </div>
  );
}

function RecentPaperOpenButton({
  doc,
  onOpen,
  itemProps,
  active,
}: {
  doc: FsaDocMeta;
  onOpen?: (id: string) => void;
  itemProps?: MenuItemProps;
  active: boolean;
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
        active ? { ...itemProps?.style, ...menuRowRovingStyle(true, false) } : itemProps?.style
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
