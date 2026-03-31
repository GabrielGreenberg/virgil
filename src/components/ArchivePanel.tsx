"use client";

import { useState, useCallback, memo } from "react";
import type { ArchivedSnippet } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onReanchor?: (id: string) => void;
  onScrollToMarker?: (id: string) => void;
  anchoredIds?: Set<string>;
}

function ArchivePanel({
  snippets,
  selectedId,
  onSelect,
  onInsert,
  onRestore,
  onDelete,
  onReanchor,
  onScrollToMarker,
  anchoredIds,
}: ArchivePanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => prev === id ? null : prev), 1500);
    });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, snippet: ArchivedSnippet) => {
    e.dataTransfer.setData("text/plain", snippet.text);
    e.dataTransfer.setData("application/x-virgil-archive-id", snippet.id);
    e.dataTransfer.effectAllowed = "move";
    // Custom drag image showing just the text
    const ghost = document.createElement("div");
    ghost.textContent = snippet.text.length > 80 ? snippet.text.slice(0, 80) + "\u2026" : snippet.text;
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#f5f5f4;border:1px solid #d6d3d1;border-radius:4px;font-size:12px;color:#44403c;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-700">
          Archived Text
          {snippets.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
              ({snippets.length})
            </span>
          )}
        </h3>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {snippets.length === 0 && (
          <div className="p-6 text-center text-[var(--muted)] text-sm">
            No archived text. Select text and use the menu to archive it.
          </div>
        )}

        {snippets.map((s) => {
          const orphaned = anchoredIds && !anchoredIds.has(s.id);
          const isAnchored = !orphaned;

          return (
            <div
              key={s.id}
              data-archive-entry={s.id}
              draggable
              onDragStart={(e) => handleDragStart(e, s)}
              className={`pl-1 pr-4 py-3 border-b transition-colors cursor-grab active:cursor-grabbing ${
                selectedId === s.id
                  ? "bg-amber-50 border-l-2 border-l-amber-400 border-b-stone-300"
                  : "border-b-stone-300 hover:bg-stone-50"
              }`}
              onClick={() => onSelect(selectedId === s.id ? null : s.id)}
            >
              <div className="flex items-start gap-2.5">
                {/* Anchor badge — top left, clickable to scroll to marker */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(s.id);
                    if (isAnchored) onScrollToMarker?.(s.id);
                  }}
                  className={`inline-flex items-center gap-0.5 shrink-0 mt-0.5 ${
                    isAnchored ? "cursor-pointer group" : "cursor-default"
                  }`}
                  title={orphaned ? "No anchor in document" : "Go to anchor in document"}
                >
                  {isAnchored && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                      className="text-[#7191b0] opacity-0 group-hover:opacity-100 transition-opacity order-first"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="6" x2="8" y2="6" />
                      <polyline points="5 3 8 6 5 9" />
                    </svg>
                  )}
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="14" height="14" rx="3"
                      stroke={orphaned ? "#b0b0b0" : "#7191b0"} strokeWidth="1.5"
                      fill={orphaned ? "#f5f5f4" : "#f0f5fa"}
                      className={isAnchored ? "group-hover:fill-[#dce8f3]" : ""}
                    />
                    <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="600"
                      fill={orphaned ? "#b0b0b0" : "#7191b0"}
                      fontFamily="var(--font-sans), sans-serif">A</text>
                    {orphaned && (
                      <line x1="3" y1="13" x2="13" y2="3"
                        stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                    )}
                  </svg>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="relative">
                    <p className={`text-sm text-stone-700 leading-relaxed whitespace-pre-wrap ${
                      expandedIds.has(s.id) ? "" : "line-clamp-4"
                    }`}
                       style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                      {s.text}
                    </p>
                    {s.text.length > 150 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(s.id); }}
                        className="absolute bottom-0 right-0 p-0.5 text-stone-400 hover:text-stone-600 transition-colors bg-gradient-to-l from-white via-white to-transparent pl-4"
                        title={expandedIds.has(s.id) ? "Collapse" : "Expand"}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: expandedIds.has(s.id) ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 ml-7">
                <span className="text-[10px] text-[var(--muted-light)] flex items-center gap-1.5">
                  {orphaned && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onReanchor?.(s.id); }}
                      className="inline-flex items-center justify-center text-[#7191b0] hover:text-[#4a6d8c] transition-colors"
                      title="Insert new anchor at cursor"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="7" y1="3" x2="7" y2="11" />
                        <line x1="3" y1="7" x2="11" y2="7" />
                      </svg>
                    </button>
                  )}
                  {new Date(s.createdAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
                <div className="flex gap-1.5 items-center">
                  {/* Copy button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopy(s.id, s.text); }}
                    className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedId === s.id ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onInsert(s.id); }}
                    className="text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-700 px-2 py-1 rounded border border-stone-200 transition-colors"
                    title="Insert at cursor and remove from archive"
                  >
                    Insert
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRestore(s.id); }}
                    className="text-xs text-[var(--accent)] bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded border border-stone-200 transition-colors"
                    title="Restore to marker position and remove from archive"
                  >
                    Restore
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                    className="text-xs text-red-400 bg-red-50 hover:bg-red-100 hover:text-red-600 px-2 py-1 rounded border border-red-200 transition-colors"
                    title="Permanently delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ArchivePanel);
