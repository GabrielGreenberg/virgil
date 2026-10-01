"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import { Field, Input } from "./field-primitives";
import { InlineError } from "./InlineError";
import { DOC_TYPES, DEFAULT_DOC_TYPE_ID } from "@/lib/doc-types";

/**
 * What `onCreate` DID — the report this dialog reads to decide whether its
 * draft was consumed (task 530).
 *
 * `"created"` means the caller has the document and is about to unmount this
 * dialog. `"cancelled"` means NOTHING was created because the user backed out
 * of an inner step (the OS folder sheet), so the dialog stays open with the
 * typed name and the chosen template intact. A THROW is the third answer — a
 * real failure, rendered inline — and that one already worked, which is
 * exactly why the abort path was the only one that lost the draft: it returns
 * instead of throwing, so it took the SUCCESS path through `submit`.
 *
 * Not optional, and not `void`-able: the report is what the dialog is reading,
 * so a caller that states nothing is a caller that has not decided (the
 * "a defaulted argument is a decision nobody made" rule) — and the compiler
 * is this contract's census.
 */
export type NewDocumentOutcome = "created" | "cancelled";

interface NewDocumentModalProps {
  /** Optional subtitle shown under the title. */
  subtitle?: string;
  /** Default value for the name input. */
  initialName?: string;
  /** Default-selected template id. */
  initialTemplateId?: string;
  /** Called with the user-entered name and the picked template id; REPORTS
   *  whether a document was created — see {@link NewDocumentOutcome}. */
  onCreate: (
    name: string,
    templateId: string,
  ) => NewDocumentOutcome | Promise<NewDocumentOutcome>;
  onCancel: () => void;
}

export default function NewDocumentModal({
  subtitle,
  initialName = "",
  initialTemplateId,
  onCreate,
  onCancel,
}: NewDocumentModalProps) {
  const [name, setName] = useState(initialName);
  const [templateId, setTemplateId] = useState(
    initialTemplateId ?? DEFAULT_DOC_TYPE_ID,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await onCreate(name.trim(), templateId);
      // `busy` means "an operation that will CONSUME this draft is in flight",
      // so it clears exactly when the operation ended without consuming it.
      // On "created" the caller unmounts us a beat later; clearing here would
      // re-enable Create for a frame and let a fast double-click create twice.
      if (outcome === "cancelled") setBusy(false);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }, [canSubmit, onCreate, name, templateId]);

  return (
    <SystemDialog
      open
      onClose={busy ? undefined : onCancel}
      size="lg"
      /* A dismissal is FREE: Escape / the backdrop IS the user abandoning the
         name they were typing, and losing it is the point of that gesture.
         What must not close this dialog is a NON-dismissal — which is why
         `onCreate` reports rather than being read for its side effects. */
      dismissIsFree
      initialFocus={() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }}
    >
      <SystemDialogHeader title="New document" subtitle={subtitle} />

      <SystemDialogBody className="pb-2">
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="My paper"
              disabled={busy}
              className="w-full px-3 py-1.5 text-sm"
            />
          )}
        </Field>
      </SystemDialogBody>

      <Field
        label="Document type"
        control="group"
        className="px-5 pt-3 pb-2"
      >
        {({ labelId }) => (
          <DocTypePicker
            labelledBy={labelId}
            value={templateId}
            onChange={setTemplateId}
            disabled={busy}
          />
        )}
      </Field>

      {error && (
        <div className="px-5 pb-2">
          <InlineError boxed>{error}</InlineError>
        </div>
      )}

      <SystemDialogFooter>
        <SystemDialogButton onClick={onCancel} disabled={busy}>
          Cancel
        </SystemDialogButton>
        {/* The CUED DEFAULT: Enter creates, from anywhere in the dialog. It does
            NOT take initial focus — the name field claims that through the
            shell's `initialFocus`, which runs first. */}
        <SystemDialogButton
          variant="accent"
          autoFocus
          onClick={submit}
          disabled={!canSubmit}
        >
          {busy ? "Creating…" : "Create"}
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

/**
 * The document-type picker — a SINGLE-CHOICE group, so it says so (task 869).
 * It used to be a column of plain buttons whose chosen member differed only by
 * border and background: nothing told assistive tech which one was picked, and
 * the arrow keys did nothing. Now it is a WAI-ARIA radio group: each card is a
 * `role="radio"` with `aria-checked`, one tab stop for the whole group (the
 * checked card — roving tabindex), and the arrow keys move the choice and the
 * focus together, wrapping at the ends, as native radios do.
 */
function DocTypePicker({
  labelledBy,
  value,
  onChange,
  disabled,
}: {
  labelledBy: string;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const current = Math.max(
      0,
      DOC_TYPES.findIndex((t) => t.id === value),
    );
    const next = (current + step + DOC_TYPES.length) % DOC_TYPES.length;
    onChange(DOC_TYPES[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1"
    >
      {DOC_TYPES.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            disabled={disabled}
            className={`text-left px-3 py-2 rounded-md border transition-colors ${
              selected
                ? "border-edge-strong bg-[var(--accent-light)]"
                : "border-edge-subtle hover:border-edge-hover hover-on-light"
            }`}
          >
            <div className="text-sm font-medium text-ink-body">{t.label}</div>
            <div className="text-xs text-ink-subtle mt-0.5">
              {t.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
