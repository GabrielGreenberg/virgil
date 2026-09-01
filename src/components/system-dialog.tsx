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
 *       <SystemDialogButton variant="secondary" onClick={cancel} autoFocus>Cancel</SystemDialogButton>
 *       <SystemDialogButton variant="danger" onClick={confirm}>Move</SystemDialogButton>
 *     </SystemDialogFooter>
 *   </SystemDialog>
 *
 * Shell behaviors (baked in, identical across every dialog):
 *   - Backdrop scrim + click-to-close (unless dismissable=false)
 *   - Esc to close — answered by ONE open dialog: the topmost modal, else the
 *     scrimless window containing focus, else the topmost (see `dialog-stack.ts`)
 *   - Enter activates a BUTTON: the focused in-frame button if there is one,
 *     otherwise the registered CUED DEFAULT — **never gated on where DOM focus
 *     happens to sit**. A modal answers an Enter from OUTSIDE its frame too, at
 *     window capture, so the document beneath never sees it; an in-frame control
 *     that owns Enter (textarea / contenteditable / select / link, or anything
 *     that called `preventDefault`) keeps it. Full rule + why:
 *     {@link file://./dialog-enter-policy.ts} (task 389).
 *   - role=dialog, aria-modal=true, aria-labelledby/aria-describedby
 *   - initial focus, once the portal exists: whatever already claimed focus
 *     INSIDE the frame, else the dialog's own `initialFocus` claim (a name
 *     field, a file row), else the cued button, else the frame — so focus always
 *     lands inside the dialog and the cue never steals a body's caret
 *
 * `autoFocus` marks the CUED DEFAULT: the button `Enter` activates, and the
 * initial-focus target when the dialog's own body has not claimed focus first.
 * It must never be a DESTRUCTIVE action — a
 * danger button armed under a hand that is already typing turns the user's next
 * keystroke into the destructive choice (task 386). Cue the safe answer;
 * `ConfirmDialog` derives this for every caller via
 * `confirmDialogCuedDefault()`.
 *   - Optional anchor positioning near a source element
 *
 * Positioning variants (`variant` prop) — one shell, principled positioning
 * VARIETY (task 033). Every variant shares the portal, the SYSTEM_DIALOG_TOKENS
 * chrome, Esc/focus/role wiring, and outside-click-to-close; they differ only in
 * scrim + placement + z-tier:
 *   - "modal"     (default) — scrim + centered (or near `anchorRef`); MODAL_SCRIM_Z.
 *   - "draggable" — scrimless tool window, drag-positioned by its header (wire the
 *                   header strip with {@link useSystemDialogDrag}); DRAGGABLE_DIALOG_Z.
 *
 * A THIRD member, "anchored" (a scrimless popover pinned at a viewport `at`
 * point, with its own clamp effect and an `outsideClickGuard` escape for a
 * modifier gesture), was DELETED by task 515. Its only consumer was the
 * preference-mode picker, which task 495 retired as a whole dead feature; 495
 * left the capability standing and SAID so, and this is the decision that note
 * asked for. `<Menu>` + `useFloatingMenuPosition` already own the two anchored
 * shapes STYLE_GUIDE routes elsewhere, so the caller it was waiting for is not
 * coming — and an untaken capability of a shared shell is a dead SSOT the next
 * reader trusts (task 202). Recoverable from git if a genuine anchored-DIALOG
 * need ever appears; do not re-add it ahead of its first caller. That "one
 * variant, one production caller" rule is now a CENSUS
 * (`system-dialog-variants-census.test.ts`), so this cannot recur silently.
 *
 * The scrimless variant closes on outside mousedown (skip via
 * `ignoreOutsideSelector` for the trigger button).
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
import {
  isKeyOwner,
  popDialog,
  pushDialog,
  type DialogToken,
} from "./dialog-stack";
import { isPlainEnter, resolveDialogEnter } from "./dialog-enter-policy";

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

export type SystemDialogVariant = "modal" | "draggable";

