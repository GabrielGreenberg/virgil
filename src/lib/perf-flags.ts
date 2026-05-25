/**
 * Runtime-toggle perf flags for ad-hoc A/B testing in the dev preview.
 *
 * All flags default to false (no behavior change). Set them from the
 * browser DevTools console to disable specific per-keystroke reactors
 * and isolate the dominant cost of typing lag.
 *
 * Usage from the DevTools Console:
 *
 *   // Disable all gated Tier 1 candidates at once:
 *   window.__virgilPerf.disableTier1 = true
 *
 *   // Or individually:
 *   window.__virgilPerf.disableTier1B = true   // section breadcrumb (EditorLayout.tsx)
 *   window.__virgilPerf.disableTier1C = true   // in-render getJSON for popouts (EditorPane.tsx)
 *
 *   // Reset:
 *   window.__virgilPerf = {}
 *
 * Tier 1 A (getJSON + setContent cascade) was traced via this mechanism
 * and then permanently fixed by deferring `editor.getJSON()` into the
 * downstream debounce timers — see the plan file
 * `ok-lets-do-a-dreamy-thacker.md`. The A-specific flag is therefore
 * no longer exported; B and C remain available for future investigation.
 */

declare global {
  interface Window {
    __virgilPerf?: {
      /** Master switch — disables all gated Tier 1 sites at once. */
      disableTier1?: boolean;
      /** B — section breadcrumb compute (src/components/EditorLayout.tsx). */
      disableTier1B?: boolean;
      /** C — in-render getJSON for popouts (src/components/EditorPane.tsx). */
      disableTier1C?: boolean;
    };
  }
}

// Pin the object at module load so the user can do
// `window.__virgilPerf.disableTier1 = true` from the console without
// first having to construct the object.
if (typeof window !== "undefined") {
  window.__virgilPerf ??= {};
}

function isOn(flag: "disableTier1B" | "disableTier1C"): boolean {
  if (typeof window === "undefined") return false;
  const p = window.__virgilPerf;
  if (!p) return false;
  return !!(p.disableTier1 || p[flag]);
}

export const isTier1BDisabled = (): boolean => isOn("disableTier1B");
export const isTier1CDisabled = (): boolean => isOn("disableTier1C");

export {};
