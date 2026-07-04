"use client";

import { PopoutButton } from "@/components/panel-primitives";
import { JumpChevron } from "@/components/icons/JumpChevron";

/**
 * Shared INNER content of a TextObject float header — the kind label, a
 * flexible spacer, the jump-to chevron, and the close (X) button.
 *
 * ONE source of truth for the header label + icons, mounted by BOTH:
 *  - `TextObjectFloat` (the real popout) — interactive: `onJump` scrolls
 *    the editor to the source block, `onClose` docks the popout.
 *  - `LiftedTextOverlay` (the lift-gesture ghost's popout-mode chrome) —
 *    visual only: the handlers are omitted and the overlay header is
 *    `pointer-events: none`, so the icons render identically but inert.
 *
 * Only the inner content is shared; the OUTER header container stays
 * per-implementation (the overlay's JS-positioned portal sibling with
 * bg/border/radius from globals.css `.lifted-text-overlay__header`; the
 * real popout's FloatCard flex-row). Both outer containers already share
 * the same flex layout (`align-items: center; gap: 4px; padding: 0 8px;
 * height: 24px`), so this content lays out identically in either.
 *
 * Why this exists (L3d.1): the label used to have two divergent
 * implementations. The overlay forced `font-family: var(--font-sans)`
 * (globals.css `.lifted-text-overlay__label`) while the real popout's span
 * set NO font-family and inherited the body chrome stack
 * `var(--font-sans-override, var(--font-sans)), "Inter", system-ui,
 * sans-serif`. Those coincide only when `--font-sans-override` resolves to
 * Inter and Inter is loaded; with a custom sans font (overlay ignores the
 * override) or during the font-load window (fallback chains differ:
 * `"Inter Fallback"` vs raw `system-ui, sans-serif`) the label changed
 * shape between the overlay and the released popout. The label's
 * font-family is now set EXPLICITLY here to that same body stack, so it is
 * context-independent and identical in both mounts — no label can drift,
 * on any kind. (Closes the shared-header cleanup deferred in L1.7.)
 */

/** The UI-chrome sans stack, mirrored verbatim from `body` (globals.css
 *  ~544) and the other chrome font rules. Set explicitly on the label so
 *  it resolves the same in the editor-column portal (overlay) and under
 *  `document.body` (real popout) — while still honoring the user's
 *  `--font-sans-override`, exactly as the real popout's inherited value
 *  did before. */
const FLOAT_HEADER_FONT_FAMILY =
  'var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif';

/** Inert handler for the overlay's non-interactive X (PopoutButton requires
 *  an `onClick`; the overlay header's `pointer-events: none` means it never
 *  fires). */
const NOOP = () => {};

export interface FloatHeaderContentProps {
  /** The kind label, already resolved to any per-instance override
   *  (e.g. heading → "Chapter" / "Section" / "Subsection"). */
  label: string;
  /** Scroll the editor to the source block. Provided by the real popout;
   *  omitted by the overlay (visual-only). */
  onJump?: () => void;
  /** Dock / close the popout. Provided by the real popout; omitted by the
   *  overlay (visual-only). */
  onClose?: () => void;
}

export function FloatHeaderContent({
  label,
  onJump,
  onClose,
}: FloatHeaderContentProps) {
  const labelNoun = label.toLowerCase();
  return (
    <>
      <span
        className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate"
        style={{ fontFamily: FLOAT_HEADER_FONT_FAMILY }}
      >
        {label}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onJump}
        tabIndex={onJump ? undefined : -1}
        className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
        data-hint={`Jump to ${labelNoun}`}
        aria-label={`Jump to ${labelNoun}`}
      >
        <JumpChevron />
      </button>
      <PopoutButton
        isPoppedOut
        variant="x"
        labelNoun={labelNoun}
        className="iconbtn-xs"
        onClick={onClose ?? NOOP}
      />
    </>
  );
}
