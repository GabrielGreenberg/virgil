/**
 * COMPILE PROGRESS — the compile subsystem's voice (task 454).
 *
 * The save path learned this lesson in task 392: *a gate that stops working
 * SAYS SO, in one voice*. The compiler had no voice at all. A cold compile of a
 * paper using tikz/pgf spends minutes fetching hundreds of packages over serial
 * synchronous XHR, and for that whole time the ONLY pixel that moved anywhere in
 * the app was a 16px spinner in the top bar — which is not even on screen while
 * the user is looking at the PDF pane, the one surface they are waiting on. The
 * PDF pane itself showed a bare dark surface. So "compiling for two minutes" and
 * "broken" were indistinguishable, which is exactly the class task 392 named.
 *
 * This is the same shape as `unsaved-work.ts` / `preservation-notice.ts`: a
 * module store read through `useSyncExternalStore`, because the fact is produced
 * deep inside a promise nobody awaits (the worker's per-fetch postMessage) and
 * consumed by surfaces with no call relationship to the producer (the PDF pane,
 * the top-bar button, the errors panel).
 *
 * Rules this carries:
 *
 *  - **Per document.** Several `EditorPane`s are mounted at once under multi-doc
 *    keep-alive, and the compile service is a module singleton shared by all of
 *    them. A progress record keyed by docId is what keeps pane B from rendering
 *    pane A's compile (AGENTS.md, "Per-doc services under multi-pane
 *    keep-alive"). The store is a registry, not a slot.
 *  - **The phase is what the user is WAITING ON, not an internal step count.**
 *    `fetching` exists because it is the phase that takes minutes and the one a
 *    user can act on (stay online; try again to resume from the cache).
 *  - **Notify is EDGE-ish, not per event.** `noteAssetFetch` is called once per
 *    package download — a few hundred times over a cold compile, i.e. a few per
 *    second — so it is a counter bump plus one notify. It never runs on the
 *    keystroke path (nothing here subscribes to the editor).
 *  - **A terminal state is a RECORD, not an absence.** `finish` stores the
 *    outcome so the pane can say *what happened* rather than falling back to the
 *    generic empty state.
 */

/** What the compile is currently doing, in the user's terms. */
export type CompilePhase =
  /** No compile has run for this doc in this session. */
  | "idle"
  /** Booting the WASM engine (first compile of the session). */
  | "booting"
  /** Reading + preparing the paper's files. */
  | "preparing"
  /** Downloading TeX packages from the mirror — the slow phase. */
  | "fetching"
  /** pdfTeX is running a pass. */
  | "typesetting"
  /** The compile ended. `outcome` says how. */
  | "done";

/** How a finished compile ended — mirrors `CompileStatus` plus `aborted`. */
export type CompileOutcome =
  | "ok"
  | "degraded"
  | "failed"
  | "timeout"
  | "boot-failed"
  | "error";

export interface CompileProgress {
  phase: CompilePhase;
  /** Wall-clock ms since the compile started; 0 when idle. */
  startedAt: number;
  /** Packages downloaded from the mirror during this compile. */
  assetsFetched: number;
  /** The package currently being downloaded, if any. */
  currentAsset: string | null;
  /** 1-based pass number while typesetting. */
  pass: number;
  /** How many passes the plan calls for. */
  totalPasses: number;
  /**
   * Which attempt this is. A cold compile that times out having made real
   * download progress is CONTINUED rather than dead-ended (see
   * `compile-service.ts`), and the user is told which attempt they are watching.
   */
  attempt: number;
  /** Set only when `phase === "done"`. */
  outcome: CompileOutcome | null;
  /** A one-line, user-facing account of a non-ok outcome. */
  message: string | null;
}

export const IDLE_PROGRESS: CompileProgress = {
  phase: "idle",
  startedAt: 0,
  assetsFetched: 0,
  currentAsset: null,
  pass: 0,
  totalPasses: 0,
  attempt: 1,
  outcome: null,
  message: null,
};

const byDoc = new Map<string, CompileProgress>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function update(docId: string, patch: Partial<CompileProgress>): void {
  const prev = byDoc.get(docId) ?? IDLE_PROGRESS;
  byDoc.set(docId, { ...prev, ...patch });
  emit();
}

/** Subscribe to every progress change (the `useSyncExternalStore` half). */
export function subscribeCompileProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Read one document's progress. Returns the SAME frozen `IDLE_PROGRESS` object
 * for an unknown doc, so `useSyncExternalStore`'s snapshot identity check bails
 * the re-render rather than looping on a fresh literal.
 */
export function getCompileProgress(docId: string | null): CompileProgress {
  if (!docId) return IDLE_PROGRESS;
  return byDoc.get(docId) ?? IDLE_PROGRESS;
}

/** A compile is starting (or continuing after a timeout that made progress). */
export function beginCompile(
  docId: string,
  opts?: { attempt?: number; startedAt?: number; assetsFetched?: number },
): void {
  const attempt = opts?.attempt ?? 1;
  const prev = byDoc.get(docId);
  byDoc.set(docId, {
    ...IDLE_PROGRESS,
    phase: "preparing",
    startedAt: opts?.startedAt ?? Date.now(),
    attempt,
    // A continuation keeps the running download count — the number the user is
    // watching go up is the number that says progress is being made ACROSS
    // attempts, which is the whole point of the continuation.
    assetsFetched: opts?.assetsFetched ?? (attempt > 1 ? (prev?.assetsFetched ?? 0) : 0),
  });
  emit();
}

export function notePhase(docId: string, phase: CompilePhase): void {
  update(docId, { phase });
}

export function notePass(docId: string, pass: number, totalPasses: number): void {
  update(docId, { phase: "typesetting", pass, totalPasses });
}

/** One package download started. Bumps the counter and flips to `fetching`. */
export function noteAssetFetch(docId: string, name: string): void {
  const prev = byDoc.get(docId) ?? IDLE_PROGRESS;
  byDoc.set(docId, {
    ...prev,
    phase: "fetching",
    assetsFetched: prev.assetsFetched + 1,
    currentAsset: name,
  });
  emit();
}

export function finishCompile(
  docId: string,
  outcome: CompileOutcome,
  message?: string | null,
): void {
  update(docId, {
    phase: "done",
    outcome,
    message: message ?? null,
    currentAsset: null,
  });
}

/**
 * Test-only: drop every record.
 *
 * There is deliberately NO per-doc reset door. A record that survives a doc
 * close is CORRECT — it describes that document's last compile, which is what
 * the pane should say if the paper is reopened before it is compiled again —
 * and a dead export is worse than an absent one (AGENTS.md, "A registry earns
 * its name by being read"). A page load clears the map.
 */
export function __resetAllCompileProgress(): void {
  byDoc.clear();
  emit();
}
