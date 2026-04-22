"use client";

/**
 * DocumentClassMismatchDialog — prompted at compile time when the
 * `\documentclass` doesn't define one of the sectioning commands used
 * in the source (e.g. `\chapter` inside `article`). Lets the user pick
 * a compatible class from a dropdown; the caller rewrites the `.tex`
 * before handing off to pdfTeX.
 *
 * Two ways to use it, mirroring ConfirmDialog:
 *   1. Controlled: render directly with `open` + handlers.
 *   2. Imperative (preferred): `useDocumentClassMismatchDialog()` gives
 *      you an async `prompt()` and a `dialog` node to mount once.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocumentClassMismatch, SectioningCommand } from "@/lib/document-class";

export type MismatchResolution =
  | { kind: "switch"; newClass: string }
  | { kind: "compile-anyway" }
  | { kind: "cancel" };

export interface DocumentClassMismatchDialogProps {
  open: boolean;
  mismatch: DocumentClassMismatch | null;
  onResolve: (resolution: MismatchResolution) => void;
}

function formatCommands(cmds: SectioningCommand[]): string {
  const formatted = cmds.map((c) => `\\${c}`);
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}

export default function DocumentClassMismatchDialog({
  open,
  mismatch,
  onResolve,
}: DocumentClassMismatchDialogProps) {
  const switchBtnRef = useRef<HTMLButtonElement>(null);
  // Derive the default (top suggestion) from the mismatch identity so
  // the dropdown resets when a new prompt opens, without the cascade of
  // setting state in an effect. `overrideChoice` captures the user's
  // selection; once set it wins over the default.
  const defaultChoice = useMemo(
    () => (mismatch && mismatch.suggestions.length > 0 ? mismatch.suggestions[0] : ""),
    [mismatch],
  );
  const [overrideChoice, setOverrideChoice] = useState<
    { mismatch: DocumentClassMismatch; value: string } | null
  >(null);
  const choice =
    overrideChoice && overrideChoice.mismatch === mismatch
      ? overrideChoice.value
      : defaultChoice;

  useEffect(() => {
    if (!open) return;
    const handle = requestAnimationFrame(() => switchBtnRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onResolve({ kind: "cancel" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onResolve]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onResolve({ kind: "cancel" });
    },
    [onResolve],
  );

  if (!open || !mismatch) return null;

  const canSwitch = choice.length > 0;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/20 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-class-dialog-title"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-[380px] mx-4 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h2
            id="doc-class-dialog-title"
            className="text-sm font-semibold text-ink-body mb-1.5"
          >
            Document class mismatch
          </h2>
          <p className="text-xs text-ink-body leading-relaxed">
            This document uses{" "}
            <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
              {formatCommands(mismatch.offenders)}
            </code>
            , which{" "}
            <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
              {`\\documentclass{${mismatch.currentClass}}`}
            </code>{" "}
            doesn&apos;t support. LaTeX will fail with &ldquo;Undefined control sequence.&rdquo;
          </p>

          <label className="block mt-4 mb-1 text-[11px] text-ink-subtle font-medium">
            Switch document class to:
          </label>
          <select
            value={choice}
            onChange={(e) =>
              mismatch &&
              setOverrideChoice({ mismatch, value: e.target.value })
            }
            className="w-full text-xs bg-surface border border-edge-subtle rounded px-2 py-1.5 text-ink-body outline-none focus:border-[var(--accent)]"
          >
            {mismatch.suggestions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-surface-muted/60">
          <button
            type="button"
            onClick={() => onResolve({ kind: "cancel" })}
            className="px-3 py-1.5 text-xs font-medium text-ink-body bg-surface border border-edge-hover rounded-md hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onResolve({ kind: "compile-anyway" })}
            className="px-3 py-1.5 text-xs font-medium text-ink-body bg-surface border border-edge-hover rounded-md hover:bg-surface-muted transition-colors"
          >
            Compile anyway
          </button>
          <button
            ref={switchBtnRef}
            type="button"
            disabled={!canSwitch}
            onClick={() => onResolve({ kind: "switch", newClass: choice })}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors bg-stone-800 hover:bg-stone-900 text-white border-stone-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Switch & compile
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── useDocumentClassMismatchDialog ──────────────────────────────── */

interface PendingPrompt {
  mismatch: DocumentClassMismatch;
  resolve: (value: MismatchResolution) => void;
}

export function useDocumentClassMismatchDialog() {
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const prompt = useCallback(
    (mismatch: DocumentClassMismatch): Promise<MismatchResolution> =>
      new Promise<MismatchResolution>((resolve) => {
        setPending({ mismatch, resolve });
      }),
    [],
  );

  const handleResolve = useCallback(
    (resolution: MismatchResolution) => {
      if (pending) pending.resolve(resolution);
      setPending(null);
    },
    [pending],
  );

  const dialog = pending ? (
    <DocumentClassMismatchDialog
      open
      mismatch={pending.mismatch}
      onResolve={handleResolve}
    />
  ) : null;

  return { prompt, dialog };
}
