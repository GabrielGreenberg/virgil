"use client";

/**
 * DocumentClassMismatchDialog — compile-time prompt when `\documentclass`
 * doesn't define a sectioning command used in the source. Composes the
 * shared SystemDialog primitives so styling stays in lockstep with the
 * rest of the app's dialogs.
 */

import { useCallback, useMemo, useState } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import { Select } from "./field-primitives";
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

  const handleCancel = useCallback(
    () => onResolve({ kind: "cancel" }),
    [onResolve],
  );

  if (!mismatch) return null;
  const canSwitch = choice.length > 0;

  return (
    <SystemDialog
      open={open}
      onClose={handleCancel}
      size="md"
    >
      <SystemDialogHeader title="Document class mismatch" />
      <SystemDialogBody>
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
        <Select
          value={choice}
          onChange={(e) =>
            mismatch && setOverrideChoice({ mismatch, value: e.target.value })
          }
          className="w-full text-xs px-2 py-1.5"
        >
          {mismatch.suggestions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton onClick={handleCancel}>Cancel</SystemDialogButton>
        <SystemDialogButton onClick={() => onResolve({ kind: "compile-anyway" })}>
          Compile anyway
        </SystemDialogButton>
        <SystemDialogButton
          variant="primary"
          autoFocus
          disabled={!canSwitch}
          onClick={() => onResolve({ kind: "switch", newClass: choice })}
        >
          Switch &amp; compile
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
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
