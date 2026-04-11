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

  const filteredTotal = ALL_CATS.reduce(
    (sum, cat) => sum + (visible(cat) ? (counts.categories[cat] ?? 0) : 0),
    0,
  );
  const filteredMinutes = Math.max(1, Math.round(filteredTotal / 225));
  const filteredReadingTime = filteredMinutes === 1 ? "1 min" : `${filteredMinutes} min`;

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
            title="View options"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[160px]">
                {ALL_CATS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCat(cat)}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  >
                    <span>{CATEGORY_LABELS[cat]}</span>
                    <span className="text-[var(--accent)]">{visible(cat) ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </PanelHeader>

      <div className={PANEL.list}>
        {/* Selection counts */}
        <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium mb-2">
            Selection
          </div>
          <div className="flex gap-6">
            <Stat label="Words" value={selection?.words ?? 0} />
            <Stat label="Characters" value={selection?.characters ?? 0} />
          </div>
        </div>

        {/* Total stats */}
        <div className="px-4 py-4">
          <div className="flex justify-between gap-3">
            <Stat label="Words" value={filteredTotal} />
            <Stat label="Characters" value={counts.characters} />
            <Stat label="Sentences" value={counts.sentences} />
          </div>
          <div className="text-center mt-2">
            <span className="text-[11px] text-[var(--muted)]">
              ~{filteredReadingTime} read
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
              const pct = filteredTotal > 0 ? Math.round((wc / filteredTotal) * 100) : 0;
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
