"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import type { FootnoteRef } from "@/lib/types";
import ViewToggle from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader, ItemMenu, MenuDelete } from "./panel-primitives";

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
  unanchoredFootnotes: FootnoteRef[];
  onCreateFootnote: (content: string) => void;
  onDeleteFromState: (id: string) => void;
}

/* ── Drag helper ─────────────────────────────────────────────── */

function startFootnoteDrag(e: React.DragEvent, id: string, content: string) {
  e.dataTransfer.setData("text/plain", content);
  e.dataTransfer.setData(
    "application/x-virgil-footnote",
    JSON.stringify({ footnoteId: id, content })
  );
  e.dataTransfer.effectAllowed = "copy";
  const ghost = document.createElement("div");
  const display = content || "Empty footnote";
  ghost.textContent = display.length > 60 ? display.slice(0, 60) + "\u2026" : display;
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fef2f2;border:1px solid #e8c4c4;border-radius:3px;font-size:12px;color:#b45757;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 14);
  requestAnimationFrame(() => document.body.removeChild(ghost));
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
  unanchoredFootnotes,
  onCreateFootnote,
  onDeleteFromState,
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newContent, setNewContent] = useState("");
  const newTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  const startEditing = useCallback((id: string, content: string) => {
    setEditingId(id);
    setEditValue(content);
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
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editingId]);

  useEffect(() => {
    if (showCreateForm) {
      setTimeout(() => newTextareaRef.current?.focus(), 50);
    }
  }, [showCreateForm]);

  const handleCreateSubmit = useCallback(() => {
    const text = newContent.trim();
    if (!text) return;
    onCreateFootnote(text);
    setNewContent("");
    setShowCreateForm(false);
  }, [newContent, onCreateFootnote]);

  const totalCount = footnotes.length + unanchoredFootnotes.length;

  /* ── Shared editing textarea ───────────────────────────────── */
  const renderEditArea = (id: string) => (
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
        if (e.key === "Escape") cancelEdit();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commitEdit();
        }
      }}
    />
  );

  /* ── Shared content display ────────────────────────────────── */
  const renderContent = (id: string, content: string) => (
    <div className="relative">
      <p
        className={`text-sm text-stone-700 leading-relaxed whitespace-pre-wrap cursor-text ${
          expandedIds.has(id) ? "" : "line-clamp-4"
        }`}
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        onClick={(e) => { e.stopPropagation(); startEditing(id, content); }}
      >
        {content || <span className="italic text-stone-400">Empty footnote</span>}
      </p>
      {content.length > 150 && (
        <button
          onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
          className="absolute bottom-0 right-0 p-0.5 text-stone-400 hover:text-stone-600 transition-colors bg-gradient-to-l from-white via-white to-transparent pl-4"
          title={expandedIds.has(id) ? "Collapse" : "Expand"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expandedIds.has(id) ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );

  /* ── Copy button ───────────────────────────────────────────── */
  const renderCopyBtn = (id: string, content: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy(id, content); }}
      className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
      title="Copy to clipboard"
    >
      {copiedId === id ? (
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
  );

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Footnotes" count={totalCount}>
        {/* Add footnote button */}
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="p-1 rounded hover:bg-stone-100 text-[var(--muted)] hover:text-stone-700 transition-colors"
          title="Create new footnote"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      {/* Creation form */}
      {showCreateForm && (
        <div className="px-3 py-2 border-b border-[var(--border)] bg-stone-50/50">
          <textarea
            ref={newTextareaRef}
            className="w-full border border-[var(--border)] rounded px-2 py-1.5 text-sm resize-vertical focus:border-[#b45757] focus:outline-none"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            rows={2}
            placeholder="Footnote text..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { setShowCreateForm(false); setNewContent(""); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleCreateSubmit(); }
            }}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button
              onClick={() => { setShowCreateForm(false); setNewContent(""); }}
              className="px-2 py-0.5 text-xs text-stone-500 hover:text-stone-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSubmit}
              disabled={!newContent.trim()}
              className="px-2.5 py-0.5 text-xs rounded transition-colors bg-[#b45757] text-white hover:bg-[#a04c4c] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {totalCount === 0 && !showCreateForm && (
          <div className={PANEL.empty}>
            No footnotes yet. Click + to create one, or select text and use the toolbar.
          </div>
        )}

        {/* ── In-text view (anchored only) ───────────────────── */}
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
                  onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content)}
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
          </div>
        ) : (
          <>
            {/* ── List view: anchored footnotes ──────────────── */}
            {footnotes.map((fn) => {
              const isEditing = editingId === fn.footnoteId;
              const isSelected = selectedId === fn.footnoteId;

              return (
                <div
                  key={fn.footnoteId}
                  data-footnote-entry={fn.footnoteId}
                  draggable
                  onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content)}
                  className={panelCard(isSelected, "cursor-grab active:cursor-grabbing")}
                  onClick={() => onSelect(isSelected ? null : fn.footnoteId)}
                >
                  <div className={PANEL.cardInner}>
                    <div className="flex items-start gap-2.5">
                      <div className="absolute top-2 right-2">
                        <ItemMenu>
                          <MenuDelete onClick={() => onDelete(fn.footnoteId)} />
                        </ItemMenu>
                      </div>
                      {/* Number badge */}
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
                        {isEditing ? renderEditArea(fn.footnoteId) : renderContent(fn.footnoteId, fn.content)}
                      </div>
                    </div>

                    <div className="flex items-center justify-end mt-2 ml-6">
                      <div className="flex gap-1.5 items-center">
                        {renderCopyBtn(fn.footnoteId, fn.content)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* ── Unanchored footnotes ────────────────────────── */}
            {unanchoredFootnotes.length > 0 && (
              <>
                {footnotes.length > 0 && (
                  <div className="px-3 py-1.5 flex items-center gap-2">
                    <div className="flex-1 border-t border-stone-200" />
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider">unanchored</span>
                    <div className="flex-1 border-t border-stone-200" />
                  </div>
                )}
                {unanchoredFootnotes.map((fn) => {
                  const isEditing = editingId === fn.id;
                  const isSelected = selectedId === fn.id;

                  return (
                    <div
                      key={fn.id}
                      data-footnote-entry={fn.id}
                      draggable
                      onDragStart={(e) => startFootnoteDrag(e, fn.id, fn.content)}
                      className={panelCard(isSelected, "cursor-grab active:cursor-grabbing")}
                      onClick={() => onSelect(isSelected ? null : fn.id)}
                    >
                      <div className={PANEL.cardInner}>
                        <div className="flex items-start gap-2.5">
                          <div className="absolute top-2 right-2">
                            <ItemMenu>
                              <MenuDelete onClick={() => onDeleteFromState(fn.id)} label="Delete" />
                            </ItemMenu>
                          </div>
                          {/* Unanchored badge — no number, grayed with strike */}
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 mt-0.5 relative"
                            style={{
                              background: "#f5f5f4",
                              border: "1.5px solid #b0b0b0",
                            }}
                            title="Not anchored in document — drag to editor to place"
                          >
                            <span className="text-[10px] font-semibold text-[#b0b0b0]">fn</span>
                            <svg className="absolute inset-0" width="20" height="20" viewBox="0 0 20 20">
                              <line x1="4" y1="16" x2="16" y2="4" stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </span>

                          <div className="flex-1 min-w-0">
                            {isEditing ? renderEditArea(fn.id) : renderContent(fn.id, fn.content)}
                          </div>
                        </div>

                        <div className="flex items-center justify-end mt-2 ml-6">
                          <div className="flex gap-1.5 items-center">
                            <span className="text-[10px] text-stone-400 italic">drag to anchor</span>
                            {renderCopyBtn(fn.id, fn.content)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(FootnotePanel);
