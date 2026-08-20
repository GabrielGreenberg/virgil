"use client";

/**
 * React reads of the SAVE STATE (task 392) — the tier ladder over task 391's
 * unsaved-work channel.
 *
 * Two hooks, and the interesting one is the ticker.
 *
 * The channel is deliberately EDGE-driven: it notifies when a state transition
 * happens and never on the passage of time (`noteSaveBlocked` for an unchanged
 * reason records the attempt WITHOUT emitting, so a standing block costs zero
 * re-renders for its whole life). That is right for the store and wrong for a
 * surface whose whole job is to age — a badge reading the same words at minute
 * 1 and minute 70 was the incident's second act.
 *
 * So the ticking lives here, and it schedules **the next interesting moment**
 * rather than polling: the tier boundaries ({@link UNSAVED_WARN_MS},
 * {@link UNSAVED_ESCALATE_MS}) and the next whole-minute of the age label.
 * A clean document schedules nothing at all.
 *
 * KEYSTROKE SANCTITY: no editor subscription anywhere in this file. The store
 * fires once on the clean→dirty edge, so a typing burst costs ONE render; the
 * timer is armed only while the document is dirty and fires at most once a
 * minute after the first minute.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  deriveSaveState,
  UNSAVED_ESCALATE_MS,
  UNSAVED_WARN_MS,
  type SaveStateView,
} from "@/lib/save-state";
import {
  getBlockingFlowRequest,
  subscribeBlockingFlow,
} from "@/lib/save-request";
import type { BlockingFlow } from "@/lib/save-state";
import { getUnsavedWork, subscribeUnsavedWork } from "@/lib/unsaved-work";

/** ms until the next moment at which {@link deriveSaveState} could answer
 *  differently — a tier boundary, or the next whole minute of the label. */
function msUntilNextChange(ageMs: number): number {
  const marks: number[] = [];
  if (ageMs < UNSAVED_WARN_MS) marks.push(UNSAVED_WARN_MS - ageMs);
  if (ageMs < UNSAVED_ESCALATE_MS) marks.push(UNSAVED_ESCALATE_MS - ageMs);
  marks.push(60_000 - (ageMs % 60_000)); // next whole minute of the label
  // A 1 s floor keeps a boundary that has just been crossed (or a clock that
  // jumped) from scheduling a zero-delay loop.
  return Math.max(1_000, Math.min(...marks));
}

/**
 * This document's save state, re-derived on every channel notification AND at
 * each moment the tier or the age label would change.
 */
export function useSaveState(docId: string | null | undefined): SaveStateView {
  const state = useSyncExternalStore(
    subscribeUnsavedWork,
    () => getUnsavedWork(docId),
    () => null,
  );
  const [, bump] = useState(0);
  const dirtySince = state?.dirtySince ?? null;
  useEffect(() => {
    if (dirtySince === null) return; // clean: nothing ages
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        bump((n) => n + 1);
        schedule();
      }, msUntilNextChange(Math.max(0, Date.now() - dirtySince)));
    };
    schedule();
    return () => clearTimeout(id);
  }, [dirtySince]);
  return deriveSaveState(state);
}

/**
 * Open this surface's blocking flow when the Save button routes to it.
 *
 * The surface that OWNS a flow (the external-change badge for a conflict, the
 * preservation badge for a refusal) calls this with its own menu opener. A
 * token it has not answered yet fires the callback exactly once — so the two
 * halves of "Save now" cannot come to disagree about which dialog a reason
 * leads to, because only one of them decides (`describeBlockReason`).
 */
export function useBlockingFlowRequest(
  docId: string | null | undefined,
  flow: BlockingFlow,
  open: () => void,
): void {
  const req = useSyncExternalStore(
    subscribeBlockingFlow,
    getBlockingFlowRequest,
    () => null,
  );
  // The answered token is BOOKKEEPING, not render state — nothing about this
  // hook's output depends on it — so it lives in a ref. Writing it through
  // `setState` inside the effect would schedule a cascading render for a value
  // no one renders.
  const answered = useRef(0);
  useEffect(() => {
    if (!req || req.seq <= answered.current) return;
    if (req.flow !== flow || !docId || req.docId !== docId) return;
    answered.current = req.seq;
    open();
  }, [req, flow, docId, open]);
}
