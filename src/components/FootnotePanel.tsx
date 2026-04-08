"use client";

import { useState, useCallback, useEffect, useMemo, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import type { OrphanedFootnote } from "@/lib/types";
import ViewToggle from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { PANEL, PanelHeader, ItemMenu, MenuDelete, PrevNextCounter, TargetIcon, useCycle } from "./panel-primitives";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import RichTextField from "./RichTextField";

interface FootnotePanelProps {
  footnotes: FootnoteInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, newContent: JSONContent) => void;
  onDelete: (id: string) => void;
  onScrollToMarker: (id: string) => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  orphanedFootnotes: OrphanedFootnote[];
  onDeleteOrphan: (id: string) => void;
  onEditOrphan: (id: string, newContent: JSONContent) => void;
  onAdd?: () => void;
  /** Lookup for rendering dropped/stored citations as formatted text. */
  getCitationDisplayText?: (command: string) => string;
  /** Called when the user drops a brand-new citation into a footnote. */
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
}

/* ── Shared helpers ──────────────────────────────────────────────── */

function footnoteCardClass(selected: boolean, extra?: string) {
  return `rounded-lg border transition-colors overflow-hidden ${
    selected
      ? "bg-[#b45757] border-[#9a3c3c] shadow-sm"
      : "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50"
  }${extra ? ` ${extra}` : ""}`;
}

function startFootnoteDrag(
  e: React.DragEvent,
  footnoteId: string,
  content: unknown,
  isOrphan: boolean,
) {
  const normalized = normalizeRichContent(content);
  const plain = richJsonToPlainText(normalized);
  e.dataTransfer.setData("text/plain", plain);
  e.dataTransfer.setData(
    "application/x-virgil-footnote",
    JSON.stringify({ footnoteId, content: normalized, isOrphan }),
  );
  e.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.textContent = plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#fef2f2;border:1px solid #b45757;border-radius:4px;font-size:12px;color:#7f1d1d;font-family:Georgia,serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 14);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

function onDropArchive(archiveId: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-consumed-archive", {
      detail: { archiveId },
    }),
  );
}

