"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  type PanelThemeKey,
  type DerivedCardPalette,
  type DerivedMarkerPalette,
  DEFAULT_PANEL_COLORS,
  deriveCardPalette,
  deriveMarkerPalette,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  loadPanelColors,
  subscribePanelColors,
} from "@/lib/panel-theme";
import { CARD_THEMES, type CardTheme } from "@/components/panel-primitives";

/** Map a PanelThemeKey to the corresponding CARD_THEMES entry. */
const CARD_THEME_BY_KEY: Record<PanelThemeKey, keyof typeof CARD_THEMES> = {
  citation: "citation",
  bib:      "bib",
  footnote: "footnote",
  note:     "note",
  archive:  "archive",
  quote:    "citation", // QuotationsPanel cards are themed inline; uses citation base
  todo:     "todo",
  cut:      "cut",
  revision: "note",     // placeholder — revision cards aren't themed yet
  example:  "example",
};

/** Return the CardTheme for `key`, augmented with `override` derived from the
 *  current user color when one is set. Triggers re-render on color change. */
export function useCardTheme(key: PanelThemeKey): CardTheme {
  useThemeVersion();
  const base = CARD_THEMES[CARD_THEME_BY_KEY[key]];
  if (!isPanelColorOverridden(key)) return base;
  const p = deriveCardPalette(getPanelColor(key));
  return {
    ...base,
    badgeBg: p.badgeBg,
    badgeColor: p.badgeColor,
    badgeBorder: p.badgeBorder,
    titleColor: p.titleColor,
    override: {
      headerBg: p.headerBg,
      headerBgSelected: p.headerBgSelected,
      separatorColor: p.separatorColor,
      selectedBorder: p.selectedBorder,
    },
  };
}

/** Subscribe to the global theme-override version counter. */
function useThemeVersion(): number {
  return useSyncExternalStore(
    subscribePanelColors,
    getPanelColorVersion,
    () => 0,
  );
}

/** Load overrides on first client mount. */
export function useLoadPanelColors() {
  useEffect(() => {
    loadPanelColors();
  }, []);
}

/** Current base hex for a panel (override or default). Re-renders on change. */
export function usePanelColor(key: PanelThemeKey): string {
  useThemeVersion();
  return getPanelColor(key);
}

/** Card palette derived from the panel's current base color. */
export function usePanelCardPalette(key: PanelThemeKey): DerivedCardPalette {
  useThemeVersion();
  return deriveCardPalette(getPanelColor(key));
}

/** Marker palette derived from the panel's current base color. */
export function usePanelMarkerPalette(key: PanelThemeKey): DerivedMarkerPalette {
  useThemeVersion();
  return deriveMarkerPalette(getPanelColor(key));
}

/** Whether this panel currently has a user override applied. */
export function useIsPanelColorOverridden(key: PanelThemeKey): boolean {
  useThemeVersion();
  return isPanelColorOverridden(key);
}

/** Get every panel's current color (for pickers that show all panels). */
export function useAllPanelColors(): Record<PanelThemeKey, string> {
  useThemeVersion();
  const out = {} as Record<PanelThemeKey, string>;
  for (const k of Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]) {
    out[k] = getPanelColor(k);
  }
  return out;
}
