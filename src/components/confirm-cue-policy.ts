/**
 * Confirm-dialog POLICY — the two rules that map a message's `tone` onto the
 * dialog's BUTTONS, stated once for every confirm door.
 *
 * Virgil has TWO imperative confirm doors and they are separate
 * implementations: `useConfirmDialog()` (`ConfirmDialog.tsx`) and
 * `useSystemDialog()` (`system-dialog-host.tsx`). Both must answer the same two
 * questions about the same `tone`, and for as long as the second door existed
 * it hand-derived both answers — so a `tone: "danger"` confirm opened with the
 * DESTRUCTIVE button cued and `Enter` ran the destruction (task 528).
 *
 * This is an import-free LEAF for the reason `latex-markers.ts` and
 * `node-attr-sets.ts` each earned: **a facet the layer that needs it cannot
 * import will be re-copied.** `ConfirmDialog.tsx` is a React component module
 * that pulls the suppression store and the whole dialog shell; the host cannot
 * take that edge for two pure functions, so the functions live where both can
 * reach them. `ConfirmDialog.tsx` re-exports both, so no existing caller moved.
 *
 * The two rules answer DIFFERENT questions and must not be conflated:
 *
 *   - `confirmDialogCuedDefault` — WHICH button is cued (task 386). A
 *     data-safety rule about the keyboard.
 *   - `confirmActionVariant` — whether the button that COMMITS is painted
 *     destructive. A claim about the AFFORDANCE (STYLE_GUIDE, "the destructive
 *     / alarm family"): red says *pressing this destroys content without a
 *     net*. A button that commits NOTHING is never painted red, whatever the
 *     message's tone — which is why an alert's sole dismiss button spells
 *     `variant="primary"` outright and does not ask this function at all.
 */

export type ConfirmTone = "default" | "danger";

/** Which footer button a confirm dialog CUES — the one that takes initial focus
 *  and that `Enter` therefore activates.
 *
 *  A `default`-tone confirm cues its primary action, which is what a confirm
 *  dialog is for. A **danger** confirm cues its SAFEST button instead: Cancel
 *  where there is one, else the secondary answer, else nothing.
 *
 *  This is a data-safety rule, not a styling preference (task 386). Every
 *  danger confirm in the app opens under fingers that are already moving —
 *  the reporting case was a card TITLE being typed when a stray `Backspace`
 *  reached the card shell: the dialog mounted with `Delete` focused, and the
 *  very next keystroke of ordinary typing pressed it. From the keyboard's point
 *  of view "Backspace, keep typing" WAS "delete the card". A destructive
 *  default armed under a still-typing user is the trap wherever the dialog
 *  opens from, so the rule is global rather than per-caller — and per-DOOR
 *  rather than per-implementation, which is what task 528 closed: the *Reset
 *  example document* confirm reached the OTHER door and opened with **Reset**
 *  focused, one `Enter` from a destruction with no undo and no
 *  `virgil/.history/` slot, on the very gesture (a menu row the user has just
 *  activated) that leaves a hand on `Enter`.
 *
 *  The danger action stays fully keyboard-reachable — Tab, then Enter — which
 *  is the right cost for a deliberate destructive choice. `hideCancel` +
 *  `danger` (a single-button danger notice) cues nothing: there is no safe
 *  button to move focus to, and cueing the only button would re-arm the trap.
 *  `SystemDialog` focuses its frame in that case, so `Escape` still works and a
 *  stray `Enter` does nothing. */
export function confirmDialogCuedDefault(opts: {
  tone?: ConfirmTone;
  hideCancel?: boolean;
  hasSecondary?: boolean;
}): "confirm" | "cancel" | "secondary" | "none" {
  if (opts.tone !== "danger") return "confirm";
  if (!opts.hideCancel) return "cancel";
  if (opts.hasSecondary) return "secondary";
  return "none";
}

/**
 * How the button that **commits** a confirm's action is painted.
 *
 * `danger` for a destructive confirm, `primary` otherwise — the one-line rule
 * that both confirm doors used to spell by hand, four attributes away from the
 * cue they also spelled by hand. One fork, two attributes; unifying only the
 * cue would have left the same disease live one prop over.
 *
 * **It takes no "does this commit?" parameter, and that omission is the rule.**
 * A button that commits nothing is never painted destructive — so the question
 * is not *should this red button be red*, it is *is this the committing
 * button at all*. A dismiss-only button (an alert's sole `OK`) answers that
 * with a literal `variant="primary"` at its own site and never reaches here;
 * a parameter would let a caller ask the destructive question about a button
 * that has no destructive answer.
 */
export function confirmActionVariant(tone?: ConfirmTone): "danger" | "primary" {
  return tone === "danger" ? "danger" : "primary";
}
