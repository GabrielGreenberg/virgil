"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/document-templates";

interface NewDocumentModalProps {
  /** Optional subtitle shown under the title. */
  subtitle?: string;
  /** Default value for the name input. */
  initialName?: string;
  /** Default-selected template id. */
  initialTemplateId?: string;
  /** Called with the user-entered name and the picked template id. */
  onCreate: (name: string, templateId: string) => void | Promise<void>;
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
    initialTemplateId ?? DEFAULT_TEMPLATE_ID,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), templateId);
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
    >
      <SystemDialogHeader title="New document" subtitle={subtitle} />

      <SystemDialogBody className="pb-2">
        <label className="block text-[11px] font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
          Name
        </label>
        <input
          ref={nameRef}
          type="text"
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
          className="w-full px-3 py-1.5 text-sm bg-surface border border-edge-subtle rounded-md focus:border-edge-strong focus:outline-none text-ink-body"
        />
      </SystemDialogBody>

      <div className="px-5 pt-3 pb-2">
        <label className="block text-[11px] font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
          Template
        </label>
        <div className="flex flex-col gap-1">
          {DOCUMENT_TEMPLATES.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                disabled={busy}
                className={`text-left px-3 py-2 rounded-md border transition-colors ${
                  selected
                    ? "border-edge-strong bg-[var(--accent-light)]"
                    : "border-edge-subtle hover:border-edge-hover hover-on-light"
                }`}
              >
                <div className="text-sm font-medium text-ink-body">
                  {t.name}
                </div>
                <div className="text-xs text-ink-subtle mt-0.5">
                  {t.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="px-5 pb-2">
          <div className="text-xs text-danger bg-danger-soft px-2.5 py-1.5 rounded-md">
            {error}
          </div>
        </div>
      )}

      <SystemDialogFooter>
        <SystemDialogButton onClick={onCancel} disabled={busy}>
          Cancel
        </SystemDialogButton>
        <SystemDialogButton
          variant="accent"
          onClick={submit}
          disabled={!canSubmit}
        >
          {busy ? "Creating…" : "Create"}
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
