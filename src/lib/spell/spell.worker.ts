/**
 * Spellcheck Web Worker entry (task 518).
 *
 * Hosts the ~550 KB Hunspell dictionary and nspell's affix machinery off the
 * main thread — the same slot, and the same client/worker shape, as the LaTeX
 * lint worker (`latex-lint.worker.ts`), whose client documents the Turbopack
 * specifier trap this file's importer has to respect.
 *
 * Protocol, one message per request, matched by `runId`:
 *   { runId, kind: "check",   words }  → { runId, unknown: string[] }
 *   { runId, kind: "suggest", word  }  → { runId, suggestions: string[] }
 * A load failure answers `{ runId, error }`, which the client reads as "this
 * engine is unavailable" and hands the surface back to the browser's checker.
 */

import { createSpellEngine, fetchDictionaryText, type SpellEngine } from "./spell-core";

interface CheckRequest {
  runId: number;
  kind: "check";
  words: string[];
  urls: { aff: string; dic: string };
}
interface SuggestRequest {
  runId: number;
  kind: "suggest";
  word: string;
  urls: { aff: string; dic: string };
}
type SpellRequest = CheckRequest | SuggestRequest;

let enginePromise: Promise<SpellEngine> | null = null;

function engineFor(urls: { aff: string; dic: string }): Promise<SpellEngine> {
  if (!enginePromise) {
    enginePromise = fetchDictionaryText(urls).then(createSpellEngine);
    // A failed load must not be cached as a permanently-rejected promise: the
    // asset may simply have been unreachable once (offline before the SW had
    // precached it). Clear it so a later request retries.
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<SpellRequest>) => {
  const req = e.data;
  void engineFor(req.urls).then(
    (engine) => {
      if (req.kind === "check") {
        post({ runId: req.runId, unknown: req.words.filter((w) => !engine.isKnown(w)) });
      } else {
        post({ runId: req.runId, suggestions: engine.suggest(req.word) });
      }
    },
    (err: unknown) => {
      post({ runId: req.runId, error: String(err) });
    },
  );
};
