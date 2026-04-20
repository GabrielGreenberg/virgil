"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { UserNote } from "@/lib/types";
import {
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTitleInput,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";

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
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(note.id, normalizeRichContent(json));
    },
    [note.id, onUpdate],
  );

  const isOrphaned = getLinkedParagraphIds(note).length === 0;
  const theme = useCardTheme("note");
  const popped = usePoppedCards();
  const cardKey = popKey("notes", note.id);
  const isPoppedInCtx = popped?.isPopped(cardKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <EditableCard
      id={note.id}
      selected={selected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={
        isOrphaned ? (
          <BadgeOrphaned theme={theme} />
        ) : (
          <BadgeLabel label="N" theme={theme} />
        )
      }
      headerContent={
        <CardTitleInput
          defaultValue={note.title}
          onChange={(t) => onUpdateTitle(note.id, t)}
          theme={theme}
        />
      }
      headerTrailing={
        onJump ? (
          <CardTargetIcon
            selected={selected}
            onClick={onJump}
            title="Jump to note anchor"
          />
        ) : (
          <CardTargetIcon selected={false} disabled onClick={() => {}} />
        )
      }
      onClick={() => onSelect(selected ? null : note.id)}
      onDragStart={(e) => startNoteDrag(e, note.id)}
      onTextDragStart={(e) => startTextDrag(e, note.content, note.title)}
      onDelete={() => onDelete(note.id)}
      value={note.content}
      variant="footnote"
      placeholder="Text here."
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "note-entry", value: note.id }}
      extraDataAttrs={extraDataAttrs}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
