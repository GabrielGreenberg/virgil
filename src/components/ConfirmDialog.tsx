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
 *
 * The IMPERATIVE form additionally owns the "Don't show this again" capability
 * (`confirm({ suppressId })`) — the checkbox, the persisted answer and the
 * short-circuit are one door, because only the door that decides whether to
 * OPEN can also decide not to. See `confirm-suppression.ts`.
 */

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useAskQueue } from "@/hooks/useAskQueue";
import {
  SUPPRESS_CHECKBOX_LABEL,
  isConfirmSuppressed,
  suppressConfirm,
  type SuppressibleConfirmId,
} from "./confirm-suppression";
import {
  confirmActionVariant,
  confirmDialogCuedDefault,
  type ConfirmTone,
} from "./confirm-cue-policy";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";

/* The tone→button policy is a LEAF (`confirm-cue-policy.ts`) so the OTHER
   confirm door — `system-dialog-host.tsx`, which cannot import this
   component module — reads the SAME rules. Re-exported here because this
   file is where every existing caller already looks for them. */
export {
  confirmActionVariant,
  confirmDialogCuedDefault,
  type ConfirmTone,
};

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
  /** When provided, the dialog positions near this element instead of centered.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Render the "Don't show this again" checkbox for this confirm.
   *
   * SHELL-ONLY. Production callers reach this through
   * `useConfirmDialog().confirm({ suppressId })`, never on a controlled
   * `<ConfirmDialog>` — the imperative door is the only surface that can also
   * SHORT-CIRCUIT a suppressed confirm, and a checkbox rendered without that
   * gate is a control that appears to work and doesn't. Pinned by
   * `confirm-suppression.test.tsx`'s census.
   */
  suppressId?: SuppressibleConfirmId;
  /** Reports the checkbox state up to the imperative door, which persists it
   *  on CONFIRM only (a suppression may only be minted by the choice it
   *  suppresses — task 395's override-mint rule). */
  onSuppressChange?: (checked: boolean) => void;
}

/**
 * May THIS confirm carry a "Don't show this again" checkbox?
 *
 * The one refusal, stated once: a **danger** confirm may not. `tone="danger"`
 * means the action destroys content without a net (STYLE_GUIDE, "the
 * destructive / alarm family"), and a remembered "yes" to a destruction is the
 * armed-default trap task 386 took off the keyboard, arriving through
 * persistence instead. A danger confirm that declares a `suppressId` renders no
 * checkbox and gates nothing — it fails toward ASKING — and says so loudly in
 * dev, because the declaration and the tone disagree and only the author can
 * decide which one is the lie.
 */
export function suppressibleTone(
  tone: ConfirmTone | undefined,
  suppressId: string,
): boolean {
  if (tone !== "danger") return true;
  if (process.env.NODE_ENV !== "production") {
    console.error(
      `[ConfirmDialog] tone="danger" confirm declares suppressId "${suppressId}". ` +
        "A destructive confirm may never be suppressible — drop one of them.",
    );
  }
  return false;
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
  suppressId,
  onSuppressChange,
}: ConfirmDialogProps) {
  const cuedDefault = confirmDialogCuedDefault({
    tone,
    hideCancel,
    hasSecondary: !!(secondaryLabel && onSecondary),
  });
  const suppressible = !!suppressId && suppressibleTone(tone, suppressId);
  const [suppressChecked, setSuppressChecked] = useState(false);
  const handleSuppressToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSuppressChecked(e.target.checked);
      onSuppressChange?.(e.target.checked);
    },
    [onSuppressChange],
  );
  return (
    <SystemDialog
      open={open}
      onClose={onCancel}
      anchorRef={anchorRef}
      size="sm"
      /* A single-button DANGER notice cues NOTHING — DECLARED, not omitted, so
         the census can tell "deliberately none" from "someone forgot one". */
      noCuedDefault={cuedDefault === "none"}
    >
      <SystemDialogHeader title={title} />
      <SystemDialogBody>
        <div className="text-sm text-ink-body leading-relaxed">{message}</div>
        {suppressible && (
          /* Deliberately NOT `autoFocus`: `autoFocus` marks the CUED DEFAULT
             (task 389) and the cue must stay on the answer. So the dialog's
             Enter contract is untouched — Enter from anywhere else still
             presses the cued button, which is the ordinary case because
             nothing focuses this box.

             Accepted consequence, stated rather than discovered: while the box
             ITSELF holds focus, Enter does nothing — `dialog-enter-policy`
             hands a focused checkbox its own key (it answers to SPACE), a
             MEASURED reversal that exists to stop Enter on
             `ManageStylesModal`'s default-style RADIO from closing that modal.
             Tick with Space, then Tab to the answer. Renegotiating it would
             move Enter for every checkbox in every dialog, which is a wider
             change than this one affordance earns. */
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={suppressChecked}
              onChange={handleSuppressToggle}
            />
            {SUPPRESS_CHECKBOX_LABEL}
          </label>
        )}
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
          variant={confirmActionVariant(tone)}
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
  /** Position the dialog beside this element instead of screen-centred — the
   *  imperative form of `ConfirmDialogProps.anchorRef`. A card's delete confirm
   *  passes its card root (task 976: `usePanelCardTryDelete`), so every kind's
   *  "This item has text" opens in the same place. */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Make this confirm SUPPRESSIBLE: the dialog grows a "Don't show this again"
   * checkbox, and a confirm the user has already answered that way resolves
   * `true` IMMEDIATELY with no dialog mounted at all.
   *
   * The short-circuit is the whole reason the capability lives on this door
   * rather than in a caller: the answer is remembered in ONE place
   * (`confirm-suppression.ts`), asked in ONE place, and minted only by the
   * choice it suppresses (ticking the box and pressing Cancel persists
   * nothing). A `tone: "danger"` confirm is refused — see `suppressibleTone`.
   */
  suppressId?: SuppressibleConfirmId;
}

