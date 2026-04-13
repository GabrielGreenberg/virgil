"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "./Editor";
import type { OrphanedFootnote, AiRequest } from "@/lib/types";
import ViewToggle from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { CARD_THEMES, EditableCard, PANEL, PanelHeader, PrevNextCounter, BadgeLabel, BadgeOrphaned, CardTitleInput, CardTargetIcon, TargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader, clearStaleHover, startTextDrag } from "./panel-primitives";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { MIME_FOOTNOTE } from "@/lib/marginalia";

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
  onEditOrphanTitle?: (id: string, title: string) => void;
  onAdd?: () => void;
  /** Lookup for rendering dropped/stored citations as formatted text. */
  getCitationDisplayText?: (command: string) => string;
  /** Called when the user drops a brand-new citation into a footnote. */
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  /** Unified AI request store + mutators (filtered to "footnote" kind). */
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  /** Called when the user edits a footnote's title. */
  onEditTitle?: (id: string, title: string) => void;
  /** Called with the Tiptap editor when a footnote body gains focus (for main toolbar routing). */
  onEditorFocus?: (editor: any) => void;
}

/* ── Shared helpers ──────────────────────────────────────────────── */

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
    MIME_FOOTNOTE,
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

/* ── FootnoteCard (anchored) ─────────────────────────────────────── */

export interface FootnoteCardProps {
  footnote: FootnoteInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
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
  onEditTitle,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: FootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );

  return (
    <EditableCard
      id={fn.footnoteId}
      selected={isSelected}
      theme={CARD_THEMES.footnote}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={<BadgeLabel label={fn.number} theme={CARD_THEMES.footnote} />}
      headerContent={<CardTitleInput defaultValue={fn.title} onChange={onEditTitle} theme={CARD_THEMES.footnote} />}
      headerTrailing={<CardTargetIcon selected={isSelected} onClick={() => onJump()} title="Jump to footnote marker" />}
      onClick={onSelect}
      onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content, false)}
      onTextDragStart={(e) => startTextDrag(e, fn.content)}
      onDelete={onDelete}
      value={fn.content}
      variant="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onDropArchive}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: fn.footnoteId }}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
    />
  );
}

/* ── OrphanedFootnoteCard ────────────────────────────────────────── */

export interface OrphanedFootnoteCardProps {
  orphan: OrphanedFootnote;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
}

export function OrphanedFootnoteCard({
  orphan,
  isSelected = false,
  onSelect,
  onEdit,
  onDelete,
  onEditTitle,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: OrphanedFootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );

  return (
    <EditableCard
      id={orphan.footnoteId}
      selected={isSelected}
      theme={CARD_THEMES.footnote}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={<BadgeOrphaned theme={CARD_THEMES.footnote} />}
      headerContent={<CardTitleInput defaultValue={orphan.title} onChange={onEditTitle} theme={CARD_THEMES.footnote} />}
      headerTrailing={<CardTargetIcon selected={false} disabled onClick={() => {}} />}
      onClick={onSelect}
      onDragStart={(e) => startFootnoteDrag(e, orphan.footnoteId, orphan.content, true)}
      onTextDragStart={(e) => startTextDrag(e, orphan.content)}
      onDelete={onDelete}
      value={orphan.content}
      variant="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onDropArchive}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: orphan.footnoteId }}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={`border-dashed${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      wrapperStyle={wrapperStyle}
    />
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
  onEditOrphanTitle,
  onAdd,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditTitle,
  onEditorFocus,
}: FootnotePanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "footnote"),
    [aiRequests],
  );
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

  // Arrow-key navigation — mirrors CitationsPanel's pattern so users can
  // step through anchored footnotes from the keyboard.
  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (footnotes.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cycleNext();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cyclePrev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [footnotes, cycleNext, cyclePrev],
  );

  const totalCount = footnotes.length + orphanedFootnotes.length;

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Footnotes"
        onAdd={onAdd}
        onAiRequest={onAddAiRequest}
      >
        <PrevNextCounter
          current={cycleIdx}
          total={footnotes.length}
          label=""
        />
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        tabIndex={0}
        onKeyDown={handleNavKeys}
        onClick={() => onSelect(null)}
        className={`${viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list} focus:outline-none`}
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
                  className={`group absolute left-0 right-0 px-1 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${
                    selectedId === fn.footnoteId
                      ? "bg-red-50/60 border-l-2 border-l-red-300 border-b-stone-300"
                      : "border-b-stone-300 hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => onSelect(selectedId === fn.footnoteId ? null : fn.footnoteId)}
                >
                  <div
                    className={`absolute top-1 right-1 transition-opacity ${
                      selectedId === fn.footnoteId
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-40 hover:!opacity-100"
                    }`}
                    draggable={false}
                    onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  >
                    <TargetIcon onClick={() => onScrollToMarker(fn.footnoteId)} title="Jump to footnote marker" />
                  </div>
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
            {myAiRequests.length > 0 && (
              <>
                <AiRequestsSectionHeader count={myAiRequests.length} />
                {myAiRequests.map((req) => (
                  <AiRequestCard
                    key={req.id}
                    request={req}
                    onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
                    onDelete={() => onDeleteAiRequest?.(req.id)}
                  />
                ))}
              </>
            )}

            {/* Unanchored footnotes are shown at the top of the list — their
                slash-mark "fn" badge already indicates the unanchored state,
                so no section heading is needed. */}
            {orphanedFootnotes.map((orphan) => (
              <OrphanedFootnoteCard
                key={orphan.footnoteId}
                orphan={orphan}
                isSelected={selectedId === orphan.footnoteId}
                onSelect={() => onSelect(selectedId === orphan.footnoteId ? null : orphan.footnoteId)}
                onEdit={(json) => onEditOrphan(orphan.footnoteId, json)}
                onDelete={() => onDeleteOrphan(orphan.footnoteId)}
                onEditTitle={(title) => onEditOrphanTitle?.(orphan.footnoteId, title)}
                onEditorFocus={onEditorFocus}
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
                onEditTitle={(title) => onEditTitle?.(fn.footnoteId, title)}
                onEditorFocus={onEditorFocus}
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
