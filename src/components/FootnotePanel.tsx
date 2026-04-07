"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import type { OrphanedFootnote } from "@/lib/types";
import ViewToggle from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { PANEL, PanelHeader, ItemMenu, MenuDelete, PrevNextCounter, useCycle } from "./panel-primitives";
import {
  normalizeFootnoteContent,
  footnoteHtmlToPlainText,
} from "@/lib/footnote-content";

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
  onAdd?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format toolbar (rich text controls for the contentEditable surface)
// ─────────────────────────────────────────────────────────────────────────────

function FormatToolbar({
  editorRef,
  isSelected,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
}) {
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const btnClass = isSelected
    ? "w-6 h-6 flex items-center justify-center rounded text-xs text-white/80 hover:bg-white/15 transition-colors"
    : "w-6 h-6 flex items-center justify-center rounded text-xs text-stone-600 hover:bg-stone-100 transition-colors";
  const dividerClass = isSelected
    ? "w-px h-4 bg-white/20 mx-0.5"
    : "w-px h-4 bg-[var(--border-light)] mx-0.5";

  return (
    <div
      className={`flex items-center gap-0.5 px-1 py-0.5 mb-1 border-b ${
        isSelected ? "border-white/20" : "border-[var(--border-light)]"
      }`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} className={`${btnClass} font-bold`} title="Bold">B</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} className={`${btnClass} italic`} title="Italic">I</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} className={`${btnClass} underline`} title="Underline">U</button>
      <div className={dividerClass} />
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
        className={btnClass}
        title="Bullet list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" />
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" />
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" />
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
        className={btnClass}
        title="Numbered list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <text x="0" y="5.5" fontSize="5" fontWeight="600">1</text>
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <text x="0" y="9.5" fontSize="5" fontWeight="600">2</text>
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <text x="0" y="13.5" fontSize="5" fontWeight="600">3</text>
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop helpers
// ─────────────────────────────────────────────────────────────────────────────

interface DropResult {
  insertion: string; // HTML to splice into the editor
  archiveIdToRemove?: string;
}

function buildDropInsertion(e: React.DragEvent): DropResult | null {
  // Footnotes refuse footnote-into-footnote drops.
  if (e.dataTransfer.types.includes("application/x-virgil-footnote")) {
    return null;
  }

  const archiveId = e.dataTransfer.getData("application/x-virgil-archive-id");
  const citationData = e.dataTransfer.getData("application/x-virgil-citation");
  const text = e.dataTransfer.getData("text/plain");

  if (citationData) {
    // Insert the citation as its raw LaTeX command — round-trips through
    // serialize/parse without needing a custom inline element type here.
    try {
      const { command } = JSON.parse(citationData);
      if (typeof command === "string" && command) {
        return { insertion: escapeHtml(command) };
      }
    } catch {
      /* fall through */
    }
  }

  if (archiveId && text) {
    return { insertion: escapeHtml(text), archiveIdToRemove: archiveId };
  }

  if (text) {
    return { insertion: escapeHtml(text) };
  }

  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Insert HTML at the current contentEditable selection (or append if no caret).
function insertHtmlAtSelection(host: HTMLDivElement, html: string) {
  host.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && host.contains(sel.anchorNode)) {
    document.execCommand("insertHTML", false, html);
    return;
  }
  // No live caret inside the host: append at the end.
  const range = document.createRange();
  range.selectNodeContents(host);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand("insertHTML", false, html);
}

// ─────────────────────────────────────────────────────────────────────────────
// FootnoteEditor (rich content surface used by both anchored and orphan cards)
// ─────────────────────────────────────────────────────────────────────────────

function FootnoteEditor({
  footnoteId,
  initialContent,
  isSelected,
  isOrphan,
  onChange,
  onDropArchive,
  onFocusChange,
}: {
  footnoteId: string;
  initialContent: string;
  isSelected: boolean;
  isOrphan: boolean;
  onChange: (html: string) => void;
  onDropArchive: (archiveId: string) => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isDragOver, setIsDragOver] = useState(false);

  // Sync the contentEditable host with the underlying footnote content. We
  // skip the sync while the user is actively typing — otherwise React would
  // clobber the caret on every debounced flush.
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    const desired = normalizeFootnoteContent(initialContent || "");
    if (editorRef.current.innerHTML !== desired) {
      editorRef.current.innerHTML = desired;
    }
  }, [footnoteId, initialContent]);

  const flush = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    onChange(html);
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flush, 300);
  }, [flush]);

  const handleFocus = useCallback(() => {
    onFocusChange?.(true);
  }, [onFocusChange]);

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    flush();
    onFocusChange?.(false);
  }, [flush, onFocusChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-virgil-footnote")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes("application/x-virgil-archive-id")
      ? "move"
      : "copy";
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // dragleave bubbles from children too — only clear when the cursor is
    // actually leaving the wrapper, not crossing into a descendant.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const result = buildDropInsertion(e);
      setIsDragOver(false);
      if (!result) return;
      e.preventDefault();
      e.stopPropagation();
      if (!editorRef.current) return;

      // If the host is empty, drop the placeholder paragraph first so the
      // caret has somewhere to land.
      if (editorRef.current.innerHTML === "" || editorRef.current.innerHTML === "<br>") {
        editorRef.current.innerHTML = "<p></p>";
      }
      insertHtmlAtSelection(editorRef.current, result.insertion);
      flush();

      if (result.archiveIdToRemove) {
        onDropArchive(result.archiveIdToRemove);
      }
    },
    [flush, onDropArchive],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={isDragOver ? "footnote-card-drop-target rounded" : undefined}
    >
      {isSelected && <FormatToolbar key="toolbar" editorRef={editorRef} isSelected />}
      <div
        key="editor"
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        // Prevent the parent card's drag handler from picking up internal selections.
        draggable={false}
        onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        className={`footnote-content-editor py-1 text-sm leading-relaxed focus:outline-none min-h-[2.5rem] ${
          isSelected ? "text-white" : isOrphan ? "text-stone-500" : "text-stone-700"
        }`}
        data-placeholder={isOrphan ? "Empty — drag text in or type" : "Empty footnote"}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FootnotePanel
