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
 * **The settle rule (task 1174).** Must-see is a judgement about a state that
 * LASTS. Gabriel (2026-10-18): "'unsaved' warnings … last for a few seconds
 * and then disappear. If it's that short, I don't want to see it." So each
 * entry also declares `settleMs` — how long the state must stay must-see
 * before it paints — and an optional `immediate` for states where work is
 * genuinely at risk. The items read the verdict through ONE hook,
 * `useBarStatusVisible`, which records the edge and arms ONE timer to the
 * boundary (owned by the component's `ViewLifetime`); a state that clears
 * inside its window never paints at all.
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
import type { UnsavedBlockReason } from "@/lib/unsaved-work";

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
  /** The file changed on disk (autosave may be paused). `atRisk` — the user
   *  has unlanded edits against it (the watcher's `conflict` severity). */
  "external-change": { standing: boolean; atRisk: boolean };
  /** "Is my work on disk?" — only its unsaved/blocked tiers are must-see.
   *  `reason` is the blocking reason (`null` outside the blocked tier). */
  "save-state": { tier: SaveTier; reason: UnsavedBlockReason | null };
  /** The per-paper skill-bundle sync: a FAILURE is must-see, a success is not. */
  "skill-sync": { failed: boolean };
  /** The writing timer — the user opened it, so it stays. */
  pomodoro: { open: boolean };
  /**
   * MODES THE USER TURNED ON (task 1353). Each chip doubles as the mode's
   * off-switch, so it must survive the bar's collapse. `zen` is read here,
   * explicitly, because zen strips these chips by design (zen is the mode
   * that hides chrome) — the policy states that, rather than a layout gate
   * around the mount.
   */
  "focus-view": { active: boolean; zen: boolean };
  /** Helper mode (instant hints everywhere) (same zen rule as `focus-view`). */
  "helper-mode": { on: boolean; zen: boolean };
  /** Collaborator mode's pen-state badge (same zen rule as `focus-view`). */
  collab: { enabled: boolean; zen: boolean };
  /** A compile is running — its ONE in-flight indicator (the Compile tool
   *  button only disables), so a collapsed bar still shows progress. */
  compile: { compiling: boolean };
}

export type BarStatusItemId = keyof BarStatusStates;

export interface BarStatusPolicyEntry<S> {
  /** Must the user see this state? False ⇒ the item renders nothing. */
  mustSee: (state: S) => boolean;
  /**
   * THE SETTLE RULE (task 1174): how long, in ms, a state must STAY must-see
   * before it paints. A must-see verdict is a judgement about a state that
   * LASTS — a state that clears itself inside this window never reaches the
   * bar at all. `0` paints at once. Required, so every item declares it.
   */
  settleMs: number;
  /** A must-see state that skips the settle window (work genuinely at risk). */
  immediate?: (state: S) => boolean;
  /** Why — the one sentence a reader needs before changing the rule. */
  why: string;
}

/** A cowork skill's hold is one atomic commit and normally clears in a
 *  moment; only a hold that lasts deserves the bar. */
const COWORK_SETTLE_MS = 10_000;

