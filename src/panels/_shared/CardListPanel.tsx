/**
 * Cardful panel variant.
 *
 * Owns iteration of the items array, the optional Pending-AI-Requests
 * section above the items, and rendering in either list or in-text view
 * mode. Does NOT own keyboard cycling or selection — those vary too much
 * per panel and stay inline (`useCycle` + `PrevNextCounter` are passed
 * via `headerExtras`).
 *
 * `selectedId` is controlled by the panel; clicking the empty list area
 * calls `onSelect(null)` so panels don't have to wire that themselves.
 */

import { Fragment, useCallback, type HTMLAttributes, type ReactNode } from "react";
import type { AiRequest } from "@/lib/types";
import {
  AiRequestCard,
  AiRequestsSectionHeader,
} from "@/components/panel-primitives";
import { Panel } from "./Panel";
import type { PanelKind } from "./types";

export interface CardListPanelProps<T> {
  kind: PanelKind;

  items: T[];
  getId: (item: T) => string;
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
   *  Rendered above items in both list and in-text modes. */
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;

  /** View-mode is panel-controlled. Pass both `viewMode` and the
   *  in-text props together when supporting an in-text mode. */
  viewMode?: "list" | "in-text";
  /** Map from item id → top-pixel-offset within the in-text scroll body. */
  inTextPositions?: Map<string, number>;
  inTextScrollHeight?: number | null;
  /** Render an item in in-text mode. Different from `renderCard` because
   *  the wrapper layout differs (absolute positioning, no list spacing). */
  inTextRenderItem?: (
    item: T,
    ctx: { selected: boolean; top: number },
  ) => ReactNode;
  /** Optional content rendered inside the in-text relative container,
   *  after the positioned items. Used by FootnotePanel to stack
   *  unanchored footnotes below the positioned ones. */
  inTextTrailing?: ReactNode;
  /** Optional content rendered inside the list scroll body, after the
   *  items. Used by Bibliography for its pending-entry-requests block. */
  listTrailing?: ReactNode;

  // ── Pass-through Panel slots ──
  title?: string;
  count?: number;
  onAdd?: () => void;
  onAiRequest?: () => void;
  headerLeading?: ReactNode;
  headerExtras?: ReactNode;
  panelExtras?: ReactNode;
  footer?: ReactNode;
  wrapperClassName?: string;
  wrapperProps?: HTMLAttributes<HTMLDivElement>;
  scrollRef?: React.Ref<HTMLDivElement>;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** When true, renders a blue "+" placeholder card at the top of the
   *  list body, signalling that a drop will create a new card here. */
  showDropPlaceholder?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  scrollTabIndex?: number;
}

export function CardListPanel<T>({
  kind,
  items,
  getId,
  renderCard,
  selectedId,
  onSelect,
  emptyState,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  viewMode = "list",
  inTextPositions,
  inTextScrollHeight,
  inTextRenderItem,
  inTextTrailing,
  listTrailing,
  title,
  count,
  onAdd,
  onAiRequest,
  headerLeading,
  headerExtras,
  panelExtras,
  footer,
  wrapperClassName,
  wrapperProps,
  scrollRef,
  onDragOver,
  onDragLeave,
  onDrop,
  showDropPlaceholder,
  onKeyDown,
  scrollTabIndex,
}: CardListPanelProps<T>) {
  const handleEmptyClick = useCallback(() => onSelect(null), [onSelect]);
  const hasAiRequests = aiRequests && aiRequests.length > 0;
  const dropPlaceholder = showDropPlaceholder ? (
    <div className="drop-placeholder-card" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </div>
  ) : null;

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

  if (viewMode === "in-text" && inTextPositions && inTextRenderItem) {
    return (
      <Panel
        kind={kind}
        title={title}
        count={count}
        onAdd={onAdd}
        onAiRequest={onAiRequest}
        headerLeading={headerLeading}
        headerExtras={headerExtras}
        panelExtras={panelExtras}
        footer={footer}
        wrapperClassName={wrapperClassName}
        wrapperProps={wrapperProps}
        variant="raw"
      >
        <div
          ref={scrollRef}
          className={`flex-1 overflow-y-auto${onKeyDown || scrollTabIndex != null ? " focus:outline-none" : ""}`}
          onClick={handleEmptyClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onKeyDown={onKeyDown}
          tabIndex={scrollTabIndex}
        >
          {aiRequestsSection && (
            <div className="px-2 pt-2 pb-2 space-y-2">{aiRequestsSection}</div>
          )}
          {dropPlaceholder && <div className="px-2 pt-2">{dropPlaceholder}</div>}
          <div
            className="relative"
            style={{ height: inTextScrollHeight ?? "100%" }}
          >
            {items.map((item) => {
              const id = getId(item);
              const top = inTextPositions.get(id);
              if (top === undefined) return null;
              return (
                <div
                  key={id}
                  className="absolute left-2 right-2"
                  style={{ top }}
                >
                  {inTextRenderItem(item, {
                    selected: selectedId === id,
                    top,
                  })}
                </div>
              );
            })}
            {inTextTrailing}
          </div>
          {listTrailing}
        </div>
      </Panel>
    );
  }

  const showEmpty = items.length === 0 && !hasAiRequests && emptyState != null;

  return (
    <Panel
      kind={kind}
      title={title}
      count={count}
      onAdd={onAdd}
      onAiRequest={onAiRequest}
      headerLeading={headerLeading}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      footer={footer}
      wrapperClassName={wrapperClassName}
      wrapperProps={wrapperProps}
      variant="list"
      scrollRef={scrollRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClickEmpty={handleEmptyClick}
      onKeyDown={onKeyDown}
      scrollTabIndex={scrollTabIndex}
    >
      {showEmpty && !dropPlaceholder ? (
        emptyState
      ) : (
        <>
          {aiRequestsSection}
          {dropPlaceholder}
          {items.map((item, index) => {
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
  );
}
