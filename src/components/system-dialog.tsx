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
 *
 * Positioning variants (`variant` prop) — one shell, principled positioning
 * VARIETY (task 033). Every variant shares the portal, the SYSTEM_DIALOG_TOKENS
 * chrome, Esc/focus/role wiring, and outside-click-to-close; they differ only in
 * scrim + placement + z-tier:
 *   - "modal"     (default) — scrim + centered (or near `anchorRef`); MODAL_SCRIM_Z.
 *   - "draggable" — scrimless tool window, drag-positioned by its header (wire the
 *                   header strip with {@link useSystemDialogDrag}); DRAGGABLE_DIALOG_Z.
 *   - "anchored"  — scrimless popover pinned at a viewport point (`at`) or near
 *                   `anchorRef`, clamped to the viewport; MODAL_SCRIM_Z.
 * The scrimless variants close on outside mousedown (skip via `ignoreOutsideSelector`
 * for the trigger button, or `outsideClickGuard` for a modifier gesture).
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
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonVariant } from "./panel-primitives";
import { MODAL_SCRIM_Z, DRAGGABLE_DIALOG_Z } from "@/floats/float-policy";
import { useDragPosition } from "@/hooks/useDragPosition";

/* ── Tokens ──────────────────────────────────────────────────────────
   The one object you edit to re-skin every system dialog. Tailwind-class
   strings so they play with arbitrary-value utilities.
*/
export const SYSTEM_DIALOG_TOKENS = {
  scrim: "bg-[var(--overlay-scrim)]",
  /** Modal stacking tier. Applied via inline style (not a Tailwind class) so
   *  it reads from the {@link MODAL_SCRIM_Z} SSOT in float-policy.ts rather
   *  than a bare arbitrary-z literal — see the scrim `<div>` below. */
  zIndex: MODAL_SCRIM_Z,
  surface:
    "bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-float)]",
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
  variant: SystemDialogVariant;
  /** variant="draggable": grab handler + live cursor state for a header strip. */
  beginDrag: (e: React.MouseEvent) => void;
  dragging: boolean;
}

const DialogCtx = createContext<DialogCtxValue | null>(null);

/**
 * Wire a custom header strip as the drag handle of a `variant="draggable"`
 * SystemDialog. Returns `{ onMouseDown, dragging }` (both inert outside a
 * draggable dialog). Spread `onMouseDown` onto the header element and use
 * `dragging` for the grab/grabbing cursor.
 */
export function useSystemDialogDrag(): {
  onMouseDown: ((e: React.MouseEvent) => void) | undefined;
  dragging: boolean;
} {
  const ctx = useContext(DialogCtx);
  return {
    onMouseDown: ctx?.variant === "draggable" ? ctx.beginDrag : undefined,
    dragging: ctx?.dragging ?? false,
  };
}

/* ── SystemDialog ─────────────────────────────────────────────────── */

export type SystemDialogVariant = "modal" | "draggable" | "anchored";

export interface SystemDialogProps {
  open: boolean;
  /** Called on Esc, backdrop/outside click, or programmatic close. Omit for non-dismissable. */
  onClose?: () => void;
  size?: SystemDialogSize;
  /** Positioning + scrim policy. Default "modal" (centered, scrim). */
  variant?: SystemDialogVariant;
  /** Position the dialog near this element instead of dead-center. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** variant="anchored": pin the frame at this viewport point (clamped to the
   *  viewport). Takes precedence over `anchorRef`. */
  at?: { x: number; y: number } | null;
  /** Scrimless variants: skip outside-click-close when the click matches this
   *  CSS selector (e.g. the trigger button that toggles the dialog open). */
  ignoreOutsideSelector?: string;
  /** Scrimless variants: return true to suppress outside-click-close for this
   *  event (e.g. ctrl+click-to-retarget in the preference picker). */
  outsideClickGuard?: (e: MouseEvent) => boolean;
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
  variant = "modal",
  anchorRef,
  at,
  ignoreOutsideSelector,
  outsideClickGuard,
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

  const scrimless = variant !== "modal";

  // Draggable shell: SystemDialog OWNS the drag (one useDragPosition), exposing
  // the grab handler to a header strip via context (useSystemDialogDrag). The
  // frame ref doubles as the outside-click "inside?" boundary for every variant.
  const {
    position: dragPos,
    onMouseDown: beginDrag,
    panelRef,
    isDraggingRef,
  } = useDragPosition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const registerAutoFocus = useCallback((el: HTMLButtonElement | null) => {
    autoFocusRef.current = el;
  }, []);

