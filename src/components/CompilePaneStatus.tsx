"use client";

import { useSyncExternalStore } from "react";
import {
  getCompileProgress,
  subscribeCompileProgress,
  type CompileProgress,
} from "@/lib/compile/compile-progress";

/**
 * THE PDF PANE'S VOICE (task 454).
 *
 * Before this, opening the PDF pane during (or after) a compile showed a bare
 * dark surface plus "No compiled PDF / Click Compile to generate a PDF." — the
 * same words whether a compile had never run, was two minutes into downloading
 * the pgf family, or had failed and been told so in a dialog the user dismissed.
 * The whole class task 392 named for the save path: *a subsystem that stops
 * working says so*, and it says so on the surface the user is watching.
 *
 * The one design rule this carries: **the message is derived from the progress
 * RECORD, never from the absence of a PDF.** "There is no pdfBlobUrl" is the
 * same fact in all three states; only the record can tell them apart.
 */

/** Read this doc's live compile progress. */
export function useCompileProgress(docId: string | null): CompileProgress {
  return useSyncExternalStore(
    subscribeCompileProgress,
    () => getCompileProgress(docId),
    () => getCompileProgress(docId),
  );
}

function phaseLine(p: CompileProgress): string {
  switch (p.phase) {
    case "booting":
      return "Starting the LaTeX engine…";
    case "preparing":
      return "Preparing your document…";
    case "fetching":
      return p.currentAsset
        ? `Downloading LaTeX packages — ${p.assetsFetched} so far`
        : "Downloading LaTeX packages…";
    case "typesetting":
      return p.totalPasses > 1
        ? `Typesetting (pass ${p.pass} of ${p.totalPasses})…`
        : "Typesetting…";
    default:
      return "Compiling…";
  }
}

function detailLine(p: CompileProgress): string | null {
  if (p.phase === "fetching") {
    // The one phase the user can act on, and the one that takes minutes. Say
    // WHY it is slow and that it is a one-time cost, or a first compile of a
    // tikz paper reads as a hang.
    return p.currentAsset
      ? `${p.currentAsset} — first compile of a paper fetches everything it needs; they're cached afterwards.`
      : "First compile of a paper fetches everything it needs; they're cached afterwards.";
  }
  if (p.attempt > 1) {
    return `Attempt ${p.attempt} — resuming from the packages already downloaded.`;
  }
  return null;
}

/**
 * The compile-aware body of the PDF pane's empty state. Renders one of three
 * things, and never a bare surface:
 *   - a live compile (spinner + phase + what it is fetching),
 *   - the last compile's FAILURE (what happened, in the user's terms),
 *   - the honest "nothing yet" prompt.
 */
export function CompilePaneStatus({ docId }: { docId: string | null }) {
  const progress = useCompileProgress(docId);
  const running = progress.phase !== "idle" && progress.phase !== "done";
  const failed =
    progress.phase === "done" && progress.outcome !== null && progress.outcome !== "ok";

  if (running) {
    const detail = detailLine(progress);
    return (
      <div className="flex flex-1 items-center justify-center">
        <div
          className="text-center text-white/80 p-8 max-w-md"
          role="status"
          aria-live="polite"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="animate-spin mx-auto mb-3 opacity-80"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p className="text-lg mb-2">{phaseLine(progress)}</p>
          {detail && <p className="text-sm text-white/60 break-words">{detail}</p>}
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-white/80 p-8 max-w-md" role="alert">
          <p className="text-lg mb-2">Compile didn&rsquo;t produce a PDF</p>
          {progress.message && (
            <p className="text-sm text-white/60 break-words">{progress.message}</p>
          )}
          <p className="text-sm text-white/45 mt-3">
            Press Compile to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center text-white/70 p-8">
        <p className="text-lg mb-2">No compiled PDF</p>
        <p className="text-sm">Click Compile to generate a PDF.</p>
      </div>
    </div>
  );
}
