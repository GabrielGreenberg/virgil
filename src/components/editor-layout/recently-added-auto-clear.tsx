"use client";

import { useEffect } from "react";
import {
  useSelectionsContext,
  type SelectionsContextValue,
} from "./contexts/selections";
import { useRecentlyAddedContext } from "./contexts/recently-added";
import type {
  RecentlyAddedKind,
  RecentlyAddedTracker,
} from "@/hooks/useRecentlyAddedTracker";

/** The selection slots a pin can follow — every `selectedXId` field. */
export type RecentlyAddedSelectionSlot = {
  [K in keyof SelectionsContextValue]: K extends `selected${string}`
    ? SelectionsContextValue[K] extends string | null
      ? K
      : never
    : never;
}[keyof SelectionsContextValue];

/**
 * THE table "pin bucket → the selection slot that holds it" (task 975). A
 * total Record over `RecentlyAddedKind`, so a new pin bucket does not compile
 * without its clear rule — the old hand list of seven `useClearOnSelectionDrift`
 * rows silently missed `highlight` and `archive`, so a new highlight stayed
 * pinned atop the Notes panel forever and masked every later note's pin.
 *
 * Must agree with the setter `finishCreate` is handed for the same bucket
 * (`card-creation.ts`); `recently-added-slots.test.ts` pins that census.
 */
export const RECENTLY_ADDED_SELECTION_SLOT: Readonly<
  Record<RecentlyAddedKind, RecentlyAddedSelectionSlot>
> = {
  note: "selectedNoteId",
  // A highlight is a Notes-panel card, selected via `setSelectedNoteId`.
  highlight: "selectedNoteId",
  cutter: "selectedCutterCardId",
  reports: "selectedReportCardId",
  revision: "selectedCommentId",
  todo: "selectedTodoId",
  footnote: "selectedFootnoteId",
  archive: "selectedArchiveId",
  citation: "selectedCitationId",
};

const KINDS = Object.keys(RECENTLY_ADDED_SELECTION_SLOT) as RecentlyAddedKind[];

/**
 * Pure decision: which pinned buckets has the selection drifted away from?
 * A pin holds only while its slot still selects the pinned id.
 */
export function driftedRecentlyAddedKinds(
  pinned: Partial<Record<RecentlyAddedKind, string>>,
  selections: Pick<SelectionsContextValue, RecentlyAddedSelectionSlot>,
): RecentlyAddedKind[] {
  return KINDS.filter((kind) => {
    const id = pinned[kind];
    return !!id && selections[RECENTLY_ADDED_SELECTION_SLOT[kind]] !== id;
  });
}

/**
 * Single coordinator that releases the recently-added pin for any panel kind
 * whose selection has moved away from the pinned id. Mounted once under the
 * RecentlyAddedProvider; reads selections context, owns no state.
 *
 * The pin is set by `useCardCreation` next to `setSelectedXId(id)`, so right
 * after creation `selectedXId === recentlyAddedId` and the pin holds. The
 * moment the user picks another card or deselects, this clears the pin and
 * the panel sort drops the card to its natural position.
 */
export function RecentlyAddedAutoClear() {
  const tracker = useRecentlyAddedContext();
  const selections = useSelectionsContext();

  if (!tracker) return null;
  return <Effects tracker={tracker} selections={selections} />;
}

function Effects({
  tracker,
  selections,
}: {
  tracker: RecentlyAddedTracker;
  selections: SelectionsContextValue;
}) {
  useEffect(() => {
    for (const kind of driftedRecentlyAddedKinds(tracker.map, selections)) {
      tracker.clear(kind);
    }
  }, [tracker, selections]);
  return null;
}
