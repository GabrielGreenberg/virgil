"use client";

import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  RevisionCard,
  RevisionCommentCard as RevisionCommentCardData,
  RevisionsTracker,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { getLinkedTextObjectIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { RevisionCommentCard } from "./RevisionCommentCard";
import { RevisionSuggestionCard } from "./RevisionSuggestionCard";
import { RevisionsTrackerStrip } from "./RevisionsTracker";

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: RevisionCommentCardData }
  | { kind: "suggestion"; id: string; createdAt: string; data: RevisionSuggestionCardData };

export default function RevisionsPanel({
  cards,
  tracker,
  onSetTrackerTarget,
  onAddComment,
  onAddSuggestion,
  onUpdateCommentContent,
  onSetCommentAiRequest,
  onUpdateSuggestionField,
  onAcceptSuggestion,
  onRejectSuggestion,
  onConvertCard,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  editor,
  recentlyAddedId,
}: {
  cards: RevisionCard[];
  tracker: RevisionsTracker | null;
  onSetTrackerTarget: (target: number | null) => void;
  onAddComment: (anchorRect?: DOMRect) => RevisionCommentCardData;
  onAddSuggestion: (anchorRect?: DOMRect) => RevisionSuggestionCardData;
  onUpdateCommentContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onSetCommentAiRequest: (id: string, value: boolean) => void;
  onUpdateSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  onAcceptSuggestion: (id: string) => void;
  onRejectSuggestion: (id: string) => void;
  onConvertCard: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: RevisionCard, sourceEl?: HTMLElement | null) => void;
  editor?: Editor | null;
  recentlyAddedId?: string | null;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "suggestion"
        ? { kind: "suggestion", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "comment", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return withRecentlyAddedFirst(out, recentlyAddedId, (i) => i.id);
  }, [cards, recentlyAddedId]);

  const acceptedCount = useMemo(
    () =>
      cards.filter((c) => c.kind === "suggestion" && c.status === "accepted").length,
    [cards],
  );
  const suggestionCount = useMemo(
    () => cards.filter((c) => c.kind === "suggestion").length,
    [cards],
  );

  const onAddOptions = useMemo(
    () => [
      { label: "Comment", onClick: (rect?: DOMRect) => onAddComment(rect) },
      { label: "Revision", onClick: (rect?: DOMRect) => onAddSuggestion(rect) },
    ],
    [onAddComment, onAddSuggestion],
  );

  return (
    <CardListPanel<Item>
      kind="revisions"
      count={cards.length}
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="revision" label="Revisions color" />
          </div>
        </ItemMenu>
      }
      panelExtras={
        <RevisionsTrackerStrip
          tracker={tracker}
          acceptedCount={acceptedCount}
          totalCount={suggestionCount}
          onSetTarget={onSetTrackerTarget}
        />
      }
      items={items}
      getId={(it) => it.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No comments or revisions yet. Click + to add one.
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "suggestion") {
          return (
            <RevisionSuggestionCard
              card={it.data}
              selected={selected}
              onUpdateField={onUpdateSuggestionField}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
              onConvert={onConvertCard}
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={
                onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                  ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                  : undefined
              }
            />
          );
        }
        return (
          <RevisionCommentCard
            card={it.data}
            selected={selected}
            editor={editor}
            onUpdateContent={onUpdateCommentContent}
            onSetAiRequest={onSetCommentAiRequest}
            onConvert={onConvertCard}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                : undefined
            }
          />
        );
      }}
    />
  );
}
