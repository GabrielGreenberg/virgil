/**
 * The shipped preference defaults, in their own LEAF module.
 *
 * `DEFAULT_PREFS` used to live in `usePreferences.ts`, which made the defaults
 * unreachable from anything `usePreferences` itself depends on. `pref-links`
 * derives each link's default delta from them at module load, so the moment the
 * prefs store started consuming `propagate` (task 625 — the link cascade now
 * lives in the ONE writer) the two modules would have formed a runtime import
 * cycle whose hazard is real: if `usePreferences` evaluated first, `pref-links`
 * would read `DEFAULT_PREFS` while it was still in its temporal dead zone and
 * throw at import time.
 *
 * Splitting the value out keeps the graph a DAG —
 * `usePreferences → pref-links → preferences-defaults` — and gives the shipped
 * defaults a single owner. The `EditorPreferences` import below is type-only,
 * so it is erased and adds no runtime edge. `usePreferences` re-exports
 * `DEFAULT_PREFS`, so every existing importer is unchanged.
 */
import type { EditorPreferences } from "./usePreferences";
import defaultPrefsJson from "./usePreferences.defaults.json";

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
export const DEFAULT_PREFS: EditorPreferences = defaultPrefsJson as EditorPreferences;
