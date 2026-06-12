"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";
import {
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { MIME_FOOTNOTE } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

export function startFootnoteDrag(
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

export function onFootnoteArchiveConsumed(archiveId: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-consumed-archive", {
      detail: { archiveId },
    }),
  );
}

export interface FootnoteCardProps {
  footnote: FootnoteInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
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
  onTogglePopout,
  isPoppedOut,
}: FootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );
  const theme = useCardTheme("footnote");
  const popped = usePoppedCards();
  const cardKey = popKey("footnotes", fn.footnoteId);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "footnote", id: fn.footnoteId });
  const isExpanded = ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(fn.content, compressedLines) || "")
    : undefined;

  const card = (
    <EditableCard
      id={fn.footnoteId}
      cardKind="footnote"
      kind="footnote"
      kindLabelOverride={fn.thanks ? "Acknowledgement" : undefined}
      selected={isHaloed}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      footnoteBadge={<BadgeLabel label={fn.thanks ? "A" : fn.number} theme={theme} />}
      bodyTitle={fn.title}
      onBodyTitleChange={onEditTitle ?? undefined}
      canJump
      onJump={(e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
      onClick={(e) => {
        ac.onActivate();
        onSelect();
        if (onJump) {
          onJump((e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null);
        }
      }}
      onHoverChange={(h) => cardStore.setHover(h ? ac.ref : null)}
      onDelete={onDelete}
      value={fn.content}
      variant="footnote"
      panelKey="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onFootnoteArchiveConsumed}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: fn.footnoteId }}
      extraDataAttrs={{ "data-pristine-card-id": fn.footnoteId, "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={fn.content}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
  return card;
}

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
  const theme = useCardTheme("footnote");
  const compressedLines = useCompressedLines();
  const compressed = !isSelected;
  const compressedSummary = compressed
    ? (makeCompressedSummary(orphan.content, compressedLines) || "")
    : undefined;

  return (
    <EditableCard
      id={orphan.footnoteId}
      cardKind="footnote"
      kind="footnote"
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      footnoteBadge={<BadgeOrphaned theme={theme} />}
      bodyTitle={orphan.title}
      onBodyTitleChange={onEditTitle ?? undefined}
      onClick={onSelect}
      onDelete={onDelete}
      value={orphan.content}
      variant="footnote"
      panelKey="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onFootnoteArchiveConsumed}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: orphan.footnoteId }}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={orphan.content}
    />
  );
}
