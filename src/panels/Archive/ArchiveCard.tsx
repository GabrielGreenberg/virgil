"use client";

import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import { EditableCard } from "@/components/panel-primitives";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";

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
  isPoppedOut?: boolean;
}) {
  const isAnchored = !orphaned;
  const theme = useCardKindTheme("archive");
  const handleEditContent = (json: JSONContent) => {
    onEdit(snippet.id, normalizeRichContent(json));
  };
  const { ac, compressed, compressedSummary, shell } = useAnchoredCardShell({
    kind: "archive",
    id: snippet.id,
    isPoppedOut,
    onSelect: () => onSelect(snippet.id),
    onJump: isAnchored ? onJump : undefined,
    summaryContent: snippet.content,
  });
  const isSelected = ac.selected || selected;
  const card = (
    <EditableCard
      {...shell}
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
      onDelete={() => onDelete(snippet.id)}
      value={snippet.content}
      variant={bodyVariantForCardKind("archive")}
      panelKey="archive"
      placeholder={cardBodyPlaceholder("archive")}
      onChange={handleEditContent}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "archive-entry", value: snippet.id }}
      extraDataAttrs={extraDataAttrs}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={snippet.content}
    />
  );
  return card;
}
