"use client";

/**
 * SegmentedToggle — the ONE segmented choice ("pick exactly one of these N")
 * (task 950).
 *
 * Three call sites hand-rolled this shape and each had drifted off the spec a
 * different way: the Bibliography search's Local/Library scope announced no
 * state (no `aria-pressed`), painted "on" a faint grey, had no focus ring and a
 * disabled Library button whose hint never said why; the suggestion card's
 * Original/Suggested preview wore `--accent` (the user-overridable link /
 * selection accent a toggle must never borrow); the print dialog's font-size
 * row was a third spelling with a 4px radius. STYLE_GUIDE "Buttons" → "The
 * SHAPE may be hand-rolled; the 'on' PALETTE never is" — so the whole family
 * is spelled ONCE, here:
 *
 *  - a `role="group"` with a name; every segment `aria-pressed`
 *  - the SOLID `--control-selected` path for the selected segment (filled
 *    segments, STYLE_GUIDE "Buttons"), never `--accent`
 *  - `rounded-md` (the control radius) on the outer ends
 *  - `.focus-ring` per segment, lifted above its neighbours while focused so
 *    the ring is not painted under the next segment (no `overflow-hidden` on
 *    the group, which would clip it)
 *  - a disabled segment keeps its hint and the hint says WHY (`disabledHint`),
 *    because a disabled native `<button>` still shows `data-hint`
 *    (STYLE_GUIDE "Buttons" → disabled hints).
 *
 * Censused by `segmented-toggle-census.test.ts`: a `role="group"` of
 * `aria-pressed` buttons outside this file fails CI.
 */

import type { ReactNode } from "react";

export interface SegmentedOption<V extends string | number> {
  value: V;
  /** Visible text — also the accessible name unless `ariaLabel` is given. */
  label: ReactNode;
  /** Tooltip while enabled. */
  hint?: string;
  /** Accessible name when it must say more than the visible label (it should
   *  still CONTAIN the label — WCAG "label in name"). */
  ariaLabel?: string;
  disabled?: boolean;
  /** Tooltip while disabled — the reason. Falls back to `hint`. */
  disabledHint?: string;
}

export type SegmentedToggleSize = "xs" | "sm";

const SIZE: Record<SegmentedToggleSize, string> = {
  xs: "text-[10px] px-1.5 py-1",
  sm: "text-[11px] font-medium px-2 h-6",
};

const SEGMENT_BASE =
  "relative focus-ring focus-visible:z-10 border border-edge-subtle -ml-px first:ml-0 first:rounded-l-md last:rounded-r-md transition-colors";
/** The selected segment — the SOLID control-selected path. Exported so the
 *  census can pin that this is the family's one "on" spelling. */
export const SEGMENT_ON =
  "bg-[var(--control-selected)] border-[var(--control-selected)] text-white z-[1]";
const SEGMENT_OFF = "bg-surface text-ink-muted hover-on-light hover:text-ink-body";
const SEGMENT_DISABLED = "bg-surface text-ink-faint cursor-not-allowed";

export interface SegmentedToggleProps<V extends string | number> {
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  /** Name of the group (announced with the segments). */
  ariaLabel: string;
  size?: SegmentedToggleSize;
  /** Disable every segment (e.g. the controller cannot resolve right now). */
  disabled?: boolean;
  /** Keep pointer events inside the control — for a host whose header owns a
   *  lift / select gesture on mousedown or click (card bodies). */
  isolatePointer?: boolean;
  className?: string;
}

export function SegmentedToggle<V extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "xs",
  disabled: groupDisabled = false,
  isolatePointer = false,
  className,
}: SegmentedToggleProps<V>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex items-stretch shrink-0${className ? ` ${className}` : ""}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const disabled = groupDisabled || !!opt.disabled;
        const hint = disabled ? (opt.disabledHint ?? opt.hint) : opt.hint;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            aria-label={opt.ariaLabel}
            // The reason reaches assistive tech too — as the DESCRIPTION, the
            // visible label stays the name (STYLE_GUIDE "A hint is never a
            // name by hand"; the print dialog's marginalia row, task 609).
            aria-description={disabled ? opt.disabledHint : undefined}
            disabled={disabled}
            data-hint={hint}
            onMouseDown={isolatePointer ? (e) => e.stopPropagation() : undefined}
            onClick={(e) => {
              if (isolatePointer) e.stopPropagation();
              if (disabled) return;
              onChange(opt.value);
            }}
            className={`${SEGMENT_BASE} ${SIZE[size]} ${
              active ? SEGMENT_ON : disabled ? SEGMENT_DISABLED : SEGMENT_OFF
            }${disabled && active ? " opacity-60" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
