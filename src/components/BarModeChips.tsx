"use client";

/**
 * **The Virgil bar's mode chips** (task 1353) — "a mode the user turned on",
 * rendered in the bar's PROTECTED tier so collapsing the tools never hides it.
 *
 * Each chip used to be hand-placed inside the collapsible tool group, so the
 * Focus-view chip — the mode's own off-switch — vanished with the tools.
 * They are now entries in the bar status policy (`bar-status-policy.ts`) and
 * each renders only through `useBarStatusVisible` with its own id. Zen hides
 * them by design; the policy reads `zen` explicitly (from the zen store here,
 * so no layout prop reaches the protected tier's mount).
 */

import { memo } from "react";
import { useBarStatusVisible } from "@/hooks/useBarStatusVisible";
import { useZenMode } from "@/hooks/useZenMode";

/** Focus view is on — click to turn it off. */
function FocusViewChipImpl({ active, onExit }: { active: boolean; onExit: () => void }) {
  const zen = useZenMode().on;
  const visible = useBarStatusVisible("focus-view", { active, zen });
  if (!visible) return null;
  return (
    <button
      onClick={onExit}
      className="topbarbtn"
      aria-pressed="true"
      data-bar-mode="focus-view"
      data-hint="Focus view"
    >
      Focus view
    </button>
  );
}
export const FocusViewChip = memo(FocusViewChipImpl);

/** Helper mode is on — click to turn it off. */
function HelperModeChipImpl({ on, onExit }: { on: boolean; onExit: () => void }) {
  const zen = useZenMode().on;
  const visible = useBarStatusVisible("helper-mode", { on, zen });
  if (!visible) return null;
  return (
    <button
      onClick={onExit}
      className="topbarbtn"
      aria-pressed="true"
      data-bar-mode="helper-mode"
      data-hint="Exit helper mode"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M5.8 6.2a2.2 2.2 0 0 1 4.08.8c0 1.2-1.68 1.6-1.68 1.6" />
        <circle cx="8" cy="11.5" r="0.3" fill="currentColor" stroke="none" />
      </svg>
      Helper mode
    </button>
  );
}
export const HelperModeChip = memo(HelperModeChipImpl);

/**
 * A compile is running. The ONE in-flight indicator: the Compile tool button
 * only disables while it runs, so the spinner is never shown twice, and a
 * collapsed bar still says the compile is working.
 */
function CompileStatusChipImpl({ compiling }: { compiling: boolean }) {
  const visible = useBarStatusVisible("compile", { compiling });
  if (!visible) return null;
  return (
    <span
      role="status"
      // A topbarbtn's box (24px tall, 4px icon padding) without its hover fill
      // or pointer — this is a readout, not a control.
      className="inline-flex items-center shrink-0 h-6 px-1 text-[var(--ink-subtle)]"
      data-bar-mode="compile"
      data-hint="Compiling…"
      aria-label="Compiling"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </span>
  );
}
export const CompileStatusChip = memo(CompileStatusChipImpl);
