"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface EditorPreferences {
  editorFontSize: number;      // rem
  editorLineHeight: number;
  editorTextColor: string;
  accentColor: string;
  backgroundColor: string;
  commentColor: string;
  latexCommentColor: string;
  citationColor: string;
  footnoteColor: string;
  noteColor: string;
  panelFontSize: number;       // px
  panelHeaderSize: number;     // px
  surfaceColor: string;
}

export const DEFAULT_PREFS: EditorPreferences = {
  editorFontSize: 1.05,
  editorLineHeight: 1.8,
  editorTextColor: "#2a2a2a",
  accentColor: "#7c5e3c",
  backgroundColor: "#faf9f7",
  commentColor: "#93c5fd",
  latexCommentColor: "#7191b0",
  citationColor: "#6b6245",
  footnoteColor: "#b45757",
  noteColor: "#15803d",
  panelFontSize: 13,
  panelHeaderSize: 14,
  surfaceColor: "#ffffff",
};

const STORAGE_KEY = "virgil-editor-prefs";

function loadPrefs(): EditorPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

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

export function usePreferences() {
  const [prefs, setPrefs] = useState<EditorPreferences>(DEFAULT_PREFS);
  const initialized = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    initialized.current = true;
  }, []);

  const persist = useCallback((newPrefs: EditorPreferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
    } catch {}
  }, []);

  const updatePref = useCallback(<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetAll = useCallback(() => {
    setPrefs(DEFAULT_PREFS);
    persist(DEFAULT_PREFS);
  }, [persist]);

  return { prefs, updatePref, resetAll };
}
