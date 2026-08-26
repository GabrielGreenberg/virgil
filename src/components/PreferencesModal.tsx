"use client";

import { useCallback, useState, useRef } from "react";
import type { EditorPreferences, PreferencePreset } from "@/hooks/usePreferences";
import type { GlobalTransforms } from "@/lib/color-transforms";
import { PREFERENCES_TREE } from "@/lib/preferences-tree";
import PreferenceTree from "./PreferenceTree";
import { Input, Select } from "./field-primitives";
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

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-medium text-ink-subtle uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-ink-muted tabular-nums w-8 text-right">{value > 0 ? `+${value}` : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="w-full h-1 accent-[var(--accent)]"
      />
    </div>
  );
}

// ─── Preset Bar ───────────────────────────────────────────────────────────────

function PresetBar({
  presets,
  onLoad,
  onSave,
  onDelete,
}: {
  presets: PreferencePreset[];
  onLoad: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    if (saving) {
      const name = newName.trim();
      if (name) {
        onSave(name);
        setNewName("");
        setSaving(false);
      }
    } else {
      setSaving(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [saving, newName, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setSaving(false);
  }, [handleSave]);

  const handleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setSelected(name);
    if (name) onLoad(name);
  }, [onLoad]);

  const selectedPreset = presets.find((p) => p.name === selected);
  const canDelete = selectedPreset && !selectedPreset.builtIn;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selected}
        onChange={handleSelectChange}
        className="flex-1 text-xs px-2 py-1.5"
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
          className="text-xs px-2 py-1.5 w-28"
        />
      ) : null}

      <button
        onClick={handleSave}
        className="text-[11px] text-ink-subtle hover:text-ink-body border border-edge-subtle rounded px-2.5 py-1.5 hover-on-light whitespace-nowrap"
      >
        {saving ? "OK" : "Save"}
      </button>

      {canDelete && (
        <button
          onClick={() => { onDelete(selected); setSelected(""); }}
          className="text-[11px] text-danger hover:text-red-600 border border-edge-subtle rounded px-2 py-1.5 hover:bg-danger-soft transition-colors"
        >
          Del
        </button>
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
}: PreferencesModalProps) {
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
      labelledBy="preferences-modal-title"
      frameClassName="w-full max-w-[560px] max-h-[85vh] flex flex-col"
    >
      <PreferencesHeader onClose={onClose} />

      {/* Presets + Global Sliders (sticky) */}
      <div className="px-5 py-3 border-b border-[var(--border)] space-y-3 bg-[var(--surface)]">
        <PresetBar
          presets={presets}
          onLoad={onLoadPreset}
          onSave={onSavePreset}
          onDelete={onDeletePreset}
        />

        <div className="flex items-start gap-4">
          <TransformSlider
            label="Contrast"
            value={transforms.contrast}
            min={-100}
            max={100}
            step={5}
            onChange={(v) => onUpdateTransform("contrast", v)}
          />
          <TransformSlider
            label="Hue"
            value={transforms.hue}
            min={-180}
            max={180}
            step={5}
            onChange={(v) => onUpdateTransform("hue", v)}
          />
          <TransformSlider
            label="Brightness"
            value={transforms.brightness}
            min={-50}
            max={50}
            step={2}
            onChange={(v) => onUpdateTransform("brightness", v)}
          />
        </div>
      </div>

      {/* Body: smart preferences on top, then the full tree */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
        <SmartPreferences prefs={prefs} onUpdate={onUpdate} />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
            All preferences
          </span>
          <div className="flex-1 h-px bg-edge-subtle" />
        </div>
        <PreferenceTree
          tree={PREFERENCES_TREE}
          prefs={prefs}
          onUpdate={onUpdate}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] flex items-center gap-3">
        <RestoreHiddenConfirmations />
        <button
          onClick={onReset}
          className="ml-auto text-xs text-ink-muted hover:text-ink-body transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </SystemDialog>
  );
}
