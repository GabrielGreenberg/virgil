"use client";

/**
 * SystemDialogHost — app-wide imperative dialog API.
 *
 * Any React subtree under `<SystemDialogProvider>` can call
 * `useSystemDialog()` and get an imperative `alert` / `confirm` / `prompt`
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
 *   const name = await dialog.prompt({ title: "Rename", initial: "foo" });
 *
 * Only one dialog renders at a time; subsequent calls queue.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
  type SystemDialogSize,
} from "./system-dialog";
import {
  confirmActionVariant,
  confirmDialogCuedDefault,
} from "./confirm-cue-policy";
import { Input } from "./field-primitives";

/* ── Option types ────────────────────────────────────────────────── */

export interface AlertOptions {
  title?: string;
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
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button destructive AND cues **Cancel**, so
   *  `Enter` cancels — both derived from `confirm-cue-policy.ts`, the same
   *  rules `<ConfirmDialog>` reads. */
  tone?: "default" | "danger";
  size?: SystemDialogSize;
}

export interface PromptOptions {
  title?: string;
  message?: ReactNode;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  size?: SystemDialogSize;
}

/* ── Context ─────────────────────────────────────────────────────── */

export interface SystemDialogApi {
  alert(opts: AlertOptions): Promise<void>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  prompt(opts: PromptOptions): Promise<string | null>;
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

/* ── Pending dialog shape — tagged union ────────────────────────── */

type Pending =
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | {
      kind: "confirm";
      opts: ConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "prompt";
      opts: PromptOptions;
      resolve: (value: string | null) => void;
    };

/* ── Provider ────────────────────────────────────────────────────── */

export function SystemDialogProvider({ children }: { children: ReactNode }) {
  // FIFO queue. We render only the head; shifting on resolve.
  const [queue, setQueue] = useState<Pending[]>([]);
  const queueRef = useRef<Pending[]>(queue);
  queueRef.current = queue;

  const enqueue = useCallback((p: Pending) => {
    setQueue((q) => [...q, p]);
  }, []);

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
      prompt(opts) {
        return new Promise<string | null>((resolve) => {
          enqueue({ kind: "prompt", opts, resolve });
        });
      },
    }),
    [enqueue],
  );

  const head = queue[0];

  const close = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  return (
    <SystemDialogCtx.Provider value={api}>
      {children}
      {head && <PendingDialog pending={head} onDone={close} />}
    </SystemDialogCtx.Provider>
  );
}

/* ── Render one pending dialog ──────────────────────────────────── */

function PendingDialog({
  pending,
  onDone,
}: {
  pending: Pending;
  onDone: () => void;
}) {
  const titleId = useId();

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
        labelledBy={title ? titleId : undefined}
      >
        <SystemDialogHeader title={title} titleId={titleId} />
        <SystemDialogBody>
          {/* The tone reaches the MESSAGE, which is what it describes. A red
              failure notice is honest; a red BUTTON says "pressing this
              destroys content without a net" (STYLE_GUIDE, "the destructive /
              alarm family") and this one only dismisses. */}
          <div
            className={`text-xs leading-relaxed ${
              tone === "danger" ? "text-danger" : "text-ink-body"
            }`}
          >
            {message}
          </div>
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
        labelledBy={title ? titleId : undefined}
      >
        <SystemDialogHeader title={title} titleId={titleId} />
        <SystemDialogBody>
          <div className="text-xs text-ink-body leading-relaxed">{message}</div>
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

  // prompt
  return <PromptDialog pending={pending} onDone={onDone} titleId={titleId} />;
}

function PromptDialog({
  pending,
  onDone,
  titleId,
}: {
  pending: Extract<Pending, { kind: "prompt" }>;
  onDone: () => void;
  titleId: string;
}) {
  const {
    title,
    message,
    placeholder,
    initial = "",
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    size = "md",
  } = pending.opts;

  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  const done = (result: string | null) => {
    pending.resolve(result);
    onDone();
  };

  return (
    <SystemDialog
      open
      onClose={() => done(null)}
      size={size}
      /* A dismissal is FREE, and here it is the whole point: dismissing a
         prompt IS answering it with `null`, which is what every caller reads
         as "cancelled". The draft is one short line, normally pre-seeded from
         `opts.initial`, and the next ask re-seeds it. */
      dismissIsFree
      labelledBy={title ? titleId : undefined}
    >
      <SystemDialogHeader title={title} titleId={titleId} />
      <SystemDialogBody>
        {message && (
          <div className="text-xs text-ink-body leading-relaxed mb-2">
            {message}
          </div>
        )}
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              done(value);
            }
          }}
          placeholder={placeholder}
          className="w-full px-3 py-1.5 text-sm"
        />
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton onClick={() => done(null)}>
          {cancelLabel}
        </SystemDialogButton>
        <SystemDialogButton
          variant="primary"
          autoFocus
          onClick={() => done(value)}
        >
          {confirmLabel}
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
