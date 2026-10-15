/**
 * **The Virgil bar's status policy — what deserves the user's eye, decided
 * once** (task 1131).
 *
 * Every status item the bar's PROTECTED tier mounts (`StatusCluster`, before
 * the collapsible tool group — `bar-occupancy.ts`) used to decide its own
 * visibility: the update chip, the skills-updated notice, the clean
 * "Saved · 22:38" timestamp and the data-integrity badges each self-gated by
 * their own rule. The protected tier is never auto-hidden, so purely
 * informational notices piled up beside the ones that matter. Gabriel
 * (2026-10-15): "unless I absolutely have to see it, no."
 *
 * > **A bar status item is shown only while it is MUST-SEE — it needs an
 * > action, or something is at risk, or the user turned it on.** Each item
 * > reports its state; this table, and nothing else, says whether that state
 * > is must-see. `StatusCluster` mounts its items in {@link BAR_STATUS_ORDER}
 * > (a `Record` over {@link BarStatusItemId}, so an item the table does not
 * > name cannot be mounted), and every item's one visibility return reads
 * > {@link barStatusVisible}. Census: `bar-status-policy.test.tsx`.
 *
 * The bar-occupancy ladder is unchanged: this decides WHAT enters the
 * protected tier, not how the tier yields.
 *
 * Informational state that leaves the bar does not vanish: the skills-sync
 * version and restart hint live on the Help menu's "Refresh skills" row, and
 * the save timestamp is the absence of a save pill (Cmd+S still works).
 */

import type { UpdateState } from "@/hooks/useUpdateAvailable";
import { isSaveTierProtected, type SaveTier } from "@/lib/save-state";

/** The state each item reports to the policy. */
export interface BarStatusStates {
  /** A new service worker is waiting (or activated in another window). The
   *  user asked to keep seeing this one — as a short "Virgil update" chip. */
  "software-update": { update: UpdateState };
  /** An `/editor/*` skill holds the pen — explains why the text is read-only. */
  "cowork-pen": { held: boolean };
  /** A gate refused a write that would drop content. */
  preservation: { standing: boolean };
  /** A mirrored model never reached disk; the user can restore it. */
  "mirror-recovery": { standing: boolean };
  /** A sync daemon left conflicted copies that may hold unseen writing. */
  "sync-conflict": { standing: boolean };
  /** The file changed on disk (autosave may be paused). */
  "external-change": { standing: boolean };
  /** "Is my work on disk?" — only its unsaved/blocked tiers are must-see. */
  "save-state": { tier: SaveTier };
  /** The per-paper skill-bundle sync: a FAILURE is must-see, a success is not. */
  "skill-sync": { failed: boolean };
  /** The writing timer — the user opened it, so it stays. */
  pomodoro: { open: boolean };
}

export type BarStatusItemId = keyof BarStatusStates;

export interface BarStatusPolicyEntry<S> {
  /** Must the user see this state? False ⇒ the item renders nothing. */
  mustSee: (state: S) => boolean;
  /** Why — the one sentence a reader needs before changing the rule. */
  why: string;
}

export const BAR_STATUS_POLICY: {
  readonly [K in BarStatusItemId]: BarStatusPolicyEntry<BarStatusStates[K]>;
} = Object.freeze({
  "software-update": {
    mustSee: (s) => s.update !== "none",
    why: "Gabriel asked to keep it — a one-click update, labelled just “Virgil update”.",
  },
  "cowork-pen": {
    mustSee: (s) => s.held,
    why: "Explains why the editor has stopped accepting typing.",
  },
  preservation: {
    mustSee: (s) => s.standing,
    why: "Virgil is refusing to save this paper — work is at risk.",
  },
  "mirror-recovery": {
    mustSee: (s) => s.standing,
    why: "Unsaved work survived only in the browser and can be restored.",
  },
  "sync-conflict": {
    mustSee: (s) => s.standing,
    why: "Conflicted copies may hold writing Virgil has never shown.",
  },
  "external-change": {
    mustSee: (s) => s.standing,
    why: "The file changed on disk; autosave may be paused until resolved.",
  },
  "save-state": {
    // The task-357 rule, kept: a data-integrity tier is must-see; the
    // reassurance tiers ("Saved · 13:28", "Saving…") are not shown at all.
    mustSee: (s) => isSaveTierProtected(s.tier),
    why: "Shown only once work has not landed (unsaved) or a gate holds it (blocked).",
  },
  "skill-sync": {
    mustSee: (s) => s.failed,
    why: "A failed sync leaves cowork commands stale and needs a retry; a success is informational (Help → Refresh skills).",
  },
  pomodoro: {
    mustSee: (s) => s.open,
    why: "The user opened the timer.",
  },
});

/**
 * The cluster's mount order — the protected tier, left to right. A `Record`
 * keyed by id in `StatusCluster` is built from this list, so the type system
 * refuses an item the table does not name.
 */
export const BAR_STATUS_ORDER: readonly BarStatusItemId[] = Object.freeze([
  "software-update",
  "cowork-pen",
  "preservation",
  "mirror-recovery",
  "sync-conflict",
  "external-change",
  "save-state",
  "skill-sync",
  "pomodoro",
]);

/** The ONE visibility question every bar status item asks. */
export function barStatusVisible<K extends BarStatusItemId>(
  id: K,
  state: BarStatusStates[K],
): boolean {
  return BAR_STATUS_POLICY[id].mustSee(state);
}
