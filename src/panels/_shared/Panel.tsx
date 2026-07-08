/**
 * Universal panel wrapper.
 *
 * Replaces the repeated outer-flex-column + PanelHeader + scroll-body
 * triplet that every panel re-implements today. `kind` drives the
 * registry lookup for the default title; everything else is overridable
 * via slots.
 *
 * `variant: "raw"` is the escape hatch for panels that need to own their
 * scroll element (e.g. Outline, Search) — Panel still renders the chrome
 * but the body is rendered as direct children with no scroll wrapper.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { PANEL, PanelHeader } from "@/components/panel-primitives";
import {
  PanelKindProvider,
  usePanelBodyVarsForKind,
} from "@/components/panel-kind-context";
import { PANEL_REGISTRY } from "../panel-registry";
import type { PanelKind } from "./types";

export interface PanelProps {
  kind: PanelKind;
  /** Override registry label. */
  title?: string;
  /** Optional count badge in the header. */
  count?: number;
  onAdd?: (anchorRect?: DOMRect) => void;
  /** When provided, the "+" button opens a dropdown of choices. Used by
   *  panels hosting more than one card kind. Overrides `onAdd`.
   *  Each option's `onClick` receives the trigger button's bounding rect.
   *  A `disabled` option renders greyed-out and is inert. */
  onAddOptions?: {
    label: string;
    onClick: (anchorRect?: DOMRect) => void;
    disabled?: boolean;
  }[];
  /** Far-left header content (e.g. options menu). */
  headerLeading?: ReactNode;
  /** Inline content right after the title (mode toggles that cluster with
   *  the title, e.g. Outline's Edit/Focus/Lock). */
  headerTitleAfter?: ReactNode;
  /** Right-aligned header content (counter, view toggle, …). */
  headerExtras?: ReactNode;
  /** Content rendered above the scroll body (e.g. draft card, search input). */
  panelExtras?: ReactNode;
  /** "list" applies PANEL.list scroll container. "raw" lets the child own scroll. */
  variant?: "list" | "raw";
  /** Ref to the scroll container (only meaningful for variant="list"). */
  scrollRef?: React.Ref<HTMLDivElement>;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** Click on empty list area (typically used to deselect). */
  onClickEmpty?: (e: React.MouseEvent) => void;
  /** Keydown handler attached to the scroll container (list variant only). */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** tabIndex on the scroll container (list variant only). Pass 0 to make
   *  it focusable for keyboard navigation. */
  scrollTabIndex?: number;
  /** Sticky footer rendered below the scroll body, inside the outer flex
   *  column. Used for action bars like Todo's "Archive completed". */
  footer?: ReactNode;
  /** Extra classes appended to the outer wrapper div. Used by Archive's
   *  capture-drop styling. */
  wrapperClassName?: string;
  /** Extra props (data-attrs, drag handlers) spread onto the outer wrapper
   *  div. Used by Archive's `usePanelCapture` dropProps. */
  wrapperProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

export function Panel({
  kind,
  title,
  count,
  onAdd,
  onAddOptions,
  headerLeading,
  headerTitleAfter,
  headerExtras,
  panelExtras,
  variant = "list",
  scrollRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onClickEmpty,
  onKeyDown,
  scrollTabIndex,
  footer,
  wrapperClassName,
  wrapperProps,
  children,
}: PanelProps) {
  const entry = PANEL_REGISTRY[kind];
  const resolvedTitle = title ?? entry.label;
  // Per-panel body typography vars (font-size override) scoped to this
  // panel root. The matching `.panel-body-typo` rules in globals.css use
  // these vars to size descendant body text in both list and in-text
  // renderers — RichTextField cards already pick up the override via
  // their own inline style, so this catches the bespoke widgets.
  const bodyVars = usePanelBodyVarsForKind(kind);
  const wrapperStyle = wrapperProps?.style;
  const mergedStyle = bodyVars
    ? { ...wrapperStyle, ...bodyVars }
    : wrapperStyle;

  return (
    <PanelKindProvider kind={kind}>
      <div
        {...wrapperProps}
        style={mergedStyle}
        className={`w-full bg-transparent flex flex-col overflow-hidden h-full panel-body-typo${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      >
        <PanelHeader
          title={resolvedTitle}
          count={count}
          onAdd={onAdd}
          onAddOptions={onAddOptions}
          leading={headerLeading}
          titleAfter={headerTitleAfter}
        >
          {headerExtras}
        </PanelHeader>
        {panelExtras}
        {variant === "list" ? (
          <div
            ref={scrollRef}
            className={`${PANEL.list}${onKeyDown || scrollTabIndex != null ? " focus:outline-none" : ""}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={onClickEmpty}
            onKeyDown={onKeyDown}
            tabIndex={scrollTabIndex}
          >
            {children}
          </div>
        ) : (
          // variant="raw": the panel owns its scroll element. Mark the body
          // region inert to the FloatingPanel WINDOW-drag (bug sweep #5) so its
          // content rows (Outline sections, Search results) jump on click rather
          // than arming the panel-move drag (the blue halo + jitter-undock that
          // swallowed the click). The PanelHeader above stays OUTSIDE this
          // wrapper, so dragging the title bar still undocks. `display:contents`
          // emits NO box — the child's own scroll/flex layout is unchanged —
          // while `closest('[data-no-window-drag]')` in onHeaderMouseDown still
          // matches it via the DOM tree (it's in WINDOW_DRAG_BLOCK_SELECTOR).
          <div data-no-window-drag style={{ display: "contents" }}>
            {children}
          </div>
        )}
        {footer}
      </div>
    </PanelKindProvider>
  );
}
