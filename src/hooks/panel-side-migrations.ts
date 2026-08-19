/**
 * Load-time one-shot PANEL SIDE migrations — the third member of the prefs
 * migration family, beside the purely subtractive `dropUnknownPanelIds` and the
 * additive/rewrite `rename-panel-id`.
 *
 * A pure module: it imports only TYPES, so `useViewPrefs.ts` can value-import it
 * with no cycle and its suite runs in the bare node env with no mocks.
 *
 * ## Why this one cannot be idempotent by construction (task 381)
 *
 * A RENAME is self-cancelling: once the retired id is gone from the blob, the
 * rewrite matches nothing and re-running it is free. A SIDE flip is not — the
 * user may deliberately drag the panel back, and a migration that re-applied on
 * every load would silently undo that on the next reload, forever. So a side
 * migration carries a stable `id` and is recorded in
 * `ViewPrefs.appliedPrefMigrations` once applied.
 *
 * That record is a GLOBAL pref, and deliberately so: `placements` is global
 * (`STRUCTURAL_GLOBAL_PREF_KEYS`), so a per-window marker would let every other
 * window re-apply the flip over a deliberate drag.
 *
 * ## Why a migration exists at all
 *
 * `loadPrefs` merges `DEFAULT_PREFS.placements` only for placement ids the
 * stored blob is MISSING, so a shipped `defaultStripSide` change reaches exactly
 * nobody who has ever opened the app. And the Tue/Fri promote-defaults cron
 * folds the personal snapshot's `placements` back over the shipped JSON — so
 * without the migration a defaults-only flip is not merely inert, it is UNDONE
 * on the next cron tick (the aiMarker-resurrection shape, task 326). Once the
 * migration has moved the stored value, the snapshot folds the NEW side and the
 * cron converges instead of reverting.
 */
import type { Side } from "./useViewPrefs";

/** One panel-side flip, applied at most once per browser profile.
 *
 *  - `id` — stable, recorded in `appliedPrefMigrations`. Never reuse or rename:
 *    the id IS the "already ran" evidence.
 *  - `panel` — the placement id to move.
 *  - `from` — the flip applies ONLY to a stored placement on this side, so a
 *    user who has already moved the panel somewhere deliberate is untouched.
 *  - `to` — the new side.
 *
 *  Typed as plain `string` for `panel` for the same reason `PanelRename` is: a
 *  migration outlives the union it was written against. */
export interface PanelSideMigration {
  readonly id: string;
  readonly panel: string;
  readonly from: Side;
  readonly to: Side;
}

/** The shipped side migrations, as DATA. */
export const PANEL_SIDE_MIGRATIONS: readonly PanelSideMigration[] = [
  // Task 381 — Gabriel: "make the default location for the Reports panel the
  // RIGHT side strip". Provenance-blind clobber of a stored `left` is the
  // resolved decision (sole user); a later deliberate drag back to left sticks,
  // because the id is recorded the first time this runs.
  { id: "2026-08-19-reports-right", panel: "reports", from: "left", to: "right" },
] as const;

interface SidedEntry {
  id?: unknown;
  side?: unknown;
}

/**
 * Apply every side migration this blob has not already recorded.
 *
 * PURE: returns the SAME arrays when nothing changed, so an
 * already-migrated blob costs one scan and no allocation. Malformed input is
 * left untouched rather than thrown on — the loader's `try` would otherwise
 * turn one bad key into a full reset to defaults.
 *
 * A migration whose panel is ABSENT from `placements`, or present on some other
 * side, is still RECORDED as applied: it had its one chance, and the stored
 * value it would have changed either does not exist (the loader's default merge
 * supplies the new side) or is a deliberate user choice this must not fight.
 */
export function applyPanelSideMigrations(
  placements: unknown,
  applied: unknown,
  migrations: readonly PanelSideMigration[],
): { placements: unknown; applied: string[]; changed: boolean } {
  const appliedIds = Array.isArray(applied)
    ? applied.filter((x): x is string => typeof x === "string")
    : [];
  const pending = migrations.filter((m) => !appliedIds.includes(m.id));
  if (pending.length === 0) {
    return { placements, applied: appliedIds, changed: false };
  }

  let nextPlacements = placements;
  if (Array.isArray(placements)) {
    let touched = false;
    const out = placements.map((entry) => {
      if (entry == null || typeof entry !== "object") return entry;
      const e = entry as SidedEntry;
      const hit = pending.find((m) => e.id === m.panel && e.side === m.from);
      if (!hit) return entry;
      touched = true;
      return { ...(entry as Record<string, unknown>), side: hit.to };
    });
    if (touched) nextPlacements = out;
  }

  return {
    placements: nextPlacements,
    applied: [...appliedIds, ...pending.map((m) => m.id)],
    changed: true,
  };
}
