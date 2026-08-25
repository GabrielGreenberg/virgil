export {};

/**
 * A single TeX asset the worker cached this session (from `dumpNewCache`):
 * the compiler-internal `cacheKey` (`<numericFormatCode>/<reqname>`), the
 * on-disk memfs `fileid`, and the raw bytes (a transferred ArrayBuffer).
 */
export interface TexCacheDumpEntry {
  cacheKey: string;
  fileid: string;
  bytes: ArrayBuffer;
}

/**
 * One TeX asset streamed out of the worker the INSTANT it finished
 * downloading (task 454), rather than at the end of the compile. Same shape as
 * a `dumpNewCache` entry — the two feed the same write-through sink, which
 * dedups by cacheKey + byte hash, so an asset arriving on both channels is
 * written once.
 */
export type TexAssetStreamEntry = TexCacheDumpEntry;

/**
 * A package DOWNLOAD that was attempted and failed (mirror 5xx, rate limit,
 * network error, per-file timeout). Distinct from an `offlineMisses` entry,
 * which was never attempted because the worker was offline or the mirror
 * circuit breaker had already tripped.
 */
export interface TexDownloadFailure {
  name: string;
  reason: string;
}

declare global {
  interface PdfTeXCompileResult {
    pdf?: Uint8Array;
    status: number;
    log: string;
    /**
     * PATCHED (virgil, P1): packages the worker could not resolve while
     * offline. Populated by the worker's offline short-circuit and surfaced by
     * the wrapper's compileLaTeX; empty when the compile ran online.
     */
    offlineMisses?: string[];
    /**
     * PATCHED (virgil, task 454): packages whose download was ATTEMPTED and
     * failed. `offlineMisses` names packages never attempted; these were.
     */
    downloadFailures?: import("./swiftlatex").TexDownloadFailure[];
  }

  class PdfTeXEngine {
    loadEngine(): Promise<void>;
    writeMemFSFile(filename: string, data: string | Uint8Array): void;
    makeMemFSFolder(folder: string): void;
    setEngineMainFile(filename: string): void;
    setTexliveEndpoint(url: string): void;
    compileLaTeX(): Promise<PdfTeXCompileResult>;
    flushCache(): void;
    closeWorker(): void;
    /**
     * PATCHED (virgil, P1): seed the worker's kpse cache from the main thread.
     * Writes `src` into memfs and registers `cacheKey` in texlive200_cache so a
     * later lookup is byte-identical to a real mirror fetch. Fire-and-forget.
     */
    seedCache(cacheKey: string, fileid: string, src: Uint8Array | ArrayBuffer): void;
    /**
     * PATCHED (virgil, P1): drain the cacheKey→{fileid,bytes} entries added to
     * texlive200_cache since the last dump, for write-through to IndexedDB.
     */
    dumpNewCache(): Promise<TexCacheDumpEntry[]>;
    /**
     * PATCHED (virgil, P1): flip the worker's offline flag so uncached kpse
     * lookups fail fast (record a miss + return 0) instead of hanging on a
     * synchronous cross-origin XHR.
     */
    setOffline(value: boolean): void;
    /**
     * PATCHED (virgil, task 454): register a sink called with each TeX asset
     * the worker downloads, the INSTANT it lands — not at the end of the
     * compile. This is what makes a timed-out compile's downloads durable:
     * `dumpNewCache` is a request/response round trip and cannot run while the
     * worker is blocked inside a synchronous compile, so a compile that times
     * out would otherwise discard every byte it fetched.
     */
    onAsset(cb: (entry: import("./swiftlatex").TexAssetStreamEntry) => void): void;
    /**
     * PATCHED (virgil, task 454): register a sink called with an asset's name
     * when its download STARTS. The compile's only live progress signal — the
     * worker is otherwise silent for the whole of a synchronous compile.
     */
    onFetchProgress(cb: (name: string) => void): void;
  }

  interface Window {
    PdfTeXEngine: typeof PdfTeXEngine;
  }
}
