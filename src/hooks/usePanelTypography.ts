"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  getPanelTypography,
  getPanelTypographyVersion,
  isPanelTypographyFieldOverridden,
  loadPanelTypography,
  subscribePanelTypography,
  type PanelBodyKey,
  type PanelTypography,
} from "@/lib/panel-typography";

function useTypoVersion(): number {
  return useSyncExternalStore(
    subscribePanelTypography,
    getPanelTypographyVersion,
    () => 0,
  );
}

/** Load overrides on first client mount. Safe to call multiple times. */
export function useLoadPanelTypography() {
  useEffect(() => {
    loadPanelTypography();
  }, []);
}

/** Effective typography (override merged over default). Re-renders on change. */
export function usePanelTypography(key: PanelBodyKey | undefined): PanelTypography | null {
  useTypoVersion();
  if (!key) return null;
  return getPanelTypography(key);
}

/** Quote space-containing font family names so the browser accepts them
 *  via inline `style.fontFamily =`. Browsers silently drop unquoted
 *  multi-word values when they're set programmatically. */
function quoteFontFamily(name: string): string {
  return /\s/.test(name) && !/^["']/.test(name) ? `"${name}"` : name;
}

/** Effective body style (default ⊕ override) as a ready-to-spread
 *  React.CSSProperties. Always populated when `key` is given, so cards
 *  can apply this inline and the registry default actually shows up
 *  (instead of being masked by upstream CSS rules like `.tiptap p`). */
export function usePanelBodyStyle(key: PanelBodyKey | undefined): React.CSSProperties {
  useTypoVersion();
  if (!key) return {};
  const t = getPanelTypography(key);
  return {
    fontFamily: quoteFontFamily(t.fontFamily),
    fontSize: `${t.fontSize}px`,
    color: t.color,
  };
}

export function useIsPanelTypoFieldOverridden<F extends keyof PanelTypography>(
  key: PanelBodyKey,
  field: F,
): boolean {
  useTypoVersion();
  return isPanelTypographyFieldOverridden(key, field);
}

export function useAllPanelTypography(): Record<PanelBodyKey, PanelTypography> {
  useTypoVersion();
  const out = {} as Record<PanelBodyKey, PanelTypography>;
  for (const k of Object.keys(DEFAULT_PANEL_TYPOGRAPHY) as PanelBodyKey[]) {
    out[k] = getPanelTypography(k);
  }
  return out;
}