  // Focus + keyboard wiring (shared by every variant). anchorRef positioning is
  // the MODAL variant's near-element placement (scrim stays); the scrimless
  // "anchored" variant computes its own point-clamped position in the layout
  // effect below.
  useEffect(() => {
    if (!open) return;

    if (variant === "modal" && anchorRef?.current) {
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
  }, [open, onClose, anchorRef, variant]);

  // Point-anchored placement for the scrimless "anchored" variant. The frame
  // renders `visibility:hidden` until this effect measures it and clamps to the
  // viewport, so the popover only ever paints at its final clamped position (no
  // unclamped flash — just a one-frame delay before it appears).
  const [anchoredPos, setAnchoredPos] = useState<
    { top: number; left: number } | null
  >(null);
  useEffect(() => {
    if (!open || !mounted || variant !== "anchored") {
      setAnchoredPos(null);
      return;
    }
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 340;
    const h = el?.offsetHeight ?? 360;
    const pad = 8;
    let x: number;
    let y: number;
    if (at) {
      x = at.x;
      y = at.y;
    } else if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 8;
    } else {
      x = (window.innerWidth - w) / 2;
      y = (window.innerHeight - h) / 2;
    }
    setAnchoredPos({
      left: Math.max(pad, Math.min(window.innerWidth - w - pad, x)),
      top: Math.max(pad, Math.min(window.innerHeight - h - pad, y)),
    });
  }, [open, mounted, variant, at, anchorRef, panelRef]);

  // Outside-click-to-close for scrimless variants (the modal variant closes via
  // its backdrop instead). rAF-armed so the opening mousedown on the trigger
  // doesn't immediately re-close; skips drags, in-frame clicks, the trigger
  // selector, and any caller guard (e.g. a modifier retarget gesture).
  useEffect(() => {
    if (!open || !mounted || !scrimless || !onClose) return;
    let armed = false;
    const raf = requestAnimationFrame(() => {
      armed = true;
    });
    const handler = (e: MouseEvent) => {
      if (!armed || isDraggingRef.current) return;
      const target = e.target as Element | null;
      if (panelRef.current && target && panelRef.current.contains(target)) return;
      if (ignoreOutsideSelector && target?.closest?.(ignoreOutsideSelector))
        return;
      if (outsideClickGuard?.(e)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handler);
    };
  }, [
    open,
    mounted,
    scrimless,
    onClose,
    ignoreOutsideSelector,
    outsideClickGuard,
    isDraggingRef,
    panelRef,
  ]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    [onClose],
  );

  if (!open || !mounted) return null;

  const t = SYSTEM_DIALOG_TOKENS;

  const ctxValue: DialogCtxValue = {
    labelledBy,
    describedBy,
    registerAutoFocus,
    autoFocusRef,
    variant,
    beginDrag,
    dragging: isDraggingRef.current,
  };

  // ── Scrimless variants (draggable / anchored) ──────────────────────
  // No backdrop; the frame IS the portal root, positioned fixed. role=dialog on
  // the frame itself (no aria-modal — these are non-modal surfaces).
  if (scrimless) {
    const zIndex =
      variant === "draggable" ? DRAGGABLE_DIALOG_Z : MODAL_SCRIM_Z;
    let placement: CSSProperties;
    if (variant === "draggable") {
      placement = dragPos
        ? { position: "fixed", top: dragPos.y, left: dragPos.x }
        : {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          };
    } else {
      // anchored: hidden until the effect clamps against the measured frame
      placement = anchoredPos
        ? { position: "fixed", top: anchoredPos.top, left: anchoredPos.left }
        : { position: "fixed", top: 0, left: 0, visibility: "hidden" };
    }
    return createPortal(
      <DialogCtx.Provider value={ctxValue}>
        <div
          ref={panelRef}
          className={`${t.surface} ${frameClassName}`}
          style={{ ...placement, zIndex }}
          role="dialog"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
        >
          {children}
        </div>
      </DialogCtx.Provider>,
      document.body,
    );
  }

  // ── Modal variant (default) — scrim + centered/anchored frame ──────
  return createPortal(
    <DialogCtx.Provider value={ctxValue}>
      <div
        className={`fixed inset-0 ${t.scrim} ${anchorPos ? "" : "flex items-center justify-center"}`}
        // Keep centered dialogs clear of the OS window-control strip under WCO
        // (and the notch under safe-area); inert for anchored dialogs and when
        // the inset is 0 (normal tab). zIndex reads the MODAL_SCRIM_Z SSOT.
        style={{ zIndex: t.zIndex, paddingTop: "var(--window-inset-top, 0px)" }}
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
