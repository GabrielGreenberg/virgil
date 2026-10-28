"use client";

import { dockedKeyboardJump, type DockedJumpGate } from "@/links/card-anchor-rows";
import type { CardMorphHandler } from "@/cards/types";
import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterGoal,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import { includedTotals, type CategoryCounts } from "@/lib/word-count-core";
import { PanelThemeMenuRow } from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CreationHint } from "@/panels/_shared/CreationHint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { cardTypeLabel } from "@/panels/panel-registry";
import { byCreatedAt, withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";
import { CutterGoalStrip } from "./CutterGoalStrip";
import type { SuggestionFieldUpdater } from "@/panels/_shared/suggestion-field-vocabulary";

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
  onConvertCard,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  jumpGate,
  editor,
  recentlyAddedId,
  wordCounts,
}: {
  cards: CutterCard[];
  goal: CutterGoal | null;
  onSetGoal: (target: number, currentWords: number) => void;
  onClearGoal: () => void;
  onAddComment: (anchorRect?: DOMRect) => CutterCommentCardData;
  onAddSuggestion: (anchorRect?: DOMRect) => CutterSuggestionCardData;
  onUpdateCommentContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onSetCommentAiRequest: (id: string, value: boolean) => void;
  onUpdateSuggestionField: SuggestionFieldUpdater;
  /* NO suggestion landing-verb props (task 684): Apply / Accept / Reject /
     Keep / Revert resolve from the `PendingChangeController` context inside the
     card, so this panel is no longer one of the places that has to remember to
     pass them — and omni + float, which never did, behave identically. */
  onConvertCard: CardMorphHandler;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: CutterCard, sourceEl?: HTMLElement | null) => void;
  /** Task 699: the ONE Jump gate (`cardJumpGate` over the pane's shared
   *  anchor pass). Required so no docked panel can fall back to gating Jump on
   *  "the card stores a link". */
  jumpGate: DockedJumpGate;
  editor?: Editor | null;
  recentlyAddedId?: string | null;
  /** The paper's word tallies — the SAME object EditorPane hands the Word
   *  Count panel (`wordCountHook.counts`, task 1342). The panel owns no
   *  counter of its own: it used to re-derive these through a second
   *  `useWordCount` (flag OFF — a duplicate whole-doc walk per typing pause)
   *  or a second pipeline subscription (flag ON), two owners of one fact. */
  wordCounts: CategoryCounts;
}) {
  // The cut goal counts what the Word Count panel counts — same tallies (one
  // owner, threaded from EditorPane), same include-set, one filter door
  // (task 122). It used to read the precomputed
  // unfiltered `counts.total`, so with the default config (comments OFF) a
  // document the panel called 10 words drove a goal measured against 15, and
  // the baseline `initialWords` this strip captures on first set was frozen
  // on that other ruler for the goal's whole life.
  const { config: wordCountConfig } = useWordCountConfig();
  const currentWords = includedTotals(wordCounts, wordCountConfig.include).words;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "suggestion"
        ? { kind: "suggestion", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "comment", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort(byCreatedAt);
    return withRecentlyAddedFirst(out, recentlyAddedId, (i) => i.id);
  }, [cards, recentlyAddedId]);

  const onAddOptions = useMemo(
    () => [
      { label: cardTypeLabel("cutter-comment"), onClick: (rect?: DOMRect) => onAddComment(rect) },
      { label: cardTypeLabel("cutter-suggestion"), onClick: (rect?: DOMRect) => onAddSuggestion(rect) },
    ],
    [onAddComment, onAddSuggestion],
  );

  // Keyboard activation (task 964): the shell selects; this jumps through the
  // card's own gate, the twin of its Jump button.
  const keyboardJump = useMemo(
    () => dockedKeyboardJump(jumpGate, onJumpToCard),
    [jumpGate, onJumpToCard],
  );

  return (
    <CardListPanel<Item>
      kind="cutter"
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <PanelThemeMenuRow keys={["cut"]} />
          <CardViewModeMenuItems kind="cutter" />
        </ItemMenu>
      }
      panelExtras={
        <CutterGoalStrip
          goal={goal}
          currentWords={currentWords}
          onSetGoal={onSetGoal}
          onClearGoal={onClearGoal}
        />
      }
      items={items}
      getId={(it) => it.id}
      getArchived={(it) => !!it.data.archived}
      selectedId={selectedId}
      onSelect={onSelect}
      onActivateItem={keyboardJump && ((it) => keyboardJump(it.data))}
      emptyState={
        <div className={PANEL.empty}>
          No comments or suggestions yet.
          <CreationHint action="cutter" />
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
