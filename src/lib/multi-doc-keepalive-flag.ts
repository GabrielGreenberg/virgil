/**
 * Feature flag for multi-doc keep-alive (the paper↔paper instant-switch
 * rollout).
 *
 * `virgil:multi-doc-keepalive` (localStorage) gates whether more than ONE
 * authored doc stays mounted-but-hidden at a time. The keep-alive substrate (the
 * per-doc LRU + DocKeepAliveSlot render block) is always present; the flag only
 * sets the effective LRU capacity:
 *   - ON  → capacity 3 (1 visible + 2 warm): instant paper↔paper switching.
 *   - OFF → capacity 1: exactly the legacy behavior — one mounted doc,
 *           evicted-and-cold-remounted on a switch (the paper↔Library bounce
 *           keep-alive from L2 still works at capacity 1, since a same-docId
 *           bounce never evicts).
 *
 * **Default is now ON** (the feature is proven: tsc + full suite green, two
 * adversarial-verification workflows GREENLIT, live-validated). The localStorage
 * key is the OPT-OUT escape hatch: set `virgil:multi-doc-keepalive` to `"0"` (or
 * `"false"`) to fall back to the single-doc behavior without a code change.
 */

const FLAG_KEY = "virgil:multi-doc-keepalive";

/**
 * Test/runtime override. `undefined` → fall back to the localStorage value;
 * `true`/`false` → force the flag.
 */
let override: boolean | undefined;

/** True when multi-doc keep-alive (capacity > 1) is enabled. Default ON; the
 *  only way to turn it off is the localStorage opt-out (`"0"`/`"false"`). */
export function isMultiDocKeepAliveOn(): boolean {
  if (override !== undefined) return override;
  // SSR: report OFF (capacity 1). The capacity is read client-side in a
  // useMemo on mount, and the initial render has a single open doc (one slot)
  // either way, so this never causes a hydration mismatch.
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(FLAG_KEY);
    return v !== "0" && v !== "false";
  } catch {
    return true;
  }
}

/**
 * Force the flag (tests, or an explicit toggle). Pass `undefined` to clear the
 * override and fall back to localStorage.
 */
export function setMultiDocKeepAliveFlag(value: boolean | undefined): void {
  override = value;
}
