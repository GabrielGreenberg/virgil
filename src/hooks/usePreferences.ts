"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GlobalTransforms, DEFAULT_TRANSFORMS } from "@/lib/color-transforms";
import { useStorageKeySync } from "@/lib/cross-window-storage";
import { DEFAULT_PREFS } from "./preferences-defaults";
import { propagate, type LinkableKey } from "@/lib/pref-links";

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
  /** Ink for rendered math (KaTeX glyphs) — read by `--math-color`. Its former
   *  sibling `mathPrefixColor` was retired in task 326: it promised to color
   *  "$ delimiters and prefixes", and `renderMath` runs KaTeX with
   *  `output: "html"`, so no delimiter element exists to paint. */
  mathColor: string;

  // Editor > Inline Elements
  accentColor: string;
  backgroundColor: string;
  commentColor: string;
  latexCommentColor: string;
  citationColor: string;
  citationBorderColor: string;
  // Cross-reference (\ref) chips — the citation pill's structural twin. Grey
  // by default; the fill is DERIVED from labelRefColor (DERIVED_CSS), so a
  // recolor moves ink and wash together instead of half the chip.
  labelRefColor: string;
  labelRefBorderColor: string;
  footnoteColor: string;
  noteColor: string;
  noteMarkerBorder: string;

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

// The shipped defaults live in a leaf module (`preferences-defaults.ts`) so
// `pref-links` can derive its default deltas from them without importing this
// one — see that file's header. Re-exported here: this is still the name every
// consumer reaches for.
export { DEFAULT_PREFS } from "./preferences-defaults";

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

// The built-in preset is DERIVED from the shipped defaults, never STORED.
// It used to be persisted alongside the user's presets, which froze a copy of
// whatever `DEFAULT_PREFS` happened to be the day the user first hit Save: once
// the promote-defaults pipeline shipped new colours, picking "Default" applied
// the OLD ones while "Reset to defaults" applied the new ones. A value that is
// computed from source must not round-trip through localStorage — `loadPresets`
// drops any stored built-in (migration) and `persistPresets` never writes one.
const DEFAULT_PRESET: PreferencePreset = {
  name: "Default",
  prefs: DEFAULT_PREFS,
  transforms: DEFAULT_TRANSFORMS,
  createdAt: 0,
  builtIn: true,
};

/** Every derived preset, in picker order. Prepended to the stored user list. */
export const BUILT_IN_PRESETS: readonly PreferencePreset[] = [DEFAULT_PRESET];

const RESERVED_PRESET_NAMES = new Set(
  BUILT_IN_PRESETS.map((p) => p.name.trim().toLowerCase()),
);

/**
 * A built-in name can never belong to a user preset: the two would collide in
 * the picker (same option value), and every lookup — load, delete, the delete
 * affordance — resolves by name and would find the built-in first, leaving the
 * user's entry unloadable and undeletable. Saving one is refused, and a stored
 * one is renamed on read (see `normalizeStoredPresets`).
 */
export function isReservedPresetName(name: string): boolean {
  return RESERVED_PRESET_NAMES.has(name.trim().toLowerCase());
}

/** First free variant of `base` ("Warm" → "Warm 2" → "Warm 3"). */
function uniquePresetName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}

/**
 * The read half of the derive/store split: strip anything that is the app's to
 * derive (built-ins), and make the remaining names unambiguous — a preset the
 * user saved as "Default" before names were reserved is RENAMED, not dropped,
 * so their work survives the migration.
 */
