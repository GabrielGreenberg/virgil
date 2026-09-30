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
 *
 * And its converse (task 854): **the PRESENCE of a PDF does not silence the
 * record either.** `pdfBlobUrl` is the fresh-compile blob OR the pane's
 * cold-start disk seed, so every reopened paper and every second compile has
 * one — and the voice used to be mounted only where it was absent. Adding
 * `\usepackage{tikz}` to an already-compiled paper runs exactly the minutes-long
 * cold download this file exists for, behind the old PDF, with nothing said.
 * So one derivation (`phaseLine` / `detailLine`) has two renderers:
 *   - `CompilePaneStatus` — the full-pane body when there is no PDF;
 *   - `PdfPaneOverlay` — the chrome laid OVER a PDF: a compact, pointer-inert
 *     progress strip while a compile runs, else the "PDF is out of date" chip.
 *     While compiling, the stale chip YIELDS: "out of date" and "compiling"
 *     stacked in one corner say contradictory things, and the running compile
 *     is the one that will resolve the staleness.
 */

/** Read this doc's live compile progress. */
export function useCompileProgress(docId: string | null): CompileProgress {
  return useSyncExternalStore(
    subscribeCompileProgress,
    () => getCompileProgress(docId),
    () => getCompileProgress(docId),
  );
}

/** A compile is in flight for this record (neither idle nor finished). */
export function isCompileRunning(p: CompileProgress): boolean {
  return p.phase !== "idle" && p.phase !== "done";
}

function Spinner({ size, className }: { size: number; className: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
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
  const running = isCompileRunning(progress);
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
          <Spinner size={28} className="mx-auto mb-3 opacity-80" />
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

/**
 * The chrome laid over a SHOWING PDF (task 854). While this doc's compile runs:
 * a compact progress strip — the same phase/detail lines as the full-pane
 * status — pinned to the top of the viewer, `pointer-events: none` so the PDF
 * underneath stays scrollable and selectable. Otherwise, when the PDF lags the
 * edits: the "PDF is out of date" chip. Never both (see the file header).
 *
 * Its own component so the progress subscription re-renders only this chrome —
 * a cold compile notifies a few times a second, and the host (EditorLayout)
 * must not re-render on each.
 */
export function PdfPaneOverlay({
  docId,
  stale,
}: {
  docId: string | null;
  stale: boolean;
}) {
  const progress = useCompileProgress(docId);

  if (isCompileRunning(progress)) {
    const detail = detailLine(progress);
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[min(32rem,calc(100%-1.5rem))] pointer-events-none">
        <div
          className="flex items-start gap-2 rounded bg-neutral-900/85 text-white/90 text-xs px-2.5 py-1.5 shadow-[var(--menu-shadow)]"
          role="status"
          aria-live="polite"
        >
          <Spinner size={12} className="mt-0.5 shrink-0 opacity-80" />
          <div className="min-w-0">
            <p>{phaseLine(progress)}</p>
            {detail && <p className="text-white/60 break-words">{detail}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!stale) return null;
  return (
    <div className="absolute top-3 right-3 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded shadow-[var(--menu-shadow)] flex items-center gap-1.5 z-10">
      {/* Deliberately still a hand-rolled dot (task 315), and the
          reasoning is recorded in status-dot-ssot.test.ts's allowlist:
          this is the SAME signal StatusCluster's pdf-stale dot paints,
          but from a different family — that dot reads
          `var(--status-warn)` (#eab308) while this one is Tailwind v4's
          `yellow-500` (oklch 79.5% 0.184 86.047 ≈ #f0b100), which its
          own chip's `bg-yellow-100`/`text-yellow-800` are on the ramp
          of. The two already differ. Converting the dot alone would
          repaint it AND strand it off its chip's ramp, so which family
          wins is a colour decision, not a cleanup. */}
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
      PDF is out of date
    </div>
  );
}
