"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { CutItem } from "@/lib/types";
import {
  CARD_THEMES,
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTitleInput,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { getLinkedParagraphIds, hasTextAnchor } from "@/links/links";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { MIME_CUT } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";

export function startCutDrag(e: React.DragEvent, cutId: string) {
  e.dataTransfer.setData(MIME_CUT, JSON.stringify({ cutId }));
  e.dataTransfer.effectAllowed = "copy";
}

export function CutCard({
  cut,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: {
  cut: CutItem;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => onUpdate(cut.id, normalizeRichContent(json)),
    [cut.id, onUpdate],
  );

  const isOrphaned = getLinkedParagraphIds(cut).length === 0 && !hasTextAnchor(cut);
  const popped = usePoppedCards();
  const cardKey = popKey("cutter", cut.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const card = (
    <EditableCard
      id={cut.id}
      selected={selected}
      theme={CARD_THEMES.cut}
      grabHandle
      hideToolbar
      inlineDelete
      badge={
        isOrphaned ? (
          <BadgeOrphaned theme={CARD_THEMES.cut} />
        ) : (
          <BadgeLabel label="C" theme={CARD_THEMES.cut} />
        )
      }
      headerContent={
        <CardTitleInput
          defaultValue={cut.title}
          onChange={(t) => onUpdateTitle(cut.id, t)}
          theme={CARD_THEMES.cut}
        />
      }
      headerTrailing={
        onJump ? (
          <CardTargetIcon
            selected={selected}
            onClick={(e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
            title="Jump to cut anchor"
          />
        ) : (
          <CardTargetIcon selected={false} disabled onClick={() => {}} />
        )
      }
      onClick={() => onSelect(selected ? null : cut.id)}
      onDragStart={(e) => startCutDrag(e, cut.id)}
      onTextDragStart={(e) => startTextDrag(e, cut.content, cut.title)}
      onDelete={() => onDelete(cut.id)}
      value={cut.content}
      variant="footnote"
      panelKey="cut"
      placeholder="Cut text…"
      onChange={handleChange}
      dataAttr={{ name: "cut-entry", value: cut.id }}
      extraDataAttrs={{ "data-pristine-card-id": cut.id, "data-card-key": cardKey }}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
