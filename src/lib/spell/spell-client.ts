/**
 * The spellcheck client (task 518) — a per-WORD verdict cache in front of the
 * worker, so the decoration pass can be SYNCHRONOUS.
 *
 * ## Why a cache, and why the pass is two-phase
 *
 * A decoration pass has to turn "which words in this paragraph are wrong" into
 * document positions, and positions move. If the pass awaited a worker round
 * trip in the middle, the answers would come back describing a document that
 * had already changed. So the round trip is moved OUT of the pass:
 *
 *   Phase A — tokenize the touched blocks, collect the words this cache has no
 *             verdict for, and if there are any, `await ensure(...)` and
 *             re-schedule. Nothing is drawn.
 *   Phase B — every word now has a cached verdict, so the pass reads the LIVE
 *             document and builds decorations synchronously.
 *
 * The cache is also what makes a re-check nearly free: a paper's vocabulary is
 * bounded and small (a few thousand distinct words), so the second pass over a
 * paragraph asks the worker nothing at all. It is never evicted for the same
 * reason.
 *
 * ## Availability is a FACT the surface reads, not an exception
 *
 * If the worker cannot be constructed (SSR, vitest, CSP) — or dies mid-session —
 * the client falls back to the main thread, and a request stranded by the
 * crash is answered THERE rather than reported as a failure. If the DICTIONARY
 * itself cannot be loaded, there is no checker at all — and the honest answer
 * then is not "no squiggles" but "give the surface back to the browser's
 * checker", which is why `spellEngineAvailable()` is published rather than
 * swallowed. See `spellcheck-decorator.ts`, which owns that hand-back.
 *
 * ## …and a RECOVERABLE fact (task 580)
 *
 * A failed load is usually TRANSIENT — the first open offline before the
 * service worker had precached the dictionary, one flaky fetch — which is why
 * the worker (and the main-thread fallback) deliberately never cache a
 * rejected engine promise. Until task 580 that retry was dead code: a failure
 * set a latch, the latch made the port report DISABLED, a disabled surface
 * never asks the client again, and the only reset lived inside a successful
 * ask. So one failure cost the whole session. Three rules now:
 *
 *   - **The CLIENT owns the retry**, not the surface. While failed, a bounded
 *     back-off probe ({@link SPELL_RETRY_BASE_MS}, doubling to
 *     {@link SPELL_RETRY_CAP_MS}) re-asks, and so do the two edges that
 *     observe a recovered network — the tab RETURN edge and `online`. The
 *     surface stays handed to the browser throughout, so an offline session
 *     never flickers between two underlines on each probe.
 *   - **A failure caches NO verdict.** Recording every asked word KNOWN meant a
 *     misspelling asked during the outage was never flagged again this
 *     session. An unresolved word is already treated as known at READ time
 *     (the decorator's phase B), which is the only place that answer belongs.
 *   - **A change is PUBLISHED.** {@link spellAvailabilityEpoch} moves on every
 *     flip and {@link onSpellAvailabilityChange} pushes it, so the provider's
 *     version token changes and the decorator runs ONE whole-document re-check
 *     on recovery — the words skipped during the outage included.
 */

import { dictionaryAssetUrls } from "@/lib/spell/dictionary-asset";
import type { SpellEngine } from "@/lib/spell/spell-core";
import { onTabReturn } from "@/lib/tab-hidden";

type CheckReply = { runId: number; unknown?: string[]; suggestions?: string[]; error?: string };
type Payload = Record<string, unknown>;

/** First retry delay after a failed load. */
export const SPELL_RETRY_BASE_MS = 30_000;
/** The back-off doubles up to this ceiling, and keeps probing at it. */
export const SPELL_RETRY_CAP_MS = 5 * 60_000;

/** Verdicts by word. `true` = known to the dictionary. Only a REAL answer is
 *  ever recorded here — never a failure's placeholder. */
const verdicts = new Map<string, boolean>();

let worker: Worker | null = null;
let workerBroken = false;
let nextRunId = 1;
const pending = new Map<number, { payload: Payload; resolve: (reply: CheckReply) => void }>();
let mainThreadEngine: Promise<SpellEngine> | null = null;

// ── availability ─────────────────────────────────────────────────────────────

/** Consecutive failed loads; 0 = available. */
let failures = 0;
let epoch = 0;
const availabilityListeners = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;
let detachRecoveryEdges: (() => void) | null = null;

/** Test seam: forget every cached verdict, every engine handle, and every
 *  availability fact. */
export function __resetSpellClientForTest(): void {
  verdicts.clear();
  pending.clear();
  worker?.terminate();
  worker = null;
  workerBroken = false;
  mainThreadEngine = null;
  failures = 0;
  epoch = 0;
  availabilityListeners.clear();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  probing = false;
  detachRecoveryEdges?.();
  detachRecoveryEdges = null;
}

/** The back-off after `failureCount` consecutive failed loads — named so the
 *  retry timer and a suite advancing past it read one rule. */
export function spellRetryDelayMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  return Math.min(SPELL_RETRY_BASE_MS * 2 ** (failureCount - 1), SPELL_RETRY_CAP_MS);
}

function publishAvailability(): void {
  epoch++;
  for (const fn of [...availabilityListeners]) {
    try {
      fn();
    } catch {
      /* one listener's failure must not strand the rest */
    }
  }
}

