"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import type { OrphanedFootnote } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { PANEL, PanelHeader, ItemMenu, MenuDelete } from "./panel-primitives";

interface FootnotePanelProps {
  footnotes: FootnoteInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, newContent: string) => void;
  onDelete: (id: string) => void;
  onScrollToMarker: (id: string) => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  orphanedFootnotes: OrphanedFootnote[];
  onDeleteOrphan: (id: string) => void;
  onEditOrphan: (id: string, newContent: string) => void;
  onReanchor?: (id: string) => void;
}

function FootnotePanel({
  footnotes,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onScrollToMarker,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
  orphanedFootnotes,
  onDeleteOrphan,
  onEditOrphan,
  onReanchor,
}: FootnotePanelProps) {
  const inTextItems = useMemo(
    () => footnotes.map((fn) => ({ id: fn.footnoteId, pos: fn.pos })),
    [footnotes]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, viewMode === "in-text"
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => prev === id ? null : prev), 1500);
    });
  }, []);

  const startEditing = useCallback((fn: FootnoteInfo) => {
    setEditingId(fn.footnoteId);
    setEditValue(fn.content);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingId) {
      if (orphanedFootnotes.some((o) => o.footnoteId === editingId)) {
        onEditOrphan(editingId, editValue);
      } else {
        onEdit(editingId, editValue);
      }
      setEditingId(null);
    }
  }, [editingId, editValue, onEdit, onEditOrphan, orphanedFootnotes]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editingId]);

  const handleDragStart = useCallback((e: React.DragEvent, footnoteId: string, content: string, isOrphan: boolean) => {
    e.dataTransfer.setData("text/plain", content);
    e.dataTransfer.setData("application/x-virgil-footnote", JSON.stringify({ footnoteId, content, isOrphan }));
    e.dataTransfer.effectAllowed = "move";
    const ghost = document.createElement("div");
    ghost.textContent = content.length > 80 ? content.slice(0, 80) + "\u2026" : content;
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#fef2f2;border:1px solid #b45757;border-radius:4px;font-size:12px;color:#7f1d1d;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  // Footnote-specific card class with prominent red selection
  const fnCard = (selected: boolean, extra?: string) =>
    `rounded-lg border transition-colors overflow-hidden ${
      selected
        ? "bg-[#b45757] border-[#9a3c3c] shadow-sm"
        : "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50"
    }${extra ? ` ${extra}` : ""}`;

  const totalCount = footnotes.length + orphanedFootnotes.length;

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Footnotes" count={totalCount}>
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {totalCount === 0 && (
          <div className={PANEL.empty}>
            No footnotes. Select text and use the toolbar to create one.
          </div>
        )}

        {viewMode === "in-text" && footnotes.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {footnotes.map((fn) => {
              const top = positions.get(fn.footnoteId);
              if (top === undefined) return null;
              return (
                <div
                  key={fn.footnoteId}
                  data-footnote-entry={fn.footnoteId}
                  draggable
                  onDragStart={(e) => handleDragStart(e, fn.footnoteId, fn.content, false)}
                  className={`absolute left-0 right-0 px-1 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${
                    selectedId === fn.footnoteId
                      ? "bg-red-50/60 border-l-2 border-l-[#b45757] border-b-stone-300"
                      : "border-b-stone-300 hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => onSelect(selectedId === fn.footnoteId ? null : fn.footnoteId)}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(fn.footnoteId); onScrollToMarker(fn.footnoteId); }}
                      className="inline-flex items-center shrink-0 mt-0.5"
                    >
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold"
                        style={{ background: "#fef2f2", color: "#b45757", border: "1.5px solid #b45757" }}>
                        {fn.number}
                      </span>
                    </button>
                    <p className="text-xs text-stone-600 leading-snug line-clamp-2 min-w-0"
                      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                      {fn.content || <span className="italic text-stone-400">Empty</span>}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Orphaned footnotes at bottom of in-text view */}
            {orphanedFootnotes.length > 0 && (
              <div className="absolute left-0 right-0 px-1 pr-4" style={{ top: (editorScrollHeight || 0) + 8 }}>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide font-medium px-1 pb-1">
                  Unanchored
                </div>
                {orphanedFootnotes.map((orphan) => (
                  <div
                    key={orphan.footnoteId}
                    data-footnote-entry={orphan.footnoteId}
                    draggable
                    onDragStart={(e) => handleDragStart(e, orphan.footnoteId, orphan.content, true)}
                    className="px-1 py-2 border-b border-b-stone-200 cursor-grab active:cursor-grabbing hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 mt-0.5">
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="1" width="14" height="14" rx="3"
                            stroke="#b0b0b0" strokeWidth="1.5" fill="#f5f5f4" />
                          <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="600"
                            fill="#b0b0b0" fontFamily="var(--font-sans), sans-serif">fn</text>
                          <line x1="3" y1="13" x2="13" y2="3"
                            stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </span>
                      <p className="text-xs text-stone-400 leading-snug line-clamp-2 min-w-0"
                        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                        {orphan.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (

        <>
        {footnotes.map((fn) => {
          const isEditing = editingId === fn.footnoteId;
          const isSelected = selectedId === fn.footnoteId;

          return (
            <div
              key={fn.footnoteId}
              data-footnote-entry={fn.footnoteId}
              draggable
              onDragStart={(e) => handleDragStart(e, fn.footnoteId, fn.content, false)}
              className={fnCard(isSelected, "cursor-grab active:cursor-grabbing")}
              onClick={() => onSelect(isSelected ? null : fn.footnoteId)}
            >
              <div className={PANEL.cardInner}>
                <div className="flex items-start gap-2.5">
                  {/* Three-dot menu */}
                  <div className="absolute top-2 right-2" draggable={false} onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                    <ItemMenu>
                      <MenuDelete onClick={() => onDelete(fn.footnoteId)} />
                    </ItemMenu>
                  </div>
                  {/* Number badge */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelect(fn.footnoteId); onScrollToMarker(fn.footnoteId); }}
                    draggable={false}
                    onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    className="inline-flex items-center gap-0.5 shrink-0 mt-0.5 cursor-pointer group"
                    title="Go to footnote in document"
                  >
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold transition-colors"
                      style={{
                        background: isSelected ? "rgba(255,255,255,0.25)" : "#fef2f2",
                        color: isSelected ? "#fff" : "#b45757",
                        border: isSelected ? "1.5px solid rgba(255,255,255,0.5)" : "1.5px solid #b45757",
                      }}
                    >
                      {fn.number}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                      className={`${isSelected ? "text-white/70" : "text-[#b45757]"} opacity-0 group-hover:opacity-100 transition-opacity order-first`}
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="6" x2="8" y2="6" />
                      <polyline points="5 3 8 6 5 9" />
                    </svg>
                  </button>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <textarea
                        ref={textareaRef}
                        className="w-full border border-[var(--border)] rounded px-2 py-1.5 text-sm resize-vertical focus:border-[#b45757] focus:outline-none"
                        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                        rows={3}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => { setTimeout(() => { if (editingId) commitEdit(); }, 100); }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") cancelEdit();
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                        }}
                      />
                    ) : (
                      <div className="relative">
                        <p
                          className={`text-sm leading-relaxed whitespace-pre-wrap cursor-text ${
                            isSelected ? "text-white" : "text-stone-700"
                          } ${expandedIds.has(fn.footnoteId) ? "" : "line-clamp-4"}`}
                          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                          onClick={(e) => { e.stopPropagation(); startEditing(fn); }}
                        >
                          {fn.content || <span className={`italic ${isSelected ? "text-white/60" : "text-stone-400"}`}>Empty footnote</span>}
                        </p>
                        {fn.content.length > 150 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(fn.footnoteId); }}
                            className={`absolute bottom-0 right-0 p-0.5 transition-colors pl-4 ${
                              isSelected
                                ? "text-white/60 hover:text-white bg-gradient-to-l from-[#b45757] via-[#b45757] to-transparent"
                                : "text-stone-400 hover:text-stone-600 bg-gradient-to-l from-white via-white to-transparent"
                            }`}
                            title={expandedIds.has(fn.footnoteId) ? "Collapse" : "Expand"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              style={{ transform: expandedIds.has(fn.footnoteId) ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end mt-2 ml-6">
                  <div className="flex gap-1.5 items-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(fn.footnoteId, fn.content); }}
                      className={`p-1 rounded transition-colors ${isSelected ? "text-white/60 hover:text-white hover:bg-white/10" : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"}`}
                      title="Copy to clipboard"
                    >
                      {copiedId === fn.footnoteId ? (
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
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Orphaned footnotes section */}
        {orphanedFootnotes.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <div className="text-[10px] text-stone-400 uppercase tracking-wide font-medium flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b0b0b0" strokeWidth="1.5" fill="none" />
                  <line x1="3" y1="13" x2="13" y2="3" stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Unanchored ({orphanedFootnotes.length})
              </div>
            </div>
            {orphanedFootnotes.map((orphan) => (
              <div
                key={orphan.footnoteId}
                data-footnote-entry={orphan.footnoteId}
                draggable
                onDragStart={(e) => handleDragStart(e, orphan.footnoteId, orphan.content, true)}
                className={fnCard(false, "cursor-grab active:cursor-grabbing border-dashed")}
              >
                <div className={PANEL.cardInner}>
                  <div className="flex items-start gap-2.5">
                    <div className="absolute top-2 right-2" draggable={false} onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                      <ItemMenu>
                        <MenuDelete onClick={() => onDeleteOrphan(orphan.footnoteId)} />
                      </ItemMenu>
                    </div>
                    {/* Orphan badge */}
                    <span className="inline-flex items-center justify-center shrink-0 mt-0.5" title="No anchor in document">
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                        <rect x="1" y="1" width="14" height="14" rx="3"
                          stroke="#b0b0b0" strokeWidth="1.5" fill="#f5f5f4" />
                        <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="600"
                          fill="#b0b0b0" fontFamily="var(--font-sans), sans-serif">fn</text>
                        <line x1="3" y1="13" x2="13" y2="3"
                          stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </span>

                    <div className="flex-1 min-w-0">
                      {editingId === orphan.footnoteId ? (
                        <textarea
                          ref={textareaRef}
                          className="w-full border border-[var(--border)] rounded px-2 py-1.5 text-sm resize-vertical focus:border-[#b45757] focus:outline-none"
                          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                          rows={3}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => { setTimeout(() => { if (editingId) commitEdit(); }, 100); }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") cancelEdit();
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                          }}
                        />
                      ) : (
                        <p
                          className="text-sm text-stone-500 leading-relaxed whitespace-pre-wrap cursor-text line-clamp-4"
                          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                          onClick={(e) => { e.stopPropagation(); setEditingId(orphan.footnoteId); setEditValue(orphan.content); }}
                        >
                          {orphan.content || <span className="italic text-stone-400">Empty — click to edit, then drag to place</span>}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2 ml-7">
                    <span className="text-[10px] text-[var(--muted-light)] flex items-center gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onReanchor?.(orphan.footnoteId); }}
                        className="inline-flex items-center justify-center text-[#b45757] hover:text-[#8b3a3a] transition-colors"
                        title="Insert at cursor position"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="7" y1="3" x2="7" y2="11" />
                          <line x1="3" y1="7" x2="11" y2="7" />
                        </svg>
                      </button>
                    </span>
                    <div className="flex gap-1.5 items-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopy(orphan.footnoteId, orphan.content); }}
                        className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedId === orphan.footnoteId ? (
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
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}

export default memo(FootnotePanel);
