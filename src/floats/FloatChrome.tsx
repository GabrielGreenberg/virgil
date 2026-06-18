"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { PopoutButton } from "@/components/panel-primitives";
import { DropChevrons } from "@/components/icons/DropChevrons";
import { beginCardDropGesture } from "@/components/drop-mode/card-drop-gesture";

/**
 * `FloatChrome` — the ONE header skeleton for every popped-out window, shared
 * by `Card` and `TextObject` floats. Promoted from the text-object
 * `FloatHeaderContent` and the card `PanelCard` popped-header branch, which are
 * both retired in its favor (the jump glyph is now drawn exactly once, here).
 *
 * Layout: grip · title · `{trailing}` · jump · close (X). Domain-neutral — it
 * imports nothing card- or text-specific. The two domain contributions ride in
 * as opaque nodes:
 *   - `titleNode` — the label-position override (e.g. the revision morph
 *     dropdown); supersedes the `title` string.
 *   - `trailing` — the narrow region before jump/close (collab pill, status
 *     dot, AI checkbox, …). For cards this is a `CardChromeTrailing` element
 *     that hosts its own `CardClaimContext`, so FloatChrome stays neutral.
 *
 * `redock` is intentionally absent — cards/text-objects never dock
 * (`canRedock=false`); panels keep their own chrome.
 */

/** The UI-chrome sans stack, mirrored verbatim from `body` so the label
 *  resolves identically wherever it mounts — honoring the user's
 *  `--font-sans-override` (the L3d.1 explicit-font fix, so no label can drift). */
const FLOAT_HEADER_FONT_FAMILY =
  'var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif';

/** Decorative 6-dot grip (mirrors `CardDragHandle`). The whole header strip is
 *  the drag surface (FloatingPanel `onHeaderMouseDown`); this just signals it. */
function FloatGrip() {
  return (
    <div
      className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint shrink-0"
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>
  );
}

export interface FloatChromeProps {
  /** Resolved display title (`titleOverride ?? floatable.title`). */
  title: string;
  /** Label-position override (morph control); supersedes `title` when set. */
  titleNode?: ReactNode;
  /** The single domain-contributed trailing slot. */
  trailing?: ReactNode;
  /** Header-strip background (`Floatable.headerTint`) — card floats pass
   *  their kind's `theme.headerDefault` so the strip matches the docked
   *  card header (pop-out continuity #20). Absent → the neutral
   *  `--surface-muted-strong` (text-object floats). */
  headerTint?: string;
  /** Whether to show the jump-to-source chevron. */
  canJump: boolean;
  onJump: () => void;
  /** Whether to show the (re)anchor drop button (mirrors `canJump`). Stays
   *  domain-neutral: the caller (`FloatWindow` via `cardFloatable`) reads the
   *  static `CARD_REGISTRY[kind].droppable` facet and hands a plain boolean —
   *  no card code reaches in here. Absent / false → no button (text-object
   *  floats and `droppable:false` kinds). */
  canDrop?: boolean;
  /** Opaque `float:card:<kind>:<id>` key the neutral drop button hands to
   *  `beginCardDropGesture` so the drop controller can look the spec up. A
   *  string at this layer — FloatChrome never parses or imports a card kind. */
  dropCardKey?: string;
  /** Optional domain-supplied press handler for the (re)anchor drop button.
   *  When provided, the guarded mousedown calls THIS instead of the default
   *  `beginCardDropGesture(dropCardKey)` — the seam that lets a text-object
   *  float drive `LiftHost.beginLift({terminalPolicy:"float", …})` (the full
   *  lifted-overlay ghost) while CARD floats keep the no-ghost
   *  `beginCardDropGesture` path byte-unchanged (caller leaves this undefined).
   *  FloatChrome stays domain-blind: the caller (`FloatWindow`) builds the
   *  handler; FloatChrome imports no card/text-object code. */
  onDropPress?: (e: ReactMouseEvent) => void;
  onClose: () => void;
}

export function FloatChrome({
  title,
  titleNode,
  trailing,
  headerTint,
  canJump,
  onJump,
  canDrop,
  dropCardKey,
  onDropPress,
  onClose,
}: FloatChromeProps) {
  const labelNoun = title.toLowerCase();
  return (
    <div
      className="flex items-center gap-1 px-2 h-6 shrink-0 border-b border-edge-subtle"
      style={{ backgroundColor: headerTint ?? "var(--surface-muted-strong)" }}
    >
      <FloatGrip />
      {titleNode ?? (
        <span
          className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate"
          style={{ fontFamily: FLOAT_HEADER_FONT_FAMILY }}
        >
          {title}
        </span>
      )}
      <span className="flex-1" />
      {trailing}
      {canJump && (
        <button
          type="button"
          onClick={onJump}
          className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
          data-hint={`Jump to ${labelNoun}`}
          aria-label={`Jump to ${labelNoun}`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
      )}
      {/* (Re)anchor drop button — the popped-float twin of the docked
          `CardDropButton`, rendered LEFT of the close X. The press guards are
          a verbatim mirror of that button (primary-button-only, then
          stopPropagation + preventDefault + draggable=false + dragstart
          swallow) so the press can't co-fire the FloatingPanel header
          drag-lift. The drop session itself is owned by the shared neutral
          `beginCardDropGesture` (arms its own one-shot commit-on-mouseup). The
          `preventDefault` on mousedown is load-bearing — this is a press-DRAG,
          not a click — and trips the header wrapper's `defaultPrevented`
          lift-guard. Gated on the static `canDrop` boolean: no per-render /
          per-keystroke work. */}
      {canDrop && dropCardKey && (
        <button
          type="button"
          onMouseDown={(e) => {
            // Primary button only — a right/middle press passes through (no
            // phantom session), matching the docked button + the 3 producers.
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            // Domain dispatch (Chip 2): a caller-supplied `onDropPress` wins
            // (text-object floats → `LiftHost.beginLift({policy:"float"})`, the
            // lifted-overlay ghost). Absent → the default neutral
            // `beginCardDropGesture` (card floats, byte-unchanged). The guards
            // above (primary-only / stopPropagation / preventDefault) run in
            // BOTH cases so neither path co-fires the FloatingPanel header lift.
            if (onDropPress) {
              onDropPress(e);
            } else {
              beginCardDropGesture({
                cardKey: dropCardKey,
                origin: { x: e.clientX, y: e.clientY },
              });
            }
          }}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light bg-transparent p-0 shrink-0 cursor-grab"
          data-hint={`Drop ${labelNoun} into text`}
          aria-label={`Drop ${labelNoun} into text`}
        >
          <DropChevrons />
        </button>
      )}
      <PopoutButton
        isPoppedOut
        variant="x"
        labelNoun={labelNoun}
        className="iconbtn-xs"
        onClick={onClose}
      />
    </div>
  );
}
