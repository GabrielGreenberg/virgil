"use client";

import { useCallback } from "react";
import { bodyVariantForCardKind } from "@/cards/predicates";
import type { Editor, JSONContent } from "@tiptap/react";
import type { RevisionCommentCard as RevisionCommentCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { normalizeRichContent } from "@/lib/footnote-content";

export function RevisionCommentCard({
  card,
  selected,
  onUpdateContent,
  onSetAiRequest,
  onConvert,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  editor,
  extraDataAttrs,
}: {
  card: RevisionCommentCardData;
  selected: boolean;
  onUpdateContent: (id: string, content: JSONContent) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onConvert: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  editor?: Editor | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardTheme("revision");
  const isAnchored =
    getLinkedTextObjectIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const ac = useAnchoredCard({ kind: "revision-comment", id: card.id });
  const cardStore = useCardStore();
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const compressedSummary = compressed
    ? (makeCompressedSummary(card.content, compressedLines) || "")
    : undefined;

  void editor;
  void isOrphaned;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(card.id, normalizeRichContent(json));
    },
    [card.id, onUpdateContent],
  );

  // (Caret-into-body on create is now owned centrally by `finishCreate` →
  // `focusNewCard` (CHIP B). The hand-rolled select+empty focus effect that
  // used to live here is removed — the chokepoint expands + focuses the body
  // for every editable-body kind at creation, so this per-kind workaround is
  // redundant.)

  const cardEl = (
    <EditableCard
      id={card.id}
      cardKind="revision-comment"
      kind="revision-comment"
      kindOptions={["revision-comment", "revision-suggestion"]}
      onKindChange={(k) => {
        if (k !== "revision-comment") onConvert(card.id, "suggestion");
      }}
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      canJump={isAnchored && !isOrphaned && !!onJump}
      onJump={
        onJump && isAnchored && !isOrphaned
          ? (e) =>
              onJump(
                (e.currentTarget as HTMLElement).closest(
                  "[data-card]",
                ) as HTMLElement | null,
              )
          : undefined
      }
      onClick={(e) => {
        const el = (e?.currentTarget as HTMLElement | undefined)?.closest(
          "[data-card]",
        ) as HTMLElement | null;
        ac.onBodyActivate({
          onSelect: () => onSelect(card.id),
          jump: onJump && isAnchored && !isOrphaned ? () => onJump(el) : undefined,
        });
      }}
      onDelete={() => onDelete(card.id)}
      footer={
        !compressed ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={card.aiRequest}
              onToggle={(next) => onSetAiRequest(card.id, next)}
            />
          </div>
        ) : undefined
      }
      value={card.content}
      variant={bodyVariantForCardKind("revision-comment")}
      panelKey="revision"
      placeholder="Comment text…"
      onChange={handleChange}
      dataAttr={{ name: "revision-comment-entry", value: card.id }}
      extraDataAttrs={{
        "data-pristine-card-id": card.id,
        "data-card-key": cardKey,
        ...(extraDataAttrs || {}),
      }}
      onHoverChange={(h) => {
        cardStore.setHover(h ? ac.ref : null);
        onHoverChange?.(h);
      }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
  return cardEl;
}
