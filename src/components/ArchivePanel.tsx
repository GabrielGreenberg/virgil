"use client";

import { useState, useCallback, useMemo, useEffect, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions, getArchiveMarkerPositions } from "@/hooks/useInTextPositions";
import { CARD_THEMES, EditableCard, panelCard, PANEL, PanelHeader, ItemMenu, MenuDelete, PrevNextCounter, TargetIcon, useCycle } from "./panel-primitives";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { MIME_ARCHIVE, MIME_ARCHIVE_ANCHOR } from "@/lib/marginalia";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onScrollToMarker?: (id: string) => void;
  anchoredIds?: Set<string>;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
}

/* ── Shared helpers ──────────────────────────────────────────────── */

function startArchiveDrag(
  e: React.DragEvent,
  snippet: ArchivedSnippet,
) {
  const plain = richJsonToPlainText(snippet.content) || "";
  e.dataTransfer.setData("text/plain", plain);
  e.dataTransfer.setData("application/x-virgil-archive-id", snippet.id);
  e.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.textContent = plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#f5f5f4;border:1px solid #d6d3d1;border-radius:4px;font-size:12px;color:#44403c;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 14);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

function startAnchorDrag(e: React.DragEvent, snippetId: string) {
  e.stopPropagation();
  e.dataTransfer.setData("application/x-virgil-archive-anchor-id", snippetId);
  e.dataTransfer.effectAllowed = "link";
  const ghost = document.createElement("div");
  ghost.textContent = "\u2693 anchor";
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;padding:4px 8px;background:#f0f5fa;border:1px solid #a8c1d8;border-radius:4px;font-size:11px;color:#5a7a99;font-family:var(--font-sans),sans-serif;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

/* ── Archive action buttons footer ───────────────────────────────── */

function ArchiveFooter({
  snippetId,
  isAnchored,
  content,
  onInsert,
  onRestore,
}: {
  snippetId: string;
  isAnchored: boolean;
  content: unknown;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const plain = richJsonToPlainText(content) || "";
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <div className="flex items-center justify-end gap-1.5 px-3 pb-2">
      <button
        onClick={(e) => { e.stopPropagation(); handleCopy(); }}
        className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
        title="Copy to clipboard"
      >
        {copied ? (
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
          onClick={(e) => { e.stopPropagation(); onInsert(snippetId); }}
          className="text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-700 px-2 py-1 rounded border border-stone-200 transition-colors"
          title="Insert at cursor and remove from archive"
        >
          Insert
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRestore(snippetId); }}
        className="text-xs text-[var(--accent)] bg-[var(--accent-light)] hover:brightness-95 px-2 py-1 rounded border border-stone-200 transition-colors"
        title={isAnchored
          ? "Restore to marker position and remove from archive"
          : "Insert at cursor and remove from archive"}
      >
        Restore
      </button>
    </div>
  );
}

/* ── ArchivePanel ────────────────────────────────────────────────── */

function ArchivePanel({
  snippets,
  selectedId,
  onSelect,
  onEdit,
  onInsert,
  onRestore,
  onDelete,
  onScrollToMarker,
  anchoredIds,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
  getCitationDisplayText,
  onCitationCreated,
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
    e.dataTransfer.setData(MIME_ARCHIVE, snippet.id);
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
    e.dataTransfer.setData(MIME_ARCHIVE_ANCHOR, snippet.id);
    e.dataTransfer.effectAllowed = "link";
    const ghost = document.createElement("div");
    ghost.textContent = "\u2693 anchor";
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;padding:4px 8px;background:#f0f5fa;border:1px solid #a8c1d8;border-radius:4px;font-size:11px;color:#5a7a99;font-family:var(--font-sans),sans-serif;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Archived Text" count={snippets.length}>
        <PrevNextCounter
          current={cycleIdx}
          total={anchoredSnippets.length}
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
              const preview = richJsonToPlainText(s.content) || "";
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
                    {preview || <span className="italic text-stone-400">Empty</span>}
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

            const handleEditContent = (json: JSONContent) => {
              onEdit(s.id, normalizeRichContent(json));
            };

            return (
              <EditableCard
                key={s.id}
                id={s.id}
                selected={isSelected}
                theme={CARD_THEMES.archive}
                badge={
                  <span
                    draggable={orphaned}
                    onDragStart={orphaned ? (e) => startAnchorDrag(e, s.id) : undefined}
                    onClick={orphaned ? (e) => e.stopPropagation() : undefined}
                    className={`inline-flex items-center shrink-0 ${orphaned ? "cursor-grab active:cursor-grabbing" : ""}`}
                    title={orphaned ? "Drag onto a paragraph to re-anchor" : "Archived snippet"}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="1" width="14" height="14" rx="3"
                        stroke={orphaned ? "#b0b0b0" : "#7191b0"} strokeWidth="1.5"
                        fill={orphaned ? "#f5f5f4" : "#f0f5fa"} />
                      <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="600"
                        fill={orphaned ? "#b0b0b0" : "#7191b0"}
                        fontFamily="var(--font-sans), sans-serif">A</text>
                      {orphaned && (
                        <line x1="3" y1="13" x2="13" y2="3"
                          stroke="#b0b0b0" strokeWidth="1.5" strokeLinecap="round" />
                      )}
                    </svg>
                  </span>
                }
                headerTrailing={isSelected && isAnchored && onScrollToMarker
                  ? <TargetIcon onClick={() => onScrollToMarker(s.id)} title="Jump to archive marker" />
                  : undefined}
                onClick={() => onSelect(isSelected ? null : s.id)}
                onDragStart={(e) => startArchiveDrag(e, s)}
                onDelete={() => onDelete(s.id)}
                value={s.content}
                variant="footnote"
                placeholder="Empty archive snippet"
                onChange={handleEditContent}
                getCitationDisplayText={getCitationDisplayText}
                onCitationCreated={onCitationCreated}
                footer={
                  <ArchiveFooter
                    snippetId={s.id}
                    isAnchored={isAnchored}
                    content={s.content}
                    onInsert={onInsert}
                    onRestore={onRestore}
                  />
                }
                dataAttr={{ name: "archive-entry", value: s.id }}
                wrapperClassName={orphaned ? "border-dashed" : undefined}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(ArchivePanel);
