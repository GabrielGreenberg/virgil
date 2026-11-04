/**
 * `virgil:multi-doc-keepalive` — the paper↔paper instant-switch rollout flag.
 *
 * The keep-alive substrate (the per-doc LRU + DocKeepAliveSlot render block) is
 * always present; the flag only sets the effective LRU capacity:
 *   - ON  → capacity 3 (1 visible + 2 warm): instant paper↔paper switching.
 *   - OFF → capacity 1: the legacy behavior — one mounted doc, evicted and
 *           cold-remounted on a switch (a same-docId paper↔Library bounce never
 *           evicts, so that keep-alive still works at capacity 1).
 *
 * **Default ON** (proven: tsc + full suite green, two adversarial-verification
 * workflows greenlit, live-validated); the localStorage key is the OPT-OUT
 * escape hatch. Declared in `src/lib/feature-flags.ts`. A suite that needs the
 * OFF branch calls `setFlagOverride("virgil:multi-doc-keepalive", false)`
 * directly — the module once published a wrapper for that which nothing ever
 * called (task 1466).
 */
import { readFlag } from "@/lib/feature-flags";

/** True when multi-doc keep-alive (capacity > 1) is enabled. Default ON. */
export function isMultiDocKeepAliveOn(): boolean {
  return readFlag("virgil:multi-doc-keepalive");
}
