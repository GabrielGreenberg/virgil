"use client";

import { useState } from "react";
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
 *  `panel-text-size-input` styles in globals.css). Stepping or typing
 *  back to the panel's default clears the override automatically. */
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
      <input
        type="number"
        className="panel-text-size-input bg-surface-muted-strong border border-edge-subtle rounded text-xs tabular-nums text-ink-body focus:outline-none focus:ring-1 focus:ring-edge-hover"
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
