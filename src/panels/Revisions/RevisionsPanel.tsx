"use client";

import type { DockedJumpGate } from "@/links/card-anchor-rows";
import type { CardMorphHandler } from "@/cards/types";
import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  RevisionCard,
  RevisionRequestCard as RevisionRequestCardData,
  RevisionsTracker,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CreationHint } from "@/panels/_shared/CreationHint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { cardTypeLabel } from "@/panels/panel-registry";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { RevisionRequestCard } from "./RevisionRequestCard";
import { RevisionSuggestionCard } from "./RevisionSuggestionCard";
import { RevisionsTrackerStrip } from "./RevisionsTracker";

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: RevisionRequestCardData }
  | { kind: "suggestion"; id: string; createdAt: string; data: RevisionSuggestionCardData };

export default function RevisionsPanel({
  cards,
  tracker,
  onSetTrackerTarget,
  onAddRequest,
  onAddSuggestion,
  onUpdateCommentContent,
  onSetCommentAiRequest,
  onUpdateSuggestionField,
  onConvertCard,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  jumpGate,
  editor,
  recentlyAddedId,
}: {
  cards: RevisionCard[];
  tracker: RevisionsTracker | null;
  onSetTrackerTarget: (target: number | null) => void;
  onAddRequest: (anchorRect?: DOMRect) => RevisionRequestCardData;
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
  /* NO suggestion landing-verb props (task 684): Apply / Accept / Reject /
     Keep / Revert resolve from the `PendingChangeController` context inside the
     card, so this panel is no longer one of the places that has to remember to
     pass them — and omni + float, which never did, behave identically. */
  onConvertCard: CardMorphHandler;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: RevisionCard, sourceEl?: HTMLElement | null) => void;
  /** Task 699: the ONE Jump gate (`cardJumpGate` over the pane's shared
   *  anchor pass). Required so no docked panel can fall back to gating Jump on
   *  "the card stores a link". */
  jumpGate: DockedJumpGate;
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
      { label: cardTypeLabel("revision-comment"), onClick: (rect?: DOMRect) => onAddRequest(rect) },
      { label: cardTypeLabel("revision-suggestion"), onClick: (rect?: DOMRect) => onAddSuggestion(rect) },
    ],
    [onAddRequest, onAddSuggestion],
  );

  return (
    <CardListPanel<Item>
      kind="revisions"
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="revision" label="Revisions color" />
          </div>
          <CardViewModeMenuItems kind="revisions" />
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
      getArchived={(it) => !!it.data.archived}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No comments or revisions yet.
          <CreationHint action="suggest-edit" />
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "suggestion") {
          return (
            <RevisionSuggestionCard
              card={it.data}
              selected={selected}
              onUpdateField={onUpdateSuggestionField}
              onConvert={onConvertCard}
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={
                onJumpToCard
                  ? jumpGate(it.data).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(it.data, sourceEl))
                  : undefined
              }
            />
          );
        }
        return (
          <RevisionRequestCard
            card={it.data}
            selected={selected}
            editor={editor}
            onUpdateContent={onUpdateCommentContent}
            onSetAiRequest={onSetCommentAiRequest}
            onConvert={onConvertCard}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard
                ? jumpGate(it.data).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(it.data, sourceEl))
                : undefined
            }
          />
        );
      }}
    />
  );
}
