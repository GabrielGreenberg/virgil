"use client";

/**
 * SystemDialog — centralized chrome for every app-level modal dialog.
 *
 * The one-file source of truth for dialog styling. Every modal in Virgil
 * (confirm, alert, prompt, document-class mismatch, new-document,
 * tex-file picker, AI window, preferences) composes from the primitives
 * exported here. Editing `SYSTEM_DIALOG_TOKENS` re-skins all of them at
 * once.
 *
 * Composition kit:
 *   <SystemDialog size="sm" open onClose={...} anchorRef={...} labelledBy={...}>
 *     <SystemDialogHeader title="Move footnote?" />
 *     <SystemDialogBody>
 *       <p>This will move the footnote…</p>
 *     </SystemDialogBody>
 *     <SystemDialogFooter>
 *       <SystemDialogButton variant="secondary" onClick={cancel}>Cancel</SystemDialogButton>
 *       <SystemDialogButton variant="danger" onClick={confirm} autoFocus>Move</SystemDialogButton>
 *     </SystemDialogFooter>
 *   </SystemDialog>
 *
 * Shell behaviors (baked in, identical across every dialog):
 *   - Backdrop scrim + click-to-close (unless dismissable=false)
 *   - Esc to close
 *   - Enter-to-confirm when a button with autoFocus is focused
 *   - role=dialog, aria-modal=true, aria-labelledby/aria-describedby
 *   - requestAnimationFrame-deferred focus on the autoFocus button
 *   - Optional anchor positioning near a source element
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonVariant } from "./panel-primitives";

/* ── Tokens ──────────────────────────────────────────────────────────
   The one object you edit to re-skin every system dialog. Tailwind-class
   strings so they play with arbitrary-value utilities.
*/
export const SYSTEM_DIALOG_TOKENS = {
  scrim: "bg-[var(--overlay-scrim)]",
  zIndex: "z-[10000]",
  surface:
    "bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl",
  maxWidth: {
    sm: "max-w-[340px]",
    md: "max-w-[380px]",
    lg: "max-w-[520px]",
    xl: "max-w-[720px]",
    full: "max-w-[min(96vw,1100px)]",
  },
  header: "px-5 pt-4 pb-3",
  body: "px-5 pb-4",
  footer:
    "flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-surface-muted/60",
  title: "text-sm font-semibold text-ink-body mb-1.5",
  subtitle: "text-xs text-ink-subtle",
  message: "text-xs text-ink-body leading-relaxed",
  /* SystemDialog buttons render through `Button` from panel-primitives;
     no per-token strings needed. The variant prop on SystemDialogButton
     maps onto the canonical Button variants. */
} as const;

export type SystemDialogSize = keyof typeof SYSTEM_DIALOG_TOKENS.maxWidth;
export type SystemDialogButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "accent";

/* ── Internal context for Enter-to-confirm + autofocus wiring ──────── */

interface DialogCtxValue {
  labelledBy?: string;
  describedBy?: string;
  registerAutoFocus: (el: HTMLButtonElement | null) => void;
  autoFocusRef: RefObject<HTMLButtonElement | null>;
}

const DialogCtx = createContext<DialogCtxValue | null>(null);

/* ── SystemDialog ─────────────────────────────────────────────────── */

export interface SystemDialogProps {
  open: boolean;
  /** Called on Esc, backdrop click, or programmatic close. Omit for non-dismissable. */
  onClose?: () => void;
  size?: SystemDialogSize;
  /** Position the dialog near this element instead of dead-center. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** DOM id of the title element — set aria-labelledby. */
  labelledBy?: string;
  /** DOM id of the description element — set aria-describedby. */
  describedBy?: string;
  /** Custom class appended to the inner frame. */
  frameClassName?: string;
  children: ReactNode;
}

