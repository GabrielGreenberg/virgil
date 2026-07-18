"use client";

/**
 * Shared "what counts as a word" config for the Word Count panel and the
 * Outline panel's per-section counts. Single source of truth, persisted to
 * localStorage so the user's choices follow them across panels.
 */

import { useState, useEffect, useCallback } from "react";
import { useStorageKeySync } from "@/lib/cross-window-storage";
import type { Category } from "@/lib/word-count-core";

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
const CHANGE_EVENT = "virgil-wordcount-config-change";

function loadConfig(): WordCountConfig {
  if (typeof window === "undefined") return DEFAULT_WORD_COUNT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORD_COUNT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WordCountConfig>;
    // Merge with defaults so newly added categories pick up sane defaults.
    return {
      include: {
        ...DEFAULT_WORD_COUNT_CONFIG.include,
        ...(parsed?.include ?? {}),
      },
    };
  } catch {
    return DEFAULT_WORD_COUNT_CONFIG;
  }
}

/**
 * Subscribe to config changes from any hook instance — multiple panels can
 * mount this hook simultaneously and they all need to stay in sync without
 * lifting state to a parent.
 */
export function useWordCountConfig() {
  const [config, setConfig] = useState<WordCountConfig>(() => loadConfig());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<WordCountConfig>).detail;
      if (detail) setConfig(detail);
    };
    window.addEventListener(CHANGE_EVENT, onChange as EventListener);
    return () => window.removeEventListener(CHANGE_EVENT, onChange as EventListener);
  }, []);

  // The `CHANGE_EVENT` above is a SAME-window bus — it keeps sibling hook
  // instances (Word Count panel + Outline panel) in step, but a second app
  // window never hears it. Without the cross-window channel that window's
  // config stays on its load-time snapshot and its next `setInclude` writes
  // the whole `include` map over the peer's category toggles (task 179,
  // following 177). Re-read through the SAME `loadConfig` merge path; the
  // write lives in the setters, so a sync can't echo back out.
  useStorageKeySync(STORAGE_KEY, () => setConfig(loadConfig()));

  const setInclude = useCallback((cat: Category, value: boolean) => {
    setConfig((prev) => {
      const next: WordCountConfig = {
        ...prev,
        include: { ...prev.include, [cat]: value },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore — quota / private mode
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WORD_COUNT_CONFIG));
    } catch {}
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: DEFAULT_WORD_COUNT_CONFIG }),
    );
    setConfig(DEFAULT_WORD_COUNT_CONFIG);
  }, []);

  return { config, setInclude, reset };
}
