/**
 * Cardful panel variant.
 *
 * Owns iteration of the items array, the archive-view filter, and KEYBOARD
 * LIST NAVIGATION (task 964). Selection stays controlled by the panel.
 *
 * `selectedId` is controlled by the panel; clicking the empty list area
 * calls `onSelect(null)` so panels don't have to wire that themselves.
 *
 * Keyboard navigation is the shell's, not the panel's. The list body is
 * focusable; ArrowDown/ArrowUp step the selection through the RENDERED set
 * (archive-filtered, so an archived off-screen card is never stepped onto),
 * Enter on the list itself re-activates the selected card, and the stepped-to
 * card is scrolled into view. The cursor is DERIVED from `selectedId` — there
 * is no second index to re-sync. Arrows inside a card's own inputs edit text
 * (the `useListNavKeys` editable-target guard). A panel whose activation does
 * more than select (jump to the in-text marker) passes `onActivateItem`.
 *
 * This used to say cycling "varies too much per panel and stays inline".
 * Measured, it did not vary: six panels repeated the same `useCycle` +
 * re-sync effect + `useListNavKeys` lines, and the five that never copied
 * them (Reports, Todo, Revisions, Cutter, Archive) had no keyboard nav at
 * all. One owner means a new card panel cannot ship without it.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useListNavKeys } from "@/components/panel-primitives";
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
import { PanelAddProvider } from "./CreationHint";

export interface CardListPanelProps<T> {
  kind: PanelKind;

  items: T[];
  getId: (item: T) => string;
  /**
   * React's reconciliation key, when it is not the SELECTION id (task 690).
   *
   * For almost every panel the two are the same string. The Bibliography panel
   * is the exception: its selection id is the CITEKEY — what the occurrence
   * cursor, the jump target and the identity cascade all speak — while two
   * `.bib` blocks may legitimately carry one citekey. Since those blocks are
   * now both listed (hiding one made it unrepairable, and every edit to the
   * visible card silently overwrote the hidden one), the list needs a key that
   * separates them without changing what "selected" means. Defaults to
   * `getId`, so no other panel is affected.
   */
  getRenderKey?: (item: T) => string;
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

  /** The panel's GENUINELY-empty state — the NOUN that names what is missing
   *  ("No examples yet."), followed by `<CreationHint action="…" />` for the way
   *  in. Rendered when nothing is filtered out.
   *
   *  This docstring used to say the panel authors the whole sentence "because
   *  only it knows how its cards are made" — and that was the bug (task 727).
   *  The panel does not know: `VIRGIL_ACTION_REGISTRY` owns the surfaces, and a
   *  panel writing them from memory is how the Examples panel spent its life
   *  pointing at a `(1)` toolbar glyph that had been deleted. The "+" half is
   *  not the panel's either — it comes from `PanelAddProvider` below, fed by the
   *  button this component is actually about to render.
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
  // number unrelated to what it renders. `count`/`countLabel` remain on
  // `PanelProps` because THIS component passes them through — measured (task
  // 479), the three panels that render `<Panel>` directly (WordCount, Search,
  // Outline) pass neither, so `CardListPanel` is their only producer. Read that
  // as a pass-through contract, not as a slot a panel is expected to fill: a
  // panel that wants a badge derives it here.
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
  /** Extra work when the KEYBOARD activates a card (Arrow step / Enter), run
   *  after the shell has selected it via `onSelect`. Typically the jump to the
   *  card's in-text marker, through the same gate the card's Jump button uses.
   *  Omit ⇒ a keyboard step only selects (and scrolls the card into view). */
  onActivateItem?: (item: T, index: number) => void;
}

