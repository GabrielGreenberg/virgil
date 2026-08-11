"use client";

import { useState, useEffect, useCallback } from "react";
import type { PrefNode, PrefGroup, PrefLeaf, PrefLeafColor, PrefLeafSlider, PrefLeafFont } from "@/lib/preferences-tree";
import { isLeaf } from "@/lib/preferences-tree";
import { Input, Select } from "./field-primitives";
import type { EditorPreferences } from "@/hooks/usePreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

// ─── Leaf Components ──────────────────────────────────────────────────────────

export function PrefLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="w-36 shrink-0">
      <span className="text-xs text-ink-body">{label}</span>
      {description && <span className="text-[10px] text-ink-muted block leading-tight">{description}</span>}
    </div>
  );
}

export function SliderPref({
  label,
  description,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <PrefLabel label={label} description={description} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-[var(--accent)]"
      />
      <span className="text-[11px] text-ink-muted w-14 text-right tabular-nums">
        {value}{unit}
      </span>
    </div>
  );
}

export function ColorPref({
  label,
  description,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
}) {
  const [localHex, setLocalHex] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => { setLocalHex(value); setInvalid(false); }, [value]);

  const commitHex = useCallback(() => {
    let hex = localHex.trim();
    if (!hex.startsWith("#")) hex = "#" + hex;
    hex = hex.toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) {
      setInvalid(false);
      onChange(hex);
    } else {
      setInvalid(true);
      setTimeout(() => { setLocalHex(value); setInvalid(false); }, 800);
    }
  }, [localHex, value, onChange]);

  const isDefault = value.toLowerCase() === defaultValue.toLowerCase();
  return (
    <div className="flex items-center gap-3 py-1">
      <PrefLabel label={label} description={description} />
      <div className="flex items-center gap-2 flex-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-6 h-6 rounded border border-edge-subtle cursor-pointer p-0 bg-transparent"
        />
        <Input
          value={localHex}
          onChange={(e) => setLocalHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
          spellCheck={false}
          tone="transparent"
          density="dense"
          ink="subtle"
          invalid={invalid}
          className="text-[11px] font-mono w-[70px] px-1 py-0.5"
        />
        {!isDefault && (
          <button
            onClick={() => onChange(defaultValue)}
            className="text-[10px] text-ink-muted hover:text-ink-body underline ml-auto"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

export function FontPref({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <PrefLabel label={label} description={description} />
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs px-2 py-1"
      >
        {options.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </Select>
    </div>
  );
}

// ─── Section (collapsible group) ──────────────────────────────────────────────

function SectionNode({
  group,
  depth,
  prefs,
  onUpdate,
}: {
  group: PrefGroup;
  depth: number;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left py-1 hover-on-light rounded"
        style={{ paddingLeft: depth * 12 }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 1.5l4 3.5-4 3.5" />
        </svg>
        <span className="text-[11px] font-semibold text-ink-subtle uppercase tracking-wider">
          {group.label}
        </span>
      </button>
      {open && (
        <div>
          {group.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} prefs={prefs} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Leaf Node Renderer ───────────────────────────────────────────────────────

function LeafNode({
  leaf,
  depth,
  prefs,
  onUpdate,
}: {
  leaf: PrefLeaf;
  depth: number;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  const style = { paddingLeft: depth * 12 + 14 };

  if (leaf.type === "color") {
    const l = leaf as PrefLeafColor;
    return (
      <div style={style}>
        <ColorPref
          label={l.label}
          description={l.description}
          value={prefs[l.key] as string}
          defaultValue={DEFAULT_PREFS[l.key] as string}
          onChange={(v) => onUpdate(l.key, v as EditorPreferences[typeof l.key])}
        />
      </div>
    );
  }

  if (leaf.type === "slider") {
    const l = leaf as PrefLeafSlider;
    return (
      <div style={style}>
        <SliderPref
          label={l.label}
          description={l.description}
          value={prefs[l.key] as number}
          min={l.min}
          max={l.max}
          step={l.step}
          unit={l.unit}
          onChange={(v) => onUpdate(l.key, v as EditorPreferences[typeof l.key])}
        />
      </div>
    );
  }

  if (leaf.type === "font") {
    const l = leaf as PrefLeafFont;
    return (
      <div style={style}>
        <FontPref
          label={l.label}
          description={l.description}
          value={prefs[l.key] as string}
          options={l.options}
          onChange={(v) => onUpdate(l.key, v as EditorPreferences[typeof l.key])}
        />
      </div>
    );
  }

  return null;
}

// ─── Generic Tree Node ────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  prefs,
  onUpdate,
}: {
  node: PrefNode;
  depth: number;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  if (isLeaf(node)) {
    return <LeafNode leaf={node} depth={depth} prefs={prefs} onUpdate={onUpdate} />;
  }
  return <SectionNode group={node as PrefGroup} depth={depth} prefs={prefs} onUpdate={onUpdate} />;
}

// ─── Public Export ────────────────────────────────────────────────────────────

export default function PreferenceTree({
  tree,
  prefs,
  onUpdate,
}: {
  tree: PrefNode[];
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  return (
    <div className="space-y-0.5">
      {tree.map((node, i) => (
        <TreeNode key={i} node={node} depth={0} prefs={prefs} onUpdate={onUpdate} />
      ))}
    </div>
  );
}
