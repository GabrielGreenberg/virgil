/**
 * Load-time defensive filter for the three panel-id carriers in ViewPrefs.
 *
 * THE ROOT FIX for the recurring stale-snapshot incidents (the retired
 * `quotations` panel kept round-tripping: saved prefs → the dev:preview
 * snapshot → promote-defaults → shipped `*.defaults.json`). A panel removed
 * from the codebase must never survive a prefs load: this drops any id/key
 * that is no longer a member of its carrier's live registry SSOT, so the
 * removed id can't propagate forward through any of those hops.
 *
 * Each carrier validates against a DIFFERENT canonical set — they are NOT
 * interchangeable:
 *
 *  1. `placements`           → keys of PANEL_REGISTRY      (PanelKind)
 *     [src/panels/panel-registry.ts]
 *  2. `omniCategories`       → OMNI_PANELS kinds            (omni-eligible
 *     PanelKinds) [OMNI_PANELS in src/panels/panel-registry.ts]
 *  3. `printOptions.panels`  → keys of PRINT_PANELS         (PrintPanelKey)
 *     [src/lib/print.ts]
 *
 * Design contract:
 *  - PURELY SUBTRACTIVE: only drops unknowns. Never injects a missing panel
 *    here — the DEFAULT_* merges in the loader already supply those.
 *  - ALLOWLIST, not denylist: the valid-id sets are derived FROM the live
 *    registries, so this auto-tracks any future panel removal without a
 *    hardcoded list of retired ids.
 *  - ORDER- and SIDE-preserving for the surviving entries.
 *  - MALFORMED-SAFE: bad input shapes return a sane empty/passthrough value
 *    instead of throwing.
 *
 * This is a pure module: it imports only the three registry SSOTs (all
 * tiptap/storage-free), so it (and its test) load without mocks in the
 * default node vitest env.
 */
import { PANEL_REGISTRY, OMNI_PANELS } from "@/panels/panel-registry";
import { PRINT_PANELS } from "@/lib/print";

/** Live allowlists, derived once from the registries. */
const PLACEMENT_ID_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(PANEL_REGISTRY));
const OMNI_CATEGORY_ALLOWLIST: ReadonlySet<string> = new Set(OMNI_PANELS.map((e) => e.kind));
const PRINT_PANEL_KEY_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(PRINT_PANELS));

/**
 * Drop placements whose `id` is not a live PANEL_REGISTRY key. Preserves the
 * order and `side` of the survivors. Non-array input → []; entries that aren't
 * `{ id }` objects are dropped.
 */
export function filterPlacements<T extends { id?: unknown }>(placements: unknown): T[] {
  if (!Array.isArray(placements)) return [];
  return placements.filter(
    (p): p is T =>
      p != null &&
      typeof p === "object" &&
      typeof (p as { id?: unknown }).id === "string" &&
      PLACEMENT_ID_ALLOWLIST.has((p as { id: string }).id),
  );
}

/**
 * Drop omni-category ids (per side) that are not omni-eligible PanelKinds.
 * Preserves order. Non-array side value → []. Non-string / unknown entries
 * dropped.
 */
export function filterOmniSide(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is string => typeof c === "string" && OMNI_CATEGORY_ALLOWLIST.has(c),
  );
}

/**
 * Drop omni-category ids on BOTH sides. Tolerates a missing/malformed
 * container by treating each side independently (missing side → []).
 */
export function filterOmniCategories(
  omni: unknown,
): { left: string[]; right: string[] } {
  const src = (omni && typeof omni === "object" ? omni : {}) as {
    left?: unknown;
    right?: unknown;
  };
  return {
    left: filterOmniSide(src.left),
    right: filterOmniSide(src.right),
  };
}

/**
 * Drop print-panel keys that are not live PRINT_PANELS keys. Preserves the
 * boolean value of each surviving key (and insertion order). Non-object input
 * → {}.
 */
export function filterPrintPanels(panels: unknown): Record<string, boolean> {
  if (!panels || typeof panels !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(panels as Record<string, unknown>)) {
    if (PRINT_PANEL_KEY_ALLOWLIST.has(k)) out[k] = Boolean(v);
  }
  return out;
}
