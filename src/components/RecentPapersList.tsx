"use client";

/**
 * Recent papers list shown on the empty state when no doc is open. Rows
 * sort by `lastAccessedAt` desc and clicking one calls `onOpen(id)` so
 * the parent (EditorLayout / useFiles) can activate the tab.
 *
 * The same row visual is reused by the tab-strip "+" dropdown.
 */

import type { FsaDocMeta } from "@/lib/doc-index";
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

export function RecentPaperRow({
  doc,
  onOpen,
}: {
  doc: FsaDocMeta;
  onOpen: (id: string) => void;
}) {
  const subtitle =
    doc.folderName && doc.folderName !== doc.name ? doc.folderName : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(doc.id)}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover-on-light text-left"
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
        {formatRelative(doc.lastAccessedAt)}
      </span>
    </button>
  );
}

function FolderIcon() {
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}
