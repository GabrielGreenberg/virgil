/**
 * Runtime-toggle perf flags for ad-hoc A/B testing in the dev preview.
 *
 * All flags default to false (no behavior change). Set them from the
 * browser DevTools console to disable specific per-keystroke reactors
 * and isolate the dominant cost of typing lag.
 *
 * Usage from the DevTools Console:
 *
 *   // Disable every remaining gated Tier 1 site at once (today: B only):
 *   window.__virgilPerf.disableTier1 = true
 *
 *   // Or individually:
 *   window.__virgilPerf.disableTier1B = true   // section-path recompute on editor update (EditorLayout.tsx)
 *
 *   // Reset:
 *   window.__virgilPerf = {}
 *
 * Tier 1 A (getJSON + setContent cascade) was traced via this mechanism
 * and then permanently fixed by deferring `editor.getJSON()` into the
 * downstream debounce timers — see the plan file
 * `ok-lets-do-a-dreamy-thacker.md`. The A-specific flag is therefore
 * no longer exported.
 *
 * Tier 1 C (the legacy outline `editor.getJSON()` memo in EditorPane.tsx)
 * was retired too (task 1278): that memo is now the DocProducts pipeline's
 * flag-off fallback, reachable only with `virgil:doc-products` OFF — the
 * declared switch for it — so a console gate on it was inert under the
 * default flag set. B remains available for future investigation.
 */

declare global {
  interface Window {
    __virgilPerf?: {
      /** Master switch — disables every remaining gated Tier 1 site (today: B). */
      disableTier1?: boolean;
      /** B — section-path recompute on editor update (src/components/EditorLayout.tsx). */
      disableTier1B?: boolean;
    };
  }
}

// Pin the object at module load so the user can do
// `window.__virgilPerf.disableTier1 = true` from the console without
// first having to construct the object.
if (typeof window !== "undefined") {
  window.__virgilPerf ??= {};
}

function isOn(flag: "disableTier1B"): boolean {
  if (typeof window === "undefined") return false;
  const p = window.__virgilPerf;
  if (!p) return false;
  return !!(p.disableTier1 || p[flag]);
}

export const isTier1BDisabled = (): boolean => isOn("disableTier1B");

export {};
