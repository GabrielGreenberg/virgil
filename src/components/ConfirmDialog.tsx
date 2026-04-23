"use client";

/**
 * ConfirmDialog — in-app replacement for `window.confirm`.
 *
 * Thin wrapper over the centralized `SystemDialog` primitive. Every
 * visual decision (backdrop, surface, button colors, focus ring, focus
 * behavior) lives in `system-dialog.tsx` / `SYSTEM_DIALOG_TOKENS`. This
 * file only decides *which* primitives to compose for a confirm flow.
 *
 * Two ways to use:
 *   1. Controlled: `<ConfirmDialog open={...} ... />`.
 *   2. Imperative: `useConfirmDialog()` returns `{ confirm, dialog }`.
 *      Mount `dialog` once near the layout root; await `confirm(...)`
 *      from anywhere.
 */

import { useCallback, useState, type ReactNode, type RefObject } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";

export type ConfirmTone = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Hide the cancel button — turns the dialog into a single-button info modal. */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided, the dialog positions near this element instead of centered. */
  anchorRef?: RefObject<HTMLElement | null>;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "default",
  hideCancel = false,
  onConfirm,
  onCancel,
  anchorRef,
}: ConfirmDialogProps) {
  return (
    <SystemDialog
      open={open}
      onClose={onCancel}
      anchorRef={anchorRef}
      size="sm"
    >
      <SystemDialogHeader title={title} />
      <SystemDialogBody className={title ? "" : "pt-3"}>
        <div className="text-xs text-ink-body leading-relaxed">{message}</div>
      </SystemDialogBody>
      <SystemDialogFooter>
        {!hideCancel && (
          <SystemDialogButton onClick={onCancel}>
            {cancelLabel}
          </SystemDialogButton>
        )}
        <SystemDialogButton
          variant={tone === "danger" ? "danger" : "primary"}
          autoFocus
          onClick={onConfirm}
        >
          {confirmLabel}
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

/* ── useConfirmDialog ─────────────────────────────────────────────── */

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  hideCancel?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Imperative wrapper. Mount `dialog` once inside your layout; call
 * `confirm(options)` to get a promise for the user's choice.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const handleConfirm = useCallback(() => {
    if (pending) pending.resolve(true);
    setPending(null);
  }, [pending]);
  const handleCancel = useCallback(() => {
    if (pending) pending.resolve(false);
    setPending(null);
  }, [pending]);

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      hideCancel={pending.hideCancel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, dialog };
}
