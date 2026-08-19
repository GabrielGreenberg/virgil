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
  /** OPTIONAL third choice, rendered between Cancel and the primary action.
   *  For a question with TWO real answers plus a way out — "this applied change
   *  is still live: keep it, revert it, or cancel" (task 238) — where a plain
   *  yes/no would force the caller to pick an answer on the user's behalf.
   *  Omit for an ordinary confirm; both halves must be supplied together. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided, the dialog positions near this element instead of centered. */
  anchorRef?: RefObject<HTMLElement | null>;
}

/** Which footer button a confirm dialog CUES — the one that takes initial focus
 *  and that `Enter` therefore activates.
 *
 *  A `default`-tone confirm cues its primary action, which is what a confirm
 *  dialog is for. A **danger** confirm cues its SAFEST button instead: Cancel
 *  where there is one, else the secondary answer, else nothing.
 *
 *  This is a data-safety rule, not a styling preference (task 386). Every
 *  danger confirm in the app opens under fingers that are already moving —
 *  the reporting case was a card TITLE being typed when a stray `Backspace`
 *  reached the card shell: the dialog mounted with `Delete` focused, and the
 *  very next keystroke of ordinary typing pressed it. From the keyboard's point
 *  of view "Backspace, keep typing" WAS "delete the card". A destructive
 *  default armed under a still-typing user is the trap wherever the dialog
 *  opens from, so the rule is global rather than per-caller.
 *
 *  The danger action stays fully keyboard-reachable — Tab, then Enter — which
 *  is the right cost for a deliberate destructive choice. `hideCancel` +
 *  `danger` (a single-button danger notice) cues nothing: there is no safe
 *  button to move focus to, and cueing the only button would re-arm the trap.
 *  `SystemDialog` focuses its frame in that case, so `Escape` still works and a
 *  stray `Enter` does nothing. */
export function confirmDialogCuedDefault(opts: {
  tone?: ConfirmTone;
  hideCancel?: boolean;
  hasSecondary?: boolean;
}): "confirm" | "cancel" | "secondary" | "none" {
  if (opts.tone !== "danger") return "confirm";
  if (!opts.hideCancel) return "cancel";
  if (opts.hasSecondary) return "secondary";
  return "none";
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "default",
  hideCancel = false,
  secondaryLabel,
  onSecondary,
  onConfirm,
  onCancel,
  anchorRef,
}: ConfirmDialogProps) {
  const cuedDefault = confirmDialogCuedDefault({
    tone,
    hideCancel,
    hasSecondary: !!(secondaryLabel && onSecondary),
  });
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
          <SystemDialogButton autoFocus={cuedDefault === "cancel"} onClick={onCancel}>
            {cancelLabel}
          </SystemDialogButton>
        )}
        {secondaryLabel && onSecondary && (
          <SystemDialogButton
            autoFocus={cuedDefault === "secondary"}
            onClick={onSecondary}
          >
            {secondaryLabel}
          </SystemDialogButton>
        )}
        <SystemDialogButton
          variant={tone === "danger" ? "danger" : "primary"}
          autoFocus={cuedDefault === "confirm"}
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

/** A three-way question: the primary answer, a second real answer, or cancel. */
export interface ChoiceOptions extends ConfirmOptions {
  secondaryLabel: string;
}

/** Which button the user pressed. `confirm` maps to `true`, everything else to
 *  `false`, which is why the boolean `confirm()` can stay unchanged. */
export type ConfirmChoice = "confirm" | "secondary" | "cancel";

interface PendingConfirm extends ConfirmOptions {
  secondaryLabel?: string;
  resolve: (value: ConfirmChoice) => void;
}

/**
 * Imperative wrapper. Mount `dialog` once inside your layout; call
 * `confirm(options)` to get a promise for the user's choice.
 *
 * `choose(options)` is the same dialog with a THIRD button, resolving the
 * pressed choice instead of a boolean — for a question whose two real answers
 * both commit (task 238's keep / revert / cancel). One `pending` slot and one
 * mounted dialog serve both, so a host that already mounts this hook gains the
 * three-way form without a second dialog instance.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve: (c) => resolve(c === "confirm") });
      }),
    [],
  );

  const choose = useCallback(
    (opts: ChoiceOptions): Promise<ConfirmChoice> =>
      new Promise<ConfirmChoice>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const handleConfirm = useCallback(() => {
    if (pending) pending.resolve("confirm");
    setPending(null);
  }, [pending]);
  const handleSecondary = useCallback(() => {
    if (pending) pending.resolve("secondary");
    setPending(null);
  }, [pending]);
  const handleCancel = useCallback(() => {
    if (pending) pending.resolve("cancel");
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
      secondaryLabel={pending.secondaryLabel}
      onSecondary={pending.secondaryLabel ? handleSecondary : undefined}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, choose, dialog };
}
