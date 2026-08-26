/**
 * **The save-state VOCABULARY** — task 392.
 *
 * Task 391 built the channel ([[unsaved-work.ts]]): one per-document fact,
 * `dirtySince` / `lastLandedAt` / `reason`, written by every gate that can
 * stop a write and cleared by nothing but a write that actually landed. What
 * it did not build is the other half of the incident's lesson — **the user
 * could not tell.** Autosave WAS "working properly" on 2026-08-19; it was
 * deliberately paused by a correct guard, and each mechanism that can stop a
 * write spoke its own dialect: a pill for the conflict, a different pill for a
 * preservation refusal, a `console.error` for an FSA throw, nothing at all for
 * a wedged lock. There was no one place that answered the only question the
 * user has: **is my work on disk?**
 *
 * > **One channel, one vocabulary, one tier ladder.** The channel says WHAT is
 * > true; this module says what that MEANS — which tier the surfaces render,
 * > how the age reads, what each blocking reason is called, and which flow the
 * > user has to resolve to get out of it. Every save-state surface reads it
 * > here: a second copy of "what does `reason: conflict` mean" is how the
 * > dialects came about in the first place.
 *
 * Pure and React-free on purpose. The tier is a function of the channel
 * snapshot and the clock, so it is testable without a DOM, and the surfaces
 * that render it (the topbar badge, the update banner's blocked list) cannot
 * come to disagree about when amber becomes red.
 *
 * ## The tiers, and why the thresholds are where they are
 *
 * - **`clean`** — nothing typed since the last landed write. A *reassurance*,
 *   not a data-integrity notice: it may be collapsed away (see
 *   {@link isSaveTierProtected}).
 * - **`pending`** — dirty, unblocked, young. This is the ordinary state
 *   between a keystroke and the 1500 ms debounce landing, and it is NOT a
 *   warning: a badge that turned amber every time you typed a word would be
 *   furniture within a day, which is precisely how the incident's pill went
 *   unread for seventy minutes.
 * - **`unsaved`** — dirty, unblocked, and older than {@link UNSAVED_WARN_MS}.
 *   Nothing has *declined* the write, but it has not landed either. Twenty
 *   seconds against a 1500 ms debounce is generous by an order of magnitude,
 *   and it has to be: `debouncedSave` re-arms on every keystroke, so a
 *   genuinely continuous typing burst holds a document dirty with nothing
 *   wrong. What it says at twenty seconds is nonetheless TRUE — the last
 *   twenty seconds of writing are not on disk — and it clears itself 1500 ms
 *   after the user stops.
 * - **`blocked`** — a gate said no, and said why. Red immediately: there is no
 *   grace period for a write that has already been refused.
 *
 * `escalated` crosses {@link UNSAVED_ESCALATE_MS} of unsaved work in the
 * `unsaved` or `blocked` tiers. The incident ran seventy minutes behind a pill
 * nobody saw, so past two minutes the surface stops being a pill.
 */

import type { UnsavedBlockReason, UnsavedWorkState } from "./unsaved-work";

/** Dirty-and-unblocked for longer than this reads as a WARNING, not as the
 *  ordinary gap between a keystroke and the debounce. See the tier notes. */
export const UNSAVED_WARN_MS = 20_000;

/** Unsaved for longer than this stops being a pill (task 392: "the incident
 *  ran 70 minutes on a pill nobody saw"). Generous by design — an escalation
 *  that fires during normal work is one the user learns to ignore. */
export const UNSAVED_ESCALATE_MS = 120_000;

export type SaveTier = "clean" | "pending" | "unsaved" | "blocked";

export interface SaveStateView {
  tier: SaveTier;
  /** How long this document's work has been off disk, in ms. 0 when clean. */
  ageMs: number;
  /** The blocking reason, or `null` in every tier but `blocked`. */
  reason: UnsavedBlockReason | null;
  /** ms epoch of the last landed write, or `null` if none this session. */
  lastLandedAt: number | null;
  /** Past {@link UNSAVED_ESCALATE_MS} in a non-clean, non-pending tier. */
  escalated: boolean;
}

/**
 * The one derivation. `null` state (a document nothing has touched yet, or no
 * document at all) reads as `clean` with no landed clock — the honest answer:
 * there is nothing unsaved, and nothing has been saved either.
 */
