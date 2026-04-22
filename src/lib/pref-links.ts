/**
 * Preference links — "this color is derived from that one by a lightness
 * delta" relationships. Editing a locked parent pushes a new value down
 * to every locked descendant. Adjusting the delta slider on a link also
 * updates the child. Editing the child directly leaves the link alone
 * (the delta stays stored; it'll re-apply on the next parent edit).
 *
 * This is a proof-of-concept scoped to the top-bar smart section. The
 * data model is generic, so we can extend to other groups later.
 *
 * Storage: `virgil-pref-links` in localStorage.
 */

import type { EditorPreferences } from "@/hooks/usePreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

/** Only color-valued prefs are linkable right now. */
export type LinkableKey = keyof EditorPreferences;

/** Stable id `${parent}>>${child}` for storage keying. */
export type LinkId = string;
export const linkId = (parent: LinkableKey, child: LinkableKey): LinkId =>
  `${String(parent)}>>${String(child)}`;

export interface LinkDefinition {
  parent: LinkableKey;
  child: LinkableKey;
  /** Human-readable label shown on the edge row, e.g. "tracks Virgil bar". */
  label: string;
}

/**
 * Static registry of links we expose in the UI. Adding an entry here
 * shows a link row in the SmartPreferences renderer; it doesn't force
 * the link on — the user still has to lock it.
 */
export const LINK_DEFINITIONS: LinkDefinition[] = [
  { parent: "topbarBackground", child: "tabBg",     label: "Tab background tracks Virgil bar" },
  { parent: "topbarBackground", child: "libraryBg", label: "Library tab steps up from Virgil bar" },
  { parent: "libraryBg",        child: "mainTabBg", label: "Main tab steps up from library" },
];

export interface LinkState {
  /** HSL lightness delta added to parent when computing child. Range -1..1. */
  deltaL: number;
  /** When true, edits to the parent propagate; edits to the delta slider apply to the child. */
  locked: boolean;
}

/* ── HSL / hex utilities (self-contained; no global dependencies) ─── */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = (n: number) => {
    const t = (h / 60 + n + 6) % 6;
    if (t < 1) return p + (q - p) * t;
    if (t < 3) return q;
    if (t < 4) return p + (q - p) * (4 - t);
    return p;
  };
  return [k(2) * 255, k(0) * 255, k(4) * 255];
}

/** L of `hex`, in 0..1. */
export function lightnessOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [, , l] = rgbToHsl(r, g, b);
  return l;
}

/** Return `parentHex` shifted by `deltaL` in HSL lightness. */
export function applyLightnessDelta(parentHex: string, deltaL: number): string {
  const [r, g, b] = hexToRgb(parentHex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.max(0, Math.min(1, l + deltaL));
  const [r2, g2, b2] = hslToRgb(h, s, newL);
  return rgbToHex(r2, g2, b2);
}

/* ── Defaults: computed from DEFAULT_PREFS at module load ──────────── */

function computeDefaultState(def: LinkDefinition): LinkState {
  const parentVal = DEFAULT_PREFS[def.parent];
  const childVal = DEFAULT_PREFS[def.child];
  if (typeof parentVal !== "string" || typeof childVal !== "string") {
    return { deltaL: 0, locked: false };
  }
  const deltaL = lightnessOf(childVal) - lightnessOf(parentVal);
  // Links start locked — users can unlock on demand.
  return { deltaL, locked: true };
}

export const DEFAULT_LINK_STATES: Record<LinkId, LinkState> = Object.fromEntries(
  LINK_DEFINITIONS.map((d) => [linkId(d.parent, d.child), computeDefaultState(d)]),
);

/* ── Mutable store with subscribe/notify ───────────────────────────── */

const STORAGE_KEY = "virgil-pref-links";

let states: Record<LinkId, LinkState> = { ...DEFAULT_LINK_STATES };
let loaded = false;
const listeners = new Set<() => void>();
let version = 0;

export function getPrefLinksVersion(): number {
  return version;
}

export function subscribePrefLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(states)); }
  catch { /* ignore */ }
}

export function loadPrefLinks(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const next: Record<LinkId, LinkState> = { ...DEFAULT_LINK_STATES };
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        if (v && typeof v === "object" && typeof v.deltaL === "number" && typeof v.locked === "boolean") {
          next[k] = { deltaL: v.deltaL, locked: v.locked };
        }
      }
      states = next;
      notify();
    }
  } catch { /* ignore */ }
}

export function getLinkState(id: LinkId): LinkState | undefined {
  return states[id];
}

export function getAllLinkStates(): Record<LinkId, LinkState> {
  return states;
}

export function setLinkField<F extends keyof LinkState>(
  id: LinkId,
  field: F,
  value: LinkState[F],
): void {
  const cur = states[id] ?? { deltaL: 0, locked: false };
  states = { ...states, [id]: { ...cur, [field]: value } };
  persist();
  notify();
}

/* ── Link-aware propagation ────────────────────────────────────────── */

/**
 * Given a just-updated pref key/value, return a map of dependent pref
 * keys to their new values, by walking all locked outgoing links
 * (transitively). Does NOT apply the updates — the caller writes them
 * into the preferences store itself.
 */
export function propagate(
  changedKey: LinkableKey,
  changedValue: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const queue: Array<{ key: LinkableKey; value: string }> = [
    { key: changedKey, value: changedValue },
  ];
  const visited = new Set<string>([String(changedKey)]);

  while (queue.length) {
    const { key, value } = queue.shift()!;
    for (const def of LINK_DEFINITIONS) {
      if (def.parent !== key) continue;
      const state = states[linkId(def.parent, def.child)];
      if (!state || !state.locked) continue;
      const childKey = String(def.child);
      if (visited.has(childKey)) continue;
      visited.add(childKey);
      const nextValue = applyLightnessDelta(value, state.deltaL);
      result[childKey] = nextValue;
      queue.push({ key: def.child, value: nextValue });
    }
  }
  return result;
}
