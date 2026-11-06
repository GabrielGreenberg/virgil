"use client";

/**
 * The preference stores that live BESIDE `usePreferences` — declared once
 * (task 1489).
 *
 * The Preferences dialog renders five stores: `usePreferences`' prefs and
 * transforms, and — in its Smart section — panel colours (`panel-theme`),
 * panel typography (`panel-typography`) and pref-link deltas (`pref-links`).
 * The whole-settings operations (Reset to defaults, preset save/load, and an
 * Undo of any of them) used to span only the first two, so a reset left a set
 * panel colour, a panel font size and a link delta standing, and "Undo" could
 * not have put them back had it cleared them.
 *
 * This table is the list of the OTHER three. `SettingsSnapshot` (in
 * `usePreferences`) is prefs + transforms + this table's product, and every
 * whole-settings operation iterates it — so a store added here is reset,
 * captured by presets and restored by Undo with no further wiring.
 *
 * Each row is the store's own doors: `read` (a fresh copy of the live value),
 * `normalize` (validate any blob — a stored preset's, a snapshot's — and map
 * `undefined` to the store's defaults; it is also how an expected result is
 * COMPUTED, so an undo offer can compare it with the live state), and
 * `replace` (write the whole value in one go, persisted + notified).
 */

import { useSyncExternalStore } from "react";
import {
  getPanelColorOverrides,
  getPanelColorVersion,
  normalizePanelColorOverrides,
  replacePanelColorOverrides,
  subscribePanelColors,
} from "./panel-theme";
import {
  getAllPanelTypographyOverrides,
  getPanelTypographyVersion,
  normalizePanelTypographyOverrides,
  replacePanelTypographyOverrides,
  subscribePanelTypography,
} from "./panel-typography";
import {
  getAllLinkStates,
  getPrefLinksVersion,
  normalizeLinkStates,
  replaceLinkStates,
  subscribePrefLinks,
} from "./pref-links";

interface SideStore<T> {
  read: () => T;
  normalize: (blob: unknown) => T;
  replace: (blob: unknown) => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

function sideStore<T>(row: SideStore<T>): SideStore<T> {
  return row;
}

export const SIDE_SETTINGS_STORES = {
  panelColors: sideStore({
    read: getPanelColorOverrides,
    normalize: normalizePanelColorOverrides,
    replace: replacePanelColorOverrides,
    subscribe: subscribePanelColors,
    version: getPanelColorVersion,
  }),
  panelTypography: sideStore({
    read: getAllPanelTypographyOverrides,
    normalize: normalizePanelTypographyOverrides,
    replace: replacePanelTypographyOverrides,
    subscribe: subscribePanelTypography,
    version: getPanelTypographyVersion,
  }),
  prefLinks: sideStore({
    read: () => ({ ...getAllLinkStates() }),
    normalize: normalizeLinkStates,
    replace: replaceLinkStates,
    subscribe: subscribePrefLinks,
    version: getPrefLinksVersion,
  }),
};

type Stores = typeof SIDE_SETTINGS_STORES;
export type SideSettingsKey = keyof Stores;
export type SideSettings = {
  [K in SideSettingsKey]: ReturnType<Stores[K]["read"]>;
};

const SIDE_KEYS = Object.keys(SIDE_SETTINGS_STORES) as SideSettingsKey[];

/** The live value of every side store. */
export function readSideSettings(): SideSettings {
  const out = {} as Record<SideSettingsKey, unknown>;
  for (const k of SIDE_KEYS) out[k] = SIDE_SETTINGS_STORES[k].read();
  return out as SideSettings;
}

/** What `applySideSettings(partial)` would leave in the stores: each present
 *  key normalized, each MISSING key at its defaults (an older preset blob
 *  carries no side stores — applying it means "these are the settings"). */
export function resolveSideSettings(partial: Partial<SideSettings>): SideSettings {
  const out = {} as Record<SideSettingsKey, unknown>;
  for (const k of SIDE_KEYS) out[k] = SIDE_SETTINGS_STORES[k].normalize(partial[k]);
  return out as SideSettings;
}

/** Replace every side store — the side half of `usePreferences.applySettings`. */
export function applySideSettings(partial: Partial<SideSettings>): void {
  for (const k of SIDE_KEYS) SIDE_SETTINGS_STORES[k].replace(partial[k]);
}

/** One subscription across every side store. */
function subscribeSideSettings(listener: () => void): () => void {
  const offs = SIDE_KEYS.map((k) => SIDE_SETTINGS_STORES[k].subscribe(listener));
  return () => offs.forEach((off) => off());
}

// The snapshot is re-read only when some store's version moved, so
// `useSyncExternalStore` sees a stable object between notifications.
let cachedKey = "";
let cachedSnapshot: SideSettings | null = null;
function getSideSettingsSnapshot(): SideSettings {
  const key = SIDE_KEYS.map((k) => SIDE_SETTINGS_STORES[k].version()).join(":");
  if (key !== cachedKey || !cachedSnapshot) {
    cachedKey = key;
    cachedSnapshot = readSideSettings();
  }
  return cachedSnapshot;
}

/** The live side settings, re-read when any of the stores notifies.
 *  Dialog-scoped (never on a keystroke path). */
export function useSideSettings(): SideSettings {
  return useSyncExternalStore(subscribeSideSettings, getSideSettingsSnapshot, getSideSettingsSnapshot);
}
