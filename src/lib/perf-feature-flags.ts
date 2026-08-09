/**
 * perf-feature-flags — body-class perf experiment flags (perf Wave 4).
 *
 * Some perf switches are CSS-scoped: a rule keyed on a `body.<flag>` class,
 * so flipping them needs no rebuild and no per-element JS. This module is
 * the SSOT for reading those flags from localStorage and stamping the body
 * classes — one place, one naming convention, applied at pane boot.
 *
 * Current flags:
 *  - `virgil:perf-contain` → `body.perf-contain` (Stage A containment:
 *    `contain: layout style` on card/omni/panel/float containers —
 *    globals.css "Wave-4 Stage A"). DEFAULT OFF until soak: containment
 *    changes containing-block semantics for absolutely-positioned
 *    descendants, so it ships as an opt-in experiment first (the same
 *    soak discipline as `virgil:card-tiers`).
 *
 * Deliberately NOT here: the per-call kill-switches (`virgil:print-gate`,
 * `virgil:doc-products`, `virgil:geom-*`, `virgil:card-tiers`) — those gate
 * JS paths and are read where they gate. This module owns only flags whose
 * consumer is a stylesheet.
 *
 * Flags are read at apply time; a flip takes effect on reload (the same
 * contract every other `virgil:*` switch has). No storage listener — this
 * is not a store with setters, and the cross-window-storage law governs
 * snapshot-caching stores, not boot-time reads.
 */

export function perfContainEnabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("virgil:perf-contain") === "on"
    );
  } catch {
    return false;
  }
}

/** Stamp the body classes from the current flag values. Idempotent; call
 *  from the app shell's mount effect. */
export function applyPerfBodyFlags(): void {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle("perf-contain", perfContainEnabled());
}