// ─────────────────────────────────────────────────────────────────────────────

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
  onAdd,
}: FootnotePanelProps) {
  const inTextItems = useMemo(
    () => footnotes.map((fn) => ({ id: fn.footnoteId, pos: fn.pos })),
    [footnotes]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, viewMode === "in-text"
  );

  const onActivateFootnote = useCallback(
    (fn: FootnoteInfo) => {
      onSelect(fn.footnoteId);
      onScrollToMarker(fn.footnoteId);
    },
    [onSelect, onScrollToMarker],
  );
  const { idx: cycleIdx, next: cycleNext, prev: cyclePrev, setIdx: setCycleIdx } =
    useCycle(footnotes, onActivateFootnote);

  // Sync external selection back to cycle index
  useEffect(() => {
    if (!selectedId) return;
    const i = footnotes.findIndex((fn) => fn.footnoteId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, footnotes, cycleIdx, setCycleIdx]);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const handleCopy = useCallback((id: string, html: string) => {
    navigator.clipboard.writeText(footnoteHtmlToPlainText(html)).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => prev === id ? null : prev), 1500);
    });
  }, []);

  const handleEditAnchored = useCallback(
    (id: string, html: string) => {
      onEdit(id, normalizeFootnoteContent(html));
    },
    [onEdit],
  );

  const handleEditOrphanContent = useCallback(
    (id: string, html: string) => {
      onEditOrphan(id, normalizeFootnoteContent(html));
    },
    [onEditOrphan],
  );

  const onDropArchive = useCallback((archiveId: string) => {
    window.dispatchEvent(
      new CustomEvent("virgil-footnote-consumed-archive", {
        detail: { archiveId },
      }),
    );
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, footnoteId: string, html: string, isOrphan: boolean) => {
      const plain = footnoteHtmlToPlainText(html);
      e.dataTransfer.setData("text/plain", plain);
      e.dataTransfer.setData(
        "application/x-virgil-footnote",
        JSON.stringify({ footnoteId, content: html, isOrphan }),
      );
      e.dataTransfer.effectAllowed = "move";
      const ghost = document.createElement("div");
      ghost.textContent = plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#fef2f2;border:1px solid #b45757;border-radius:4px;font-size:12px;color:#7f1d1d;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [],
  );

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
      <PanelHeader title="Footnotes" count={totalCount} onAdd={onAdd}>
        <PrevNextCounter
          current={cycleIdx}
          total={footnotes.length}
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
              const preview = footnoteHtmlToPlainText(fn.content);
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
                      {preview || <span className="italic text-stone-400">Empty</span>}
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
                {orphanedFootnotes.map((orphan) => {
                  const preview = footnoteHtmlToPlainText(orphan.content);
                  return (
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
                          {preview}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (

        <>
        {footnotes.map((fn) => {
          const isSelected = selectedId === fn.footnoteId;
          const isFocused = focusedId === fn.footnoteId;

          return (
            <div
              key={fn.footnoteId}
              data-footnote-entry={fn.footnoteId}
              draggable={!isFocused}
              onDragStart={(e) => handleDragStart(e, fn.footnoteId, fn.content, false)}
              className={fnCard(isSelected, isFocused ? "cursor-default" : "cursor-grab active:cursor-grabbing")}
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
                    <FootnoteEditor
                      footnoteId={fn.footnoteId}
                      initialContent={fn.content}
                      isSelected={isSelected}
                      isOrphan={false}
                      onChange={(html) => handleEditAnchored(fn.footnoteId, html)}
                      onDropArchive={onDropArchive}
                      onFocusChange={(focused) => {
                        if (focused) setFocusedId(fn.footnoteId);
                        else setFocusedId((curr) => (curr === fn.footnoteId ? null : curr));
                      }}
                    />
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
            {orphanedFootnotes.map((orphan) => {
              const isFocused = focusedId === orphan.footnoteId;
              return (
              <div
                key={orphan.footnoteId}
                data-footnote-entry={orphan.footnoteId}
                draggable={!isFocused}
                onDragStart={(e) => handleDragStart(e, orphan.footnoteId, orphan.content, true)}
                className={fnCard(false, `${isFocused ? "cursor-default" : "cursor-grab active:cursor-grabbing"} border-dashed`)}
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
                      <FootnoteEditor
                        footnoteId={orphan.footnoteId}
                        initialContent={orphan.content}
                        isSelected={false}
                        isOrphan
                        onChange={(html) => handleEditOrphanContent(orphan.footnoteId, html)}
                        onDropArchive={onDropArchive}
                        onFocusChange={(focused) => {
                          if (focused) setFocusedId(orphan.footnoteId);
                          else setFocusedId((curr) => (curr === orphan.footnoteId ? null : curr));
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end mt-2 ml-7">
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
