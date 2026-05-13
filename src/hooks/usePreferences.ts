"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GlobalTransforms, DEFAULT_TRANSFORMS } from "@/lib/color-transforms";
import defaultPrefsJson from "./usePreferences.defaults.json";

export interface EditorPreferences {
  // Editor > Body Text
  editorFontSize: number;      // rem
  editorLineHeight: number;
  editorTextColor: string;

  // Editor > Paragraph Titles
  parTitleSize: number;        // rem
  parTitleColor: string;

  // Editor > Heading Annotations
  headingAnnotationColor: string;
  headingAnnotationBorder: string;

  // Editor > Blockquotes
  blockquoteBorder: string;
  blockquoteText: string;

  // Editor > Code & Math
  codeBackground: string;
  codeBlockBackground: string;
  mathColor: string;
  mathPrefixColor: string;

  // Editor > Inline Elements
  accentColor: string;
  backgroundColor: string;
  commentColor: string;
  latexCommentColor: string;
  citationColor: string;
  citationBorderColor: string;
  footnoteColor: string;
  noteColor: string;
  noteMarkerBorder: string;

  // Editor > AI Markers
  aiMarkerText: string;
  aiMarkerBg: string;
  aiMarkerBorder: string;

  // Editor > Suggestions
  markBackground: string;
  markBorder: string;

  // Editor > LaTeX Commands
  latexCmdColor: string;

  // Panels > General
  panelFontSize: number;       // px
  panelHeaderSize: number;     // px
  surfaceColor: string;

  // Panels > Chrome
  // (podEditor is locked to surfaceColor and not user-editable)
  headerBg: string;
  podPanel: string;
  podToolbar: string;
  podDark: string;
  panelAdminTextColor: string;  // Panel header titles ("Footnotes", etc.)
  panelHeaderTextColor: string; // Other text in panel headers (count, etc.)
  panelAdminTextFont: string;

  // App Chrome
  // (themeColor is locked to topbarBackground, mainTabBg is locked to
  //  backgroundColor — both derived in globals.css, not user-editable)
  topbarBackground: string;
  topbarBackgroundBottom: string; // Bottom color of the Virgil-bar gradient
  topbarBorder: string;
  tabBg: string;          // Inactive tab fill
  libraryBg: string;      // Library peek-tab fill
  virgilBarText: string;  // Icons & text in the top bar

  // Canvas & Layout
  // (h1Color, h2h3Color, scrollbarHover are locked to foreground,
  // editorTextColor, mutedLight respectively and not user-editable)
  foreground: string;
  borderColor: string;
  borderLight: string;
  mutedColor: string;
  mutedLight: string;
  dragHighlight: string;
  scrollbarThumb: string;

  // Fonts
  fontSerif: string;
  fontSans: string;
  fontDisplay: string;
  fontLogo: string;
  fontMono: string;

  // Fonts… dialog (per-element overrides for the main text)
  // null family = "pin to body family"
  fontMaketitleFamily: string | null;
  fontMaketitleTitleSize: number;   // rem
  fontMaketitleTitleWeight: number; // 100-900
  fontMaketitleMetaSize: number;    // rem (author/date)
  fontMaketitleMetaWeight: number;  // 100-900
  fontHeadersFamily: string | null;
  fontHeadersH1Size: number;        // rem
  fontHeadersH1Weight: number;      // 100-900
  fontHeadersH2Size: number;        // rem
  fontHeadersH2Weight: number;      // 100-900
  fontHeadersH3Size: number;        // rem
  fontHeadersH3Weight: number;      // 100-900
  fontParTitleFamily: string | null;
  fontParTitleWeight: number;       // 100-900
}

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
export const DEFAULT_PREFS: EditorPreferences = defaultPrefsJson as EditorPreferences;

// ─── Presets ──────────────────────────────────────────────────────────────────

export interface PreferencePreset {
  name: string;
  prefs: EditorPreferences;
  transforms: GlobalTransforms;
  createdAt: number;
  builtIn?: boolean;
}

const PREFS_KEY = "virgil-editor-prefs";
const TRANSFORMS_KEY = "virgil-editor-transforms";
const PRESETS_KEY = "virgil-editor-presets";