function attachRecoveryEdges(): void {
  if (detachRecoveryEdges) return;
  const offReturn = onTabReturn(() => void probe());
  const onOnline = () => void probe();
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);
  detachRecoveryEdges = () => {
    offReturn();
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
  };
}

function scheduleRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void probe();
  }, spellRetryDelayMs(failures));
}

function noteFailure(): void {
  failures++;
  attachRecoveryEdges();
  scheduleRetry();
  // Only the FIRST failure is a flip; a failed probe is not news.
  if (failures === 1) publishAvailability();
}

function noteSuccess(): void {
  if (failures === 0) return;
  failures = 0;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  detachRecoveryEdges?.();
  detachRecoveryEdges = null;
  publishAvailability();
}

/** Re-ask the engine to load. Asks for no words, so it caches nothing. */
async function probe(): Promise<void> {
  if (failures === 0 || probing) return;
  probing = true;
  try {
    const reply = await ask({ kind: "check", words: [] });
    if (reply.error || !reply.unknown) {
      // noteFailure would count it again and re-publish nothing; keep the
      // back-off growing and the timer armed.
      failures++;
      scheduleRetry();
    } else {
      noteSuccess();
    }
  } finally {
    probing = false;
  }
}

// ── transport ────────────────────────────────────────────────────────────────

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    // EXTENSION-LESS specifier, and it is load-bearing: Turbopack compiles
    // `new Worker(new URL(...))` into a real worker chunk only for this form —
    // with an explicit ".ts" it routes the file through the static-asset
    // pipeline and ships RAW TypeScript that dies at parse time in the worker.
    // (`lint-client.ts` records the same trap; it is the shipped precedent.)
    worker = new Worker(new URL("./spell.worker", import.meta.url));
    worker.onmessage = (e: MessageEvent<CheckReply>) => {
      const entry = pending.get(e.data.runId);
      if (entry) {
        pending.delete(e.data.runId);
        entry.resolve(e.data);
      }
    };
    worker.onerror = () => {
      // A crashed WORKER is not a failed DICTIONARY: the requests it stranded
      // are answered by the main-thread engine, which every later request
      // uses too. Reporting them as an engine failure would hand the surface
      // back to the browser for a fault the fallback can absorb (task 580).
      workerBroken = true;
      const stranded = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const { payload, resolve } of stranded) {
        void askMainThread(payload, -1).then(resolve);
      }
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function getMainThreadEngine(): Promise<SpellEngine> {
  if (!mainThreadEngine) {
    mainThreadEngine = (async () => {
      const { createSpellEngine, fetchDictionaryText } = await import(
        "@/lib/spell/spell-core"
      );
      return createSpellEngine(await fetchDictionaryText(dictionaryAssetUrls()));
    })();
    mainThreadEngine.catch(() => {
      mainThreadEngine = null;
    });
  }
  return mainThreadEngine;
}

function askMainThread(payload: Payload, runId: number): Promise<CheckReply> {
  return getMainThreadEngine().then(
    (engine) => {
      if (payload.kind === "check") {
        const words = payload.words as string[];
        return { runId, unknown: words.filter((word) => !engine.isKnown(word)) };
      }
      return { runId, suggestions: engine.suggest(payload.word as string) };
    },
    (err: unknown) => ({ runId, error: String(err) }),
  );
}

function ask(payload: Payload): Promise<CheckReply> {
  const w = getWorker();
  const runId = nextRunId++;
  if (w) {
    return new Promise<CheckReply>((resolve) => {
      pending.set(runId, { payload, resolve });
      w.postMessage({ ...payload, runId, urls: dictionaryAssetUrls() });
    });
  }
  return askMainThread(payload, runId);
}

// ── public surface ───────────────────────────────────────────────────────────

/**
 * Is a checker usable right now? False only while a dictionary load has
 * actually FAILED and no retry has since succeeded — never merely "not loaded
 * yet", because a surface that handed itself back to the browser during the
 * first fetch would flash two underlines.
 */
export function spellEngineAvailable(): boolean {
  return failures === 0;
}

/** Moves on every availability flip — fold it into a change token. */
export function spellAvailabilityEpoch(): number {
  return epoch;
}

/** Called on every availability flip (failure, recovery). Returns the
 *  unsubscribe. */
export function onSpellAvailabilityChange(fn: () => void): () => void {
  availabilityListeners.add(fn);
  return () => {
    availabilityListeners.delete(fn);
  };
}

/** The cached verdict, or `undefined` when this word has no real answer yet. */
export function knownSync(word: string): boolean | undefined {
  return verdicts.get(word);
}

/**
 * Warm the cache for these words. Resolves when every one of them has a
 * verdict — or when the engine has failed, in which case NOTHING is recorded:
 * the words stay unresolved (read as known by the surface, so nothing is
 * flagged by a checker that isn't there) and are asked again on recovery.
 */
export async function ensureChecked(words: readonly string[]): Promise<void> {
  const need = [...new Set(words.filter((w) => !verdicts.has(w)))];
  if (need.length === 0) return;
  const reply = await ask({ kind: "check", words: need });
  if (reply.error || !reply.unknown) {
    if (failures === 0) noteFailure();
    return;
  }
  const unknown = new Set(reply.unknown);
  for (const w of need) verdicts.set(w, !unknown.has(w));
  noteSuccess();
}

/** Ranked alternatives for a flagged word. Runs only on a user gesture. */
export async function suggestFor(word: string): Promise<string[]> {
  const reply = await ask({ kind: "suggest", word });
  return reply.suggestions ?? [];
}
