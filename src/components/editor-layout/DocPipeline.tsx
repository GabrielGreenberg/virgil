"use client";

/**
 * <DocPipeline> — per-doc lifecycle bracket for the React tree.
 *
 * Wraps the subtree that operates on a single doc. On mount it opens a
 * pipeline (via beginDocPipeline) and exposes the resulting handle via
 * Context. On unmount it ends the pipeline. With `key={docId}` on the
 * wrapper (the recommended pattern), every doc switch fully remounts the
 * subtree — no surviving timers, refs, or closures from the previous
 * doc — and the storage layer additionally rejects any write whose
 * pipelineId no longer matches the active pipeline.
 *
 * Hooks inside the pipeline read the handle via `useDocWriteHandle()`
 * and pass it to storage writers. They should not read the docId from
 * any other source for write paths — the handle bundles docId and
 * pipelineId together so closures can't pick up a stale destination.
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  beginDocPipeline,
  endDocPipeline,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";

const HandleContext = createContext<DocWriteHandle | null>(null);

interface DocPipelineProps {
  docId: string;
  children: ReactNode;
}

/**
 * Always render with `key={docId}` so the boundary remounts on every
 * doc switch. Without the key, prop changes would re-run the effect
 * but live state in the subtree (timers, refs) would carry over.
 */
export function DocPipeline({ docId, children }: DocPipelineProps) {
  // useMemo so the handle is stable across renders within the same
  // mount — if it changed each render, downstream useCallback deps
  // would invalidate every render.
  const handle = useMemo(() => beginDocPipeline(docId), [docId]);

  useEffect(() => {
    return () => endDocPipeline(handle);
  }, [handle]);

  return <HandleContext.Provider value={handle}>{children}</HandleContext.Provider>;
}

/** Read the active doc-write handle. Throws if no <DocPipeline> ancestor. */
export function useDocWriteHandle(): DocWriteHandle {
  const handle = useContext(HandleContext);
  if (!handle) {
    throw new Error(
      "useDocWriteHandle: no <DocPipeline> ancestor — wrap doc-state hooks " +
        "in <DocPipeline key={docId} docId={docId}>",
    );
  }
  return handle;
}

/** Optional variant — returns null instead of throwing when there's no
 *  pipeline. Use only at the top of a tree where the pipeline may
 *  legitimately be absent (e.g. Library outer tabs that don't operate
 *  on the active doc). */
export function useDocWriteHandleOrNull(): DocWriteHandle | null {
  return useContext(HandleContext);
}
