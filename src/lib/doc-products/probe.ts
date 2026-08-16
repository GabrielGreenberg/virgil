/**
 * DocProducts probe — `window.__docProductsStats()` (perf plan Wave 1).
 *
 * The verification instrument for the pipeline's exit criteria: per typing
 * pause there should be ONE Tier A run + ONE Tier B run + one assembly,
 * with cache misses ≈ the NODES actually edited (the WeakMap-miss-is-the-diff
 * property). Read + diff across a typing burst in the dev preview.
 *
 * UNIT CHANGE (task 337): the json counters were per TOP-LEVEL BLOCK and are
 * now per NODE at every depth, because the cache composes a container's JSON
 * from its children's. So a keystroke inside a list now reports ~3 misses and
 * ~99 HITS where it used to report 1 miss and 0 hits — a bigger number that
 * means strictly less work. The fields are renamed to say so; a soak diff
 * across the flag flip must not read the hit count as a regression.
 */

import { blockCacheStats } from "./block-caches";
import { pipelineStats } from "./pipeline";

export interface DocProductsStats {
  tierARuns: number;
  tierBRuns: number;
  assemblies: number;
  ensureFreshCalls: number;
  lastTierAMs: number;
  lastTierBMs: number;
  nodeJsonMisses: number;
  nodeJsonHits: number;
  blockLatexMisses: number;
  blockLatexHits: number;
  /** Container CHILDREN re-serialized (task 337). A keystroke inside a
   *  100-item list must move this by ONE item, not by the list. */
  childPartMisses: number;
  childPartHits: number;
}

export function readDocProductsStats(): DocProductsStats {
  return {
    tierARuns: pipelineStats.tierARuns,
    tierBRuns: pipelineStats.tierBRuns,
    assemblies: pipelineStats.assemblies,
    ensureFreshCalls: pipelineStats.ensureFreshCalls,
    lastTierAMs: Math.round(pipelineStats.lastTierAMs * 10) / 10,
    lastTierBMs: Math.round(pipelineStats.lastTierBMs * 10) / 10,
    nodeJsonMisses: blockCacheStats.jsonMisses,
    nodeJsonHits: blockCacheStats.jsonHits,
    blockLatexMisses: blockCacheStats.latexMisses,
    blockLatexHits: blockCacheStats.latexHits,
    childPartMisses: blockCacheStats.partMisses,
    childPartHits: blockCacheStats.partHits,
  };
}

declare global {
  interface Window {
    __docProductsStats?: () => DocProductsStats;
  }
}

if (typeof window !== "undefined") {
  window.__docProductsStats = readDocProductsStats;
}
