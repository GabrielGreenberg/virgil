"use client";

import { useCallback, useState, useRef } from "react";
import type { EditorPreferences, PreferencePreset, SettingsSnapshot } from "@/hooks/usePreferences";
import { isReservedPresetName } from "@/hooks/usePreferences";
import type { GlobalTransforms } from "@/lib/color-transforms";
import { PREFERENCES_TREE } from "@/lib/preferences-tree";
import PreferenceTree from "./PreferenceTree";
import { Field, Input, Select } from "./field-primitives";
import { Button } from "./Button";
import SmartPreferences from "./SmartPreferences";
import SystemDialog, { useSystemDialogDrag } from "./system-dialog";
import { iconHint } from "@/components/Hint";
import {
  SUPPRESSIBLE_CONFIRM_LABELS,
  restoreAllConfirms,
  useSuppressedConfirms,
} from "./confirm-suppression";

interface PreferencesModalProps {
  prefs: EditorPreferences;
  transforms: GlobalTransforms;
  presets: PreferencePreset[];
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
  onUpdateTransform: <K extends keyof GlobalTransforms>(key: K, value: GlobalTransforms[K]) => void;
  onReset: () => void;
  onClose: () => void;
  onSavePreset: (name: string) => void;
  onLoadPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  /** Undo doors (task 903): put the settings pair / a preset back as it was. */
  onRestoreSettings: (snapshot: SettingsSnapshot) => void;
  onRestorePreset: (preset: PreferencePreset) => void;
}

/** The one pending undo the dialog offers: what just happened, and how to take
 *  it back. ONE slot, not a stack — the next undoable action replaces it, and
 *  any other change through the dialog clears it (an undo that silently also
 *  reverted the edits made since would be a second destructive action). */
interface PendingUndo {
  message: string;
  undo: () => void;
}

// ─── Global Transform Slider ──────────────────────────────────────────────────

function TransformSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const rafRef = useRef<number>(0);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => onChange(v));
  }, [onChange]);

  // A labelled field (task 903): the caption above the slider used to be a bare
  // `<span>`, so "Contrast"/"Hue"/"Brightness" named nothing.
  return (
    <Field label={label} className="flex-1 min-w-0 relative">
      {({ id }) => (
        <>
          <span className="absolute right-0 top-0 text-[10px] text-ink-muted tabular-nums w-8 text-right">
            {value > 0 ? `+${value}` : value}
          </span>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            className="w-full h-1 accent-[var(--accent)]"
          />
        </>
      )}
    </Field>
  );
}

// ─── Preset Bar ───────────────────────────────────────────────────────────────