/** A three-way question: the primary answer, a second real answer, or cancel.
 *
 *  `suppressId` is deliberately UNREPRESENTABLE here. Suppression remembers ONE
 *  answer, and a three-way question has two that commit — "remember my answer"
 *  cannot say which, and a half-capability (checkbox, no short-circuit) is a
 *  control that appears to work and doesn't. */
export interface ChoiceOptions extends Omit<ConfirmOptions, "suppressId"> {
  secondaryLabel: string;
}

/** Which button the user pressed. `confirm` maps to `true`, everything else to
 *  `false`, which is why the boolean `confirm()` can stay unchanged. */
export type ConfirmChoice = "confirm" | "secondary" | "cancel";

interface PendingConfirm extends ConfirmOptions {
  secondaryLabel?: string;
  resolve: (value: ConfirmChoice) => void;
}

/** An ask that ends without an answer (its door unmounted) is a cancel. */
const cancelPendingConfirm = (ask: PendingConfirm) => ask.resolve("cancel");

/**
 * Imperative wrapper. Mount `dialog` once inside your layout; call
 * `confirm(options)` to get a promise for the user's choice.
 *
 * `choose(options)` is the same dialog with a THIRD button, resolving the
 * pressed choice instead of a boolean — for a question whose two real answers
 * both commit (task 238's keep / revert / cancel). One queue and one mounted
 * dialog serve both, so a host that already mounts this hook gains the
 * three-way form without a second dialog instance.
 *
 * Asks QUEUE (task 1447, `useAskQueue`): a second `confirm()`/`choose()` while
 * one is open waits behind it rather than replacing it, every promise settles,
 * and each ask mounts its own dialog (`key={head.id}`) so focus and the cued
 * default re-enter per question. Unmounting the host resolves every
 * outstanding ask as cancel.
 */
export function useConfirmDialog() {
  const { head, enqueue, settle } =
    useAskQueue<PendingConfirm>(cancelPendingConfirm);
  // Each ask's suppression-checkbox state, keyed by ask id — a ref rather
  // than React state so ticking the box costs no re-render of the host (often
  // a whole editor pane), and per ASK so a queued confirm can never read the
  // box an earlier one ticked.
  const suppressCheckedRef = useRef(new Map<number, boolean>());
  const markSuppress = useCallback((id: number, checked: boolean) => {
    suppressCheckedRef.current.set(id, checked);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> => {
      // The SHORT-CIRCUIT. A confirm the user has told us to stop asking
      // resolves `true` with no dialog mounted — the caller's own doors
      // (`classifyDrop` / `applyDrop`, the archive splice) still run exactly as
      // they do on a live "yes"; only the question is skipped.
      // Resolved ONCE, here, so a refused (danger) declaration is dropped
      // before the dialog can see it — otherwise `suppressibleTone`'s dev
      // console.error re-fires on every render of a dialog that must not carry
      // the checkbox anyway.
      const allowSuppress =
        !!opts.suppressId && suppressibleTone(opts.tone, opts.suppressId);
      if (allowSuppress && isConfirmSuppressed(opts.suppressId!)) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        enqueue({
          ...opts,
          suppressId: allowSuppress ? opts.suppressId : undefined,
          resolve: (c) => resolve(c === "confirm"),
        });
      });
    },
    [enqueue],
  );

  const choose = useCallback(
    (opts: ChoiceOptions): Promise<ConfirmChoice> =>
      new Promise<ConfirmChoice>((resolve) => {
        enqueue({ ...opts, resolve });
      }),
    [enqueue],
  );

  const answer = useCallback(
    (id: number, choice: ConfirmChoice) => {
      const ask = settle(id);
      const ticked = suppressCheckedRef.current.get(id) === true;
      suppressCheckedRef.current.delete(id);
      if (!ask) return;
      // MINT HERE and nowhere else: a suppression may only be created by the
      // choice it suppresses, so Cancel (and the secondary answer) with the
      // box ticked persists nothing.
      if (choice === "confirm" && ask.suppressId && ticked) {
        suppressConfirm(ask.suppressId);
      }
      ask.resolve(choice);
    },
    [settle],
  );

  const pending = head?.ask;
  const dialog =
    head && pending ? (
      <ConfirmDialog
        key={head.id}
        open
        title={pending.title}
        message={pending.message}
        confirmLabel={pending.confirmLabel}
        cancelLabel={pending.cancelLabel}
        tone={pending.tone}
        hideCancel={pending.hideCancel}
        anchorRef={pending.anchorRef}
        suppressId={pending.suppressId}
        onSuppressChange={(checked) => markSuppress(head.id, checked)}
        secondaryLabel={pending.secondaryLabel}
        onSecondary={
          pending.secondaryLabel
            ? () => answer(head.id, "secondary")
            : undefined
        }
        onConfirm={() => answer(head.id, "confirm")}
        onCancel={() => answer(head.id, "cancel")}
      />
    ) : null;

  return { confirm, choose, dialog };
}