const DEFAULT_PRESET: PreferencePreset = {
  name: "Default",
  prefs: DEFAULT_PREFS,
  transforms: DEFAULT_TRANSFORMS,
  createdAt: 0,
  builtIn: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a light background tint from a hex color (mix with white at ~90%) */
export function deriveLight(hex: string, opacity = 0.1): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c * opacity + 255 * (1 - opacity));
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}

/** Convert hex to rgba string */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadPrefs(): EditorPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadTransforms(): GlobalTransforms {
  if (typeof window === "undefined") return DEFAULT_TRANSFORMS;
  try {
    const raw = localStorage.getItem(TRANSFORMS_KEY);
    if (!raw) return DEFAULT_TRANSFORMS;
    return { ...DEFAULT_TRANSFORMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TRANSFORMS;
  }
}

function loadPresets(): PreferencePreset[] {
  if (typeof window === "undefined") return [DEFAULT_PRESET];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [DEFAULT_PRESET];
    const parsed = JSON.parse(raw) as PreferencePreset[];
    // Ensure Default preset is always present
    if (!parsed.some((p) => p.builtIn)) {
      parsed.unshift(DEFAULT_PRESET);
    }
    return parsed;
  } catch {
    return [DEFAULT_PRESET];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePreferences() {
  const [prefs, setPrefs] = useState<EditorPreferences>(DEFAULT_PREFS);
  const [transforms, setTransforms] = useState<GlobalTransforms>(DEFAULT_TRANSFORMS);
  const [presets, setPresets] = useState<PreferencePreset[]>([DEFAULT_PRESET]);
  const initialized = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setTransforms(loadTransforms());
    setPresets(loadPresets());
    initialized.current = true;
  }, []);

  const persistPrefs = useCallback((newPrefs: EditorPreferences) => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(newPrefs)); } catch {}
  }, []);

  const persistTransforms = useCallback((newT: GlobalTransforms) => {
    try { localStorage.setItem(TRANSFORMS_KEY, JSON.stringify(newT)); } catch {}
  }, []);

  const persistPresets = useCallback((newP: PreferencePreset[]) => {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(newP)); } catch {}
  }, []);

  const updatePref = useCallback(<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      persistPrefs(next);
      return next;
    });
  }, [persistPrefs]);

  const updateTransform = useCallback(<K extends keyof GlobalTransforms>(key: K, value: GlobalTransforms[K]) => {
    setTransforms((prev) => {
      const next = { ...prev, [key]: value };
      persistTransforms(next);
      return next;
    });
  }, [persistTransforms]);

  const resetAll = useCallback(() => {
    setPrefs(DEFAULT_PREFS);
    setTransforms(DEFAULT_TRANSFORMS);
    persistPrefs(DEFAULT_PREFS);
    persistTransforms(DEFAULT_TRANSFORMS);
  }, [persistPrefs, persistTransforms]);

  const savePreset = useCallback((name: string) => {
    setPresets((prev) => {
      const existing = prev.findIndex((p) => p.name === name && !p.builtIn);
      const preset: PreferencePreset = { name, prefs, transforms, createdAt: Date.now() };
      let next: PreferencePreset[];
      if (existing >= 0) {
        next = [...prev];
        next[existing] = preset;
      } else {
        next = [...prev, preset];
      }
      persistPresets(next);
      return next;
    });
  }, [prefs, transforms, persistPresets]);

  const loadPreset = useCallback((name: string) => {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    setPrefs({ ...DEFAULT_PREFS, ...preset.prefs });
    setTransforms({ ...DEFAULT_TRANSFORMS, ...preset.transforms });
    persistPrefs({ ...DEFAULT_PREFS, ...preset.prefs });
    persistTransforms({ ...DEFAULT_TRANSFORMS, ...preset.transforms });
  }, [presets, persistPrefs, persistTransforms]);

  const deletePreset = useCallback((name: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.name !== name || p.builtIn);
      persistPresets(next);
      return next;
    });
  }, [persistPresets]);

  return { prefs, transforms, presets, updatePref, updateTransform, resetAll, savePreset, loadPreset, deletePreset };
}
