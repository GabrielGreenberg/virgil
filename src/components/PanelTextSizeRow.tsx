"use client";

import { useState } from "react";
import { Input } from "./field-primitives";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  setPanelTypographyField,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import { usePanelTypography } from "@/hooks/usePanelTypography";

const MIN = 8;
const MAX = 32;

function commit(key: PanelBodyKey, raw: number) {
  const clamped = Math.max(MIN, Math.min(MAX, Math.round(raw)));
  // Always store the explicit value (no auto-clear at the default). This
  // guarantees the slider is monotonic across panels: the rendered
  // font-size matches the slider value step-for-step instead of snapping
  // back to whatever the underlying CSS default happens to be when the
  // override is dropped.
  setPanelTypographyField(key, "fontSize", clamped);
}

/** Compact text-size stepper for a panel's three-dots menu — designed to
 *  sit inline alongside the panel's color swatch and view toggle.
 *
 *  Layout:  [ 14 ] pts
 *
 *  Uses the native number-input spinner (forced always-visible via
 *  `panel-text-size-input` styles in globals.css). Every step/typed value is
 *  stored as an explicit override (see `commit` — no auto-clear at the
 *  default), so the rendered size matches the stepper value step-for-step and
 *  the stepper stays monotonic. The override survives even when it equals the
 *  default; clearing it (to track the doc-relative default again, BUG #30) is
 *  done from the Fonts… dialog / Smart Preferences reset, not here. */
export default function PanelTextSize({ panelKey }: { panelKey: PanelBodyKey }) {
  const typo = usePanelTypography(panelKey);
  const current = typo?.fontSize ?? DEFAULT_PANEL_TYPOGRAPHY[panelKey].fontSize;

  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>(String(current));
  const displayValue = focused ? draft : String(current);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="flex items-center gap-1 text-xs text-ink-muted"
      onClick={stop}
      onMouseDown={stop}
    >
      <Input
        type="number"
        tone="muted"
        density="dense"
        className="panel-text-size-input text-xs tabular-nums"
        min={MIN}
        max={MAX}
        value={displayValue}
        onFocus={() => { setFocused(true); setDraft(String(current)); }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // Commit immediately on every change — covers native spinner clicks
          // (which focus the input first, so we can't gate on focus state) and
          // typed digits. Empty / invalid input parses to NaN and is skipped,
          // so the user can still backspace before retyping.
          const n = parseInt(raw, 10);
          if (Number.isFinite(n) && n >= MIN && n <= MAX) {
            commit(panelKey, n);
          }
        }}
        onBlur={() => {
          setFocused(false);
          // Final guard: if the user blurred with an out-of-range or empty
          // value, snap-commit a clamped version so the input doesn't leave
          // the typography registry in an inconsistent state.
          const n = parseInt(draft, 10);
          if (Number.isFinite(n)) commit(panelKey, n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
      <span>pts</span>
    </div>
  );
}
