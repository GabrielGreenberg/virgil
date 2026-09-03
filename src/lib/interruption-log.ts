/**
 * **The interruption PROVENANCE log** — task 545, member 1.
 *
 * Gabriel: *"Occasionally I'm being prompted for: do you want to keep your
 * copy, or the copy on disk? The answer is always my copy."* Which external
 * writer causes those prompts cannot be answered from the code — two
 * hypotheses fit (task 489's own residual: the AI's commit surfaces as an
 * anonymous change once the pen is released; or a sync daemon landing a
 * different version) — so the app records enough at each detection to answer
 * it from a real session.
 *
 * A ring buffer, read at `window.__interruptionStats()` (the sibling of
 * `__layoutGestureStats` / `__settleConvergenceStats`). Each entry carries
 * the verdict AND the two times it was derived from, so a misattribution is
 * visible as a fact rather than hidden behind a label. Dev-only in effect:
 * nothing reads it in production, and an entry costs one object.
 */

import type { ExternalWriter } from "./cowork-pen";
import type { InterruptionKind } from "./document-interruption";

export interface InterruptionEvent {
  docId: string;
  kind: InterruptionKind;
  /** When the surface began showing this state. */
  at: number;
  /** The DiskWatcher's own detection time, for the external kinds. */
  detectedAt: number | null;
  writer: ExternalWriter;
  /** The pen trace the verdict was read from. */
  penHeld: boolean;
  penLastReleasedAt: number | null;
  /** How long the document's work had been unsaved at that moment. */
  unsavedAgeMs: number;
}

const MAX = 50;
const events: InterruptionEvent[] = [];

/** Record one presentation. Deduped on `(docId, kind, detectedAt)` so a
 *  re-render, or two surfaces reading one view, cannot double-count. */
export function recordInterruptionEvent(e: InterruptionEvent): void {
  const last = events[events.length - 1];
  if (
    last &&
    last.docId === e.docId &&
    last.kind === e.kind &&
    last.detectedAt === e.detectedAt
  ) {
    return;
  }
  events.push(e);
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function interruptionEvents(): readonly InterruptionEvent[] {
  return events;
}

/** Test seam. */
export function __resetInterruptionLogForTests(): void {
  events.length = 0;
}

declare global {
  interface Window {
    __interruptionStats?: () => {
      events: readonly InterruptionEvent[];
      byWriter: Record<ExternalWriter, number>;
    };
  }
}

if (typeof window !== "undefined") {
  window.__interruptionStats = () => {
    const byWriter: Record<ExternalWriter, number> = { "virgil-ai": 0, unknown: 0 };
    for (const e of events) {
      if (e.kind === "conflict" || e.kind === "disk-change") byWriter[e.writer]++;
    }
    return { events, byWriter };
  };
}
