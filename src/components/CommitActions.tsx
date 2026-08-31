/**
 * COMMIT ACTIONS — the Keep / Dismiss pair for a pending AI change, spelled
 * ONCE (task 2026-08-31-501).
 *
 * ## Why this exists
 *
 * `PendingChangePill` (the fixed margin portal) and `suggestion-fields`'
 * applied-card body each rendered their own copy of this pair: two buttons
 * with the same four announced strings (`aria-label="Keep change"` /
 * `title="Keep"`, `aria-label="Dismiss change"` /
 * `title="Dismiss (restores original, archives the card)"`), the same sizing,
 * and a byte-identical check/cross glyph under two names (`PillGlyph` /
 * `CommitGlyph`). `STYLE_GUIDE.md` → *Buttons* already states the rule that
 * forbids it — "spell the treatment ONCE per control family, not once per
 * button (task 309)".
 *
 * There was no visible divergence when this was extracted, which is precisely
 * the window in which to do it: the affirmative half of both pairs carried a
 * raw `text-emerald-600 hover:bg-emerald-50` while the destructive half four
 * lines away read the token family (`hover:bg-danger-soft hover:text-danger`),
 * so one row of one control was governed two ways.
 *
 * ## What is shared and what is NOT
 *
 * Shared: the two buttons, their announced strings, their sizing, their glyph,
 * and their colour — the affirmative half now reads the `--positive` role
 * family (`text-positive-ink hover:bg-positive-soft`), exactly mirroring the
 * destructive half.
 *
 * Not shared: the CONTAINER. The pill's is a fixed portal with its own chrome
 * and its own `role="group"`; the card's is a right-aligned row inside a
 * header. Each call site keeps its own, which is why this renders a fragment.
 *
 * ## The pointer policy is a REQUIRED prop, not a branch
 *
 * The one genuine behavioural difference between the two call sites is how the
 * pair answers a POINTER event, and the two answers are opposite:
 *
 *  - the pill is a fixed portal painted OVER the editor, so a mousedown must
 *    not blur the editor / clear the selection before the click registers;
 *  - the card sits inside a card header whose own mousedown begins a LIFT
 *    gesture, so a mousedown must not reach it.
 *
 * Neither is guessable from inside this component, so the call site states it
 * (`pointerPolicy`) and there is no default — a defaulted argument here would
 * be a decision nobody made, and getting it wrong is silent in both directions
 * (a lost selection, or a card that lifts when you meant to click Keep).
 */
import type { ReactElement } from "react";

/** A check (Keep) / cross (Dismiss) glyph. ONE implementation — this used to be
 *  `PillGlyph` in `PendingChangePill.tsx` and `CommitGlyph` in
 *  `suggestion-fields.tsx`, byte-identical apart from a `flex-shrink-0`. */
export function CommitGlyph({ kind }: { kind: "check" | "cross" }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      aria-hidden
    >
      {kind === "check" ? (
        <polyline points="20 6 9 17 4 12" />
      ) : (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
    </svg>
  );
}

/**
 * How the pair answers a pointer event. Named by the SITUATION rather than by
 * the DOM call, so a third call site has to say which one it is in rather than
 * copy an incantation.
 *
 *  - `"portal-over-editor"` — a fixed portal above the editor. The click
 *    `preventDefault()`s as well as stopping propagation; the pair installs no
 *    mousedown handler of its own, because the portal's own container owns the
 *    blur guard for its whole surface (its padding included, which a
 *    per-button handler would not cover).
 *  - `"inside-lifting-card"` — inside a card whose header owns a lift gesture.
 *    The pair stops mousedown from reaching that gesture, and the click stops
 *    propagation so the card does not also treat it as a selection.
 */
export type CommitPointerPolicy = "portal-over-editor" | "inside-lifting-card";

/** The shared button treatment. Affirmative and destructive halves differ only
 *  by their ROLE colours, and both now read a role family rather than a raw
 *  palette literal. */
const COMMIT_BUTTON_BASE =
  "inline-flex items-center justify-center h-6 w-6 rounded-md " +
  "disabled:opacity-40 disabled:pointer-events-none transition-colors focus-ring";

export const KEEP_BUTTON_CLASS =
  `${COMMIT_BUTTON_BASE} text-positive-ink hover:bg-positive-soft`;

export const DISMISS_BUTTON_CLASS =
  `${COMMIT_BUTTON_BASE} text-ink-subtle hover:bg-danger-soft hover:text-danger`;

export interface CommitActionsProps {
  /** Keep — finalize the suggested text. */
  onKeep: () => void;
  /** Dismiss — restore the original + archive the card. NEVER deletes. */
  onDismiss: () => void;
  /** Defensive disable (the card surface uses it when the controller is off). */
  disabled?: boolean;
  /** REQUIRED — see `CommitPointerPolicy`. */
  pointerPolicy: CommitPointerPolicy;
}

export function CommitActions({
  onKeep,
  onDismiss,
  disabled = false,
  pointerPolicy,
}: CommitActionsProps): ReactElement {
  const stopsMouseDown = pointerPolicy === "inside-lifting-card";
  const onMouseDown = stopsMouseDown
    ? (e: React.MouseEvent) => e.stopPropagation()
    : undefined;
  const commit = (run: () => void) => (e: React.MouseEvent) => {
    if (pointerPolicy === "portal-over-editor") e.preventDefault();
    e.stopPropagation();
    run();
  };

  return (
    <>
      {/* Check — keep (finalize the suggested text). */}
      <button
        type="button"
        aria-label="Keep change"
        title="Keep"
        disabled={disabled}
        onMouseDown={onMouseDown}
        onClick={commit(onKeep)}
        className={KEEP_BUTTON_CLASS}
      >
        <CommitGlyph kind="check" />
      </button>
      {/* Cross — dismiss (restore original + archive; never deletes). */}
      <button
        type="button"
        aria-label="Dismiss change"
        title="Dismiss (restores original, archives the card)"
        disabled={disabled}
        onMouseDown={onMouseDown}
        onClick={commit(onDismiss)}
        className={DISMISS_BUTTON_CLASS}
      >
        <CommitGlyph kind="cross" />
      </button>
    </>
  );
}
