export {};

declare global {
  interface PdfTeXCompileResult {
    pdf?: Uint8Array;
    status: number;
    log: string;
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
  }

  interface Window {
    PdfTeXEngine: typeof PdfTeXEngine;
  }
}
