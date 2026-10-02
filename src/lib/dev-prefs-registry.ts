/**
 * Typed loader for `dev-prefs-registry.json` — the single source of
 * truth for which localStorage keys feed the personal-prefs promotion
 * pipeline.
 *
 * (The first-paint CSS seed is NOT here: it is rendered from the ONE
 * pref→CSS table, `pref-css-table.mjs` — task 902.)
 *
 * The JSON is consumed by both the browser-side mirror
 * (`dev-prefs-mirror.ts`) and the Node-side promoter
 * (`tools/promote-defaults.mjs`). Keep them in sync by editing the JSON
 * — never duplicate the list.
 */

import registry from "./dev-prefs-registry.json";

export type PromotionStrategy = "replace-all" | "whitelist" | "print-options" | "bake-transforms";

export interface PromotablePref {
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

export const PROMOTABLE_PREFS: PromotablePref[] =
  registry.promotable as PromotablePref[];

/** Distinct localStorage keys that the mirror should snapshot. */
export const MIRRORABLE_STORAGE_KEYS: readonly string[] = Array.from(
  new Set(PROMOTABLE_PREFS.map((p) => p.storageKey)),
);