export function CardListPanel<T>({
  kind,
  items,
  getId,
  getRenderKey,
  getArchived,
  getCounted,
  renderCard,
  selectedId,
  onSelect,
  emptyState,
  listTrailing,
  onAdd,
  onAddOptions,
  headerLeading,
  headerExtras,
  panelExtras,
  footer,
  scrollRef,
  onActivateItem,
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

  // ── Keyboard list navigation (task 964) ──
  // The cursor is the selection, read against the rendered set: no `useCycle`
  // index to keep in step with `selectedId`, so a click, a margin pick or an
  // omni pick moves the keyboard cursor for free.
  const selectedIndex =
    selectedId == null ? -1 : visibleItems.findIndex((it) => getId(it) === selectedId);
  // The list element the last key event came through — where the stepped-to
  // card is scrolled. Set by the key handler, so it is always the live body.
  const navBodyRef = useRef<HTMLElement | null>(null);
  const activateIndex = useCallback(
    (i: number) => {
      const item = visibleItems[i];
      if (item === undefined) return;
      onSelect(getId(item));
      onActivateItem?.(item, i);
      // Each rendered card is one child of the list body, in render order
      // (`listTrailing` follows them), so the index addresses the card's DOM
      // without a per-panel selector. Deferred a frame: selection can resize
      // the card (expand), and "nearest" should see the settled box.
      const body = navBodyRef.current;
      requestAnimationFrame(() => {
        const el = body?.children[i] as HTMLElement | undefined;
        el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      });
    },
    [visibleItems, getId, onSelect, onActivateItem],
  );
  const stepNext = useCallback(() => {
    const n = visibleItems.length;
    activateIndex(selectedIndex < 0 ? 0 : (selectedIndex + 1) % n);
  }, [visibleItems.length, selectedIndex, activateIndex]);
  const stepPrev = useCallback(() => {
    const n = visibleItems.length;
    activateIndex(selectedIndex < 0 ? n - 1 : (selectedIndex - 1 + n) % n);
  }, [visibleItems.length, selectedIndex, activateIndex]);
  const arrowKeys = useListNavKeys(visibleItems.length, stepNext, stepPrev);
  const handleNavKeys = useCallback(
    (e: ReactKeyboardEvent) => {
      navBodyRef.current = e.currentTarget as HTMLElement;
      // Enter only when the LIST itself has focus — inside a card, Enter
      // belongs to that card's buttons and fields.
      if (e.key === "Enter" && e.target === e.currentTarget) {
        if (visibleItems.length === 0) return;
        e.preventDefault();
        activateIndex(selectedIndex < 0 ? 0 : selectedIndex);
        return;
      }
      arrowKeys(e);
    },
    [arrowKeys, visibleItems.length, selectedIndex, activateIndex],
  );

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

  // Whether the header will actually paint a "+" — the exact condition
  // `PanelHeader` renders on (`onAddOptions ? dropdown : onAdd && button`).
  // Published to the empty state through `PanelAddProvider` so a panel's copy
  // never ASSERTS a "+": it asks the surface that owns one. Task 727 — the
  // Examples panel declared an `onAdd` no host passed while its sentence named
  // a toolbar glyph that no longer existed; both were promises nobody kept.
  const hasAddButton = handleAddOptions != null || handleAdd != null;

  return (
    // Docked card panels DECLARE their compressed-line count (R8) rather than
    // relying on the silent context default — keeps omni (2) / docked (1)
    // symmetry explicit and test-pinned.
    <CardDisplayProvider value={{ compressedLines: DOCKED_COMPRESSED_LINES }}>
    <Panel
      kind={kind}
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
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
    >
      {showEmpty ? (
        // Even with no items, a panel may have trailing content that must
        // survive the empty state — e.g. Bibliography's pending entry-requests
        // block (BIB-F1-01). Render `listTrailing` alongside the empty-state so
        // a pending request isn't dropped when the card list is empty.
        <>
          {viewEmpty ? (
            <ArchiveViewEmptyState reason={viewEmpty} />
          ) : (
            <PanelAddProvider value={hasAddButton}>{emptyState}</PanelAddProvider>
          )}
          {listTrailing}
        </>
      ) : (
        <>
          {visibleItems.map((item, index) => {
            const id = getId(item);
            return (
              <Fragment key={getRenderKey ? getRenderKey(item) : id}>
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