export interface SystemDialogProps {
  open: boolean;
  /** Called on Esc, backdrop/outside click, or programmatic close. Omit for non-dismissable. */
  onClose?: () => void;
  size?: SystemDialogSize;
  /** Positioning + scrim policy. Default "modal" (centered, scrim). */
  variant?: SystemDialogVariant;
  /** Position the dialog near this element instead of dead-center. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Scrimless variants: skip outside-click-close when the click matches this
   *  CSS selector (e.g. the trigger button that toggles the dialog open). */
  ignoreOutsideSelector?: string;
  /** DOM id of the title element — set aria-labelledby. */
  labelledBy?: string;
  /** DOM id of the description element — set aria-describedby. */
  describedBy?: string;
  /** Custom class appended to the inner frame. */
  frameClassName?: string;
  /**
   * Claim initial focus for something in the dialog's BODY — a name field, a
   * file row — instead of the cued button.
   *
   * Run by the shell once the portal exists. A dialog must NOT hand-roll this as
   * its own `useEffect(…, [])`: the shell renders `null` until `mounted`, so a
   * parent's mount effect fires in a commit where the body is not in the DOM,
   * the ref is null, and the effect (deps `[]`) never runs again. Three shipped
   * dialogs did exactly that and their fields were never focused —
   * `TexFilePickerModal` was left with no focused row AND no cued default, i.e.
   * a `Return` that did nothing, which is the very symptom task 389 removes.
   *
   * Called only when focus has not already landed inside the frame, and the
   * shell falls through to the cued button if this leaves focus outside it — so
   * a claim that cannot be satisfied costs nothing.
   */
  initialFocus?: () => void;
  /**
   * Declare that this dialog deliberately cues NO default button.
   *
   * A footered dialog either registers exactly one cued default (an `autoFocus`
   * `SystemDialogButton`) or says here that it means not to — so "no cue" can
   * never be read as "someone forgot one". Two real shapes need it: a picker
   * whose real answers are in its BODY (`TexFilePickerModal` — Enter belongs to
   * the focused file row, not to Cancel), and a single-button DANGER notice,
   * where cueing the only button would arm the destructive action under an
   * already-moving hand (task 386).
   *
   * Declaring this AND registering an `autoFocus` button is a contradiction and
   * `console.error`s in dev. The "a footer with NEITHER" half is a source shape,
   * pinned by `src/components/__tests__/dialog-cued-default-census.test.ts`.
   */
  noCuedDefault?: boolean;
  children: ReactNode;
}

