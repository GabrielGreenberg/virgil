"use client";

/**
 * The one slider (task 2026-11-16-1653): a range input and its tabular-nums
 * readout. The Preferences dialog used to hand-roll this control four times —
 * four track widths, four readout widths, the readout before/after/absolutely
 * placed, one readout missing its muted ink — and every copy repainted its
 * fill `--accent`, overriding the app-wide `:root { accent-color:
 * var(--control-selected) }` (STYLE_GUIDE: `--accent` is for colour that
 * reads as TEXT; a filled track is a fill). This primitive carries no accent
 * class at all, so its fill IS the root accent-color.
 *
 * Layout-neutral: it renders the input and the readout as siblings (a
 * fragment), so the caller's own flex row decides spacing.
 *  - `readout="after"` — the readout follows the track (the common row).
 *  - `readout="corner"` — the readout sits top-right of the nearest
 *    `relative` ancestor, i.e. on the caption line of a stacked `<Field>`.
 * The readout's width is DERIVED from the widest value it can print
 * (`format(min)` / `format(max)`, in `ch` — the digits are tabular), so it
 * never jitters while dragging and no caller states a width.
 *
 * `range-field-census.test.ts` fails a raw `type="range"` anywhere else.
 */

export type RangeTrack = "xs" | "sm" | "md" | "fill";

const TRACK: Record<RangeTrack, string> = {
  xs: "w-14 shrink-0",
  sm: "w-20 shrink-0",
  md: "w-28 shrink-0",
  fill: "w-full",
};

export interface RangeFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  /** How the readout prints a value (default: the bare number). */
  format?: (v: number) => string;
  track: RangeTrack;
  readout?: "after" | "corner";
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
}

export function RangeField({
  value,
  min,
  max,
  step,
  onChange,
  format = String,
  track,
  readout = "after",
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  disabled,
}: RangeFieldProps) {
  const readoutCh = Math.max(format(min).length, format(max).length);
  const readoutEl = (
    <span
      className={`text-2xs text-ink-muted tabular-nums text-right shrink-0${
        readout === "corner" ? " absolute right-0 top-0" : ""
      }`}
      style={{ minWidth: `${readoutCh}ch` }}
    >
      {format(value)}
    </span>
  );
  return (
    <>
      {readout === "corner" && readoutEl}
      <input
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`${TRACK[track]} h-1 disabled:opacity-40`}
      />
      {readout === "after" && readoutEl}
    </>
  );
}

/** A signed readout: `+5`, `0`, `-5` (and the unit, if any). */
export const signed = (unit = "") => (v: number) => `${v > 0 ? "+" : ""}${v}${unit}`;
