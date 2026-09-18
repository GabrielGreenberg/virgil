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
  // One door: `setPanelTypographyField` stores the explicit value, except at
  // the live doc-relative default, where it clears instead (task 626). The
  // stepper stays monotonic either way — `usePanelBodyStyle` always ships an
  // inline `font-size`, so a cleared field renders at exactly the default the
  // stepper is showing; what changes is that the panel goes back to TRACKING
  // the document's body size instead of being pinned at today's number.
  setPanelTypographyField(key, "fontSize", clamped);
}

/** Compact text-size stepper for a panel's three-dots menu — designed to
 *  sit inline alongside the panel's color swatch and view toggle.
 *
 *  Layout:  [ 14 ] pts
 *
 *  Uses the native number-input spinner (forced always-visible via
 *  `panel-text-size-input` styles in globals.css). Every step/typed value goes
 *  through `setPanelTypographyField`, which stores it as an explicit override
 *  unless it equals the live doc-relative default — in which case it clears,
 *  so the panel tracks the document's body size again (BUG #30 / task 626).
 *  Stepping away and back therefore leaves no pin behind. */
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
