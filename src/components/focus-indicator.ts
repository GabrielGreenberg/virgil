/**
 * THE FOCUS INDICATOR A SHELL SUPPLIES (tasks 2026-08-31-507, 2026-09-03-554).
 *
 * > **A component that OWNS a focusable element supplies that element's focus
 * > indicator.** Where a shell renders the `<button>` / `<input>` / card root
 * > itself and takes only its CLASS from a prop, the indicator is the SHELL's
 * > obligation — stated once, beside the ARIA and the drag isolation it
 * > already owns — never N callers' to remember.
 *
 * `STYLE_GUIDE.md` → "Interaction" → Focus states the law; this leaf is the
 * one DOOR every shell enters, so "the shell supplies one" is structural
 * rather than N per-shell spellings that can drift. Task 507 applied the law
 * to `AnchoredMenu` with a private resolver; task 554 found six more members
 * and retired that resolver onto this door rather than growing a seventh copy.
 *
 * ── Two indicators, because `box-shadow` can be TAKEN ─────────────────
 *
 * The app's ring is a `box-shadow`, and an INLINE `box-shadow` beats every
 * stylesheet rule. So on an element whose elevation is inline — a docked card,
 * whose ambient lift `themedCardStyle` writes inline — `.focus-ring` would
 * strip the UA outline (its `outline: none` is NOT inline, so it lands) and
 * then fail to draw its own: an element with NO indicator at all, strictly
 * worse than never adding the class. That is the `StackIcon` caveat
 * `STYLE_GUIDE.md` records, and the reason this door has a second member.
 *
 *  - {@link FOCUS_RING_CLASS} (`focus-ring`) — the default. Owns `box-shadow`.
 *  - {@link FOCUS_OUTLINE_CLASS} (`focus-outline`) — owns `outline`, the FREE
 *    property on an element whose `box-shadow` is already spoken for.
 *
 * Both resolve to the same 2px `--edge-strong` edge, declared beside each
 * other in `globals.css` so the two spellings cannot drift into two looks.
 *
 * ── Why this file imports NOTHING ────────────────────────────────────
 *
 * Its consumers span `panel-primitives`, `field-primitives`, the menu shell,
 * `HexColorField` and the library-entry link. A facet the layer that needs it
 * cannot import is a facet that gets re-copied — the placement rule
 * `latex-markers.ts` and `node-attr-sets.ts` each earned, arriving in the
 * component tree.
 *
 * CI: `icon-button-a11y-guardrail.test.ts` → "a SHELL that owns a focusable
 * element supplies its indicator" (allowlists: EMPTY for the compose question;
 * the indicator question's postures are per-shell and each states its reason).
 */

/** The app's focus indicator, UNBUNDLED from geometry and palette. Owns the
 *  element's `box-shadow` while `:focus-visible` matches. */
export const FOCUS_RING_CLASS = "focus-ring";

/** The same edge drawn with `outline` — for an element whose `box-shadow` is
 *  taken by an INLINE style (a docked card's ambient lift). */
export const FOCUS_OUTLINE_CLASS = "focus-outline";

export type FocusIndicatorClass =
  | typeof FOCUS_RING_CLASS
  | typeof FOCUS_OUTLINE_CLASS;

/**
 * `className` with the shell's focus indicator APPENDED.
 *
 * Append, never replace: the caller's classes are its own (geometry, ink,
 * spacing) and the indicator is the shell's, so the two compose rather than
 * one silently deleting the other. A caller that passes `iconbtn-xs` to a
 * shell whose default is `iconbtn-sm` is REPLACING geometry deliberately —
 * that is what makes the indicator's separation from geometry load-bearing
 * rather than tidy, since the shell can honour the replacement and still
 * guarantee the ring.
 *
 * Composing with an `iconbtn-*` does NOT double-paint: the five selectors
 * share ONE declaration block in `globals.css`, pinned as source in the
 * census (jsdom resolves no stylesheet, so no render can observe it).
 */
export function withFocusIndicator(
  className?: string,
  indicator: FocusIndicatorClass = FOCUS_RING_CLASS,
): string {
  return className ? `${className} ${indicator}` : indicator;
}
