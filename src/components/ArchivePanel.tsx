"use client";

import { useState, useCallback, useMemo, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions, getArchiveMarkerPositions } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader, ItemMenu, MenuDelete, PrevNextCounter, TargetIcon, useCycle } from "./panel-primitives";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onScrollToMarker?: (id: string) => void;
  anchoredIds?: Set<string>;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
}

function ArchivePanel({
  snippets,
  selectedId,
  onSelect,
  onInsert,
  onRestore,
  onDelete,
  onScrollToMarker,
  anchoredIds,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
}: ArchivePanelProps) {
  const inTextItems = useMemo(
    () => getArchiveMarkerPositions(editor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, snippets]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, viewMode === "in-text"
  );

  // Anchored snippets in document order, for prev/next cycling
  const anchoredSnippets = useMemo(() => {
    if (!anchoredIds) return [];
    return snippets.filter((s) => anchoredIds.has(s.id));
  }, [snippets, anchoredIds]);

  const onActivateSnippet = useCallback(
    (s: ArchivedSnippet) => {
      onSelect(s.id);
      onScrollToMarker?.(s.id);
    },
    [onSelect, onScrollToMarker],
  );
  const { idx: cycleIdx, next: cycleNext, prev: cyclePrev, setIdx: setCycleIdx } =
    useCycle(anchoredSnippets, onActivateSnippet);

  // Sync external selection back to cycle index
  useEffect(() => {
    if (!selectedId) return;
    const i = anchoredSnippets.findIndex((s) => s.id === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, anchoredSnippets, cycleIdx, setCycleIdx]);
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
    const ghost = document.createElement("div");
    ghost.textContent = snippet.text.length > 80 ? snippet.text.slice(0, 80) + "\u2026" : snippet.text;
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#f5f5f4;border:1px solid #d6d3d1;border-radius:4px;font-size:12px;color:#44403c;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  // Anchor-only drag (orphaned snippets) — drops re-anchor the snippet at
  // the drop position without inserting any text.
  const handleAnchorDragStart = useCallback((e: React.DragEvent, snippet: ArchivedSnippet) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/x-virgil-archive-anchor-id", snippet.id);
    e.dataTransfer.effectAllowed = "link";
    const ghost = document.createElement("div");
    ghost.textContent = "\u2693 anchor";
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;padding:4px 8px;background:#f0f5fa;border:1px solid #a8c1d8;border-radius:4px;font-size:11px;color:#5a7a99;font-family:var(--font-sans),sans-serif;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Archived Text" count={snippets.length}>
        <PrevNextCounter
          current={cycleIdx}
          total={anchoredSnippets.length}
          onPrev={cyclePrev}
          onNext={cycleNext}
          label="anchored"
        />
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {snippets.length === 0 && (
          <div className={PANEL.empty}>
            No archived text. Select text and use the menu to archive it.
          </div>
        )}

        {viewMode === "in-text" && snippets.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {snippets.map((s) => {
              const top = positions.get(s.id);
              if (top === undefined) return null;
              const isSelected = selectedId === s.id;
              return (
                <div
                  key={s.id}
                  data-archive-entry={s.id}
                  className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${
                    isSelected
                      ? "bg-amber-50 border-l-2 border-l-amber-400 border-b-stone-300"
                      : "border-b-stone-300 hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => onSelect(isSelected ? null : s.id)}
                >
                  {isSelected && onScrollToMarker && (
                    <div className="absolute top-1 right-1">
                      <TargetIcon onClick={() => onScrollToMarker(s.id)} title="Jump to archive marker" />
                    </div>
                  )}
                  <p className="text-xs text-stone-600 leading-snug line-clamp-2 pr-6"
                    style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                    {s.text}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (

        snippets.map((s) => {
          const isSelected = selectedId === s.id;
          const orphaned = anchoredIds && !anchoredIds.has(s.id);
          const isAnchored = !orphaned;

          return (
            <div
              key={s.id}
              data-archive-entry={s.id}
              draggable
              onDragStart={(e) => handleDragStart(e, s)}
              className={panelCard(isSelected, "cursor-grab active:cursor-grabbing")}
              onClick={() => onSelect(isSelected ? null : s.id)}
            >
              <div className={PANEL.cardInner}>
                <div className="flex items-start gap-2.5">
                  {/* Top-right controls: target (when selected + anchored) + three-dot menu */}
                  <div className="absolute top-2 right-2 flex items-center gap-0.5">
                    {isSelected && isAnchored && onScrollToMarker && (
                      <TargetIcon onClick={() => onScrollToMarker(s.id)} title="Jump to archive marker" />
                    )}
                    <ItemMenu>
                      <MenuDelete onClick={() => onDelete(s.id)} />
                    </ItemMenu>
                  </div>
                  {/* Anchor badge — visual only for anchored; drag handle for orphaned (re-anchor on drop) */}
                  <span
                    draggable={orphaned}
                    onDragStart={orphaned ? (e) => handleAnchorDragStart(e, s) : undefined}
                    onClick={orphaned ? (e) => e.stopPropagation() : undefined}
                    className={`inline-flex items-center shrink-0 mt-0.5 ${
                      orphaned ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                    title={orphaned ? "Drag onto a paragraph to re-anchor" : "Archived snippet"}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="1" width="14" height="14" rx="3"
                        stroke={orphaned ? "#b0b0b0" : "#7191b0"} strokeWidth="1.5"
                        fill={orphaned ? "#f5f5f4" : "#f0f5fa"}
                      />
                      <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="600"
                        fill={orphaned ? "#b0b0b0" : "#7191b0"}
                        fontFamily="var(--font-sans), sans-serif">A</text>
                      {orphaned && (
                        <line x1="3" y1="13" x2="13" y2="3"
                          stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                      )}
                    </svg>
                  </span>

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

                <div className="flex items-center justify-end mt-2 ml-7">
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
                          <rect x="2" y="2" width="13" height="13" rx="2" />
                          <path d="M19 9h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-1" />
                        </svg>
                      )}
                    </button>
                    {isAnchored && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onInsert(s.id); }}
                        className="text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-700 px-2 py-1 rounded border border-stone-200 transition-colors"
                        title="Insert at cursor and remove from archive"
                      >
                        Insert
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRestore(s.id); }}
                      className="text-xs text-[var(--accent)] bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded border border-stone-200 transition-colors"
                      title={isAnchored
                        ? "Restore to marker position and remove from archive"
                        : "Insert at cursor and remove from archive"}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }))
        }
      </div>
    </div>
  );
}

export default memo(ArchivePanel);
