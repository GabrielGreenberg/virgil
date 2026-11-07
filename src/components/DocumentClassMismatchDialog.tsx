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
import { Field, Select } from "./field-primitives";
import { useAskQueue } from "@/hooks/useAskQueue";
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
          <code className="font-mono text-2xs bg-surface-muted px-1 py-0.5 rounded">
            {formatCommands(mismatch.offenders)}
          </code>
          , which{" "}
          <code className="font-mono text-2xs bg-surface-muted px-1 py-0.5 rounded">
            {`\\documentclass{${mismatch.currentClass}}`}
          </code>{" "}
          doesn&apos;t support. LaTeX will fail with &ldquo;Undefined control sequence.&rdquo;
        </p>

        <Field label="Switch document class to" className="mt-4">
          {({ id }) => (
            <Select
              id={id}
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
          )}
        </Field>
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

const cancelPrompt = (p: PendingPrompt) => p.resolve({ kind: "cancel" });

/** Prompts QUEUE through `useAskQueue` (task 1447): a second `prompt()` while
 *  one is open waits behind it, every promise settles, and unmount resolves
 *  outstanding prompts as cancel. */
export function useDocumentClassMismatchDialog() {
  const { head, enqueue, settle } = useAskQueue<PendingPrompt>(cancelPrompt);

  const prompt = useCallback(
    (mismatch: DocumentClassMismatch): Promise<MismatchResolution> =>
      new Promise<MismatchResolution>((resolve) => {
        enqueue({ mismatch, resolve });
      }),
    [enqueue],
  );

  const dialog = head ? (
    <DocumentClassMismatchDialog
      key={head.id}
      open
      mismatch={head.ask.mismatch}
      onResolve={(resolution) => settle(head.id)?.resolve(resolution)}
    />
  ) : null;

  return { prompt, dialog };
}
