"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  createWriteCoalescer,
  type WriteCoalescer,
  type WriteCoalescerOptions,
} from "@/lib/write-coalescer";

/**
 * The ONE write coalescer (task 1327, `@/lib/write-coalescer`) owned by a
 * React component or hook.
 *
 * The coalescer is created once, lazily, and its timing (`delayMs`,
 * `maxWaitMs`) is fixed at that first render — a writer's cadence is its
 * file's, not a prop. `fire` may change every render: the LATEST one runs,
 * synced in an effect, so a fire never closes over a stale `persist` / `save`.
 * The returned object is STABLE for the owner's life (safe in a dependency
 * array) and delegates to the one instance.
 *
 * Lifetime is the caller's: an owner that must deliver a held write on
 * teardown calls `flush()` (or its own settle door) from its cleanup; this
 * hook never cancels on unmount, because a silently dropped write is the
 * failure this primitive exists to prevent.
 */
export function useWriteCoalescer({
  delayMs,
  maxWaitMs,
  fire,
}: WriteCoalescerOptions): WriteCoalescer {
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  });
  const coalescerRef = useRef<WriteCoalescer | null>(null);
  if (coalescerRef.current === null) {
    coalescerRef.current = createWriteCoalescer({
      delayMs,
      maxWaitMs,
      fire: () => fireRef.current(),
    });
  }
  return useMemo<WriteCoalescer>(() => {
    const live = (): WriteCoalescer => coalescerRef.current!;
    return {
      arm: () => live().arm(),
      flush: () => live().flush(),
      cancel: () => live().cancel(),
      get pending() {
        return live().pending;
      },
    };
  }, []);
}
