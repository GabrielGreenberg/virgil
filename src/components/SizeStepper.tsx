"use client";

import { useState } from "react";
import { Input } from "./field-primitives";

interface SizeStepperProps {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Number of decimal places to display. */
  precision?: number;
}

/** Spacious number input with adjacent − / + buttons, designed for the
 *  Fonts… dialog. Larger hit targets than [PanelTextSizeRow.tsx]. */
export default function SizeStepper({
  value,
  onChange,
  min,
  max,
  step,
  unit = "",
  precision = 2,
}: SizeStepperProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value.toFixed(precision));
  const display = focused ? draft : value.toFixed(precision);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const round = (n: number) => Number(clamp(n).toFixed(precision));

  const commitRaw = (raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    onChange(round(n));
  };

  const bump = (delta: number) => {
    onChange(round(value + delta));
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        density="dense"
        min={min}
        max={max}
        step={step}
        value={display}
        onFocus={() => { setFocused(true); setDraft(value.toFixed(precision)); }}
        onChange={(e) => {
          setDraft(e.target.value);
          commitRaw(e.target.value);
        }}
        onBlur={() => { setFocused(false); commitRaw(draft); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        className="w-16 px-2 py-1 text-sm tabular-nums"
        style={{ fontVariantNumeric: "tabular-nums" }}
      />
      <button
        type="button"
        onClick={() => bump(-step)}
        disabled={value <= min}
        className="w-7 h-7 rounded border border-edge-subtle bg-surface text-ink-muted hover:bg-edge-subtle hover:text-ink-body disabled:opacity-30 disabled:cursor-default flex items-center justify-center text-base leading-none"
        data-hint="Smaller"
        aria-label="Smaller"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => bump(step)}
        disabled={value >= max}
        className="w-7 h-7 rounded border border-edge-subtle bg-surface text-ink-muted hover:bg-edge-subtle hover:text-ink-body disabled:opacity-30 disabled:cursor-default flex items-center justify-center text-base leading-none"
        data-hint="Larger"
        aria-label="Larger"
      >
        +
      </button>
      {unit && <span className="text-xs text-ink-muted ml-0.5">{unit}</span>}
    </div>
  );
}
