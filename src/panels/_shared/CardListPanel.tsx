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

import { Fragment, useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  CardDisplayProvider,
  DOCKED_COMPRESSED_LINES,
} from "@/components/editor-layout/contexts/card-display";
import { Panel } from "./Panel";
import type { PanelKind } from "./types";
import {
  archiveViewBadgeLabel,
  resolveArchiveEmptyReason,
  useArchiveVisibleItems,
  useCardArchiveView,
} from "./card-archive-view";
import { ArchiveViewEmptyState } from "./ArchiveViewEmptyState";

export interface CardListPanelProps<T> {
  kind: PanelKind;

  items: T[];
  getId: (item: T) => string;
  /** When provided, CardListPanel filters `items` by the panel's archive view
   *  mode (View Active / Archives / All from the three-dot menu), reading each
   *  item's `archived` flag through this accessor. Omit for panels with no
   *  archivable cards — they render every item as before. */
  getArchived?: (item: T) => boolean;
  /** When provided, the header badge counts only the visible items matching this
   *  predicate, instead of every visible item. Lets a panel with a SECOND
   *  orthogonal dimension on top of the rendered set (Todo's `done`) show a
   *  semantically-meaningful badge — "pending, in this view" — without
   *  desyncing from it. Omit ⇒ badge counts all visible items. Independent of
   *  `getArchived`: the badge always derives from the rendered set, so a panel
   *  may narrow it with `getCounted` alone. */
  getCounted?: (item: T) => boolean;
  /** Render a single card. CardListPanel handles the React `key` via a
   *  Fragment wrapper, so the returned node should be the card directly
   *  (no need to set `key`). */
  renderCard: (item: T, ctx: { selected: boolean; index: number }) => ReactNode;

  selectedId: string | null;
  onSelect: (id: string | null) => void;

  /** The panel's GENUINELY-empty state — the one case only the panel can
   *  author, because only it knows how its cards are made ("Select text and use
   *  the toolbar to create one"). Rendered when nothing is filtered out.
   *
   *  A panel supplies this and NOTHING else: when the archive view is what
   *  emptied the list, `CardListPanel` renders the shared view-aware state
   *  instead (task 478), so a ninth archivable panel inherits that by shipping
   *  and there is no second string per panel to keep in step. */
  emptyState?: ReactNode;

  /** Optional content rendered inside the list scroll body, after the
   *  items. Used by Bibliography for its pending-entry-requests block. */
  listTrailing?: ReactNode;

  // ── Pass-through Panel slots ──
  // NOTE: no `count`. The header badge is DERIVED from the rendered set (see
  // `shownCount` below), so a card panel structurally cannot hand the header a
  // number unrelated to what it renders. `count` remains on `PanelProps` for
  // the non-card panels that render `<Panel>` directly.
  title?: string;
  onAdd?: (anchorRect?: DOMRect) => void;
  /** When provided, the "+" button opens a small dropdown of choices
   *  instead of firing `onAdd`. Used by panels hosting more than one
   *  card kind (Cutter: Comment / Suggestion). Each option's `onClick`
   *  receives the trigger button's bounding rect. A `disabled` option
   *  renders greyed-out and is inert. */
  onAddOptions?: {
    label: string;
    onClick: (anchorRect?: DOMRect) => void;
    disabled?: boolean;
  }[];
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
  getCounted,
  renderCard,
  selectedId,
  onSelect,
  emptyState,
  listTrailing,
  title,
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
  const { getView, setView } = useCardArchiveView();
  const view = getView(kind);
  const archivable = getArchived != null;

