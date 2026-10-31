"use client";

/**
 * **The Virgil bar's mode chips** (task 1353) — "a mode the user turned on",
 * rendered in the bar's PROTECTED tier so collapsing the tools never hides it.
 *
 * Each chip used to be hand-placed inside the collapsible tool group, so the
 * Focus-view chip — the mode's own off-switch — vanished with the tools.
 * They are now entries in the bar status policy (`bar-status-policy.ts`): each
 * renders only through `useBarStatusVisible` with its own id, and through the
 * bar's one pill (`BarStatusPill`, `mode` register for a mode the user turned
 * on). Zen hides the modes by design; the policy reads `zen` explicitly (from
 * the zen store here, so no layout prop reaches the protected tier's mount).
 */

import { memo } from "react";
import { useBarStatusVisible } from "@/hooks/useBarStatusVisible";
import { useZenMode } from "@/hooks/useZenMode";
import { BarStatusPill } from "@/components/status/BarStatusPill";
import { useCollabContext } from "@/hooks/useCollab";

/** Focus view is on — click to turn it off. */
function FocusViewChipImpl({ active, onExit }: { active: boolean; onExit: () => void }) {
  const zen = useZenMode().on;
  const visible = useBarStatusVisible("focus-view", { active, zen });
  if (!visible) return null;
  return (
    <BarStatusPill
      tone="mode"
      label="Focus view"
      ariaLabel="Focus view — click to turn it off"
      hint="Exit focus view"
      onActivate={onExit}
      data={{ "data-bar-mode": "focus-view" }}
    />
  );
}
export const FocusViewChip = memo(FocusViewChipImpl);

function HelperIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.8 6.2a2.2 2.2 0 0 1 4.08.8c0 1.2-1.68 1.6-1.68 1.6" />
      <circle cx="8" cy="11.5" r="0.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Helper mode is on — click to turn it off. */
function HelperModeChipImpl({ on, onExit }: { on: boolean; onExit: () => void }) {
  const zen = useZenMode().on;
  const visible = useBarStatusVisible("helper-mode", { on, zen });
  if (!visible) return null;
  return (
    <BarStatusPill
      tone="mode"
      glyph={<HelperIcon />}
      label="Helper mode"
      ariaLabel="Helper mode — click to turn it off"
      hint="Exit helper mode"
      onActivate={onExit}
      data={{ "data-bar-mode": "helper-mode" }}
    />
  );
}
export const HelperModeChip = memo(HelperModeChipImpl);

/**
 * **Is any mode chip showing?** (task 1391) — the ONE answer, read from the
 * same policy verdicts the chips render through (`useBarStatusVisible` per
 * mode id, settle rule included) and the same sources they read (the zen
 * store, the one `CollabContext`). The bar's mode/tools divider asks this
 * rather than re-deriving "a mode is on" from layout props, so a divider can
 * never paint beside an empty mode segment — whatever a mode entry's
 * `settleMs`, and whichever collab source would have answered first.
 */
export function useAnyBarModeVisible({
  focusActive,
  helperOn,
}: {
  focusActive: boolean;
  helperOn: boolean;
}): boolean {
  const zen = useZenMode().on;
  const collab = useCollabContext();
  const focus = useBarStatusVisible("focus-view", { active: focusActive, zen });
  const helper = useBarStatusVisible("helper-mode", { on: helperOn, zen });
  const collabOn = useBarStatusVisible("collab", { enabled: !!collab.enabled, zen });
  return focus || helper || collabOn;
}

/**
 * The boundary between the mode chips (TIER 1, just left of the tool group)
 * and the standard tools. A memoized leaf, so a collab pen/presence tick
 * re-renders only this span, not the cluster that mounts it.
 */
function BarModeDividerImpl({ focusActive, helperOn }: { focusActive: boolean; helperOn: boolean }) {
  if (!useAnyBarModeVisible({ focusActive, helperOn })) return null;
  return (
    <span
      aria-hidden
      data-bar-mode-divider=""
      className="self-center h-5 w-px mr-2"
      // Its left side already has the status segment's trailing
      // `--bar-occupant-gap` (a mode chip is visible, so the segment is
      // non-empty — the predicate above guarantees it); top it up to the same
      // 8px as the right rather than adding a second, independent margin.
      style={{ background: "var(--edge-strong)", marginLeft: "calc(0.5rem - var(--bar-occupant-gap))" }}
    />
  );
}
export const BarModeDivider = memo(BarModeDividerImpl);

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * A compile is running. The ONE in-flight indicator: the Compile tool button
 * only disables while it runs, so the spinner is never shown twice, and a
 * collapsed bar still says the compile is working.
 */
function CompileStatusChipImpl({ compiling }: { compiling: boolean }) {
  const visible = useBarStatusVisible("compile", { compiling });
  if (!visible) return null;
  return (
    <BarStatusPill
      tone="quiet"
      glyph={<SpinnerIcon />}
      label="Compiling"
      ariaLabel="Compiling the PDF"
      hint="Compiling the PDF…"
      data={{ "data-bar-mode": "compile" }}
    />
  );
}
export const CompileStatusChip = memo(CompileStatusChipImpl);
