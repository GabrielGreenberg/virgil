"use client";

/**
 * Shared "what counts as a word" config for the Word Count panel and the
 * Outline panel's per-section counts. Single source of truth, persisted to
 * localStorage so the user's choices follow them across panels.
 */

import { useState, useEffect, useCallback } from "react";

export type Category =
  | "mainText"
  | "headings"
  | "footnotes"
  | "captions"
  | "math"
  | "comments";

export const CATEGORY_LABELS: Record<Category, string> = {
  mainText: "Main Text",
  headings: "Headings",
  footnotes: "Footnotes",
  captions: "Captions",
  math: "Math",
  comments: "Comments",
};

export const ALL_CATEGORIES: Category[] = [
  "mainText",
  "headings",
  "footnotes",
  "captions",
  "math",
  "comments",
];

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
