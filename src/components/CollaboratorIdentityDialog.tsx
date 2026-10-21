"use client";

/**
 * CollaboratorIdentityDialog — the collaborator identity form, for both doors:
 * first-time setup (turning collab on with no identity yet) and "Edit
 * identity…" (an identity already exists — `IDENTITY_EDIT_COPY`).
 *
 * Asks for a display name and color. Writes both to localStorage via the
 * helpers in `lib/collab` and returns the chosen identity to the caller.
 * Composed from SystemDialog primitives.
 */

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Input } from "./field-primitives";
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
import { iconHint } from "@/components/Hint";
import { isCommitEnter } from "@/lib/key-intent";
import { useRadioGroup } from "@/hooks/useRadioGroup";

/** The swatch row's option values, normalised once (the saved colour is
 *  compared case-insensitively). */
const SWATCH_HEXES = COLLAB_COLORS.map((c) => c.hex.toLowerCase());

export interface CollaboratorIdentityDialogProps {
  open: boolean;
  /** Defaults the form to the previously saved identity if present. */
  initial?: CollabIdentity | null;
  /** Submitted with the new identity. */
  onConfirm: (identity: CollabIdentity) => void;
  /** Esc / cancel button. */
  onCancel: () => void;
  /** Replaces the default (first-time setup) header text — the edit door
   *  passes `IDENTITY_EDIT_COPY` through `useCollaboratorIdentity`. */
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
  const nameRef = useRef<HTMLInputElement | null>(null);
  const colorLabelId = useId();
  const swatchGroup = useRadioGroup({
    options: SWATCH_HEXES,
    value: color.toLowerCase(),
    onChange: setColor,
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 40;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const identity: CollabIdentity = { name: trimmed, color: color.toLowerCase() };
    saveIdentity(identity);
    onConfirm(identity);
  }, [canSubmit, trimmed, color, onConfirm]);

  return (
    <SystemDialog
      open={open}
      onClose={onCancel}
      size="sm"
      /* A dismissal is FREE: the draft is the user's own display name and a
         colour swatch, and Escape / the backdrop IS the Cancel this dialog
         offers. Nothing here is the only copy of anything. */
      dismissIsFree
      /* The name field claims initial focus through the SHELL's door, not a raw
         DOM `autoFocus`. Both put the caret in the box; only this one runs
         inside the shell's focus rAF, i.e. AFTER the shell has captured the
         element to give focus back to on close. A DOM `autoFocus` fires in
         React's layout pass — before every effect the shell can schedule — so
         it would make this the one dialog in the app with no focus restore
         (task 531), and it was already the shape `initialFocus` exists to
         retire. */
      initialFocus={() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }}
    >
      <SystemDialogHeader title={title} subtitle={description} />
      <SystemDialogBody>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-subtle">Display name</span>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (isCommitEnter(e) && canSubmit) {
                  e.preventDefault();
                  submit();
                }
              }}
              maxLength={40}
              placeholder="e.g. Sam"
              className="h-7 px-2 text-sm"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span id={colorLabelId} className="text-[11px] text-ink-subtle">
              Color
            </span>
            {/* A pick-one row, so it is a radio group (task 1216): the chosen
                colour is announced, not only drawn as a border, and the arrow
                keys move it. */}
            <div
              {...swatchGroup.groupProps}
              aria-labelledby={colorLabelId}
              className="flex flex-wrap gap-1.5"
            >
              {COLLAB_COLORS.map((c, i) => {
                const selected = c.hex.toLowerCase() === color.toLowerCase();
                return (
                  <button
                    data-iconbtn-exempt="color swatch: the fill IS the control"
                    key={c.hex}
                    type="button"
                    {...swatchGroup.radioProps(i)}
                    {...iconHint({ label: c.name })}
                    className="w-6 h-6 rounded-full border-2 motion-safe:transition-transform focus-ring"
                    style={{
                      background: c.hex,
                      borderColor: selected ? "var(--foreground)" : "transparent",
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

/** The header for EDITING an identity that already exists (task 1216). A
 *  saved change reaches every open paper through `saveIdentity`'s door (task
 *  1014), which moves this browser's pen and presence onto the new name. */
export const IDENTITY_EDIT_COPY = {
  title: "Edit your identity",
  description:
    "Your co-author sees this name and color. A change carries over to every open paper.",
} as const;

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

  // The copy follows what the ask FOUND: an existing identity is being
  // edited, a missing one is being set up for the first time.
  const dialog = pending ? (
    <CollaboratorIdentityDialog
      open
      initial={pending.initial}
      {...(pending.initial ? IDENTITY_EDIT_COPY : {})}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { ensureIdentity, dialog };
}
