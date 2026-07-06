/**
 * Typed contract for the CompileService (P2).
 *
 * Keeps the hook and any future callers off inline shapes. The rich
 * `CompileResult` carries everything the old smeared-across-layers path
 * produced (pdf bytes + log + status) plus the new signals the service owns:
 * how many passes actually ran, whether the bibtex stage failed, and — for
 * the P1 offline-assets pillar that lands later — which packages were missing
 * offline.
 */

import type { LatexError } from "@/lib/latex-errors";

/**
 * Overall outcome of a compile:
 *  - `ok`         — pdfTeX exited 0 and produced a PDF; bibtex (if any) was fine.
 *  - `degraded`   — a PDF exists (retained from an earlier good pass, or the
 *                   final pass), but something is off: a later pass failed
 *                   after an earlier one succeeded, or the bibtex stage failed.
 *                   The user gets a usable-but-imperfect PDF + a warning.
 *  - `failed`     — pdfTeX exited non-zero and no usable PDF was produced.
 *  - `timeout`    — a compile pass exceeded its budget and was aborted; the
 *                   engine has been reset and will reboot on the next call.
 *  - `boot-failed`— the engine could not be booted at all.
 */
export type CompileStatus =
  | "ok"
  | "failed"
  | "degraded"
  | "timeout"
  | "boot-failed";

export type BibtexStatus = "ok" | "failed" | "absent";

export interface CompileResult {
  status: CompileStatus;
  /** The compiled PDF bytes, when one is available (ok OR degraded). */
  pdf?: Uint8Array;
  /** Raw pdfTeX log from the LAST pass that produced this result. */
  log: string;
  /** How many compile passes actually ran (0 on a boot failure). */
  ranPasses: number;
  /** Whether the bibtex stage failed, succeeded, or never ran. */
  bibtexStatus: BibtexStatus;
  /** Structured diagnostics parsed from the log (via parseTexLog). */
  diagnostics?: LatexError[];
  /**
   * Packages the engine could not resolve while offline. Populated by the P1
   * offline-assets pillar (unused / left empty here). Optional so P2 can ship
   * ahead of P1.
   */
  offlineMisses?: string[];
}

export interface CompileInput {
  /** Every file in the paper folder, as raw bytes (sidecars already excluded). */
  files: import("@/lib/storage-fsa").PaperFile[];
  /** The main `.tex` filename to hand pdfTeX as its entry point. */
  mainTexFilename: string;
  /** Optional abort signal so a caller can cancel a pending compile. */
  signal?: AbortSignal;
}
