"use client";

import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import {
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

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
  onJump?: (sourceEl: HTMLElement | null) => void;
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
  const ac = useAnchoredCard({ kind: "archive", id: snippet.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(snippet.content, compressedLines) || "")
    : undefined;
  const card = (
    <EditableCard
      id={snippet.id}
      cardKind="archive"
      kind="archive"
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      bodyTitle={snippet.title}
      onBodyTitleChange={(t) => onUpdateTitle(snippet.id, t)}
      canJump={isAnchored && !!onJump}
      onJump={onJump ? (e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null) : undefined}
      onClick={(e) => {
        ac.onActivate();
        onSelect(snippet.id);
        if (isAnchored && onJump) {
          onJump((e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null);
        }
      }}
      onHoverChange={(h) => cardStore.setHover(h ? ac.ref : null)}
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
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={snippet.content}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
  return card;
}
