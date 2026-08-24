"use client";

import { iconHint } from "@/components/Hint";
import { IconBlank } from "./panel-icons";

/**
 * The strip's BLANK-THIS-GUTTER toggle: hide every omni card on one side and
 * leave an empty margin.
 *
 * Extracted (task 424) because its NAME is a decision, and a decision needs a
 * home. It shipped as `iconHint({ label: "Omni view" })` — named for the
 * surface it SUPPRESSES, so a screen-reader user heard "Omni view, toggle
 * button, pressed" at exactly the moment the omni view was empty, and a
 * sighted user got a tooltip that said nothing about what pressing it does.
 * The polarity was never wrong: `IconBlank`'s own glyph signals "suppress omni
 * — leave a truly empty canvas on this side", so `aria-pressed=true` + the
 * accent tint (the `.iconbtn-toggle[aria-pressed="true"]` "this mode is on"
 * convention) are CORRECT for the mode being toggled. The NAME was for the
 * mode's inverse.
 *
 * **Which reading was taken:** a SINGLE STABLE name for the MODE, not a
 * state-dependent one. A toggle button announces its state through
 * `aria-pressed`, so a name that flips with the state double-announces it —
 * "Show omni cards, pressed" reads as a control that is *already* showing.
 * Every sibling in this pod is the same shape (`"Toggle sidebar"` beside a
 * live `aria-pressed`). The TOOLTIP, which has no state channel of its own,
 * *is* state-dependent through `iconHint`'s `hint` — so the sighted user is
 * told what pressing it does, from the same call site.
 *
 * Visible on the shipped default with no gesture: `useViewPrefs.defaults.json`
 * ships `omniHideAllCards: { left: true, right: false }`, so on a fresh
 * profile the left strip's button is already pressed and accented while the
 * left gutter shows nothing.
 */
export function OmniBlankToggle({
  hidden,
  onToggle,
}: {
  /** Whether this side's omni cards are currently suppressed. */
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="iconbtn-md iconbtn-toggle"
      aria-pressed={hidden}
      {...iconHint({
        label: "Blank this gutter",
        hint: hidden
          ? "Show omni cards in this gutter again"
          : "Blank this gutter — hide every omni card on this side",
      })}
    >
      <IconBlank active={hidden} />
    </button>
  );
}
