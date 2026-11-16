/**
 * Typed loader for `dev-prefs-registry.json` — the single source of
 * truth for which localStorage keys feed the personal-prefs promotion
 * pipeline.
 *
 * (The first-paint CSS seed is NOT here: it is rendered from the ONE
 * pref→CSS table, `pref-css-table.mjs` — task 902.)
 *
 * The JSON is read by the browser-side mirror (`dev-prefs-mirror.ts`,
 * through this loader) and by the Node-side tools — `promote-defaults.mjs`,
 * `check-prefs-coverage.mjs`, `sync-defaults.sh` — which find a row by its
 * `id`, never by a restated key or path. Each row's `storageKey` is pinned
 * to its runtime owner's exported constant by
 * `__tests__/dev-prefs-registry-keys-census.test.ts` (task 1654). Edit the JSON —
 * never duplicate the list.
 */

import registry from "./dev-prefs-registry.json";

type PromotionStrategy = "replace-all" | "whitelist" | "print-options" | "bake-transforms";

interface PromotablePref {
  /** Stable row handle the Node tools and the key census look rows up by. */
  id: string;
  /** localStorage key whose JSON value flows into the snapshot. */
  storageKey: string;
  /** Optional sub-path inside the parsed JSON to extract before
   *  applying. Used by `print-options` to pull `printOptions` out of
   *  the global ViewPrefs blob. */
  subPath?: string;
  /** Path (relative to repo root) of the defaults file the value is
   *  merged into. */
  defaultsFile: string;
  /** How the source merges onto the existing defaults JSON. */
  strategy: PromotionStrategy;
  /** Required for `strategy === "whitelist"`. The only top-level keys
   *  permitted to flow through. */
  whitelist?: readonly string[];
  /** Required for `strategy === "bake-transforms"`: the storage key whose
   *  RAW colours the snapshot's transforms are baked from (task 902). */
  rawFrom?: string;
}

const PROMOTABLE_PREFS: PromotablePref[] =
  registry.promotable as PromotablePref[];

/** Distinct localStorage keys that the mirror should snapshot. */
export const MIRRORABLE_STORAGE_KEYS: readonly string[] = Array.from(
  new Set(PROMOTABLE_PREFS.map((p) => p.storageKey)),
);
