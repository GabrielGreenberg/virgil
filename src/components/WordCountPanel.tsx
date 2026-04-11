"use client";

import { useState } from "react";
import { PanelHeader, PANEL } from "./panel-primitives";
import type { WordCounts, SelectionCounts } from "@/hooks/useWordCount";
import {
  type Category,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  useWordCountConfig,
} from "@/hooks/useWordCountConfig";

interface WordCountPanelProps {
  counts: WordCounts;
  selection: SelectionCounts | null;
}

// Display order — same as the shared config so the menu and the
// breakdown stay aligned.
const ALL_CATS: Category[] = ALL_CATEGORIES;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-semibold text-stone-800 tabular-nums">{value}</span>
      <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function WordCountPanel({ counts, selection }: WordCountPanelProps) {
  const { config, setInclude } = useWordCountConfig();
  const [menuOpen, setMenuOpen] = useState(false);

  // The shared config drives both the breakdown visibility here and the
  // per-section counts in the outline panel — "show in breakdown" and
  // "include in count" are intentionally the same toggle now.
  const visible = (cat: Category) => config.include[cat] ?? true;
  const toggleCat = (cat: Category) => setInclude(cat, !visible(cat));

  const visibleCats = ALL_CATS.filter((c) => visible(c) && (counts.categories[c] ?? 0) > 0);
  const hiddenWithCount = ALL_CATS.filter((c) => !visible(c) && (counts.categories[c] ?? 0) > 0);

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Word Count">
        {/* Settings gear dropdown */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="Category settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[160px]">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                  Show categories
                </div>
                {ALL_CATS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCat(cat)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors flex items-center gap-2"
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      visible(cat)
                        ? "bg-[var(--accent)] border-[var(--accent)]"
                        : "border-stone-300"
                    }`}>
                      {visible(cat) && (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 8l3.5 3.5L13 5" />
                        </svg>
                      )}
                    </span>
                    <span className="text-stone-700">{CATEGORY_LABELS[cat]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </PanelHeader>

      <div className={PANEL.list}>
        {/* Selection counts */}
        {selection && (
          <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium mb-2">
              Selection
            </div>
            <div className="flex gap-6">
              <Stat label="Words" value={selection.words} />
              <Stat label="Characters" value={selection.characters} />
            </div>
          </div>
        )}

        {/* Total stats */}
        <div className="px-4 py-4">
          <div className="flex justify-between gap-3">
            <Stat label="Words" value={counts.total} />
            <Stat label="Characters" value={counts.characters} />
            <Stat label="Sentences" value={counts.sentences} />
          </div>
          <div className="text-center mt-2">
            <span className="text-[11px] text-[var(--muted)]">
              ~{counts.readingTime} read
            </span>
          </div>
        </div>

        {/* Category breakdown */}
        {visibleCats.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-2 border-b border-stone-100">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                Breakdown
              </span>
            </div>
            {visibleCats.map((cat, i) => {
              const wc = counts.categories[cat] ?? 0;
              const pct = counts.total > 0 ? Math.round((wc / counts.total) * 100) : 0;
              return (
                <div
                  key={cat}
                  className={`flex items-center justify-between px-4 py-2 ${
                    i < visibleCats.length - 1 ? "border-b border-stone-50" : ""
                  }`}
                >
                  <span className="text-xs text-stone-600">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-xs tabular-nums text-stone-800 flex items-center gap-2">
                    {wc}
                    <span className="text-[10px] text-[var(--muted)] w-8 text-right">{pct}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Categories with 0 words that are visible — show muted */}
        {ALL_CATS.filter((c) => visible(c) && (counts.categories[c] ?? 0) === 0).length > 0 && (
          <div className="px-3 py-1">
            <span className="text-[11px] text-[var(--muted)]">
              {ALL_CATS.filter((c) => visible(c) && (counts.categories[c] ?? 0) === 0)
                .map((c) => CATEGORY_LABELS[c])
                .join(", ")}
              {" — 0 words"}
            </span>
          </div>
        )}

        {/* Hidden categories with content indicator */}
        {hiddenWithCount.length > 0 && (
          <div className="px-3 py-1">
            <span className="text-[11px] text-[var(--muted)] italic">
              {hiddenWithCount.length} hidden {hiddenWithCount.length === 1 ? "category has" : "categories have"} words
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
