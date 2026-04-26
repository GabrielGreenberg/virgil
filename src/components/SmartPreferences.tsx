"use client";

import { useState } from "react";
import { SMART_PREFERENCES, type SmartSection, type SmartItem } from "@/lib/smart-preferences";
import { ColorPref, SliderPref, FontPref } from "./PreferenceTree";
import type { EditorPreferences } from "@/hooks/usePreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";
import type { PrefLeafColor, PrefLeafSlider, PrefLeafFont } from "@/lib/preferences-tree";
import {
  DEFAULT_PANEL_COLORS,
  setPanelColor,
  clearPanelColor,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { usePanelColor } from "@/hooks/usePanelTheme";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  PANEL_BODY_LABELS,
  PANEL_BODY_FONT_OPTIONS,
  setPanelTypographyField,
  clearPanelTypographyField,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import { usePanelTypography } from "@/hooks/usePanelTypography";
import {
  useLinkAwareUpdater,
  useLinkState,
  setLinkLocked,
  setLinkDelta,
} from "@/hooks/usePrefLinks";
import type { LinkableKey } from "@/lib/pref-links";
import { applyLightnessDelta } from "@/lib/pref-links";

function PrefRow({
  item,
  prefs,
  onUpdate,
}: {
  item: Extract<SmartItem, { kind: "pref" }>;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  const { leaf } = item;
  if (leaf.type === "color") {
    const l = leaf as PrefLeafColor;
    return (
      <ColorPref
        label={l.label}
        description={l.description}
        value={prefs[l.key] as string}
        defaultValue={DEFAULT_PREFS[l.key] as string}
        onChange={(v) => onUpdate(l.key, v as EditorPreferences[typeof l.key])}
      />
    );
  }
  if (leaf.type === "slider") {
    const l = leaf as PrefLeafSlider;
    return (
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
    );
  }
  if (leaf.type === "font") {
    const l = leaf as PrefLeafFont;
    return (
      <FontPref
        label={l.label}
        description={l.description}
        value={prefs[l.key] as string}
        options={l.options}
        onChange={(v) => onUpdate(l.key, v as EditorPreferences[typeof l.key])}
      />
    );
  }
  return null;
}

function PanelColorRow({
  panelKey,
  label,
  description,
}: {
  panelKey: PanelThemeKey;
  label: string;
  description?: string;
}) {
  const value = usePanelColor(panelKey);
  const defaultValue = DEFAULT_PANEL_COLORS[panelKey];
  const onChange = (hex: string) => {
    if (hex.toLowerCase() === defaultValue.toLowerCase()) {
      clearPanelColor(panelKey);
    } else {
      setPanelColor(panelKey, hex);
    }
  };
  return (
    <ColorPref
      label={label}
      description={description}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
    />
  );
}

function PanelTypographyGridRow({ panelKey }: { panelKey: PanelBodyKey }) {
  const typo = usePanelTypography(panelKey)!;
  const def = DEFAULT_PANEL_TYPOGRAPHY[panelKey];
  const isDefault =
    typo.fontFamily === def.fontFamily &&
    typo.fontSize === def.fontSize &&
    typo.color.toLowerCase() === def.color.toLowerCase();

  const setField = <F extends keyof typeof typo>(field: F, value: typeof typo[F]) => {
    if (value === def[field]) clearPanelTypographyField(panelKey, field);
    else setPanelTypographyField(panelKey, field, value);
  };

  const resetAll = () => {
    (Object.keys(def) as (keyof typeof def)[]).forEach((f) => clearPanelTypographyField(panelKey, f));
  };

  return (
    <>
      <div className="text-xs text-ink-body py-1">{PANEL_BODY_LABELS[panelKey]}</div>
      <select
        value={typo.fontFamily}
        onChange={(e) => setField("fontFamily", e.target.value)}
        className="text-xs bg-surface border border-edge-subtle rounded px-1.5 py-0.5 text-ink-body outline-none focus:border-[var(--accent)]"
        style={{ fontFamily: typo.fontFamily }}
      >
        {PANEL_BODY_FONT_OPTIONS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <input
          type="range"
          min={10}
          max={20}
          step={1}
          value={typo.fontSize}
          onChange={(e) => setField("fontSize", parseInt(e.target.value, 10))}
          className="w-14 h-1 accent-[var(--accent)]"
        />
        <span className="text-[10px] text-ink-muted tabular-nums w-6 text-right">{typo.fontSize}px</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={typo.color}
          onChange={(e) => setField("color", e.target.value)}
          className="w-5 h-5 rounded border border-edge-subtle cursor-pointer p-0 bg-transparent"
        />
        <input
          type="text"
          value={typo.color}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(v)) setField("color", v);
          }}
          spellCheck={false}
          className="text-[10px] font-mono w-[60px] px-1 py-0.5 border border-edge-subtle rounded bg-transparent text-ink-subtle outline-none focus:border-[var(--accent)]"
        />
      </div>
      <button
        onClick={resetAll}
        disabled={isDefault}
        className={`text-[10px] underline ${isDefault ? "text-ink-faint cursor-default" : "text-ink-muted hover:text-ink-body"}`}
      >
        reset
      </button>
    </>
  );
}

