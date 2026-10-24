/**
 * COMPILE RECORD — the per-DOCUMENT owner of a compile's run state and RESULT
 * (task 1277).
 *
 * `compile-progress.ts` already said, per document, what a compile is DOING.
 * What it PRODUCED — the log, the numeric status, the diagnostics, the PDF
 * bytes — and whether one is RUNNING lived in React state inside the
 * `useLatexCompile` instance of the pane that pressed the button. Under
 * multi-doc keep-alive that pane can be UNMOUNTED mid-compile (the LRU evicts
 * the least-recent pane when a 4th paper opens, and a cold tikz compile takes
 * minutes), and with it went the result: the PDF write ran on a mount-time
 * handle the unmount had ended, the bytes were delivered to a dead callback,
 * the log/diagnostics setStates were dropped, and the reopened pane's fresh
 * hook said "not compiling" beside a pane status that said "Fetching
 * packages…". Two SSOTs with two different owners.
 *
 * So the document owns the whole record (the per-doc-services law: "a
 * module-level value that is per-DOCUMENT is a REGISTRY keyed by its owner").
 * `runCompileForDoc` writes it; every pane surface — the Compile button, the
 * Errors panel, the log drawer, the PDF view — READS it, so a pane mounted
 * after the run started (or after it finished) sees exactly what one mounted
 * throughout would have.
 *
 * Retention: the last PDF's bytes stay in the record for the session, one per
 * compiled document — that is what lets a pane mounted after the run show the
 * PDF the run produced, even when no write pipeline was open to persist it. A
 * page load clears the map (like `compile-progress`).
 */

import type { LatexError } from "@/lib/latex-errors";

export interface CompileRecord {
  /** A run for this doc is in flight (from the click to the last write). */
  running: boolean;
  /** Raw pdfTeX log of the most recent finished run, or null if none yet. */
  log: string | null;
  /** Numeric status of the most recent run (0 = a PDF exists). */
  status: number | null;
  /** Salted diagnostics of the most recent run. */
  errors: LatexError[];
  /** The most recent run's PDF bytes, or null if no run produced one. */
  pdf: Uint8Array | null;
  /** Bumps on every new `pdf` — the edge a reader delivers on. 0 = none. */
  pdfGeneration: number;
  /** Wall-clock ms the current `pdf` was produced; 0 when none. */
  pdfAt: number;
}

const EMPTY_COMPILE_RECORD: CompileRecord = Object.freeze({
  running: false,
  log: null,
  status: null,
  errors: [],
  pdf: null,
  pdfGeneration: 0,
  pdfAt: 0,
}) as CompileRecord;

const byDoc = new Map<string, CompileRecord>();
const listeners = new Set<() => void>();
/** Per-doc run counter — the diagnostics salt (see `nextCompileSalt`). */
const runCounter = new Map<string, number>();

function emit(): void {
  for (const fn of listeners) fn();
}

function update(docId: string, patch: Partial<CompileRecord>): void {
  const prev = byDoc.get(docId) ?? EMPTY_COMPILE_RECORD;
  byDoc.set(docId, { ...prev, ...patch });
  emit();
}

/** Subscribe to every record change (the `useSyncExternalStore` half). */
export function subscribeCompileRecord(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Read one document's record — the SAME frozen empty record for an unknown
 *  doc, so a `useSyncExternalStore` snapshot bails rather than loops. */
export function getCompileRecord(docId: string | null): CompileRecord {
  if (!docId) return EMPTY_COMPILE_RECORD;
  return byDoc.get(docId) ?? EMPTY_COMPILE_RECORD;
}

/** True while a run for `docId` is in flight — the re-entry guard every
 *  pane's Compile press reads, so a remounted pane cannot start a second run
 *  under a live one. */
export function isCompileRunning(docId: string): boolean {
  return getCompileRecord(docId).running;
}

/**
 * Mark a run as started. Returns false (and changes nothing) when one is
 * already running for this doc — the caller must not proceed.
 */
export function markCompileStarted(docId: string): boolean {
  if (isCompileRunning(docId)) return false;
  update(docId, { running: true });
  return true;
}

export function markCompileEnded(docId: string): void {
  update(docId, { running: false });
}

/**
 * A fresh per-run salt for this doc's diagnostics ids, so the same logical
 * error compiled twice gets a NEW id and `pruneDismissed` (P5) re-surfaces a
 * re-occurring error instead of leaving it hidden by a stale dismissal. Per
 * DOCUMENT and monotonic for the session — a remounted pane can no longer
 * restart the count and re-mint an id an earlier run already used.
 */
export function nextCompileSalt(docId: string): string {
  const n = (runCounter.get(docId) ?? 0) + 1;
  runCounter.set(docId, n);
  return `r${n}:`;
}

/** Publish a finished run's result. A `pdf` bumps the PDF generation. */
export function recordCompileResult(
  docId: string,
  result: { log: string; status: number; errors: LatexError[]; pdf?: Uint8Array | null },
): void {
  const prev = getCompileRecord(docId);
  const patch: Partial<CompileRecord> = {
    log: result.log,
    status: result.status,
    errors: result.errors,
  };
  if (result.pdf) {
    patch.pdf = result.pdf;
    patch.pdfGeneration = prev.pdfGeneration + 1;
    patch.pdfAt = Date.now();
  }
  update(docId, patch);
}

/** Test-only: drop every record. */
export function __resetAllCompileRecords(): void {
  byDoc.clear();
  runCounter.clear();
  emit();
}
