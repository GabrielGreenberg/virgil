"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote } from "@/lib/types";
import {
  EditableCard,
  AiRequestCheckbox,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

/** Top grab bar: anchor-only drag (no inline text insertion).
 *  NOTE: Do NOT set text/plain here — ProseMirror's default drop handler
 *  would insert it as inline text when the Editor's handleDrop returns
 *  false for anchor drags. */
export function startNoteDrag(e: React.DragEvent, noteId: string) {
  e.dataTransfer.setData(
    "application/x-virgil-note",
    JSON.stringify({ noteId }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function NoteCard({
  note,
  selected,
  onUpdate,
  onUpdateTitle,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: {
  note: UserNote;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSetAiRequest?: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(note.id, normalizeRichContent(json));
    },
    [note.id, onUpdate],
  );

  const ac = useAnchoredCard({ kind: "note", id: note.id });
  // ac.expanded drives open/closed (multi-card); ac.selected drives halo
  // (single primary). Keep the legacy `selected` prop accepted for back-
  // compat — it folds into both because parent panels derive it from the
  // same cardStore primary focus.
  const isExpanded = ac.expanded || selected;
  const isSelected = ac.selected || selected;
  // isOrphaned was previously surfaced as a BadgeOrphaned in the header;
  // unified-chrome cards have no badge so this state isn't rendered, but
  // we still compute it for the existing data-orphaned attribute callers.
  const _isOrphaned = getLinkedTextObjectIds(note).length === 0;
  void _isOrphaned;
  const theme = useCardTheme("note");
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(note.content, compressedLines) || "")
    : undefined;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("note", note.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const card = (
    <EditableCard
      id={note.id}
      cardKind="note"
      kind="note"
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      bodyTitle={note.title}
      onBodyTitleChange={(t) => onUpdateTitle(note.id, t)}
      canJump={!!onJump}
      onJump={onJump ? (e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null) : undefined}
      onClick={(e) => {
        cardStore.toggleSelection(ac.ref);
        if (!cardStore.isExpanded(ac.ref)) return;
        onSelect(note.id);
        if (onJump) {
          onJump((e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null);
        }
      }}
      onDelete={() => onDelete(note.id)}
      footer={
        onSetAiRequest && !compressed ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={!!note.aiRequest}
              onToggle={(next) => onSetAiRequest(note.id, next)}
            />
          </div>
        ) : undefined
      }
      value={note.content}
      variant="footnote"
      panelKey="note"
      placeholder="Text here."
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "note-entry", value: note.id }}
      extraDataAttrs={{ "data-pristine-card-id": note.id, "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      onHoverChange={(h) => { cardStore.setHover(h ? ac.ref : null); onHoverChange?.(h); }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  // Popped: AF's FloatHost wraps this body in a FloatWindow + FloatChrome; the
  // card renders headerless (chromeless). Docked: render inline.
  return card;
}
