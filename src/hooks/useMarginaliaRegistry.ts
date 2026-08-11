"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import type { AnchorNodeMetrics } from "@/lib/marginalia";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import {
  getOrCreateGeometry,
  type EditorGeometryService,
} from "@/lib/editor-geometry";

/**
 * Viewport-scoped, on-demand layout registry for UUID-bearing blocks —
 * now a THIN ADAPTER over the editor-attached EditorGeometry service
 * ([src/lib/editor-geometry/](../lib/editor-geometry/service.ts), perf Wave 2
 * C4). The measurement engine this hook used to own (IO near-zone culling,
 * per-block RO, parked metrics, ε bails, gesture parking) moved there
 * verbatim so every geometry consumer shares ONE engine per editor; this
 * hook keeps its exact public surface — `getMetrics`/`subscribe`/`stats` —
 * and its test suite doubles as the service's parity gate.
 *
 * Invariants (unchanged; the service enforces them):
 *   1. Layout state comes from layout observers, never from edit events.
 *   2. Per-block measurements only exist for viewport-near-zone blocks
 *      (±800 px); off-screen blocks resolve to `null`.
 *   3. Cost scales with the size of the change, not with document size.
 *   4. Derived state is pulled on demand via `getMetrics(uuid)`.
 *
 * What the adapter owns: the React lifecycle (retain the engine for this
 * consumer's lifetime) and the keep-alive visibility feed (context → the
 * service's `setVisible`, via a LAYOUT effect so the re-show RO
 * notification — delivered in the post-commit "update the rendering" step —
 * already reads `true`; a passive effect would lose that race and leave
 * markers stale until the next trigger).
 */

export interface MarginaliaRegistry {
  /**
   * Current measurement for `uuid`, or `null` if the block is off-screen,
   * not yet attached, or no longer in the document. Consumers must
   * tolerate `null` by skipping render — that's the correct response
   * (the block isn't visible so its marginalia isn't visible either).
   */
  getMetrics(uuid: string): AnchorNodeMetrics | null;
  /**
   * `useSyncExternalStore`-friendly subscription. The callback fires
   * whenever any cached entry changes. Consumers re-render and re-call
   * `getMetrics` for the UUIDs they care about.
   */
  subscribe(cb: () => void): () => void;
  /** Diagnostic — exposed for the success-criteria test. `version` bumps on
   *  EVERY `notify()` (recompute, intersection enter/leave, observed-set sync),
   *  so it — not `recomputes` — is the correct re-render trigger for consumers
   *  that must reflect an intersection-only cache change. `recomputes` bumps
   *  only on `flushRecompute`. */
  stats(): {
    cached: number;
    observed: number;
    recomputes: number;
    version: number;
  };
}

// The pure measurement primitive stays importable from its historical home
// (the measurement-contract test + external callers).
export { measureBlock } from "@/lib/editor-geometry";

export function useMarginaliaRegistry(
  editor: Editor | null,
): MarginaliaRegistry {
  // Keep-alive: when this editor is hidden (display:none, kept alive across a
  // tab switch) its observers still FIRE — but measuring then would read
  // 0-boxes and cache garbage. The service makes those callbacks INERT while
  // hidden; this adapter feeds it the keep-alive visibility CONTEXT (defaults
  // to `true`, so tests and non-keep-alive callers read "visible").
  const isVisible = useIsVisible();
  const isVisibleRef = useRef(isVisible);

  // Render-safe attach (idempotent, effect-free): consumers may call
  // `getMetrics`/`subscribe` from the very first render, before the engine
  // starts — they resolve against empty state, exactly as the pre-service
  // hook behaved before its effect ran.
  const serviceRef = useRef<EditorGeometryService | null>(null);
  if (editor) {
    if (serviceRef.current?.editor !== editor) {
      serviceRef.current = getOrCreateGeometry(editor);
    }
  } else {
    serviceRef.current = null;
  }

  // LAYOUT effect, not passive: a visibility flip re-renders this consumer
  // and React runs the layout effect synchronously at commit — BEFORE the
  // browser delivers the re-show ResizeObserver notification. The service
  // that re-measures on re-show must already read `true`.
  useLayoutEffect(() => {
    isVisibleRef.current = isVisible;
    serviceRef.current?.setVisible(isVisible);
  }, [isVisible]);

  useEffect(() => {
    if (!editor) return;
    const service = getOrCreateGeometry(editor);
    // Seed visibility before the engine starts (the layout effect above only
    // re-fires on flips; the initial value must land too).
    service.setVisible(isVisibleRef.current);
    const release = service.retain();
    return release;
  }, [editor]);

  return useMemo<MarginaliaRegistry>(
    () => ({
      getMetrics: (uuid: string) =>
        serviceRef.current?.getMetrics(uuid) ?? null,
      subscribe: (cb: () => void) =>
        serviceRef.current ? serviceRef.current.subscribe(cb) : () => {},
      stats: () =>
        serviceRef.current?.stats() ?? {
          cached: 0,
          observed: 0,
          recomputes: 0,
          version: 0,
        },
    }),
    [],
  );
}

/**
 * Convenience hook for consumers that want to re-render whenever the
 * registry's cache changes. Reads through to `getMetrics` per UUID.
 *
 * Snapshots `version` (bumped by every `notify()`), NOT `recomputes`: the
 * service calls `notify()` whenever the cache changes — including a block
 * ENTERING the near-zone via the IntersectionObserver and getting measured,
 * which bumps `version` but NOT `recomputes`. Snapshotting `recomputes`
 * missed intersection-only updates. Still keystroke-safe: plain typing
 * changes nothing in the service → no `notify()` → `version` stays flat.
 */
export function useRegistryVersion(registry: MarginaliaRegistry): number {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.stats().version,
    () => 0,
  );
}
