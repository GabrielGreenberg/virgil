"use client";

/**
 * useAskQueue — the ONE queue semantics behind every imperative dialog door
 * (task 1447).
 *
 * An imperative dialog hook hands its caller a Promise and renders the
 * question later. Until this primitive, only `SystemDialogProvider` queued
 * (task 833); `useConfirmDialog`, `useDocumentClassMismatchDialog` and
 * `useCollaboratorIdentity` each kept ONE unkeyed `pending` slot, so a second
 * ask while one was open REPLACED it: the first caller's promise never
 * settled (its `await` hung, its cleanup never ran), and the reconciled
 * dialog kept the first ask's focused button — Enter on a chained DANGER
 * confirm pressed the destructive answer.
 *
 * The contract, stated once:
 *  - **FIFO.** `enqueue` appends; only `head` renders.
 *  - **Identity.** Each ask gets a monotonic, never-reused `id`. Render the
 *    head with `key={head.id}` so every ask MOUNTS its own dialog (fresh
 *    focus capture/restore, fresh cued default).
 *  - **Settled exactly once.** `settle(id)` removes the ask and returns it
 *    the FIRST time only (a double click before re-render answers once);
 *    the caller resolves the ask's promise with the answer it chose.
 *  - **Unmount is an ending.** Every outstanding ask is handed to `cancel`
 *    when the owner unmounts, so no promise outlives its door.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface QueuedAsk<A> {
  id: number;
  ask: A;
}

export interface AskQueue<A> {
  /** The ask to render now, or null when the queue is empty. */
  head: QueuedAsk<A> | null;
  enqueue: (ask: A) => void;
  /** Remove the ask with this id. Returns it the first time, then undefined. */
  settle: (id: number) => A | undefined;
}

/**
 * @param cancel How an ask ends when its owner unmounts (resolve the
 *   promise with the door's cancel answer). Read ONCE, at mount — it must
 *   not depend on render state.
 */
export function useAskQueue<A>(cancel: (ask: A) => void): AskQueue<A> {
  const [queue, setQueue] = useState<QueuedAsk<A>[]>([]);
  // Outstanding asks, kept outside React state so `settle` can answer
  // synchronously and the unmount cleanup sees asks not yet committed.
  const outstandingRef = useRef(new Map<number, A>());
  const nextIdRef = useRef(0);
  const cancelRef = useRef(cancel);

  const enqueue = useCallback((ask: A) => {
    const id = ++nextIdRef.current;
    outstandingRef.current.set(id, ask);
    setQueue((q) => [...q, { id, ask }]);
  }, []);

  const settle = useCallback((id: number): A | undefined => {
    const outstanding = outstandingRef.current;
    const ask = outstanding.get(id);
    if (ask === undefined) return undefined;
    outstanding.delete(id);
    setQueue((q) => q.filter((e) => e.id !== id));
    return ask;
  }, []);

  useEffect(() => {
    const outstanding = outstandingRef.current;
    const cancelAsk = cancelRef.current;
    return () => {
      const asks = [...outstanding.values()];
      outstanding.clear();
      for (const ask of asks) cancelAsk(ask);
    };
  }, []);

  return { head: queue[0] ?? null, enqueue, settle };
}
