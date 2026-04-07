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
  | "blockquotes"
  | "lists"
  | "math"
  | "comments";

export const CATEGORY_LABELS: Record<Category, string> = {
  mainText: "Main Text",
  headings: "Headings",
  footnotes: "Footnotes",
  blockquotes: "Block Quotes",
  lists: "Lists",
  math: "Math",
  comments: "Comments",
};

export const ALL_CATEGORIES: Category[] = [
  "mainText",
  "headings",
  "footnotes",
  "blockquotes",
  "lists",
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
    blockquotes: true,
    lists: true,
    math: true,
    // Comments are noise for the running total — opt-in only.
    comments: false,
  },
};

const STORAGE_KEY = "virgil-wordcount-config";

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

export function useWordCountConfig() {
  const [config, setConfig] = useState<WordCountConfig>(() => loadConfig());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore — quota / private mode
    }
  }, [config]);

  const setInclude = useCallback((cat: Category, value: boolean) => {
    setConfig((prev) => ({
      ...prev,
      include: { ...prev.include, [cat]: value },
    }));
  }, []);

  const reset = useCallback(() => setConfig(DEFAULT_WORD_COUNT_CONFIG), []);

  return { config, setInclude, reset };
}
