"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";
import {
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTitleInput,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { MIME_FOOTNOTE } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";

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
  onJump: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: () => void;
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
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <EditableCard
      id={fn.footnoteId}
      selected={isSelected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={<BadgeLabel label={fn.number} theme={theme} />}
      headerContent={
        <CardTitleInput
          defaultValue={fn.title}
          onChange={onEditTitle}
          theme={theme}
        />
      }
      headerTrailing={
        <CardTargetIcon
          selected={isSelected}
          onClick={() => onJump()}
          title="Jump to footnote marker"
        />
      }
      onClick={onSelect}
      onDragStart={(e) => startFootnoteDrag(e, fn.footnoteId, fn.content, false)}
      onTextDragStart={(e) => startTextDrag(e, fn.content)}
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
      extraDataAttrs={{ "data-pristine-card-id": fn.footnoteId, ...(extraDataAttrs || {}) }}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
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

  return (
    <EditableCard
      id={orphan.footnoteId}
      selected={isSelected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={<BadgeOrphaned theme={theme} />}
      headerContent={
        <CardTitleInput
          defaultValue={orphan.title}
          onChange={onEditTitle}
          theme={theme}
        />
      }
      headerTrailing={<CardTargetIcon selected={false} disabled onClick={() => {}} />}
      onClick={onSelect}
      onDragStart={(e) =>
        startFootnoteDrag(e, orphan.footnoteId, orphan.content, true)
      }
      onTextDragStart={(e) => startTextDrag(e, orphan.content)}
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
    />
  );
}
