"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  type PanelThemeKey,
  type DerivedCardPalette,
  type DerivedMarkerPalette,
  type CardTheme,
  DEFAULT_PANEL_COLORS,
  deriveCardPalette,
  deriveMarkerPalette,
  themeFromAccent,
  getPanelColor,
  getPanelColorVersion,
  isPanelColorOverridden,
  loadPanelColors,
  subscribePanelColors,
} from "@/lib/panel-theme";

/** Return the fully-derived CardTheme for `key`. The accent comes from
 *  the user's color override when one is set; otherwise from
 *  `DEFAULT_PANEL_COLORS`. Re-derives on color change. */
export function useCardTheme(key: PanelThemeKey): CardTheme {
  useThemeVersion();
  return themeFromAccent(getPanelColor(key));
}

/** Subscribe to the global theme-override version counter.
 *
 *  Exported (task 493) for the ONE consumer that cannot name its key at hook
 *  time: a float's theme key is optional on the `Floatable` contract (text-object
 *  floats carry none), and a hook may not be called conditionally — so
 *  `floats/use-float-accent.ts` subscribes unconditionally here and resolves the
 *  accent afterwards. Every consumer that HAS a key should take one of the keyed
 *  hooks below instead; they are this one plus a derivation. */
export function useThemeVersion(): number {
  return useSyncExternalStore(
    subscribePanelColors,
    getPanelColorVersion,
    () => 0,
  );
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
