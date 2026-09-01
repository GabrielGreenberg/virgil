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
 * If the worker cannot be constructed (SSR, vitest, CSP) the client falls back
 * to the main thread. If the DICTIONARY itself cannot be loaded, there is no
 * checker at all — and the honest answer then is not "no squiggles" but "give
 * the surface back to the browser's checker", which is why `available()` is
 * published rather than swallowed. See `spellcheck-decorator.ts`, which owns
 * that hand-back.
 */

import { dictionaryAssetUrls } from "@/lib/spell/dictionary-asset";
import type { SpellEngine } from "@/lib/spell/spell-core";

type CheckReply = { runId: number; unknown?: string[]; suggestions?: string[]; error?: string };

/** Verdicts by word. `true` = known to the dictionary. */
const verdicts = new Map<string, boolean>();

let worker: Worker | null = null;
let workerBroken = false;
let engineFailed = false;
let nextRunId = 1;
const pending = new Map<number, (reply: CheckReply) => void>();
let mainThreadEngine: Promise<SpellEngine> | null = null;

/** Test seam: forget every cached verdict and every engine handle. */
export function __resetSpellClientForTest(): void {
  verdicts.clear();
  pending.clear();
  worker?.terminate();
  worker = null;
  workerBroken = false;
  engineFailed = false;
  mainThreadEngine = null;
}

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
      const resolve = pending.get(e.data.runId);
      if (resolve) {
        pending.delete(e.data.runId);
        resolve(e.data);
      }
    };
    worker.onerror = () => {
      workerBroken = true;
      const stranded = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const resolve of stranded) resolve({ runId: -1, error: "worker died" });
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

function ask(payload: Record<string, unknown>): Promise<CheckReply> {
  const w = getWorker();
  const runId = nextRunId++;
  if (w) {
    return new Promise<CheckReply>((resolve) => {
      pending.set(runId, resolve);
      w.postMessage({ ...payload, runId, urls: dictionaryAssetUrls() });
    });
  }
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

/**
 * Is a checker usable at all? False only once a dictionary load has actually
 * FAILED — never merely "not loaded yet", because a surface that handed itself
 * back to the browser during the first fetch would flash two underlines.
 */
export function spellEngineAvailable(): boolean {
  return !engineFailed;
}

/** The cached verdict, or `undefined` when this word has never been asked. */
export function knownSync(word: string): boolean | undefined {
  return verdicts.get(word);
}

/**
 * Warm the cache for these words. Resolves when every one of them has a
 * verdict — or when the engine has failed, in which case they are all recorded
 * KNOWN so nothing is flagged by a checker that isn't there.
 */
export async function ensureChecked(words: readonly string[]): Promise<void> {
  const need = [...new Set(words.filter((w) => !verdicts.has(w)))];
  if (need.length === 0) return;
  const reply = await ask({ kind: "check", words: need });
  if (reply.error || !reply.unknown) {
    engineFailed = true;
    for (const w of need) verdicts.set(w, true);
    return;
  }
  engineFailed = false;
  const unknown = new Set(reply.unknown);
  for (const w of need) verdicts.set(w, !unknown.has(w));
}

/** Ranked alternatives for a flagged word. Runs only on a user gesture. */
export async function suggestFor(word: string): Promise<string[]> {
  const reply = await ask({ kind: "suggest", word });
  return reply.suggestions ?? [];
}
