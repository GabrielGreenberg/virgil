"use client";

import { useCallback } from "react";
import { EditorPreferences, DEFAULT_PREFS } from "@/hooks/usePreferences";

interface PreferencesModalProps {
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
  onReset: () => void;
  onClose: () => void;
}

function SliderPref({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-stone-600 w-28 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-[var(--accent)]"
      />
      <span className="text-[11px] text-stone-400 w-14 text-right tabular-nums">
        {value}{unit}
      </span>
    </div>
  );
}

function ColorPref({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
}) {
  const isDefault = value.toLowerCase() === defaultValue.toLowerCase();
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-stone-600 w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded border border-stone-200 cursor-pointer p-0 bg-transparent"
        />
        <span className="text-[11px] text-stone-400 font-mono">{value}</span>
        {!isDefault && (
          <button
            onClick={() => onChange(defaultValue)}
            className="text-[10px] text-stone-400 hover:text-stone-600 underline ml-auto"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider pt-4 pb-1.5 first:pt-0">
      {children}
    </div>
  );
}

export default function PreferencesModal({ prefs, onUpdate, onReset, onClose }: PreferencesModalProps) {
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-stone-700">Preferences</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <SectionHeader>Editor</SectionHeader>
          <SliderPref
            label="Font size"
            value={prefs.editorFontSize}
            min={0.85} max={1.4} step={0.05} unit=" rem"
            onChange={(v) => onUpdate("editorFontSize", v)}
          />
          <SliderPref
            label="Line height"
            value={prefs.editorLineHeight}
            min={1.4} max={2.4} step={0.1} unit=""
            onChange={(v) => onUpdate("editorLineHeight", v)}
          />
          <ColorPref
            label="Text color"
            value={prefs.editorTextColor}
            defaultValue={DEFAULT_PREFS.editorTextColor}
            onChange={(v) => onUpdate("editorTextColor", v)}
          />

          <SectionHeader>Colors</SectionHeader>
          <ColorPref
            label="Accent"
            value={prefs.accentColor}
            defaultValue={DEFAULT_PREFS.accentColor}
            onChange={(v) => onUpdate("accentColor", v)}
          />
          <ColorPref
            label="Background"
            value={prefs.backgroundColor}
            defaultValue={DEFAULT_PREFS.backgroundColor}
            onChange={(v) => onUpdate("backgroundColor", v)}
          />
          <ColorPref
            label="Comment highlight"
            value={prefs.commentColor}
            defaultValue={DEFAULT_PREFS.commentColor}
            onChange={(v) => onUpdate("commentColor", v)}
          />
          <ColorPref
            label="LaTeX comment"
            value={prefs.latexCommentColor}
            defaultValue={DEFAULT_PREFS.latexCommentColor}
            onChange={(v) => onUpdate("latexCommentColor", v)}
          />
          <ColorPref
            label="Citation"
            value={prefs.citationColor}
            defaultValue={DEFAULT_PREFS.citationColor}
            onChange={(v) => onUpdate("citationColor", v)}
          />
          <ColorPref
            label="Footnote"
            value={prefs.footnoteColor}
            defaultValue={DEFAULT_PREFS.footnoteColor}
            onChange={(v) => onUpdate("footnoteColor", v)}
          />
          <ColorPref
            label="Note marker"
            value={prefs.noteColor}
            defaultValue={DEFAULT_PREFS.noteColor}
            onChange={(v) => onUpdate("noteColor", v)}
          />

          <SectionHeader>Paragraph titles</SectionHeader>
          <SliderPref
            label="Size"
            value={prefs.parTitleSize}
            min={0.6} max={1.0} step={0.02} unit=" rem"
            onChange={(v) => onUpdate("parTitleSize", v)}
          />
          <ColorPref
            label="Color"
            value={prefs.parTitleColor}
            defaultValue={DEFAULT_PREFS.parTitleColor}
            onChange={(v) => onUpdate("parTitleColor", v)}
          />

          <SectionHeader>Panels</SectionHeader>
          <SliderPref
            label="Font size"
            value={prefs.panelFontSize}
            min={11} max={16} step={1} unit="px"
            onChange={(v) => onUpdate("panelFontSize", v)}
          />
          <SliderPref
            label="Header size"
            value={prefs.panelHeaderSize}
            min={12} max={17} step={1} unit="px"
            onChange={(v) => onUpdate("panelHeaderSize", v)}
          />
          <ColorPref
            label="Panel background"
            value={prefs.surfaceColor}
            defaultValue={DEFAULT_PREFS.surfaceColor}
            onChange={(v) => onUpdate("surfaceColor", v)}
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
    </div>
  );
}
