"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/document-templates";

interface NewDocumentModalProps {
  /**
   * Optional subtitle shown under the title — lets callers hint where the
   * new doc will land (e.g. "in current folder" vs picker-based).
   */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

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

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !busy) onCancel();
    },
    [onCancel, busy],
  );

  return (
    <div
      className="fixed inset-0 z-[10000] bg-[var(--overlay-scrim)] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdrop}
    >
      <div className="bg-surface border border-edge-subtle rounded-xl shadow-xl w-full max-w-[480px] mx-4 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-ink-body mb-0.5">
            New document
          </h2>
          {subtitle && (
            <p className="text-xs text-ink-subtle">{subtitle}</p>
          )}
        </div>

        <div className="px-5 pb-2">
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
        </div>

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
                      : "border-edge-subtle hover:border-edge-hover hover:bg-surface-muted"
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

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge-subtle bg-surface-muted/60">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium text-ink-body bg-surface border border-edge-hover rounded-md hover:bg-surface-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