function PresetBar({
  presets,
  onLoad,
  onSave,
  onDelete,
  onUndoable,
  onRestore,
}: {
  presets: PreferencePreset[];
  onLoad: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onUndoable: (pending: PendingUndo) => void;
  onRestore: (preset: PreferencePreset) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  // The preset last PICKED — the delete affordance's target, not an "active
  // preset" claim. The picker itself holds no selection (see below), so this is
  // deliberately not fed back into the <select>.
  const [target, setTarget] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedName = newName.trim();
  const nameReserved = isReservedPresetName(trimmedName);
  const canSaveName = trimmedName.length > 0 && !nameReserved;

  const handleSave = useCallback(() => {
    if (saving) {
      const name = newName.trim();
      if (name && !isReservedPresetName(name)) {
        // Saving over an existing name replaced it silently; snapshot it first
        // so the overwrite can be taken back (task 903).
        const replaced = presets.find((p) => p.name === name && !p.builtIn);
        onSave(name);
        if (replaced) {
          onUndoable({
            message: `Preset \u201c${name}\u201d replaced`,
            undo: () => onRestore(replaced),
          });
        }
        setNewName("");
        setSaving(false);
      }
    } else {
      setSaving(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [saving, newName, onSave, presets, onUndoable, onRestore]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setSaving(false);
  }, [handleSave]);

  // The picker is an ACTION, not a bound value: it applies the preset and
  // immediately returns to its placeholder. Bound to a selection it lied twice —
  // re-picking the preset you were already on fired no change event (so you
  // could not revert your edits by re-applying it), and after "Reset to
  // defaults" it went on naming a preset that was no longer in effect. The DOM
  // reset is imperative because React re-renders on an UNCHANGED `target` are
  // bailed out, which would leave the picked option stuck in the DOM.
  const handleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.currentTarget.value;
    e.currentTarget.value = "";
    if (!name) return;
    setTarget(name);
    onLoad(name);
  }, [onLoad]);

  const targetPreset = presets.find((p) => p.name === target);
  const canDelete = !!targetPreset && !targetPreset.builtIn;

  return (
    <div className="flex items-center gap-2">
      <Select
        value=""
        onChange={handleSelectChange}
        className="flex-1 min-w-0 text-xs px-2 py-1.5"
      >
        <option value="">Load preset...</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.builtIn ? " (built-in)" : ""}
          </option>
        ))}
      </Select>

      {saving ? (
        <Input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!newName.trim()) setSaving(false); }}
          placeholder="Preset name"
          invalid={nameReserved}
          aria-invalid={nameReserved || undefined}
          title={nameReserved ? `"${trimmedName}" is a built-in preset name` : undefined}
          className="text-xs px-2 py-1.5 w-28"
        />
      ) : null}

      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving && !canSaveName}
        title={saving && nameReserved ? `"${trimmedName}" is a built-in preset name` : undefined}
        className="whitespace-nowrap"
      >
        {saving ? "OK" : "Save"}
      </Button>

      {canDelete && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            // A one-click delete with no way back (task 903) — snapshot it.
            const deleted = targetPreset;
            onDelete(target);
            setTarget("");
            if (deleted) {
              onUndoable({
                message: `Preset \u201c${deleted.name}\u201d deleted`,
                undo: () => onRestore(deleted),
              });
            }
          }}
          title={`Delete preset "${target}"`}
          className="max-w-[9rem]"
        >
          <span className="truncate">Del &ldquo;{target}&rdquo;</span>
        </Button>
      )}
    </div>
  );
}

// ─── Header (drag handle) ───────────────────────────────────────────────────────
// Rendered as a child of SystemDialog so it sits INSIDE the dialog's provider and
// can read the drag handler via useSystemDialogDrag (SystemDialog owns the drag).

