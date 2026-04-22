"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  getPanelTypography,
  getPanelTypographyOverrides,
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

/** Only the user-overridden fields. Cards use this to apply inline styles
 *  that don't disturb their default (theme-driven) styling when the user
 *  hasn't explicitly set anything. Ready-to-spread React.CSSProperties. */
export function usePanelBodyStyle(key: PanelBodyKey | undefined): React.CSSProperties {
  useTypoVersion();
  if (!key) return {};
  const o = getPanelTypographyOverrides(key);
  const style: React.CSSProperties = {};
  if (o.fontFamily) style.fontFamily = o.fontFamily;
  if (o.fontSize)   style.fontSize   = `${o.fontSize}px`;
  if (o.color)      style.color      = o.color;
  return style;
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
