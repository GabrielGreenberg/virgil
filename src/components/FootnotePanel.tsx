"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader } from "./panel-primitives";

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
      onEdit(editingId, editValue);
      setEditingId(null);
    }
  }, [editingId, editValue, onEdit]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editingId]);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Footnotes" count={footnotes.length}>
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {footnotes.length === 0 && (
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
                  className={`absolute left-0 right-0 px-1 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${
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
          </div>
        ) : (

        footnotes.map((fn) => {
          const isEditing = editingId === fn.footnoteId;
          const isSelected = selectedId === fn.footnoteId;

          return (
            <div
              key={fn.footnoteId}
              data-footnote-entry={fn.footnoteId}
              className={panelCard(isSelected, "cursor-pointer")}
              onClick={() => onSelect(isSelected ? null : fn.footnoteId)}
            >
              <div className={PANEL.cardInner}>
                <div className="flex items-start gap-2.5">
                  {/* Number badge — clickable to scroll to marker */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(fn.footnoteId);
                      onScrollToMarker(fn.footnoteId);
                    }}
                    className="inline-flex items-center gap-0.5 shrink-0 mt-0.5 cursor-pointer group"
                    title="Go to footnote in document"
                  >
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold transition-colors"
                      style={{
                        background: "#fef2f2",
                        color: "#b45757",
                        border: "1.5px solid #b45757",
                      }}
                    >
                      {fn.number}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                      className="text-[#b45757] opacity-0 group-hover:opacity-100 transition-opacity order-first"
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
                        onBlur={() => {
                          setTimeout(() => {
                            if (editingId) commitEdit();
                          }, 100);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") {
                            cancelEdit();
                          }
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            commitEdit();
                          }
                        }}
                      />
                    ) : (
                      <div className="relative">
                        <p
                          className={`text-sm text-stone-700 leading-relaxed whitespace-pre-wrap cursor-text ${
                            expandedIds.has(fn.footnoteId) ? "" : "line-clamp-4"
                          }`}
                          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                          onClick={(e) => { e.stopPropagation(); startEditing(fn); }}
                        >
                          {fn.content || <span className="italic text-stone-400">Empty footnote</span>}
                        </p>
                        {fn.content.length > 150 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(fn.footnoteId); }}
                            className="absolute bottom-0 right-0 p-0.5 text-stone-400 hover:text-stone-600 transition-colors bg-gradient-to-l from-white via-white to-transparent pl-4"
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
                      className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      {copiedId === fn.footnoteId ? (
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
                      onClick={(e) => { e.stopPropagation(); onDelete(fn.footnoteId); }}
                      className="text-xs text-red-400 bg-red-50 hover:bg-red-100 hover:text-red-600 px-2 py-1 rounded border border-red-200 transition-colors"
                      title="Delete footnote"
                    >
                      Delete
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

export default memo(FootnotePanel);