export const BAR_STATUS_POLICY: {
  readonly [K in BarStatusItemId]: BarStatusPolicyEntry<BarStatusStates[K]>;
} = Object.freeze({
  "software-update": {
    mustSee: (s) => s.update !== "none",
    settleMs: 0,
    why: "Gabriel asked to keep it — a one-click update, labelled just “Virgil update”.",
  },
  "cowork-pen": {
    mustSee: (s) => s.held,
    settleMs: COWORK_SETTLE_MS,
    why: "Explains why the editor has stopped accepting typing.",
  },
  preservation: {
    mustSee: (s) => s.standing,
    settleMs: 0,
    why: "Virgil is refusing to save this paper — work is at risk.",
  },
  "mirror-recovery": {
    mustSee: (s) => s.standing,
    settleMs: 0,
    why: "Unsaved work survived only in the browser and can be restored.",
  },
  "sync-conflict": {
    mustSee: (s) => s.standing,
    settleMs: 0,
    why: "Conflicted copies may hold writing Virgil has never shown.",
  },
  "external-change": {
    mustSee: (s) => s.standing,
    // Virgil's own write, or a sync service's, can blip and reconcile in
    // seconds; only edits the user has not landed make it urgent.
    settleMs: 5_000,
    immediate: (s) => s.atRisk,
    why: "The file changed on disk; autosave may be paused until resolved.",
  },
  "save-state": {
    // The task-357 rule, kept: a data-integrity tier is must-see; the
    // reassurance tiers ("Saved · 13:28", "Saving…") are not shown at all.
    // Task 1174: a cowork hold is the cowork-pen pill's to explain — one event,
    // one pill — and the save pill clears 1.5 s after the pen releases, so
    // showing it here only ever doubled or trailed the pen pill.
    mustSee: (s) =>
      isSaveTierProtected(s.tier) && !(s.tier === "blocked" && s.reason === "cowork"),
    // `unsaved` already means 20 s off disk; since the autosave debounce has
    // a maxWait it cannot age there through typing, and the settle window
    // keeps a slow write that is about to land from flashing.
    settleMs: 10_000,
    // A refusal, a failed write or an unresolved conflict is not coming to
    // clear itself — it shows at once.
    immediate: (s) => s.tier === "blocked",
    why: "Shown only once work has not landed (unsaved) or a gate holds it (blocked).",
  },
  "skill-sync": {
    mustSee: (s) => s.failed,
    settleMs: 0,
    why: "A failed sync leaves cowork commands stale and needs a retry; a success is informational (Help → Refresh skills).",
  },
  pomodoro: {
    mustSee: (s) => s.open,
    settleMs: 0,
    why: "The user opened the timer.",
  },
  "focus-view": {
    mustSee: (s) => s.active && !s.zen,
    settleMs: 0,
    why: "The user turned Focus view on; the chip is its off-switch, so collapsing the tools must not hide it (zen hides it by design).",
  },
  "helper-mode": {
    mustSee: (s) => s.on && !s.zen,
    settleMs: 0,
    why: "The user turned Helper mode on; the chip is its off-switch (zen hides it by design).",
  },
  collab: {
    mustSee: (s) => s.enabled && !s.zen,
    settleMs: 0,
    why: "Collaborator mode is on: who holds the pen decides whether typing lands (zen hides it by design).",
  },
  compile: {
    mustSee: (s) => s.compiling,
    settleMs: 0,
    why: "A compile can run for minutes; with the tools collapsed nothing else says it is still working.",
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
  "compile",
  // The user's modes sit last, against the tool group's divider — where they
  // sat before task 1353 moved them out of the collapsible tier.
  "focus-view",
  "helper-mode",
  "collab",
]);

/** Is this state MUST-SEE (before the settle rule)? Pure. */
export function barStatusVisible<K extends BarStatusItemId>(
  id: K,
  state: BarStatusStates[K],
): boolean {
  return BAR_STATUS_POLICY[id].mustSee(state);
}

/**
 * The full verdict, settle rule included: `hidden` (not must-see), `now`
 * (paint this frame), or `settle` (must-see, but it has not yet lasted the
 * entry's {@link BarStatusPolicyEntry.settleMs}). Items read it through the
 * ONE hook, `useBarStatusVisible`, which owns the single settle timer — no
 * item component carries a timer of its own.
 */
export type BarStatusVerdict = "hidden" | "now" | "settle";

export function barStatusVerdict<K extends BarStatusItemId>(
  id: K,
  state: BarStatusStates[K],
): BarStatusVerdict {
  const entry = BAR_STATUS_POLICY[id] as BarStatusPolicyEntry<BarStatusStates[K]>;
  if (!entry.mustSee(state)) return "hidden";
  if (entry.settleMs <= 0 || entry.immediate?.(state)) return "now";
  return "settle";
}
