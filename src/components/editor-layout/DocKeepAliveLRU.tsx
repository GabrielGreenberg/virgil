"use client";

// Multi-doc keep-alive (L2-generalized). The main app can have several authored
// papers open at once; switching between them used to fully unmount + cold-remount
// the editor (re-read .tex + 17 sidecars, re-parse, rebuild TipTap) — the visible
// "Loading…" flash. This keeps the last N authored docs mounted-but-hidden
// (display:none) so a switch is an instant visibility flip, with cursor/scroll/
// content preserved by the warm mount. Same primitive as L3's ReaderLRU:
// useKeepAliveLRU (access-ordered, dedup-by-id) + KeepAliveSlot (display:none +
// the visibility context the EditorPane measurement followers go inert on).
//
// DEDUP / dual-pipeline guard: the LRU id is the BARE docId — exactly the id
// handed to `<DocPipeline key={docId}>` — so a doc appears at most once and two
// pipelines can never fight over the same docId (assertNotSuperseded).

import { useEffect, useRef, type ReactNode } from "react";
import {
  useKeepAliveLRU,
  type KeepAliveEntry,
} from "@/lib/keep-alive/useKeepAliveLRU";
import { KeepAliveSlot } from "@/lib/keep-alive/KeepAliveSlot";

/** 1 visible + 2 warm. Each warm doc holds a live ProseMirror editor + parsed
 *  doc + per-doc sidecar hooks + a DiskWatcher, so this is materially heavier
 *  than the read-only Reader LRU (READER_LRU_CAPACITY = 4). Raise only after
 *  heap profiling shows headroom. */
export const DOC_KEEP_ALIVE_CAPACITY = 3;

/**
 * Authored-doc keep-alive LRU. Thin wrapper over the shared primitive so the
 * call site reads intent. `activeId` is the BARE docId (= the `<DocPipeline
 * key>`), or null when no granted doc is active (which leaves the order intact
 * — warm docs stay hidden).
 */
export function useDocKeepAliveLRU(
  activeId: string | null,
  capacity: number = DOC_KEEP_ALIVE_CAPACITY,
): KeepAliveEntry[] {
  return useKeepAliveLRU(activeId, capacity);
}

/**
 * `KeepAliveSlot` + a per-slot unmount hook. When the slot TRULY unmounts (LRU
 * tail eviction or tab close — NOT a visibility flip), `onUnmount(slotDocId)`
 * fires so the layout can prune this doc's entry from its per-doc
 * editorInstance/paneState maps (and any cached per-slot callbacks).
 *
 * `onUnmount` is read through a ref so the cleanup fires ONLY on a real unmount
 * (the effect deps are just the stable `slotDocId` = the React key); an
 * `onUnmount` identity change can never spuriously prune a still-mounted slot.
 */
export function DocKeepAliveSlot({
  slotDocId,
  isVisible,
  onUnmount,
  children,
}: {
  slotDocId: string;
  isVisible: boolean;
  onUnmount: (slotDocId: string) => void;
  children: ReactNode;
}) {
  const onUnmountRef = useRef(onUnmount);
  onUnmountRef.current = onUnmount;
  useEffect(() => {
    return () => onUnmountRef.current(slotDocId);
  }, [slotDocId]);

  return <KeepAliveSlot isVisible={isVisible}>{children}</KeepAliveSlot>;
}
