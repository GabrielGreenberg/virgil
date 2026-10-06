"use client";

import { useCallback } from "react";
import { bodyVariantForCardKind } from "@/cards/predicates";
import type { JSONContent } from "@tiptap/react";
import type { UserNote } from "@/lib/types";
import { EditableCard } from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { canMorphNoteToHighlight } from "@/cards/morphs";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";

export function NoteCard({
  note,
  selected,
  onUpdate,
  onUpdateTitle,
  onConvert,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  isPoppedOut,
}: {
  note: UserNote;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  /** Morph this note ⇄ highlight via the kind-chevron (R14, bidirectional).
   *  note → highlight is lossy (drops the body); the host confirms first. */
  onConvert?: CardMorphHandler;
  onSetAiRequest?: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(note.id, normalizeRichContent(json));
    },
    [note.id, onUpdate],
  );

  // N1 (A4): the two axes are independent. ac.expanded drives open/closed
  // (multi-card); ac.selected drives the halo (single). The legacy `selected`
  // prop folds into SELECTION ONLY now — expansion is its own axis, never
  // derived from selection.
  const { ac, compressed, compressedSummary, shell } = useAnchoredCardShell({
    kind: "note",
    id: note.id,
    isPoppedOut,
    onSelect: () => onSelect(note.id),
    onJump,
    summaryContent: note.content,
  });
  const isSelected = ac.selected || selected;
  const theme = useCardKindTheme("note");

  // WS7 (A6): the note→highlight chevron is gated off for paragraph-only
  // Mode-A notes (and orphaned ones) — no text range, nothing to tint.
  // Covers docked AND omni (both render this component); the float's
  // CardKindHeader title slot is gated in cards/floats/index.tsx.
  const morphable = canMorphNoteToHighlight(note);

  const card = (
    <EditableCard
      {...shell}
      id={note.id}
      cardKind="note"
      kind="note"
      kindOptions={onConvert && morphable ? morphOptionsFor("note") : undefined}
      onKindChange={
        onConvert && morphable ? (k) => onConvert("note", note.id, k) : undefined
      }
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      bodyTitle={note.title}
      onBodyTitleChange={(t) => onUpdateTitle(note.id, t)}
      onDelete={() => onDelete(note.id)}
      aiRequest={
        onSetAiRequest
          ? { checked: !!note.aiRequest, onToggle: (next) => onSetAiRequest(note.id, next) }
          : undefined
      }
      value={note.content}
      variant={bodyVariantForCardKind("note")}
      panelKey="note"
      placeholder={cardBodyPlaceholder("note")}
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "note-entry", value: note.id }}
      extraDataAttrs={{ "data-pristine-card-id": note.id, ...(extraDataAttrs || {}) }}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  // Popped: AF's FloatHost wraps this body in a FloatWindow + FloatChrome; the
  // card renders headerless (chromeless). Docked: render inline.
  return card;
}