export function deriveSaveState(
  state: UnsavedWorkState | null,
  now: number = Date.now(),
): SaveStateView {
  const lastLandedAt = state?.lastLandedAt ?? null;
  if (!state || state.dirtySince === null) {
    return { tier: "clean", ageMs: 0, reason: null, lastLandedAt, escalated: false };
  }
  const ageMs = Math.max(0, now - state.dirtySince);
  const escalated = ageMs >= UNSAVED_ESCALATE_MS;
  if (state.reason !== null) {
    return { tier: "blocked", ageMs, reason: state.reason, lastLandedAt, escalated };
  }
  if (ageMs >= UNSAVED_WARN_MS) {
    return { tier: "unsaved", ageMs, reason: null, lastLandedAt, escalated };
  }
  // Young, unblocked dirt: a write is on its way. Not a warning.
  return { tier: "pending", ageMs, reason: null, lastLandedAt, escalated: false };
}

/**
 * May a layout preference hide this tier?
 *
 * The rule task 357 wrote for the preservation banner, stated once for the
 * whole ladder: **a data-integrity notice must not be hideable by a layout
 * preference — but a reassurance may be.** "Saved · 13:28" is chrome; "Not
 * saving — the file changed on disk" is not.
 */
export function isSaveTierProtected(tier: SaveTier): boolean {
  return tier === "unsaved" || tier === "blocked";
}

/** "47 minutes", "2 minutes", "a few seconds" — the age the user recognises. */
export function describeAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "a few seconds";
  if (mins === 1) return "1 minute";
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours === 1 && rest === 0) return "1 hour";
  if (rest === 0) return `${hours} hours`;
  return `${hours}h ${rest}m`;
}

/**
 * Which surface owns the flow that is holding this write.
 *
 * The load-bearing half of the vocabulary, and the reason "Save now" is not
 * just a flush: **a Save that silently re-refuses is the incident's silence
 * with a button on it.** When a reason names a flow, the button ROUTES to the
 * surface that owns it (see `save-request.ts`) rather than re-implementing the
 * user's decision — a conflict is answered by choosing a side, a preservation
 * refusal by acknowledging what will be lost, and neither is a call a Save
 * button is entitled to make on the user's behalf.
 */
export type BlockingFlow = "external-change" | "preservation";

export interface BlockDescription {
  /** The pill's own words. Short enough for a 32 px bar. */
  short: string;
  /** One sentence: what happened, and what the user has to do. */
  sentence: string;
  /** The surface that owns the way out, or `null` when retrying IS the way
   *  out (an FSA/lock error has no flow to open — it has a next attempt). */
  flow: BlockingFlow | null;
  /** What the "Save now" button says in this tier. */
  action: string;
}

/** The reason vocabulary. Exhaustive over `UnsavedBlockReason` by the switch's
 *  `never` arm, so a new reason cannot ship without stating its words. */
export function describeBlockReason(
  reason: UnsavedBlockReason,
): BlockDescription {
  switch (reason) {
    case "conflict":
      return {
        short: "Not saving — the file changed on disk",
        sentence:
          "Another app or a sync service changed this paper's file, so Virgil " +
          "paused saving rather than overwrite it. Choose which version to keep.",
        flow: "external-change",
        action: "Resolve…",
      };
    case "preservation":
      return {
        short: "Not saving — Virgil couldn't fully read this file",
        sentence:
          "Virgil is refusing to save because its version of this document " +
          "holds less than the file on disk does. Answer that notice to decide.",
        flow: "preservation",
        action: "Review…",
      };
    case "cowork":
      return {
        short: "Virgil is editing this paper",
        sentence:
          "A Virgil cowork skill is writing to this paper's folder, so saving " +
          "is paused and the text is read-only until it finishes. This " +
          "normally takes a moment and clears itself.",
        // No flow: there is nothing for the user to answer. The hold is one
        // atomic commit and the pen self-expires, so the way out is to wait —
        // and "Try again" is the honest button for a state whose resolution IS
        // a next attempt (the same shape `error` takes, for the same reason).
        flow: null,
        action: "Try again",
      };
    case "error":
      return {
        short: "Not saving — the last save failed",
        sentence:
          "The last write to this paper's folder failed. Check that Virgil " +
          "still has permission to the folder, then try again.",
        flow: null,
        action: "Try again",
      };
    default: {
      const unhandled: never = reason;
      void unhandled;
      return {
        short: "Not saving",
        sentence: "Virgil could not write this paper to disk.",
        flow: null,
        action: "Try again",
      };
    }
  }
}

/** "Saved · 13:28" — the clean tier's reassurance. */
export function describeLandedAt(at: number | null): string {
  if (at === null) return "Saved";
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Saved · ${hh}:${mm}`;
}
