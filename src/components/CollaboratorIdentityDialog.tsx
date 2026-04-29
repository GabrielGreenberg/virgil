"use client";

/**
 * CollaboratorIdentityDialog — first-time identity setup for collaborator mode.
 *
 * Asks for a display name and color. Writes both to localStorage via the
 * helpers in `lib/collab` and returns the chosen identity to the caller.
 * Composed from SystemDialog primitives.
 */

import { useCallback, useState, type ReactNode } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import {
  COLLAB_COLORS,
  loadIdentity,
  saveIdentity,
  type CollabIdentity,
} from "@/lib/collab";

export interface CollaboratorIdentityDialogProps {
  open: boolean;
  /** Defaults the form to the previously saved identity if present. */
  initial?: CollabIdentity | null;
  /** Submitted with the new identity. */
  onConfirm: (identity: CollabIdentity) => void;
  /** Esc / cancel button. */
  onCancel: () => void;
  /** Replaces the default header text — useful for "Edit identity" reuse. */
  title?: string;
  description?: ReactNode;
}

export default function CollaboratorIdentityDialog({
  open,
  initial,
  onConfirm,
  onCancel,
  title = "Collaborator identity",
  description = "Pick a name and color so your co-author can tell who's editing.",
}: CollaboratorIdentityDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(
    initial?.color ?? COLLAB_COLORS[0].hex,
  );

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 40;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const identity: CollabIdentity = { name: trimmed, color: color.toLowerCase() };
    saveIdentity(identity);
    onConfirm(identity);
  }, [canSubmit, trimmed, color, onConfirm]);

  return (
    <SystemDialog open={open} onClose={onCancel} size="sm">
      <SystemDialogHeader title={title} subtitle={description} />
      <SystemDialogBody>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-subtle">Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  submit();
                }
              }}
              maxLength={40}
              placeholder="e.g. Sam"
              autoFocus
              className="h-7 px-2 rounded border border-edge-strong bg-surface text-sm text-ink-body outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-subtle">Color</span>
            <div className="flex flex-wrap gap-1.5">
              {COLLAB_COLORS.map((c) => {
                const selected = c.hex.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    title={c.name}
                    className="w-6 h-6 rounded-full border-2 transition-transform"
                    style={{
                      background: c.hex,
                      borderColor: selected ? "#1a1a1a" : "transparent",
                      transform: selected ? "scale(1.1)" : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton onClick={onCancel}>Cancel</SystemDialogButton>
        <SystemDialogButton
          variant="primary"
          autoFocus
          disabled={!canSubmit}
          onClick={submit}
        >
          Save
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

/* ── Imperative hook ─────────────────────────────────────────────── */

interface PendingIdentityAsk {
  initial: CollabIdentity | null;
  resolve: (identity: CollabIdentity | null) => void;
}

/**
 * `ensureIdentity()` resolves to a saved or newly-entered identity, or
 * `null` if the user cancelled. Mount `dialog` once near the layout root.
 */
export function useCollaboratorIdentity() {
  const [pending, setPending] = useState<PendingIdentityAsk | null>(null);

  const ensureIdentity = useCallback(
    (opts?: { force?: boolean }): Promise<CollabIdentity | null> => {
      const existing = loadIdentity();
      if (existing && !opts?.force) return Promise.resolve(existing);
      return new Promise<CollabIdentity | null>((resolve) => {
        setPending({ initial: existing, resolve });
      });
    },
    [],
  );

  const handleConfirm = useCallback(
    (identity: CollabIdentity) => {
      pending?.resolve(identity);
      setPending(null);
    },
    [pending],
  );

  const handleCancel = useCallback(() => {
    pending?.resolve(null);
    setPending(null);
  }, [pending]);

  const dialog = pending ? (
    <CollaboratorIdentityDialog
      open
      initial={pending.initial}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { ensureIdentity, dialog };
}
