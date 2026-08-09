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
import { subscribeToStorageKey } from "@/lib/cross-window-storage";
import { lightnessOf, withLightness } from "@/lib/color-math";

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
];

export interface LinkState {
  /** HSL lightness delta added to parent when computing child. Range -1..1. */
  deltaL: number;
  /** When true, edits to the parent propagate; edits to the delta slider apply to the child. */
  locked: boolean;
}

/* ── HSL / hex utilities ───────────────────────────────────────────
 *
 * These used to be a byte-identical second copy of the conversion helpers in
 * `panel-theme.ts`; both now import the one dependency-free `color-math`
 * module (task 176), which is also where the WCAG contrast primitives live.
 *
 * Lightness is the RIGHT dial here, and this is not the bug class that module
 * header warns about: a pref link expresses a user-authored *relative* step
 * between two chrome colors ("Library tab steps up from Virgil bar"), not a
 * claim about legibility. A contrast target would be wrong for it. */

export { lightnessOf };

/** Return `parentHex` shifted by `deltaL` in HSL lightness. */
export function applyLightnessDelta(parentHex: string, deltaL: number): string {
  return withLightness(parentHex, Math.max(0, Math.min(1, lightnessOf(parentHex) + deltaL)));
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

/**
 * The ONE parse/validate path for the persisted blob — shared by the one-shot
 * hydrate and the cross-window re-sync below, so a peer's blob is filtered by
 * exactly the same rules as a local one. Absent/corrupt storage (and a peer's
 * `clear()`) resolve to the defaults.
 */
function readLinkStatesFromStorage(): Record<LinkId, LinkState> {
  const next: Record<LinkId, LinkState> = { ...DEFAULT_LINK_STATES };
  if (typeof window === "undefined") return next;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return next;
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (v && typeof v === "object" && typeof v.deltaL === "number" && typeof v.locked === "boolean") {
        next[k] = { deltaL: v.deltaL, locked: v.locked };
      }
    }
  } catch { /* ignore */ }
  return next;
}

export function loadPrefLinks(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  states = readLinkStatesFromStorage();
  notify();
}

// Cross-window re-sync (task 179, following 177). `loaded` is a one-shot
// latch, so a second window's snapshot could never re-hydrate — and because
// `setLinkField` serializes the WHOLE `states` map, its next edit would drop
// the peer's lock/delta changes from that stale base. The `storage` event
// never fires in the writing window, so this is the peer channel only.
subscribeToStorageKey(STORAGE_KEY, () => {
  states = readLinkStatesFromStorage();
  notify();
});

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
