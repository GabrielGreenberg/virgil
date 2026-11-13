"use client";

/**
 * SystemDialogHost — app-wide imperative dialog API.
 *
 * Any React subtree under `<SystemDialogProvider>` can call
 * `useSystemDialog()` and get an imperative `alert` / `confirm`
 * that render through the centralized SystemDialog primitive. This is
 * how we avoid `window.alert` / `window.confirm` from deep hooks — the
 * hook doesn't need to plumb a dialog callback through props, it just
 * reads context.
 *
 * Usage from any descendant of SystemDialogProvider:
 *
 *   const dialog = useSystemDialog();
 *   const ok = await dialog.confirm({ title: "Move?", message: "..." });
 *   await dialog.alert({ title: "Failed", message: "..." , tone: "danger" });
 *
 * There is no `prompt` (task 834): it had no caller, and every text-entry need
 * is a purpose-built dialog whose field claims focus through the shell's
 * `initialFocus` door. A new text ask starts there, not here.
 *
 * Only one dialog renders at a time; subsequent calls queue.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
  SystemDialogMessage,
  type SystemDialogSize,
} from "./system-dialog";
import {
  confirmActionVariant,
  confirmDialogCuedDefault,
} from "./confirm-cue-policy";
import { useAskQueue } from "@/hooks/useAskQueue";
import { registerEditRefusalVoice } from "@/lib/edit-refusal";

/* ── Option types ────────────────────────────────────────────────── */

export interface AlertOptions {
  /** REQUIRED (task 1609) — the dialog's accessible name. */
  title: string;
  message: ReactNode;
  /** Label for the single dismiss button. Defaults to "OK". */
  okLabel?: string;
  /** Visual tone of the MESSAGE — `danger` inks a failure notice red.
   *  It does NOT reach the button: an alert's sole button dismisses and
   *  commits nothing, and red is a claim about the AFFORDANCE (task 528).
   *  See `confirm-cue-policy.ts`. */
  tone?: "default" | "danger";
  size?: SystemDialogSize;
}

export interface ConfirmOptions {
  /** REQUIRED (task 1609) — the dialog's accessible name. */
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button destructive AND cues **Cancel**, so
   *  `Enter` cancels — both derived from `confirm-cue-policy.ts`, the same
   *  rules `<ConfirmDialog>` reads. */
  tone?: "default" | "danger";
  size?: SystemDialogSize;
}

/* ── Context ─────────────────────────────────────────────────────── */

export interface SystemDialogApi {
  alert(opts: AlertOptions): Promise<void>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}

const SystemDialogCtx = createContext<SystemDialogApi | null>(null);

export function useSystemDialog(): SystemDialogApi {
  const ctx = useContext(SystemDialogCtx);
  if (!ctx) {
    throw new Error(
      "useSystemDialog must be used inside <SystemDialogProvider>",
    );
  }
  return ctx;
}

/** The dialog API when a `<SystemDialogProvider>` is mounted above, else
 *  `null` — for surfaces (an editor NodeView) that also render in harnesses
 *  with no provider and fall back to a console line there. */
export function useOptionalSystemDialog(): SystemDialogApi | null {
  return useContext(SystemDialogCtx);
}

/* ── Pending dialog shape — tagged union ────────────────────────── */

/** One ASK. Its queue `id` (minted by `useAskQueue`) is its identity for the life of the queue (task 833): the
 *  head renders keyed by it, so each ask MOUNTS its own dialog. Without it,
 *  two same-kind asks in a row reconciled into ONE `SystemDialog` whose `open`
 *  never left `true` — the second ask inherited the first's focused button
 *  (Enter on a queued danger confirm armed the destruction), skipped the
 *  shell's per-open focus capture/restore. Every per-open contract assumes a fresh mount. */
type PendingAsk =
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | {
      kind: "confirm";
      opts: ConfirmOptions;
      resolve: (value: boolean) => void;
    };

/** How an ask ends when the provider unmounts under it: an alert is
 *  dismissed, a confirm is declined. */
function cancelAsk(ask: PendingAsk) {
  if (ask.kind === "alert") ask.resolve();
  else ask.resolve(false);
}

/* ── Provider ────────────────────────────────────────────────────── */