function CopyButton({
  content,
  selected,
}: {
  content: unknown;
  selected: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(richJsonToPlainText(content)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [content],
  );
  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition-colors ${selected ? "text-white/60 hover:text-white hover:bg-white/10" : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"}`}
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
  );
}

/* ── FootnoteCard (anchored) ─────────────────────────────────────── */

export interface FootnoteCardProps {
  footnote: FootnoteInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  /** Extra class names appended to the card wrapper (e.g. in-text view). */
  wrapperClassName?: string;
  /** Inline style on the card wrapper (used by in-text view positioning). */
  wrapperStyle?: React.CSSProperties;
  /** Extra data-* attributes on the card wrapper (e.g. data-omni-entry). */
  extraDataAttrs?: Record<string, string>;
}

export function FootnoteCard({
  footnote: fn,
  isSelected,
  onSelect,
  onJump,
  onEdit,
  onDelete,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: FootnoteCardProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );

  return (
    <div
      data-footnote-entry={fn.footnoteId}
      {...(extraDataAttrs || {})}
      draggable={!isFocused}
      onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content, false)}
      className={`${footnoteCardClass(isSelected, isFocused ? "cursor-default" : "cursor-grab active:cursor-grabbing")}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
      onClick={onSelect}
    >
      <div className={PANEL.cardInner}>
        <div className="flex items-start gap-2.5">
          {/* Top-right controls: target (when selected) + three-dot menu */}
          <div
            className="absolute top-2 right-2 flex items-center gap-0.5"
            draggable={false}
            onDragStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {isSelected && (
              <TargetIcon
                onClick={onJump}
                title="Jump to footnote marker"
                className="text-white/80 hover:text-white hover:bg-white/15"
              />
            )}
            <ItemMenu>
              <MenuDelete onClick={onDelete} />
            </ItemMenu>
          </div>
          {/* Number badge */}
          <span className="inline-flex items-center shrink-0 mt-0.5">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold transition-colors"
              style={{
                background: isSelected ? "rgba(255,255,255,0.25)" : "#fef2f2",
                color: isSelected ? "#fff" : "#b45757",
                border: isSelected
                  ? "1.5px solid rgba(255,255,255,0.5)"
                  : "1.5px solid #b45757",
              }}
            >
              {fn.number}
            </span>
          </span>

          <div className="flex-1 min-w-0">
            <RichTextField
              instanceKey={fn.footnoteId}
              value={fn.content}
              placeholder="Empty footnote"
              variant="footnote"
              selected={isSelected}
              onChange={handleEdit}
              onArchiveConsumed={onDropArchive}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
              onFocusChange={setIsFocused}
            />
          </div>
        </div>

        <div className="flex items-center justify-end mt-2 ml-6">
          <div className="flex gap-1.5 items-center">
            <CopyButton content={fn.content} selected={isSelected} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── OrphanedFootnoteCard ────────────────────────────────────────── */

export interface OrphanedFootnoteCardProps {
  orphan: OrphanedFootnote;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
}

export function OrphanedFootnoteCard({
  orphan,
  onEdit,
  onDelete,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: OrphanedFootnoteCardProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );

  return (
    <div
      data-footnote-entry={orphan.footnoteId}
      {...(extraDataAttrs || {})}
      draggable={!isFocused}
      onDragStart={(e) => startFootnoteDrag(e, orphan.footnoteId, orphan.content, true)}
      className={`${footnoteCardClass(false, `${isFocused ? "cursor-default" : "cursor-grab active:cursor-grabbing"} border-dashed`)}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
    >
      <div className={PANEL.cardInner}>
        <div className="flex items-start gap-2.5">
          <div
            className="absolute top-2 right-2"
            draggable={false}
            onDragStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <ItemMenu>
              <MenuDelete onClick={onDelete} />
            </ItemMenu>
          </div>
          {/* Orphan badge */}
          <span
            className="inline-flex items-center justify-center shrink-0 mt-0.5"
            title="No anchor in document"
          >
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
            <RichTextField
              instanceKey={orphan.footnoteId}
              value={orphan.content}
              placeholder="Empty — drag text in or type"
              variant="footnote"
              muted
              onChange={handleEdit}
              onArchiveConsumed={onDropArchive}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
              onFocusChange={setIsFocused}
            />
          </div>
        </div>

        <div className="flex items-center justify-end mt-2 ml-7">
          <div className="flex gap-1.5 items-center">
            <CopyButton content={orphan.content} selected={false} />
          </div>
        </div>
      </div>
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
  getCitationDisplayText,
  onCitationCreated,
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

  // Sync external selection back to cycle index — including deselect
  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = footnotes.findIndex((fn) => fn.footnoteId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, footnotes, cycleIdx, setCycleIdx]);

  const totalCount = footnotes.length + orphanedFootnotes.length;

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Footnotes" onAdd={onAdd}>
        <PrevNextCounter
          current={cycleIdx}
          total={footnotes.length}
          onPrev={cyclePrev}
          onNext={cycleNext}
          label=""
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
              const preview = richJsonToPlainText(fn.content);
              return (
                <div
                  key={fn.footnoteId}
                  data-footnote-entry={fn.footnoteId}
                  draggable
                  onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content, false)}
                  className={`absolute left-0 right-0 px-1 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${
                    selectedId === fn.footnoteId
                      ? "bg-red-50/60 border-l-2 border-l-[#b45757] border-b-stone-300"
                      : "border-b-stone-300 hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => onSelect(selectedId === fn.footnoteId ? null : fn.footnoteId)}
                >
                  {selectedId === fn.footnoteId && (
                    <div className="absolute top-1 right-1" draggable={false} onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                      <TargetIcon onClick={() => onScrollToMarker(fn.footnoteId)} title="Jump to footnote marker" />
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <span className="inline-flex items-center shrink-0 mt-0.5">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold"
                        style={{ background: "#fef2f2", color: "#b45757", border: "1.5px solid #b45757" }}>
                        {fn.number}
                      </span>
                    </span>
                    <p className="text-xs text-stone-600 leading-snug line-clamp-2 min-w-0"
                      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                      {preview || <span className="italic text-stone-400">Empty</span>}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Orphaned footnotes trail the positioned entries in in-text
                view. Each item carries the slash-mark badge so no heading
                is needed to distinguish them. */}
            {orphanedFootnotes.length > 0 && (
              <div className="absolute left-0 right-0 px-1 pr-4" style={{ top: (editorScrollHeight || 0) + 8 }}>
                {orphanedFootnotes.map((orphan) => {
                  const preview = richJsonToPlainText(orphan.content);
                  return (
                    <div
                      key={orphan.footnoteId}
                      data-footnote-entry={orphan.footnoteId}
                      draggable
                      onDragStart={(e) => startFootnoteDrag(e, orphan.footnoteId, orphan.content, true)}
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
            {/* Unanchored footnotes are shown at the top of the list — their
                slash-mark "fn" badge already indicates the unanchored state,
                so no section heading is needed. */}
            {orphanedFootnotes.map((orphan) => (
              <OrphanedFootnoteCard
                key={orphan.footnoteId}
                orphan={orphan}
                onEdit={(json) => onEditOrphan(orphan.footnoteId, json)}
                onDelete={() => onDeleteOrphan(orphan.footnoteId)}
                getCitationDisplayText={getCitationDisplayText}
                onCitationCreated={onCitationCreated}
              />
            ))}

            {footnotes.map((fn) => (
              <FootnoteCard
                key={fn.footnoteId}
                footnote={fn}
                isSelected={selectedId === fn.footnoteId}
                onSelect={() => onSelect(selectedId === fn.footnoteId ? null : fn.footnoteId)}
                onJump={() => onScrollToMarker(fn.footnoteId)}
                onEdit={(json) => onEdit(fn.footnoteId, json)}
                onDelete={() => onDelete(fn.footnoteId)}
                getCitationDisplayText={getCitationDisplayText}
                onCitationCreated={onCitationCreated}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(FootnotePanel);
