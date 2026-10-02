"use client";

import { useState, type ReactNode } from "react";
import type { PrefNode, PrefGroup, PrefLeaf, PrefLeafColor, PrefLeafSlider, PrefLeafFont } from "@/lib/preferences-tree";
import { isLeaf } from "@/lib/preferences-tree";
import { Field, Select, type FieldIds } from "./field-primitives";
import { ResetButton } from "./ResetButton";
import { withCurrent, type FontGroup } from "@/lib/font-catalogue";
import { HexColorField } from "./HexColorField";
import type { EditorPreferences } from "@/hooks/usePreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

// ─── Leaf Components ──────────────────────────────────────────────────────────
//
// Every preference row is a `Field` in the ROW register (task 903): its label
// is ASSOCIATED with its control and its description is the control's
// accessible description. The rows used to set a bare `<span>` beside the
// control, so every slider, select and colour field in the dialog was announced
// unnamed. Each row also ends in the ONE reset control (`ResetButton`) when it
// is given a default — present always, disabled at the default.

/** The row shell every preference leaf shares: a `Field` in the row register
 *  with the 9rem label column. */
export function PrefField({
  label,
  description,
  control,
  children,
}: {
  label: string;
  description?: string;
  control?: "native" | "group";
  children: (ids: FieldIds) => ReactNode;
}) {
  return (
    <Field
      label={label}
      description={description}
      register="row"
      control={control}
      className="gap-3 py-1"
      labelClassName="w-36"
    >
      {children}
    </Field>
  );
}

export function SliderPref({
  label,
  description,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  /** When given, the row ends in the reset control. */
  defaultValue?: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <PrefField label={label} description={description}>
      {({ id, descriptionId }) => (
        <>
          <input
            id={id}
            aria-describedby={descriptionId}
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
          {defaultValue !== undefined && (
            <ResetButton
              onReset={() => onChange(defaultValue)}
              atDefault={value === defaultValue}
              target={label}
            />
          )}
        </>
      )}
    </PrefField>
  );
}

/** A preference row wrapping the shared {@link HexColorField}.
 *
 *  This row is where the draft / normalize / validate / reconcile contract was
 *  first written, and it was the ONLY place it was written — `SmartPreferences`
 *  hand-rolled a second copy of the same control with none of it (task 532).
 *  The control is now a primitive and both sites render it; what stays here is
 *  what belongs to a preference ROW: its label and its reset control. The
 *  swatch + hex pair is a composite, so the label names it as a GROUP. */
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
  const isDefault = value.toLowerCase() === defaultValue.toLowerCase();
  return (
    <PrefField label={label} description={description} control="group">
      {({ labelId, descriptionId }) => (
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          className="flex items-center gap-2 flex-1"
        >
          <HexColorField value={value} onChange={onChange} />
          <ResetButton
            onReset={() => onChange(defaultValue)}
            atDefault={isDefault}
            target={label}
            className="ml-auto"
          />
        </div>
      )}
    </PrefField>
  );
}

export function FontPref({
  label,
  description,
  value,
  defaultValue,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  /** When given, the row ends in the reset control. */
  defaultValue?: string;
  options: string[] | FontGroup[];
  onChange: (v: string) => void;
}) {
  // `withCurrent` keeps a stored font outside this row's offer ON offer, so the
  // controlled <Select> never displays its first option in its place (task 901).
  const groups = withCurrent(options, value);
  return (
    <PrefField label={label} description={description}>
      {({ id, descriptionId }) => (
        <>
          <Select
            id={id}
            aria-describedby={descriptionId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 text-xs px-2 py-1"
          >
            {groups.map((g) =>
              g.group ? (
                <optgroup key={g.group} label={g.group}>
                  {g.fonts.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </optgroup>
              ) : (
                g.fonts.map((f) => <option key={f} value={f}>{f}</option>)
              ),
            )}
          </Select>
          {defaultValue !== undefined && (
            <ResetButton
              onReset={() => onChange(defaultValue)}
              atDefault={value === defaultValue}
              target={label}
            />
          )}
        </>
      )}
    </PrefField>
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
          className={`text-ink-muted motion-safe:transition-transform ${open ? "rotate-90" : ""}`}
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
          defaultValue={DEFAULT_PREFS[l.key] as number}
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
          defaultValue={DEFAULT_PREFS[l.key] as string}
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
