"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import type { EditorPreferences, PreferencePreset } from "@/hooks/usePreferences";
import type { GlobalTransforms } from "@/lib/color-transforms";
import { PREFERENCES_TREE } from "@/lib/preferences-tree";
import { useDragPosition } from "@/hooks/useDragPosition";
import PreferenceTree from "./PreferenceTree";

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
        <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-stone-400 tabular-nums w-8 text-right">{value > 0 ? `+${value}` : value}</span>
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
      <select
        value={selected}
        onChange={handleSelectChange}
        className="flex-1 text-xs bg-white border border-stone-200 rounded px-2 py-1.5 text-stone-700 outline-none focus:border-[var(--accent)]"
      >
        <option value="">Load preset...</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.builtIn ? " (built-in)" : ""}
          </option>
        ))}
      </select>

      {saving ? (
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!newName.trim()) setSaving(false); }}
          placeholder="Preset name"
          className="text-xs border border-stone-300 rounded px-2 py-1.5 w-28 outline-none focus:border-[var(--accent)]"
        />
      ) : null}

      <button
        onClick={handleSave}
        className="text-[11px] text-stone-500 hover:text-stone-700 border border-stone-200 rounded px-2.5 py-1.5 hover:bg-stone-50 transition-colors whitespace-nowrap"
      >
        {saving ? "OK" : "Save"}
      </button>

      {canDelete && (
        <button
          onClick={() => { onDelete(selected); setSelected(""); }}
          className="text-[11px] text-red-400 hover:text-red-600 border border-stone-200 rounded px-2 py-1.5 hover:bg-red-50 transition-colors"
        >
          Del
        </button>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

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
  const { position, onMouseDown: onDragStart, panelRef, isDraggingRef } = useDragPosition();

  // Click-outside-to-close (deferred by one frame to avoid the opening click)
  useEffect(() => {
    let mounted = true;
    requestAnimationFrame(() => {
      if (!mounted) return;
      const handler = (e: MouseEvent) => {
        if (isDraggingRef.current) return;
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener("mousedown", handler);
      // Store cleanup for the effect teardown
      cleanupRef.current = () => document.removeEventListener("mousedown", handler);
    });
    const cleanupRef = { current: () => {} };
    return () => { mounted = false; cleanupRef.current(); };
  }, [onClose, isDraggingRef, panelRef]);

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-[560px] max-h-[85vh] flex flex-col"
      style={
        position
          ? { top: position.y, left: position.x }
          : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
      }
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] select-none"
        onMouseDown={onDragStart}
        style={{ cursor: isDraggingRef.current ? "grabbing" : "grab" }}
      >
        <h2 className="text-sm font-semibold text-stone-700">Preferences</h2>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>

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

      {/* Tree Body */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <PreferenceTree
          tree={PREFERENCES_TREE}
          prefs={prefs}
          onUpdate={onUpdate}
        />
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end">
        <button
          onClick={onReset}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
