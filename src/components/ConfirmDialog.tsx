"use client";

/**
 * ConfirmDialog — in-app replacement for `window.confirm`.
 *
 * A small modal with a title, message, cancel/confirm buttons, and an
 * optional tone (`default` or `danger`) that tweaks the accent color of
 * the primary button. Styled to match the rest of the app chrome so
 * that destructive or move-style confirmations don't drop the user into
 * a native browser dialog.
 *
 * Two ways to use it:
 *   1. Controlled: render `<ConfirmDialog open={...} ... />` directly and
 *      manage its state yourself.
 *   2. Imperative (recommended for call-site brevity): use the
 *      `useConfirmDialog()` hook, which gives you an async `confirm()`
 *      function and a `dialog` node to mount once near the layout root.
 *
 *      const { confirm, dialog } = useConfirmDialog();
 *      // ...
 *      const ok = await confirm({
 *        title: "Move footnote?",
 *        message: "This will move the footnote from its current spot.",
 *        confirmLabel: "Move",
 *        tone: "danger",
 *      });
 *      if (ok) { ... }
 *      // ...
 *      return <>{dialog}{rest of layout}</>;
 *
 * Designed to be generalizable: any caller needing a confirmation can
 * drop this in without maintaining its own modal boilerplate.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConfirmTone = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the primary action on open, and bind ESC/Enter keyboard shortcuts.
  useEffect(() => {
    if (!open) return;
    // Defer to after paint so the button exists in the DOM.
    const handle = requestAnimationFrame(() => {
      confirmBtnRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // Only intercept Enter when the confirm button has focus — lets
        // forms inside the message body work normally if ever needed.
        if (document.activeElement === confirmBtnRef.current) {
          e.preventDefault();
          onConfirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel, onConfirm]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "bg-[#b45757] hover:bg-[#9a3c3c] text-white border-[#9a3c3c]"
      : "bg-stone-800 hover:bg-stone-900 text-white border-stone-900";

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/20"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "confirm-dialog-title" : undefined}
      aria-describedby="confirm-dialog-message"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-[400px] mx-4 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          {title && (
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold text-stone-700 mb-1.5"
            >
              {title}
            </h2>
          )}
          <div
            id="confirm-dialog-message"
            className="text-xs text-stone-600 leading-relaxed"
          >
            {message}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-stone-50/60">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded-md hover:bg-stone-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── useConfirmDialog ─────────────────────────────────────────────── */

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Imperative wrapper around ConfirmDialog. Mount `dialog` once inside
 * your layout; call `confirm(options)` to pop a confirmation and get a
 * promise resolving to the user's choice.
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

  // Close handlers capture `pending` from the closure on each render.
  // Since `pending` changes cause a re-render (and new handlers), the
  // ConfirmDialog props stay in sync without needing a ref.
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
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, dialog };
}