  // Archive view: filter the list by the panel's current mode (active /
  // archived / all). When `getArchived` is omitted the panel has no archivable
  // cards, so every item shows. Pure derivation — recomputes only when items or
  // the mode change (an archive toggle / view switch), never on a keystroke
  // (the `archived` flag lives in sidecar state, not the doc).
  const visibleItems = useArchiveVisibleItems(kind, items, getArchived);
  // The header badge is derived from the RENDERED set, unconditionally — and,
  // when the panel supplies a `getCounted` predicate, only the visible subset it
  // cares about (Todo: pending, i.e. not-done).
  //
  // Deriving it here rather than accepting a `count` prop is the invariant
  // (task 183): the badge and the list cannot disagree, because there is only
  // one set. Previously this fell back to a raw `count` pass-through whenever
  // `getArchived` was absent, which let `ErrorsPanel` pass its *unfiltered* set
  // to the badge while rendering the text-filtered one — a header that showed
  // "ERRORS 12" beside a "0 errors" counter above an empty list.
  const shownCount = getCounted
    ? visibleItems.filter(getCounted).length
    : visibleItems.length;

  // If the selected card is filtered out of the current view (e.g. it was just
  // archived, or the user switched to View Active while an archived card was
  // selected), drop the selection so no hidden card stays "selected".
  useEffect(() => {
    if (!getArchived || selectedId == null) return;
    if (!visibleItems.some((it) => getId(it) === selectedId)) onSelect(null);
  }, [getArchived, selectedId, visibleItems, getId, onSelect]);

  // Which empty state? The rule is one pure function in `card-archive-view`,
  // read here because this is the one place that holds BOTH sets — the raw
  // `items` and the `visibleItems` the filter left. A view-aware reason wins;
  // `panel-empty` falls through to the panel's own authored copy.
  const emptyReason = resolveArchiveEmptyReason({
    view,
    archivable,
    rawCount: items.length,
    visibleCount: visibleItems.length,
  });
  const viewEmpty =
    emptyReason && emptyReason.kind !== "panel-empty" ? emptyReason : null;
  const showEmpty =
    visibleItems.length === 0 && (viewEmpty != null || emptyState != null);

  // Creating a card always produces an ACTIVE one, so the Archives view would
  // hide it the instant it existed — pressing "+" there read as a broken button.
  // The affordance and its outcome must agree (the law the drop path already
  // states: what the hover OFFERS is what the commit ACCEPTS), so a create
  // leaves the Archives view rather than landing somewhere the user cannot see.
  // "All" needs no redirect: it shows the new card already.
  const leaveArchivesView = useCallback(() => {
    if (archivable && view === "archived") setView(kind, "active");
  }, [archivable, view, setView, kind]);
  const handleAdd = useMemo(
    () =>
      onAdd
        ? (rect?: DOMRect) => {
            leaveArchivesView();
            onAdd(rect);
          }
        : undefined,
    [onAdd, leaveArchivesView],
  );
  const handleAddOptions = useMemo(
    () =>
      onAddOptions?.map((o) => ({
        ...o,
        onClick: (rect?: DOMRect) => {
          leaveArchivesView();
          o.onClick(rect);
        },
      })),
    [onAddOptions, leaveArchivesView],
  );

  return (
    // Docked card panels DECLARE their compressed-line count (R8) rather than
    // relying on the silent context default — keeps omni (2) / docked (1)
    // symmetry explicit and test-pinned.
    <CardDisplayProvider value={{ compressedLines: DOCKED_COMPRESSED_LINES }}>
    <Panel
      kind={kind}
      title={title}
      count={shownCount}
      countLabel={archivable ? archiveViewBadgeLabel(view) : undefined}
      onAdd={handleAdd}
      onAddOptions={handleAddOptions}
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
        // Even with no items, a panel may have trailing content that must
        // survive the empty state — e.g. Bibliography's pending entry-requests
        // block (BIB-F1-01). Render `listTrailing` alongside the empty-state so
        // a pending request isn't dropped when the card list is empty.
        <>
          {viewEmpty ? <ArchiveViewEmptyState reason={viewEmpty} /> : emptyState}
          {listTrailing}
        </>
      ) : (
        <>
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
