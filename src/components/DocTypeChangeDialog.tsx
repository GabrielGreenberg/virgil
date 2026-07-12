"use client";

/**
 * DocTypeChangeDialog — the "needs restructuring" prompt shown when the Style
 * panel's doc-type control would swap `\documentclass` to a class that DROPS a
 * sectioning command the body relies on (the structural-downgrade case, e.g.
 * book/report → article while the body uses `\chapter`).
 *
 * The safe cases (any upgrade, or a lateral swap whose target supports every
 * command the body uses) never reach here — they apply as a silent, instant
 * hard swap via `useDocumentStyle.setDocumentClass`. This dialog only guards
 * the downgrade so the class change can't SILENTLY produce a non-compiling
 * document; it surfaces exactly which commands would break and lets the user
 * proceed with eyes open or back out.
 *
 * Modeled on `DocumentClassMismatchDialog` (the compile-time inverse: there a
 * mismatch already exists and we suggest a class that fixes it; here the user
 * is about to CREATE a mismatch and we ask them to confirm).
 */

import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import type { SectioningCommand } from "@/lib/document-class";

interface DocTypeChangeDialogProps {
  /** The `\documentclass` name being switched TO (e.g. "article"). */
  targetClass: string;
  /** Commands the body uses that `targetClass` doesn't define. */
  offenders: SectioningCommand[];
  /** Proceed with the mechanical hard swap anyway. */
  onChangeAnyway: () => void;
  onCancel: () => void;
}

function formatCommands(cmds: SectioningCommand[]): string {
  const formatted = cmds.map((c) => `\\${c}`);
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}

export default function DocTypeChangeDialog({
  targetClass,
  offenders,
  onChangeAnyway,
  onCancel,
}: DocTypeChangeDialogProps) {
  return (
    <SystemDialog open onClose={onCancel} size="md">
      <SystemDialogHeader
        title="This doc type needs restructuring"
        subtitle="Switching class would drop sectioning commands the document uses."
      />
      <SystemDialogBody>
        <p className="text-xs text-ink-body leading-relaxed">
          This document uses{" "}
          <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
            {formatCommands(offenders)}
          </code>
          , which{" "}
          <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
            {`\\documentclass{${targetClass}}`}
          </code>{" "}
          doesn&apos;t define. Changing the class won&apos;t compile
          (&ldquo;Undefined control sequence&rdquo;) until{" "}
          {offenders.length === 1 ? "that command is" : "those commands are"}{" "}
          converted — e.g.{" "}
          <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
            \chapter
          </code>{" "}
          →{" "}
          <code className="font-mono text-[11px] bg-surface-muted px-1 py-0.5 rounded">
            \section
          </code>
          .
        </p>
        <p className="text-xs text-ink-subtle leading-relaxed mt-3">
          Change the class anyway and convert the headings yourself, or keep the
          current class.
        </p>
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton variant="secondary" onClick={onCancel} autoFocus>
          Keep current class
        </SystemDialogButton>
        <SystemDialogButton variant="danger" onClick={onChangeAnyway}>
          Change anyway
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