export default function SystemDialog({
  open,
  onClose,
  size = "sm",
  anchorRef,
  labelledBy,
  describedBy,
  frameClassName = "",
  children,
}: SystemDialogProps) {
  const autoFocusRef = useRef<HTMLButtonElement | null>(null);
  const [anchorPos, setAnchorPos] = useState<
    { top: number; left: number } | null
  >(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const registerAutoFocus = useCallback((el: HTMLButtonElement | null) => {
    autoFocusRef.current = el;
  }, []);

  // Position + focus + keyboard wiring
  useEffect(() => {
    if (!open) return;

    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const dialogWidth = 340;
      let left = rect.left + rect.width / 2 - dialogWidth / 2;
      left = Math.max(16, Math.min(left, vw - dialogWidth - 16));
      const top = Math.min(rect.bottom + 8, window.innerHeight - 180);
      setAnchorPos({ top, left });
    } else {
      setAnchorPos(null);
    }

    const handle = requestAnimationFrame(() => {
      autoFocusRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        if (
          autoFocusRef.current &&
          document.activeElement === autoFocusRef.current
        ) {
          e.preventDefault();
          autoFocusRef.current.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    [onClose],
  );

  if (!open || !mounted) return null;

  const t = SYSTEM_DIALOG_TOKENS;

  return createPortal(
    <DialogCtx.Provider
      value={{ labelledBy, describedBy, registerAutoFocus, autoFocusRef }}
    >
      <div
        className={`fixed inset-0 ${t.zIndex} ${t.scrim} ${anchorPos ? "" : "flex items-center justify-center"}`}
        // Keep centered dialogs clear of the OS window-control strip under WCO
        // (and the notch under safe-area); inert for anchored dialogs and when
        // the inset is 0 (normal tab).
        style={{ paddingTop: "var(--window-inset-top, 0px)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={handleBackdrop}
      >
        <div
          className={`${t.surface} w-full ${t.maxWidth[size]} mx-4 overflow-hidden ${frameClassName}`}
          style={
            anchorPos
              ? {
                  position: "fixed",
                  top: anchorPos.top,
                  left: anchorPos.left,
                  margin: 0,
                }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </DialogCtx.Provider>,
    document.body,
  );
}

/* ── Header / Body / Footer ──────────────────────────────────────── */

export interface SystemDialogHeaderProps {
  /** The heading text. Rendered in the canonical style. */
  title?: ReactNode;
  /** Optional subtitle (smaller, muted) below the title. */
  subtitle?: ReactNode;
  /** Custom children replace the default title/subtitle rendering. */
  children?: ReactNode;
  /** Override the auto-generated title id (match `labelledBy` on SystemDialog). */
  titleId?: string;
}

export function SystemDialogHeader({
  title,
  subtitle,
  children,
  titleId,
}: SystemDialogHeaderProps) {
  const ctx = useContext(DialogCtx);
  const autoId = useId();
  const id = titleId ?? ctx?.labelledBy ?? `sd-title-${autoId}`;
  const t = SYSTEM_DIALOG_TOKENS;
  return (
    <div className={t.header}>
      {children ?? (
        <>
          {title && (
            <h2 id={id} className={t.title}>
              {title}
            </h2>
          )}
          {subtitle && <p className={t.subtitle}>{subtitle}</p>}
        </>
      )}
    </div>
  );
}

export function SystemDialogBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${SYSTEM_DIALOG_TOKENS.body} ${className}`}>{children}</div>
  );
}

export function SystemDialogFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${SYSTEM_DIALOG_TOKENS.footer} ${className}`}>
      {children}
    </div>
  );
}

/* ── Button ──────────────────────────────────────────────────────── */

export interface SystemDialogButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SystemDialogButtonVariant;
  /** Capture focus on dialog open; also enables Enter-to-confirm on this button. */
  autoFocus?: boolean;
}

/** Map legacy SystemDialog variant names onto the canonical Button
 *  variants. The "accent" name is preserved for compatibility but folds
 *  into "primary" (which is itself accent-filled in the new spec). */
const SYSTEM_DIALOG_BUTTON_VARIANT: Record<SystemDialogButtonVariant, ButtonVariant> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
  accent: "primary",
};

export function SystemDialogButton({
  variant = "secondary",
  autoFocus,
  className,
  type = "button",
  ...rest
}: SystemDialogButtonProps) {
  const ctx = useContext(DialogCtx);
  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      if (autoFocus) ctx?.registerAutoFocus(el);
    },
    [autoFocus, ctx],
  );
  return (
    <Button
      ref={ref}
      type={type}
      variant={SYSTEM_DIALOG_BUTTON_VARIANT[variant]}
      size="sm"
      className={className}
      {...rest}
    />
  );
}