export function SystemDialogProvider({ children }: { children: ReactNode }) {
  // FIFO queue, keyed by monotonic ask identity — the ONE queue semantics
  // every imperative dialog door shares (`useAskQueue`, task 1447). We render
  // only the head; an unmounted provider resolves every outstanding ask as
  // its cancel.
  const { head, enqueue, settle } = useAskQueue<PendingAsk>(cancelAsk);

  const api = useMemo<SystemDialogApi>(
    () => ({
      alert(opts) {
        return new Promise<void>((resolve) => {
          enqueue({ kind: "alert", opts, resolve });
        });
      },
      confirm(opts) {
        return new Promise<boolean>((resolve) => {
          enqueue({ kind: "confirm", opts, resolve });
        });
      },
    }),
    [enqueue],
  );

  // The app's ONE "your edit was refused after you acted" voice (task 1436):
  // pure doors and NodeViews announce through `announceEditRefused` and it
  // lands here as an alert, the typed/picked input handed back beneath.
  useEffect(
    () =>
      registerEditRefusalVoice((notice) => {
        void api.alert({
          title: notice.title,
          message: notice.draft ? (
            <>
              {notice.message} Your input, so you can re-apply it:
              <pre className="mt-2 whitespace-pre-wrap break-words select-text font-mono">
                {notice.draft}
              </pre>
            </>
          ) : (
            notice.message
          ),
        });
      }),
    [api],
  );

  const close = useCallback(
    (id: number) => {
      settle(id);
    },
    [settle],
  );

  return (
    <SystemDialogCtx.Provider value={api}>
      {children}
      {/* KEYED by the ask's identity (task 833) — each ask mounts fresh. */}
      {head && (
        <PendingDialog
          key={head.id}
          pending={head.ask}
          onDone={() => close(head.id)}
        />
      )}
    </SystemDialogCtx.Provider>
  );
}

/* ── Render one pending dialog ──────────────────────────────────── */

function PendingDialog({
  pending,
  onDone,
}: {
  pending: PendingAsk;
  onDone: () => void;
}) {
  if (pending.kind === "alert") {
    const { title, message, okLabel = "OK", tone = "default", size = "sm" } =
      pending.opts;
    const finish = () => {
      pending.resolve();
      onDone();
    };
    return (
      <SystemDialog
        open
        onClose={finish}
        size={size}
      >
        <SystemDialogHeader title={title} />
        <SystemDialogBody>
          {/* The tone reaches the MESSAGE, which is what it describes. A red
              failure notice is honest; a red BUTTON says "pressing this
              destroys content without a net" (STYLE_GUIDE, "the destructive /
              alarm family") and this one only dismisses. */}
          <SystemDialogMessage
            className={`text-xs leading-relaxed ${
              tone === "danger" ? "text-error" : "text-ink-body"
            }`}
          >
            {message}
          </SystemDialogMessage>
        </SystemDialogBody>
        <SystemDialogFooter>
          {/* Deliberately a LITERAL, not `confirmActionVariant(tone)`: this
              button commits nothing, so there is no destructive answer to
              derive. Cueing it is safe for the same reason — `Enter`
              dismisses, which is what an alert is for. */}
          <SystemDialogButton variant="primary" autoFocus onClick={finish}>
            {okLabel}
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>
    );
  }

  if (pending.kind === "confirm") {
    const {
      title,
      message,
      confirmLabel = "Continue",
      cancelLabel = "Cancel",
      tone = "default",
      size = "sm",
    } = pending.opts;
    const done = (value: boolean) => {
      pending.resolve(value);
      onDone();
    };
    /* DERIVED, never hardcoded (task 528). A `danger` confirm cues its SAFEST
       button, so `Enter` cancels — task 386's data-safety rule, read from the
       ONE function `<ConfirmDialog>` reads. This door armed the destructive
       answer for as long as it has existed; the live path was Tab-strip **+**
       → "Reset example document", whose destruction has no undo and no
       `virgil/.history/` slot, opening under a hand that had just pressed a
       menu row.

       This door always renders Cancel and offers no secondary, so the policy
       can only answer "cancel" or "confirm" — there is no `"none"` arm to
       declare. Should `ConfirmOptions` ever grow `hideCancel`, that arm
       arrives with it and needs `noCuedDefault` on the frame, exactly as
       `<ConfirmDialog>` spells it. */
    const cuedDefault = confirmDialogCuedDefault({
      tone,
      hideCancel: false,
      hasSecondary: false,
    });
    return (
      <SystemDialog
        open
        onClose={() => done(false)}
        size={size}
      >
        <SystemDialogHeader title={title} />
        <SystemDialogBody>
          <SystemDialogMessage className="text-sm text-ink-body leading-relaxed">
            {message}
          </SystemDialogMessage>
        </SystemDialogBody>
        <SystemDialogFooter>
          <SystemDialogButton
            autoFocus={cuedDefault === "cancel"}
            onClick={() => done(false)}
          >
            {cancelLabel}
          </SystemDialogButton>
          <SystemDialogButton
            variant={confirmActionVariant(tone)}
            autoFocus={cuedDefault === "confirm"}
            onClick={() => done(true)}
          >
            {confirmLabel}
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>
    );
  }
}
