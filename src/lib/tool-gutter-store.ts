/**
 * The TOOL GUTTER's view state (task 1440) — the left gutter of the
 * cards-right / tools-left layout (`virgil:gutter-layout`).
 *
 * Three facts, all window-wide view state (like the dock stack it replaces —
 * panels were never per-document, so this is not a per-doc registry):
 *
 *  - `tool`   — which of the three TOOLS (Outline / Search / Word count) is
 *               written at the top of the gutter, or none.
 *  - `extra`  — the list sections the user added through "More", in the order
 *               added, after the three standing sections.
 *  - `folded` — sections the user folded shut.
 *
 * Persisted to ONE `localStorage` key and re-hydrated on the native `storage`
 * event through `subscribeToStorageKey` (the cross-window store law), so two
 * windows never fight over a stale snapshot.
 */

import { useSyncExternalStore } from "react";
import type { PanelKind } from "@/panels/_shared/types";
import {
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";

export const TOOL_GUTTER_STORAGE_KEY = "virgil:tool-gutter";

/** The three tools across the top of the gutter, in display order. */
export const GUTTER_TOOLS = ["outline", "search", "wordcount"] as const;
export type GutterTool = (typeof GUTTER_TOOLS)[number];

/** Sections every gutter shows (fold-able, never removable). */
export const STANDING_SECTIONS = ["footnotes", "examples", "todo"] as const;

/** Sections offered under "More", in menu order. */
export const MORE_SECTIONS = [
  "notes",
  "citations",
  "bibliography",
  "reports",
  "archive",
  "revisions",
  "cutter",
  "errors",
] as const;

export type GutterSection =
  | (typeof STANDING_SECTIONS)[number]
  | (typeof MORE_SECTIONS)[number];

export interface ToolGutterState {
  tool: GutterTool | null;
  extra: GutterSection[];
  folded: GutterSection[];
}

export const DEFAULT_TOOL_GUTTER_STATE: ToolGutterState = {
  tool: null,
  extra: [],
  folded: [],
};

export function isGutterTool(id: string): id is GutterTool {
  return (GUTTER_TOOLS as readonly string[]).includes(id);
}

export function isMoreSection(id: string): id is (typeof MORE_SECTIONS)[number] {
  return (MORE_SECTIONS as readonly string[]).includes(id);
}

export function isGutterSection(id: string): id is GutterSection {
  return (
    (STANDING_SECTIONS as readonly string[]).includes(id) || isMoreSection(id)
  );
}

/** Parse a stored value; anything malformed degrades field-by-field to the
 *  default rather than throwing away the rest. */
export function parseToolGutterState(raw: string | null): ToolGutterState {
  if (!raw) return DEFAULT_TOOL_GUTTER_STATE;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_TOOL_GUTTER_STATE;
  }
  if (typeof v !== "object" || v === null) return DEFAULT_TOOL_GUTTER_STATE;
  const o = v as Record<string, unknown>;
  const tool =
    typeof o.tool === "string" && isGutterTool(o.tool) ? o.tool : null;
  const list = (x: unknown, ok: (s: string) => boolean): GutterSection[] =>
    Array.isArray(x)
      ? [...new Set(x.filter((s): s is GutterSection => typeof s === "string" && ok(s)))]
      : [];
  return {
    tool,
    extra: list(o.extra, isMoreSection),
    folded: list(o.folded, isGutterSection),
  };
}

function readStored(): ToolGutterState {
  if (typeof window === "undefined") return DEFAULT_TOOL_GUTTER_STATE;
  try {
    return parseToolGutterState(localStorage.getItem(TOOL_GUTTER_STORAGE_KEY));
  } catch {
    return DEFAULT_TOOL_GUTTER_STATE;
  }
}

let snapshot: ToolGutterState | null = null;
const listeners = new Set<() => void>();
let unsubscribeStorage: (() => void) | null = null;

function current(): ToolGutterState {
  if (snapshot === null) snapshot = readStored();
  return snapshot;
}

function emit(): void {
  for (const l of listeners) l();
}

function sameState(a: ToolGutterState, b: ToolGutterState): boolean {
  return (
    a.tool === b.tool &&
    a.extra.join() === b.extra.join() &&
    a.folded.join() === b.folded.join()
  );
}

function commit(next: ToolGutterState): void {
  const prev = current();
  if (sameState(prev, next)) return;
  snapshot = next;
  writeStorageIfChanged(TOOL_GUTTER_STORAGE_KEY, JSON.stringify(next));
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribeStorage) {
    // A peer window wrote — re-read through the one parse path.
    unsubscribeStorage = subscribeToStorageKey(TOOL_GUTTER_STORAGE_KEY, () => {
      const next = readStored();
      if (snapshot && sameState(snapshot, next)) return;
      snapshot = next;
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeStorage) {
      unsubscribeStorage();
      unsubscribeStorage = null;
    }
  };
}

export function getToolGutterState(): ToolGutterState {
  return current();
}

export function useToolGutterState(): ToolGutterState {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_TOOL_GUTTER_STATE);
}

/** Show `tool` at the top of the gutter (replacing any other). */
export function openGutterTool(tool: GutterTool): void {
  const s = current();
  commit({ ...s, tool });
}

/** Toggle `tool`: open it, or close it if it is the one showing. */
export function toggleGutterTool(tool: GutterTool): void {
  const s = current();
  commit({ ...s, tool: s.tool === tool ? null : tool });
}

/** Make `section` present AND unfolded (adds a More section if absent). */
export function revealGutterSection(section: GutterSection): void {
  const s = current();
  const extra =
    isMoreSection(section) && !s.extra.includes(section)
      ? [...s.extra, section]
      : s.extra;
  commit({ ...s, extra, folded: s.folded.filter((f) => f !== section) });
}

export function toggleGutterSectionFold(section: GutterSection): void {
  const s = current();
  const folded = s.folded.includes(section)
    ? s.folded.filter((f) => f !== section)
    : [...s.folded, section];
  commit({ ...s, folded });
}

/** Remove an added (More) section from the gutter. Standing sections fold,
 *  they never leave. */
export function removeGutterSection(section: GutterSection): void {
  if (!isMoreSection(section)) return;
  const s = current();
  commit({
    ...s,
    extra: s.extra.filter((x) => x !== section),
    folded: s.folded.filter((x) => x !== section),
  });
}

/**
 * Route a legacy "open this panel" request in the gutter layout. Tools open at
 * the top of the gutter; a card panel opens NOTHING (its cards already live in
 * the right gutter, and a click on a marker or a new card must not grow a list
 * on the left). Returns whether the id was handled.
 */
export function routePanelOpenToGutter(id: string, mode: "open" | "toggle"): boolean {
  if (isGutterTool(id)) {
    if (mode === "toggle") toggleGutterTool(id);
    else openGutterTool(id);
    return true;
  }
  return isGutterSection(id as PanelKind);
}

/** Test seam: drop the cached snapshot so the next read re-parses storage. */
export function __resetToolGutterStoreForTests(): void {
  snapshot = null;
  emit();
}
