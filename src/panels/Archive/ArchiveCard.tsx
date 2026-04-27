"use client";

import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
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
import { normalizeRichContent } from "@/lib/footnote-content";
import { MIME_ARCHIVE_ANCHOR } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";

export function startArchiveDrag(e: React.DragEvent, archiveId: string) {
  e.dataTransfer.setData(
    MIME_ARCHIVE_ANCHOR,
    JSON.stringify({ archiveId }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function ArchiveCard({
  snippet,
  selected,
  orphaned,
  onSelect,
  onEdit,
  onUpdateTitle,
  onDelete,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
}: {
  snippet: ArchivedSnippet;
  selected: boolean;
  orphaned?: boolean;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onJump?: () => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const isAnchored = !orphaned;
  const theme = useCardTheme("archive");
  const popped = usePoppedCards();
  const cardKey = popKey("archive", snippet.id);
  const handleEditContent = (json: JSONContent) => {
    onEdit(snippet.id, normalizeRichContent(json));
  };
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const card = (
    <EditableCard
      id={snippet.id}
      selected={selected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={
        orphaned ? (
          <BadgeOrphaned theme={theme} />
        ) : (
          <BadgeLabel label="A" theme={theme} />
        )
      }
      headerContent={
        <CardTitleInput
          defaultValue={snippet.title}
          onChange={(t) => onUpdateTitle(snippet.id, t)}
          theme={theme}
        />
      }
      headerTrailing={
        isAnchored && onJump ? (
          <CardTargetIcon
            selected={selected}
            onClick={onJump}
            title="Jump to archive marker"
          />
        ) : orphaned ? (
          <CardTargetIcon selected={false} disabled onClick={() => {}} />
        ) : undefined
      }
      onClick={() => onSelect(selected ? null : snippet.id)}
      onDragStart={(e) => startArchiveDrag(e, snippet.id)}
      onTextDragStart={(e) => startTextDrag(e, snippet.content)}
      onDelete={() => onDelete(snippet.id)}
      value={snippet.content}
      variant="footnote"
      panelKey="archive"
      placeholder="Text here."
      onChange={handleEditContent}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "archive-entry", value: snippet.id }}
      extraDataAttrs={{ "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