export default function SystemDialog({
  open,
  onClose,
  size = "sm",
  variant = "modal",
  anchorRef,
  ignoreOutsideSelector,
  labelledBy,
  describedBy,
  frameClassName = "",
  noCuedDefault = false,
  initialFocus,
  children,
}: SystemDialogProps) {
  const autoFocusRef = useRef<HTMLButtonElement | null>(null);
  // Fallback focus target for a dialog that cues NO button (task 386: a
  // single-button DANGER notice has no safe button to cue, and cueing the only
  // one would put the destructive action under an already-moving hand). Focus
  // has to land inside the dialog regardless, or `Escape` and Tab-order both
  // start from wherever the user happened to be.
  const modalFrameRef = useRef<HTMLDivElement | null>(null);
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

  // Read through a ref so an inline arrow at the call site cannot churn the
  // focus effect (which must run exactly once per open). Written in an effect,
  // not during render — and safe, because the only reader is the focus rAF,
  // which fires after this commit.
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    initialFocusRef.current = initialFocus;
  });

  // anchorRef positioning — the MODAL variant's near-element placement (the
  // scrim stays; STYLE_GUIDE: a confirm acting on ONE visible object opens
  // against it). The scrimless variant is drag-positioned, never anchored.
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
  }, [open, anchorRef, variant]);

  // ── The dialog STACK ───────────────────────────────────────────────
  // One keyboard owner at a time. Dialogs genuinely stack (ManageStylesModal
  // stays mounted under StyleEditorModal / StyleApplyDialog / DocTypeChangeDialog),
  // and a window listener per open dialog means an un-owned key is answered by
  // every one of them — which pre-389 made a single Escape close BOTH.
  const tokenRef = useRef<DialogToken | null>(null);
  useEffect(() => {
    // Gated on `mounted` as well as `open`, matching the render gate below:
    // otherwise a dialog owns the keyboard for one commit before it has any DOM,
    // during which the dialog beneath it stops answering Escape.
    if (!open || !mounted) return;
    // The frame getter closes over two STABLE refs, so it needs no ref of its
    // own; the stack calls it lazily at key time.
    const token = pushDialog(
      variant === "modal",
      () => modalFrameRef.current ?? panelRef.current,
    );
    tokenRef.current = token;
    return () => {
      popDialog(token);
      tokenRef.current = null;
    };
  }, [open, mounted, variant, panelRef]);

  // ── Initial focus ──────────────────────────────────────────────────
  // Gated on `mounted`, and that is the whole of the 389 focus half. `mounted`
  // starts false (SSR can't touch document.body), so the FIRST commit of every
  // dialog renders `null` — no portal, no buttons, every ref still null. Scheduling
  // the focus rAF from that commit made landing focus a RACE the shell cannot win
  // reliably: React schedules the `setMounted(true)` re-render as a Scheduler task
  // while the rAF is tied to the frame, so on a BUSY main thread (exactly what the
  // end of a drag is — gesture-end edge, mint transaction, RO settle) the frame can
  // arrive first and the callback focuses nothing at all. That is why the reported
  // "Re-anchor this snippet?" dialog opened with focus still on `.ProseMirror`:
  // there was never a thief, only a claim that missed. Keyed on `mounted` the rAF
  // is scheduled from the commit where the portal EXISTS and the refs are live.
  //
  // It also STANDS DOWN when the dialog's own body has already claimed focus — a
  // prompt input, the file list in TexFilePickerModal, a rich field. `autoFocus`
  // marks the CUED DEFAULT (what Enter presses); it is only the initial-focus
  // target when nothing better inside the dialog wanted it.
  useEffect(() => {
    if (!open || !mounted) return;
    const handle = requestAnimationFrame(() => {
      const frame = modalFrameRef.current ?? panelRef.current;
      const inFrame = (el: Element | null) =>
        !!(frame && el && el !== frame && frame.contains(el));
      if (inFrame(document.activeElement)) return;
      // The body's own claim, run HERE rather than in the caller's mount effect —
      // see `initialFocus` on SystemDialogProps for why a caller cannot do this.
      initialFocusRef.current?.();
      if (inFrame(document.activeElement)) return;
      const cued = autoFocusRef.current;
      if (process.env.NODE_ENV !== "production" && noCuedDefault && cued) {
        // The declaration and the registration disagree — one of them is a lie,
        // and which one is a decision only the author can make. Loud in dev, and
        // the reason `noCuedDefault` is a LIVE prop rather than a marker the
        // census alone reads: a suite is not a consumer (task 202).
        console.error(
          "[SystemDialog] declares `noCuedDefault` but a SystemDialogButton " +
            "registered `autoFocus`. Drop one of them.",
          cued,
        );
      }
      if (cued && !cued.disabled) {
        cued.focus();
        return;
      }
      frame?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [open, mounted, panelRef, noCuedDefault]);

  // ── Keyboard ───────────────────────────────────────────────────────
  // Two listeners, one rule, split by PHASE — see `dialog-enter-policy.ts`.
  // CAPTURE answers an Enter from OUTSIDE a modal's frame, before ProseMirror can
  // turn it into a paragraph in the user's document. BUBBLE answers everything
  // else, AFTER the focused control had its chance to consume the key.
  useEffect(() => {
    if (!open) return;
    const modal = variant === "modal";
    const frameEl = () => modalFrameRef.current ?? panelRef.current;

    const pressCued = (e: KeyboardEvent) => {
      const cued = autoFocusRef.current;
      if (!cued || cued.disabled) return false;
      e.preventDefault();
      cued.click();
      return true;
    };

    const onCapture = (e: KeyboardEvent) => {
      if (!tokenRef.current || !isKeyOwner(tokenRef.current)) return;
      if (!isPlainEnter(e)) return;
      const verdict = resolveDialogEnter({
        target: e.target,
        frame: frameEl(),
        modal,
        alreadyHandled: e.defaultPrevented,
        phase: "capture",
      });
      if (verdict.kind !== "cued-default") return;
      // The modal OWNS this key: stop it here so nothing beneath the scrim acts
      // on it, whether or not a cued default exists to press.
      e.stopPropagation();
      // `pressCued` calls preventDefault when there IS a cue; do it here too so
      // the key is dead for the document beneath even when there is none.
      if (!pressCued(e)) e.preventDefault();
    };

    const onBubble = (e: KeyboardEvent) => {
      if (!tokenRef.current || !isKeyOwner(tokenRef.current)) return;
      if (e.key === "Escape") {
        // Unchanged from pre-389 except for the stack gate: Escape closes the
        // TOP dialog, unconditionally. Deliberately NOT gated on
        // `defaultPrevented` — CodeMirror binds Escape (simplifySelection) and
        // StyleEditorModal hosts one, so a "the target consumed it" rule would
        // make Escape stop closing that dialog whenever its preamble editor has
        // focus. A modal always has a way out.
        if (!onClose) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (!isPlainEnter(e)) return;
      const verdict = resolveDialogEnter({
        target: e.target,
        frame: frameEl(),
        modal,
        alreadyHandled: e.defaultPrevented,
        phase: "bubble",
      });
      if (verdict.kind === "activate") {
        e.preventDefault();
        verdict.button.click();
      } else if (verdict.kind === "cued-default") {
        pressCued(e);
      }
    };

    // DOCUMENT capture, not window capture. It still beats every in-document
    // handler (ProseMirror, CodeMirror, the editor keymaps all bind at or below
    // the editor element), and it deliberately runs AFTER two window-capture
    // listeners that must not be silenced: the open-menu controller, which
    // should win while a menu is up, and `input-modality`'s tracker, whose own
    // contract says a key trap must not be able to hide the fact that the user
    // is typing.
    document.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onBubble);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onBubble);
    };
  }, [open, onClose, variant, panelRef]);

  // Outside-click-to-close for scrimless variants (the modal variant closes via
  // its backdrop instead). rAF-armed so the opening mousedown on the trigger
  // doesn't immediately re-close; skips drags, in-frame clicks, and the trigger
  // selector.
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

  // ── Scrimless variant (draggable) ──────────────────────────────────
  // No backdrop; the frame IS the portal root, positioned fixed. role=dialog on
  // the frame itself (no aria-modal — this is a non-modal surface). `scrimless`
  // stays the SCRIM AXIS rather than collapsing into `variant === "draggable"`:
  // it is the axis the modal branch below contrasts with, and it happens to
  // have one member today (task 515 retired the other).
  if (scrimless) {
    const zIndex = DRAGGABLE_DIALOG_Z;
    const placement: CSSProperties = dragPos
      ? { position: "fixed", top: dragPos.y, left: dragPos.x }
      : {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        };
    return createPortal(
      <DialogCtx.Provider value={ctxValue}>
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`${t.surface} ${frameClassName} focus:outline-none`}
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

  // ── Modal variant (default) — scrim + centered/anchor-placed frame ─
  return createPortal(
    <DialogCtx.Provider value={ctxValue}>
      <div
        className={`fixed inset-0 ${t.scrim} ${anchorPos ? "" : "flex items-center justify-center"}`}
        // Keep centered dialogs clear of the OS window-control strip under WCO
        // (and the notch under safe-area); inert for an anchorRef-placed frame
        // and when the inset is 0 (normal tab). zIndex reads MODAL_SCRIM_Z.
        style={{ zIndex: t.zIndex, paddingTop: "var(--window-inset-top, 0px)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={handleBackdrop}
      >
        <div
          ref={modalFrameRef}
          tabIndex={-1}
          className={`${t.surface} w-full ${t.maxWidth[size]} mx-4 overflow-hidden focus:outline-none ${frameClassName}`}
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
