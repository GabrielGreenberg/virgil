/**
 * The TOOL GUTTER's view state (task 1440) — the left gutter of the
 * cards-right / tools-left layout (`virgil:gutter-layout`).
 *
 * Three facts, all window-wide view state (like the dock stack it replaces —
 * panels were never per-document, so this is not a per-doc registry):
 *
 *  - `tool`     — which of the three TOOLS (Outline / Search / Word count) is
 *                 written at the top of the gutter, or none.
 *  - `sections` — the list sections the gutter shows, in order. None is
 *                 required: the user adds them through "More" and removes
 *                 them, down to none at all.
 *  - `folded`   — sections the user folded shut (the one-column layout's
 *                 fold; kept so a stored blob round-trips).
 *  - `list`     — which list is written in the gutter's BOTTOM half, or none.
 *                 Its icon row mirrors the tools row: one list at a time, a
 *                 click on the lit icon closes it.
 *  - `split`    — the top half's share (0–1) of the height the two halves
 *                 split when a tool AND a list are open; the divider between
 *                 them is dragged through the pane-resize engine and commits
 *                 here once, on release.
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

/** Every list the gutter can show, in "More" menu order. */
export const GUTTER_SECTIONS = [
  "footnotes",
  "examples",
  "todo",
  "notes",
  "citations",
  "bibliography",
  "reports",
  "archive",
  "revisions",
  "cutter",
  "errors",
] as const;

export type GutterSection = (typeof GUTTER_SECTIONS)[number];

/** What a gutter shows until the user says otherwise. */
export const DEFAULT_GUTTER_SECTIONS: readonly GutterSection[] = ["footnotes", "bibliography"];

export interface ToolGutterState {
  tool: GutterTool | null;
  sections: GutterSection[];
  folded: GutterSection[];
  list: GutterSection | null;
  split: number;
}

/** The top half's share when nothing is stored, and the drag's bounds. */
export const DEFAULT_GUTTER_SPLIT = 0.5;
export const MIN_GUTTER_SPLIT = 0.15;
export const MAX_GUTTER_SPLIT = 0.85;

export function clampGutterSplit(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_GUTTER_SPLIT;
  return Math.min(MAX_GUTTER_SPLIT, Math.max(MIN_GUTTER_SPLIT, f));
}

export const DEFAULT_TOOL_GUTTER_STATE: ToolGutterState = {
  tool: null,
  sections: [...DEFAULT_GUTTER_SECTIONS],
  folded: [],
  list: DEFAULT_GUTTER_SECTIONS[0] ?? null,
  split: DEFAULT_GUTTER_SPLIT,
};

export function isGutterTool(id: string): id is GutterTool {
  return (GUTTER_TOOLS as readonly string[]).includes(id);
}

export function isGutterSection(id: string): id is GutterSection {
  return (GUTTER_SECTIONS as readonly string[]).includes(id);
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
  const list = (x: unknown): GutterSection[] =>
    Array.isArray(x)
      ? [...new Set(x.filter((s): s is GutterSection => typeof s === "string" && isGutterSection(s)))]
      : [];
  const sections = Array.isArray(o.sections)
    ? list(o.sections)
    : [...new Set([...DEFAULT_GUTTER_SECTIONS, ...list(o.extra)])];
  // `list` names one of the icons present; a blob from before the split
  // gutter has none, and opens the first of its lists.
  const openList =
    o.list === null
      ? null
      : typeof o.list === "string" && isGutterSection(o.list) && sections.includes(o.list)
        ? o.list
        : (sections[0] ?? null);
  return {
    tool,
    // A blob from before `sections` kept only what the user added (`extra`);
    // the three sections it took as read were never a choice, so the current
    // default stands in for them. An empty `sections` is a choice, and stays.
    sections,
    folded: list(o.folded),
    list: openList,
    split: typeof o.split === "number" ? clampGutterSplit(o.split) : DEFAULT_GUTTER_SPLIT,
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
    a.sections.join() === b.sections.join() &&
    a.folded.join() === b.folded.join() &&
    a.list === b.list &&
    a.split === b.split
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

/** Make `section` present, unfolded AND the open list (adds its icon if
 *  absent) — what the "+" menu does with its choice. */
export function revealGutterSection(section: GutterSection): void {
  const s = current();
  const sections = s.sections.includes(section) ? s.sections : [...s.sections, section];
  commit({ ...s, sections, folded: s.folded.filter((f) => f !== section), list: section });
}

/** Toggle the bottom half's list: open `section`, or close it if it is the
 *  one showing. */
export function toggleGutterList(section: GutterSection): void {
  const s = current();
  commit({ ...s, list: s.list === section ? null : section });
}

/** Commit the divider's position (the top half's share), clamped. */
export function setGutterSplit(fraction: number): void {
  const s = current();
  commit({ ...s, split: clampGutterSplit(fraction) });
}

export function toggleGutterSectionFold(section: GutterSection): void {
  const s = current();
  const folded = s.folded.includes(section)
    ? s.folded.filter((f) => f !== section)
    : [...s.folded, section];
  commit({ ...s, folded });
}

/** Remove a list's icon from the gutter ("…" menu). "+" brings it back. */
export function removeGutterSection(section: GutterSection): void {
  const s = current();
  commit({
    ...s,
    sections: s.sections.filter((x) => x !== section),
    folded: s.folded.filter((x) => x !== section),
    list: s.list === section ? null : s.list,
  });
}

/** Put the list icons back to the shipped default ("…" menu). */
export function resetGutterSections(): void {
  const s = current();
  commit({
    ...s,
    sections: [...DEFAULT_GUTTER_SECTIONS],
    folded: [],
    list: s.list && DEFAULT_GUTTER_SECTIONS.includes(s.list) ? s.list : (DEFAULT_GUTTER_SECTIONS[0] ?? null),
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
