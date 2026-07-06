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
  }

  interface Window {
    PdfTeXEngine: typeof PdfTeXEngine;
  }
}
