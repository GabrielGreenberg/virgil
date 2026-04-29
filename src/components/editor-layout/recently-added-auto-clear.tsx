"use client";

import { useEffect } from "react";
import { useSelectionsContext } from "./contexts/selections";
import { useRecentlyAddedContext } from "./contexts/recently-added";
import type { RecentlyAddedKind } from "@/hooks/useRecentlyAddedTracker";

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
  tracker: NonNullable<ReturnType<typeof useRecentlyAddedContext>>;
  selections: ReturnType<typeof useSelectionsContext>;
}) {
  useClearOnSelectionDrift(tracker, "note", selections.selectedNoteId);
  useClearOnSelectionDrift(tracker, "cutter", selections.selectedCutterCardId);
  useClearOnSelectionDrift(tracker, "revision", selections.selectedCommentId);
  useClearOnSelectionDrift(tracker, "todo", selections.selectedTodoId);
  useClearOnSelectionDrift(tracker, "footnote", selections.selectedFootnoteId);
  useClearOnSelectionDrift(
    tracker,
    "quotation",
    selections.selectedQuotationGroupId,
  );
  useClearOnSelectionDrift(tracker, "citation", selections.selectedCitationId);
  return null;
}

function useClearOnSelectionDrift(
  tracker: NonNullable<ReturnType<typeof useRecentlyAddedContext>>,
  kind: RecentlyAddedKind,
  selectedId: string | null,
) {
  const pinnedId = tracker.getId(kind);
  useEffect(() => {
    if (pinnedId && selectedId !== pinnedId) {
      tracker.clear(kind);
    }
  }, [tracker, kind, pinnedId, selectedId]);
}
