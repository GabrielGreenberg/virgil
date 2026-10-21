"use client";

/**
 * Shared "what counts as a word" config for the Word Count panel and the
 * Outline panel's per-section counts. Single source of truth, persisted to
 * localStorage so the user's choices follow them across panels.
 */

import { useSyncExternalStore } from "react";
import {
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";
import { ALL_CATEGORIES, type Category } from "@/lib/word-count-core";

// Category vocabulary lives in the shared word-count core (the SSOT walker);
// re-exported here so existing panel imports keep working.
export { ALL_CATEGORIES, CATEGORY_LABELS } from "@/lib/word-count-core";
export type { Category };

export interface WordCountConfig {
  include: Record<Category, boolean>;
}

export const DEFAULT_WORD_COUNT_CONFIG: WordCountConfig = {
  include: {
    mainText: true,
    headings: true,
    footnotes: true,
    captions: true,
    math: true,
    // Comments are noise for the running total — opt-in only.
    comments: false,
  },
};

const STORAGE_KEY = "virgil-wordcount-config";

/**
 * Read the stored config through ONE parse path (hydrate AND sync).
 *
 * Every category comes back a real boolean: a stored key that is not `true`
 * (`false`, `null`, a string…) reads as OFF, and only an ABSENT key takes the
 * default. That is the same "truthy ⇒ counted" spelling `sumIncluded` in
 * word-count-core applies, so a checkbox can never show ON for a category the
 * total excludes (task 1224).
 */
function loadConfig(): WordCountConfig {
  if (typeof window === "undefined") return DEFAULT_WORD_COUNT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORD_COUNT_CONFIG;
    const parsed = JSON.parse(raw) as { include?: Record<string, unknown> } | null;
    const stored = parsed?.include;
    if (!stored || typeof stored !== "object") return DEFAULT_WORD_COUNT_CONFIG;
    const include = { ...DEFAULT_WORD_COUNT_CONFIG.include };
    for (const cat of ALL_CATEGORIES) {
      if (cat in stored) include[cat] = stored[cat] === true;
    }
    return { include };
  } catch {
    return DEFAULT_WORD_COUNT_CONFIG;
  }
}

/*
 * ONE module-level store, N readers (task 1224). The Word Count, Outline and
 * Cutter panels each mount `useWordCountConfig`; they used to hold N private
 * copies kept in step by a same-window CustomEvent dispatched from INSIDE a
 * setState updater — a render-phase side effect that could set state in a
 * sibling component mid-render. Now the value lives here, a write updates it
 * once, persists once and notifies every reader; React reads it through
 * `useSyncExternalStore`. The cross-window leg rides `subscribeToStorageKey`
 * and re-reads through the same `loadConfig`.
 */
let snapshot: WordCountConfig | null = null;
const listeners = new Set<() => void>();
let offStorage: (() => void) | null = null;

function getSnapshot(): WordCountConfig {
  return (snapshot ??= loadConfig());
}

function getServerSnapshot(): WordCountConfig {
  return DEFAULT_WORD_COUNT_CONFIG;
}

function notify(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  offStorage ??= subscribeToStorageKey(STORAGE_KEY, () => {
    snapshot = loadConfig();
    notify();
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    offStorage?.();
    offStorage = null;
    // Nobody is listening for peer writes any more, so the cache may go
    // stale — drop it; the next reader re-hydrates from storage.
    snapshot = null;
  };
}

/** Set one category's include flag: update, persist, notify — in that order, outside React. */
function setInclude(cat: Category, value: boolean): void {
  const prev = getSnapshot();
  if (prev.include[cat] === value) return;
  const next: WordCountConfig = { include: { ...prev.include, [cat]: value } };
  snapshot = next;
  // Idempotent write: no storage event for peers when nothing changed on disk.
  writeStorageIfChanged(STORAGE_KEY, JSON.stringify(next));
  notify();
}

/**
 * The shared word-count config. Every caller reads the same snapshot, so the
 * panels stay in sync without lifting state to a parent.
 */
export function useWordCountConfig() {
  const config = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { config, setInclude };
}
