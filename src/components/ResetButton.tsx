"use client";

// The ONE per-row "reset to default" control (task 903).
//
// Preferences had three spellings of it with three behaviours at the default:
// colour rows HID a lowercase underlined "reset", the Smart typography grid kept
// it visible-but-disabled, Fonts… dimmed a capitalised "Reset" to 30% — and the
// slider and font rows had none at all. All raw `<button>`s, none with a name
// that said WHAT it reset.
//
// One behaviour now: the control is ALWAYS present, and at the default it is
// disabled and unpainted, so it keeps its place in the row (the grid's column
// never jumps) without a column of grey "Reset"s saying nothing. It appears the
// moment there is something to reset.

import { Button } from "./Button";

export interface ResetButtonProps {
  onReset: () => void;
  /** True when the value(s) already equal the default — the control disables. */
  atDefault: boolean;
  /** What is being reset ("Line height", "Editor body"). Becomes the accessible
   *  name — "Reset Line height" — so a list of rows is not a list of identical
   *  "Reset" buttons. The visible text stays "Reset" (label-in-name holds). */
  target?: string;
  className?: string;
}

export function ResetButton({ onReset, atDefault, target, className }: ResetButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onReset}
      disabled={atDefault}
      aria-label={target ? `Reset ${target}` : undefined}
      data-hint={atDefault ? undefined : "Reset to default"}
      data-reset-control=""
      className={`${atDefault ? "invisible" : ""} ${className ?? ""}`.trim()}
    >
      Reset
    </Button>
  );
}
