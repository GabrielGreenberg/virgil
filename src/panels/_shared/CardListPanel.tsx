/**
 * Cardful panel variant.
 *
 * Owns iteration of the items array and the optional Pending-AI-Requests
 * section above the items. Does NOT own keyboard cycling or selection —
 * those vary too much per panel and stay inline (`useCycle` +
 * `PrevNextCounter` are passed via `headerExtras`).
 *
 * `selectedId` is controlled by the panel; clicking the empty list area
 * calls `onSelect(null)` so panels don't have to wire that themselves.
 */

import { Fragment, useCallback, useEffect, type ReactNode } from "react";
import type { AiRequest } from "@/lib/types";
import {
  AiRequestCard,
  AiRequestsSectionHeader,
} from "@/components/panel-primitives";
import {
  CardDisplayProvider,
  DOCKED_COMPRESSED_LINES,
} from "@/components/editor-layout/contexts/card-display";
import { Panel } from "./Panel";
import type { PanelKind } from "./types";
import { useCardArchiveView, filterByArchiveView } from "./card-archive-view";

export interface CardListPanelProps<T> {
  kind: PanelKind;

  items: T[];
  getId: (item: T) => string;
  /** When provided, CardListPanel filters `items` by the panel's archive view
   *  mode (View Active / Archives / All from the three-dot menu), reading each
   *  item's `archived` flag through this accessor. Omit for panels with no
   *  archivable cards — they render every item as before. */
  getArchived?: (item: T) => boolean;
  /** Render a single card. CardListPanel handles the React `key` via a
   *  Fragment wrapper, so the returned node should be the card directly
   *  (no need to set `key`). */
  renderCard: (item: T, ctx: { selected: boolean; index: number }) => ReactNode;

  selectedId: string | null;
  onSelect: (id: string | null) => void;

  /** Optional empty-state. Rendered when items is empty AND there are no
   *  pending AI requests. */
  emptyState?: ReactNode;

  /** Pre-filtered AI requests for this panel (caller filters by kind).
   *  Rendered above items. */
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;

  /** Optional content rendered inside the list scroll body, after the
   *  items. Used by Bibliography for its pending-entry-requests block. */
  listTrailing?: ReactNode;

  // ── Pass-through Panel slots ──
  title?: string;
  count?: number;
  onAdd?: (anchorRect?: DOMRect) => void;
  /** When provided, the "+" button opens a small dropdown of choices
   *  instead of firing `onAdd`. Used by panels hosting more than one
   *  card kind (Cutter: Comment / Suggestion). Each option's `onClick`
   *  receives the trigger button's bounding rect. */
  onAddOptions?: { label: string; onClick: (anchorRect?: DOMRect) => void }[];
  headerLeading?: ReactNode;
  headerExtras?: ReactNode;
  panelExtras?: ReactNode;
  footer?: ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  scrollTabIndex?: number;
}

export function CardListPanel<T>({
  kind,
  items,
  getId,
  getArchived,
  renderCard,
  selectedId,
  onSelect,
  emptyState,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  listTrailing,
  title,
  count,
  onAdd,
  onAddOptions,
  headerLeading,
  headerExtras,
  panelExtras,
  footer,
  scrollRef,
  onKeyDown,
  scrollTabIndex,
}: CardListPanelProps<T>) {
  const handleEmptyClick = useCallback(() => onSelect(null), [onSelect]);
  const hasAiRequests = aiRequests && aiRequests.length > 0;

  // Archive view: filter the list by the panel's current mode (active /
  // archived / all). When `getArchived` is omitted the panel has no archivable
  // cards, so every item shows. Pure derivation — recomputes only when items or
  // the mode change (an archive toggle / view switch), never on a keystroke
  // (the `archived` flag lives in sidecar state, not the doc).
  const { getView } = useCardArchiveView();
  const view = getView(kind);
  const visibleItems = getArchived
    ? filterByArchiveView(items, view, getArchived)
    : items;
  // The header badge reflects what's actually shown in the current view.
  const shownCount = getArchived ? visibleItems.length : count;

  // If the selected card is filtered out of the current view (e.g. it was just
  // archived, or the user switched to View Active while an archived card was
  // selected), drop the selection so no hidden card stays "selected".
  useEffect(() => {
    if (!getArchived || selectedId == null) return;
    if (!visibleItems.some((it) => getId(it) === selectedId)) onSelect(null);
  }, [getArchived, selectedId, visibleItems, getId, onSelect]);

  const aiRequestsSection = hasAiRequests ? (
    <>
      <AiRequestsSectionHeader count={aiRequests!.length} />
      {aiRequests!.map((req) => (
        <AiRequestCard
          key={req.id}
          request={req}
          onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
          onDelete={() => onDeleteAiRequest?.(req.id)}
        />
      ))}
    </>
  ) : null;

  const showEmpty =
    visibleItems.length === 0 && !hasAiRequests && emptyState != null;

  return (
    // Docked card panels DECLARE their compressed-line count (R8) rather than
    // relying on the silent context default — keeps omni (2) / docked (1)
    // symmetry explicit and test-pinned.
    <CardDisplayProvider value={{ compressedLines: DOCKED_COMPRESSED_LINES }}>
    <Panel
      kind={kind}
      title={title}
      count={shownCount}
      onAdd={onAdd}
      onAddOptions={onAddOptions}
      headerLeading={headerLeading}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      footer={footer}
      variant="list"
      scrollRef={scrollRef}
      onClickEmpty={handleEmptyClick}
      onKeyDown={onKeyDown}
      scrollTabIndex={scrollTabIndex}
    >
      {showEmpty ? (
        // Even with no items and no AI requests, a panel may have trailing
        // content that must survive the empty state — e.g. Bibliography's
        // pending entry-requests block (BIB-F1-01). Render `listTrailing`
        // alongside the empty-state so a pending request isn't dropped when
        // the card list is empty.
        <>
          {emptyState}
          {listTrailing}
        </>
      ) : (
        <>
          {aiRequestsSection}
          {visibleItems.map((item, index) => {
            const id = getId(item);
            return (
              <Fragment key={id}>
                {renderCard(item, { selected: selectedId === id, index })}
              </Fragment>
            );
          })}
          {listTrailing}
        </>
      )}
    </Panel>
    </CardDisplayProvider>
  );
}