function PreferencesHeader({ onClose }: { onClose: () => void }) {
  const { onMouseDown, dragging } = useSystemDialogDrag();
  return (
    <div
      className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] select-none shrink-0"
      onMouseDown={onMouseDown}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      <h2 id="preferences-modal-title" className="text-sm font-semibold text-ink-body">
        Preferences
      </h2>
      <button
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
        className="iconbtn-md"
        {...iconHint({ label: "Close" })}
      >
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

/* ── Restore hidden confirmations ─────────────────────────────────────────────
 *
 * The way BACK from every "Don't show this again" tick, so suppression is never
 * a one-way door (task 492). Renders NOTHING when nothing is suppressed rather
 * than a disabled control that does nothing — the false-affordance rule this
 * codebase applies to the unanchored-cards chip and every other count-gated
 * affordance. It lives in the modal CHROME and not in `PREFERENCES_TREE`
 * because the tree's leaves are `EditorPreferences` keys that each move a pixel
 * through a CSS variable (the `inert-preference-controls` census); this is an
 * action, not a value.
 */
function RestoreHiddenConfirmations() {
  const suppressed = useSuppressedConfirms();
  if (suppressed.length === 0) return null;
  return (
    <button
      onClick={restoreAllConfirms}
      title={suppressed
        .map((id) => SUPPRESSIBLE_CONFIRM_LABELS[id])
        .join("\n")}
      className="text-xs text-ink-muted hover:text-ink-body transition-colors"
    >
      Restore hidden confirmations ({suppressed.length})
    </button>
  );
}

export default function PreferencesModal({
  prefs,
  transforms,
  presets,
  onUpdate,
  onUpdateTransform,
  onReset,
  onClose,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onRestoreSettings,
  onRestorePreset,
}: PreferencesModalProps) {
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

  // Any other change routed through the dialog retires the pending undo: an
  // Undo pressed after further edits would silently revert those too.
  const update = useCallback<PreferencesModalProps["onUpdate"]>((key, value) => {
    setPendingUndo(null);
    onUpdate(key, value);
  }, [onUpdate]);
  const updateTransform = useCallback<PreferencesModalProps["onUpdateTransform"]>((key, value) => {
    setPendingUndo(null);
    onUpdateTransform(key, value);
  }, [onUpdateTransform]);
  const loadPreset = useCallback((name: string) => {
    setPendingUndo(null);
    onLoadPreset(name);
  }, [onLoadPreset]);

  // "Reset to defaults" wipes every preference and transform in one click. It
  // stays one click — a confirm in front of an UNDOABLE action is friction with
  // no protection — but it is undoable now (task 903): the settings it replaced
  // are snapshotted and offered back in the footer.
  const handleReset = useCallback(() => {
    const snapshot: SettingsSnapshot = { prefs, transforms };
    onReset();
    setPendingUndo({
      message: "Preferences reset",
      undo: () => onRestoreSettings(snapshot),
    });
  }, [prefs, transforms, onReset, onRestoreSettings]);

  const runUndo = useCallback(() => {
    if (!pendingUndo) return;
    setPendingUndo(null);
    pendingUndo.undo();
  }, [pendingUndo]);

  // Scrimless draggable SystemDialog: it owns the portal, surface chrome
  // (SYSTEM_DIALOG_TOKENS), the DRAGGABLE_DIALOG_Z tier (retiring the old bare
  // z-[9999] that collided with the drop indicator), the drag (grab the header),
  // Esc, and outside-click-to-close. `ignoreOutsideSelector` preserves the
  // topbar-trigger guard: clicking the Preferences button doesn't close-then-
  // reopen (the same gesture would otherwise flip `preferencesOpen` back on).
  return (
    <SystemDialog
      open
      variant="draggable"
      onClose={onClose}
      ignoreOutsideSelector='[data-hint="Preferences"]'
      /* A dismissal is FREE: every preference commits UPSTREAM the instant it
         changes (`onUpdate` writes straight to the prefs store), so closing
         loses no setting. The pockets of local state that do die with the
         unmount — `PresetBar`'s half-typed preset name,
         `PreferenceTree.ColorPref`'s half-typed hex, and the footer's pending
         Undo (an offer, like a toast's, that ends with the surface) — are
         each a short token or a click. */
      dismissIsFree
      labelledBy="preferences-modal-title"
      frameClassName="w-full max-w-[560px] max-h-[85vh] flex flex-col"
    >
      <PreferencesHeader onClose={onClose} />

      {/* Presets + Global Sliders (sticky) */}
      <div className="px-5 py-3 border-b border-[var(--border)] space-y-3 bg-[var(--surface)]">
        <PresetBar
          presets={presets}
          onLoad={loadPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
          onUndoable={setPendingUndo}
          onRestore={onRestorePreset}
        />

        <div className="flex items-start gap-4">
          <TransformSlider
            label="Contrast"
            value={transforms.contrast}
            min={-100}
            max={100}
            step={5}
            onChange={(v) => updateTransform("contrast", v)}
          />
          <TransformSlider
            label="Hue"
            value={transforms.hue}
            min={-180}
            max={180}
            step={5}
            onChange={(v) => updateTransform("hue", v)}
          />
          <TransformSlider
            label="Brightness"
            value={transforms.brightness}
            min={-50}
            max={50}
            step={2}
            onChange={(v) => updateTransform("brightness", v)}
          />
        </div>
      </div>

      {/* Body: smart preferences on top, then the full tree */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
        <SmartPreferences prefs={prefs} onUpdate={update} />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
            All preferences
          </span>
          <div className="flex-1 h-px bg-edge-subtle" />
        </div>
        <PreferenceTree
          tree={PREFERENCES_TREE}
          prefs={prefs}
          onUpdate={update}
        />
      </div>

      {/* Footer — STYLE_GUIDE "Modal footers": the destructive action sits FAR
          LEFT (task 903; it was `ml-auto`, the primary's corner). The pending
          Undo is a live status so a screen reader hears the reset happened. */}
      <div className="px-5 py-3 border-t border-[var(--border)] flex items-center gap-3">
        <Button variant="danger" size="sm" onClick={handleReset} data-reset-all="">
          Reset to defaults
        </Button>
        <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0 text-xs text-ink-muted">
          {pendingUndo && (
            <>
              <span className="truncate">{pendingUndo.message}</span>
              <Button variant="ghost" size="sm" onClick={runUndo}>
                Undo
              </Button>
            </>
          )}
        </div>
        <div className="ml-auto">
          <RestoreHiddenConfirmations />
        </div>
      </div>
    </SystemDialog>
  );
}
