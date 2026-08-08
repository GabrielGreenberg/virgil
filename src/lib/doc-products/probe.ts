/**
 * DocProducts probe — `window.__docProductsStats()` (perf plan Wave 1).
 *
 * The verification instrument for the pipeline's exit criteria: per typing
 * pause there should be ONE Tier A run + ONE Tier B run + one assembly,
 * with block-cache misses ≈ blocks actually edited (the WeakMap-miss-is-
 * the-diff property). Read + diff across a typing burst in the dev preview.
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
  blockJsonMisses: number;
  blockJsonHits: number;
  blockLatexMisses: number;
  blockLatexHits: number;
}

export function readDocProductsStats(): DocProductsStats {
  return {
    tierARuns: pipelineStats.tierARuns,
    tierBRuns: pipelineStats.tierBRuns,
    assemblies: pipelineStats.assemblies,
    ensureFreshCalls: pipelineStats.ensureFreshCalls,
    lastTierAMs: Math.round(pipelineStats.lastTierAMs * 10) / 10,
    lastTierBMs: Math.round(pipelineStats.lastTierBMs * 10) / 10,
    blockJsonMisses: blockCacheStats.jsonMisses,
    blockJsonHits: blockCacheStats.jsonHits,
    blockLatexMisses: blockCacheStats.latexMisses,
    blockLatexHits: blockCacheStats.latexHits,
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
