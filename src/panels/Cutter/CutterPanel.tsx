"use client";

import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterGoal,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useWordCount } from "@/hooks/useWordCount";
import {
  docProductsEnabled,
  useWordCountsProduct,
} from "@/lib/doc-products/use-doc-products";
import { getLinkedTextObjectIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { cardTypeLabel } from "@/panels/panel-registry";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";
import { CutterGoalStrip } from "./CutterGoalStrip";

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: CutterCommentCardData }
  | { kind: "suggestion"; id: string; createdAt: string; data: CutterSuggestionCardData };

export default function CutterPanel({
  cards,
  goal,
  onSetGoal,
  onClearGoal,
  onAddComment,
  onAddSuggestion,
  onUpdateCommentContent,
  onSetCommentAiRequest,
  onUpdateSuggestionField,
  onAcceptSuggestion,
  onRejectSuggestion,
  onApplySuggestion,
  onKeepSuggestion,
  onRevertSuggestion,
  onConvertCard,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  editor,
  recentlyAddedId,
}: {
  cards: CutterCard[];
  goal: CutterGoal | null;
  onSetGoal: (target: number, currentWords: number) => void;
  onClearGoal: () => void;
  onAddComment: (anchorRect?: DOMRect) => CutterCommentCardData;
  onAddSuggestion: (anchorRect?: DOMRect) => CutterSuggestionCardData;
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
  /** Pending-changes (flag-ON) client-side apply/keep/revert. */
  onApplySuggestion: (id: string) => void;
  onKeepSuggestion: (id: string) => void;
  onRevertSuggestion: (id: string) => void;
  onConvertCard: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: CutterCard, sourceEl?: HTMLElement | null) => void;
  editor?: Editor | null;
  recentlyAddedId?: string | null;
}) {
  // Flag-on (perf Wave 1) the pipeline's shared product replaces what used
  // to be a SECOND full useWordCount instance on the same editor (a
  // duplicate 47ms whole-doc walk per typing pause at 2,883 blocks).
  const { counts: legacyCounts } = useWordCount(
    docProductsEnabled ? null : (editor ?? null),
  );
  const productCounts = useWordCountsProduct(
    docProductsEnabled ? (editor ?? null) : null,
  );
  const counts = docProductsEnabled
    ? (productCounts ?? { total: 0, characters: 0, sentences: 0, readingTime: "0 min", categories: {}, characterCategories: {} })
    : legacyCounts;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "suggestion"
        ? { kind: "suggestion", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "comment", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return withRecentlyAddedFirst(out, recentlyAddedId, (i) => i.id);
  }, [cards, recentlyAddedId]);

  const onAddOptions = useMemo(
    () => [
      { label: cardTypeLabel("cutter-comment"), onClick: (rect?: DOMRect) => onAddComment(rect) },
      { label: cardTypeLabel("cutter-suggestion"), onClick: (rect?: DOMRect) => onAddSuggestion(rect) },
    ],
    [onAddComment, onAddSuggestion],
  );

  return (
    <CardListPanel<Item>
      kind="cutter"
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="cut" label="Cutter color" />
          </div>
          <CardViewModeMenuItems kind="cutter" />
        </ItemMenu>
      }
      panelExtras={
        <CutterGoalStrip
          goal={goal}
          currentWords={counts.total}
          onSetGoal={onSetGoal}
          onClearGoal={onClearGoal}
        />
      }
      items={items}
      getId={(it) => it.id}
      getArchived={(it) => !!it.data.archived}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No comments or suggestions yet. Click + to add one.
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "suggestion") {
          return (
            <CutterSuggestionCard
              card={it.data}
              selected={selected}
              onUpdateField={onUpdateSuggestionField}
              onConvert={onConvertCard}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
              onApply={onApplySuggestion}
              onKeep={onKeepSuggestion}
              onRevert={onRevertSuggestion}
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
          <CutterCommentCard
            card={it.data}
            selected={selected}
            editor={editor}
            onUpdateContent={onUpdateCommentContent}
            onConvert={onConvertCard}
            onSetAiRequest={onSetCommentAiRequest}
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