function PanelTypographyGrid() {
  const keys = Object.keys(DEFAULT_PANEL_TYPOGRAPHY) as PanelBodyKey[];
  return (
    <div
      className="grid gap-x-2 gap-y-1 items-center"
      style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted pt-1">Panel</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted pt-1">Font</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted pt-1">Size</div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-muted pt-1">Color</div>
      <div />
      {keys.map((k) => (
        <PanelTypographyGridRow key={k} panelKey={k} />
      ))}
    </div>
  );
}

function LinkEdgeRow({
  parent,
  child,
  label,
  prefs,
  onUpdate,
}: {
  parent: LinkableKey;
  child: LinkableKey;
  label: string;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  const state = useLinkState(parent, child);
  if (!state) return null;
  const parentVal = prefs[parent];
  const locked = state.locked;
  // Percentage form for the slider (integer), -40..+40.
  const pct = Math.round(state.deltaL * 100);

  const handleLockToggle = () => {
    setLinkLocked(parent, child, !locked);
  };
  const handleDeltaChange = (newPct: number) => {
    const newDelta = newPct / 100;
    setLinkDelta(parent, child, newDelta);
    // When locked, immediately push the new value to the child so the
    // slider feels direct.
    if (locked && typeof parentVal === "string") {
      const nextChild = applyLightnessDelta(parentVal, newDelta);
      onUpdate(child, nextChild as EditorPreferences[typeof child]);
    }
  };

  return (
    <div className="flex items-center gap-2 pl-6 py-0.5 text-[10.5px] text-ink-muted">
      <span className="text-ink-faint">↳</span>
      <button
        onClick={handleLockToggle}
        className={`shrink-0 p-0.5 rounded transition-colors ${locked ? "text-[var(--accent)]" : "text-ink-faint hover:text-ink-muted"}`}
        title={locked ? "Unlock: child stays independent" : "Lock: child tracks parent + delta"}
      >
        {locked ? (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" />
            <path d="M5 7V5a3 3 0 1 1 6 0v2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 5.6-1.5" />
          </svg>
        )}
      </button>
      <span className={`flex-1 truncate ${locked ? "text-ink-subtle" : ""}`}>{label}</span>
      <input
        type="range"
        min={-40}
        max={40}
        step={1}
        value={pct}
        onChange={(e) => handleDeltaChange(parseInt(e.target.value, 10))}
        disabled={!locked}
        className={`w-20 h-1 accent-[var(--accent)] ${locked ? "" : "opacity-40"}`}
      />
      <span className="text-[10px] tabular-nums w-9 text-right">
        {pct > 0 ? "+" : ""}{pct}%
      </span>
    </div>
  );
}

function ItemRow({
  item,
  prefs,
  onUpdate,
}: {
  item: SmartItem;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  if (item.kind === "pref") {
    return <PrefRow item={item} prefs={prefs} onUpdate={onUpdate} />;
  }
  if (item.kind === "panel-typography-grid") {
    return <PanelTypographyGrid />;
  }
  if (item.kind === "link-edge") {
    return (
      <LinkEdgeRow
        parent={item.parent}
        child={item.child}
        label={item.label}
        prefs={prefs}
        onUpdate={onUpdate}
      />
    );
  }
  return (
    <PanelColorRow
      panelKey={item.panelKey}
      label={item.label}
      description={item.description}
    />
  );
}

function Section({
  section,
  prefs,
  onUpdate,
}: {
  section: SmartSection;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  const [open, setOpen] = useState(true);
  // Any edit through a linked parent cascades to its locked children.
  // Sections that don't use `link-edge` rows are unaffected.
  const linkAwareUpdate = useLinkAwareUpdater(onUpdate);
  return (
    <div className="rounded-lg border border-edge-subtle bg-surface-muted/40 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 hover-on-light"
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
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-ink-strong">{section.label}</div>
          {section.description && (
            <div className="text-[10.5px] text-ink-muted leading-tight">{section.description}</div>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pt-1 pb-2 bg-surface border-t border-edge-subtle">
          {section.items.map((item, i) => (
            <ItemRow key={i} item={item} prefs={prefs} onUpdate={linkAwareUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SmartPreferences({
  prefs,
  onUpdate,
}: {
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}) {
  if (SMART_PREFERENCES.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--accent)]">
          Smart preferences
        </span>
        <div className="flex-1 h-px bg-edge-subtle" />
      </div>
      <div className="space-y-2">
        {SMART_PREFERENCES.map((section) => (
          <Section key={section.id} section={section} prefs={prefs} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  );
}