function normalizeStoredPresets(raw: unknown): PreferencePreset[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set(RESERVED_PRESET_NAMES);
  const out: PreferencePreset[] = [];
  for (const entry of raw as PreferencePreset[]) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.builtIn) continue;
    const base = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!base) continue;
    const name = uniquePresetName(base, taken);
    if (!name) continue;
    taken.add(name.toLowerCase());
    const { builtIn: _derived, ...rest } = entry;
    out.push({ ...rest, name });
  }
  return out;
}

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
  if (typeof window === "undefined") return [...BUILT_IN_PRESETS];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [...BUILT_IN_PRESETS];
    return [...BUILT_IN_PRESETS, ...normalizeStoredPresets(JSON.parse(raw))];
  } catch {
    return [...BUILT_IN_PRESETS];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePreferences() {
  const [prefs, setPrefs] = useState<EditorPreferences>(DEFAULT_PREFS);
  const [transforms, setTransforms] = useState<GlobalTransforms>(DEFAULT_TRANSFORMS);
  const [presets, setPresets] = useState<PreferencePreset[]>([...BUILT_IN_PRESETS]);
  const initialized = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    setTransforms(loadTransforms());
    setPresets(loadPresets());
    initialized.current = true;
  }, []);

  // Cross-window re-sync (task 179, following 177). The hydrate above is
  // one-shot, so without this a second window's `prefs`/`transforms`/`presets`
  // snapshot goes permanently stale — and because every setter serializes the
  // WHOLE object, its next edit silently drops the peer's changes from that
  // stale base. Re-read through the SAME `load*` parse path so a peer's blob
  // is merged onto the defaults exactly like a local one. Persistence lives in
  // the setters (not in a state-watching effect), so this sync can never echo
  // back out as a write — no two-window ping-pong.
  //
  // PER-KEY (task 629): the three keys are independent, so a peer's preset
  // save no longer re-parses prefs and transforms in every other window. The
  // `clear()` case — where all three go at once — is the door's, not ours.
  useStorageKeySync({
    [PREFS_KEY]: () => setPrefs(loadPrefs()),
    [TRANSFORMS_KEY]: () => setTransforms(loadTransforms()),
    [PRESETS_KEY]: () => setPresets(loadPresets()),
  });

  const persistPrefs = useCallback((newPrefs: EditorPreferences) => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(newPrefs)); } catch {}
  }, []);

  const persistTransforms = useCallback((newT: GlobalTransforms) => {
    try { localStorage.setItem(TRANSFORMS_KEY, JSON.stringify(newT)); } catch {}
  }, []);

  // The write half of the derive/store split: only USER presets are persisted.
  // Writing the built-in back out is what froze it against the shipped defaults.
  const persistPresets = useCallback((newP: PreferencePreset[]) => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(newP.filter((p) => !p.builtIn)));
    } catch {}
  }, []);

  /**
   * The ONE door that writes a single preference — and therefore the one place
   * the locked-link cascade can live (task 625).
   *
   * It used to be a raw write, with the cascade bolted on by a wrapper
   * (`useLinkAwareUpdater`) that exactly one of the dialog's sections applied.
   * So "Top bar background" moved the linked tab/library shades when you edited
   * it in the Smart section and left them behind when you edited the very same
   * pref in the "All preferences" tree a few inches below — one preference, two
   * behaviours, decided by which control you happened to reach for. A cascade
   * that any door can forget to opt into is not a cascade; it belongs to the
   * writer, so every existing door (Smart rows, the tree, FontsDialog) and every
   * future one inherits it by construction.
   *
   * `propagate` walks only LOCKED outgoing links, transitively, and returns the
   * empty map for an unlinked key — so an unlocked link, a non-colour pref, or a
   * CHILD edit (which must leave its link alone) all take the raw-write path.
   * The children land in the SAME state update as the parent, so one edit is one
   * render and one localStorage write rather than 1 + N of each.
   */
  const updatePref = useCallback(<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      if (typeof value === "string") {
        for (const [childKey, childValue] of Object.entries(propagate(key as LinkableKey, value))) {
          (next as Record<string, unknown>)[childKey] = childValue;
        }
      }
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

  /** Returns false (and writes nothing) for an empty or reserved name. */
  const savePreset = useCallback((name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || isReservedPresetName(trimmed)) return false;
    setPresets((prev) => {
      const existing = prev.findIndex((p) => p.name === trimmed && !p.builtIn);
      const preset: PreferencePreset = { name: trimmed, prefs, transforms, createdAt: Date.now() };
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
    return true;
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
