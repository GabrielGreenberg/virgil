/**
 * Typed loader for `dev-prefs-registry.json` — the single source of
 * truth for which localStorage keys feed the personal-prefs promotion
 * pipeline.
 *
 * The JSON is consumed by both the browser-side mirror
 * (`dev-prefs-mirror.ts`) and the Node-side promoter
 * (`tools/promote-defaults.mjs`). Keep them in sync by editing the JSON
 * — never duplicate the list.
 */

import registry from "./dev-prefs-registry.json";

export type PromotionStrategy = "replace-all" | "whitelist" | "print-options";

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
}

export const PROMOTABLE_PREFS: PromotablePref[] =
  registry.promotable as PromotablePref[];

/** Distinct localStorage keys that the mirror should snapshot. */
export const MIRRORABLE_STORAGE_KEYS: readonly string[] = Array.from(
  new Set(PROMOTABLE_PREFS.map((p) => p.storageKey)),
);

export interface CssVarSpec {
  /** `bucket.key` — `bucket` is one of `editor` | `view`; `key` indexes
   *  into that bucket's resolved defaults object. */
  source: string;
  /** Suffix appended to the value (e.g. `rem`, `px`). */
  unit?: string;
  /** When true, wraps the rendered value in double quotes (used for
   *  font-family names). */
  quote?: boolean;
}

export const CSS_VAR_MAP: Record<string, CssVarSpec> =
  registry.cssVarMap as Record<string, CssVarSpec>;
