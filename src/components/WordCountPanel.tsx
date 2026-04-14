"use client";

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
  focusCounts?: { words: number } | null;
}

const ALL_CATS: Category[] = ALL_CATEGORIES;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-semibold text-stone-800 tabular-nums">{value}</span>
      <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function WordCountPanel({ counts, selection, focusCounts }: WordCountPanelProps) {
  const { config, setInclude } = useWordCountConfig();

  const visible = (cat: Category) => config.include[cat] ?? true;
  const toggleCat = (cat: Category) => setInclude(cat, !visible(cat));

  const filteredTotal = ALL_CATS.reduce(
    (sum, cat) => sum + (visible(cat) ? (counts.categories[cat] ?? 0) : 0),
    0,
  );
  const filteredMinutes = Math.max(1, Math.round(filteredTotal / 225));
  const filteredReadingTime = filteredMinutes === 1 ? "1 min" : `${filteredMinutes} min`;

  // Show all categories that have words — both included and excluded.
  const catsWithWords = ALL_CATS.filter((c) => (counts.categories[c] ?? 0) > 0);

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Word Count" />

      <div className={PANEL.list}>
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

        {/* Focus count */}
        {focusCounts && (
          <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium mb-2">
              Focus
            </div>
            <div className="flex gap-6">
              <Stat label="Words" value={focusCounts.words} />
            </div>
          </div>
        )}

        {/* Category breakdown — each row is a toggle button */}
        {catsWithWords.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-2 border-b border-stone-100">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                Breakdown
              </span>
            </div>
            {catsWithWords.map((cat, i) => {
              const wc = counts.categories[cat] ?? 0;
              const included = visible(cat);
              const pct = filteredTotal > 0 && included
                ? Math.round((wc / filteredTotal) * 100)
                : 0;
              return (
                <button
                  key={cat}
                  onClick={() => toggleCat(cat)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-stone-50 ${
                    i < catsWithWords.length - 1 ? "border-b border-stone-50" : ""
                  }`}
                  title={included ? `Exclude ${CATEGORY_LABELS[cat]} from total` : `Include ${CATEGORY_LABELS[cat]} in total`}
                >
                  {/* Checkbox */}
                  {included ? (
                    <svg className="shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="1" width="14" height="14" rx="3" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5" />
                      <path d="M4.5 8l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" />
                    </svg>
                  )}
                  <span className={`text-xs flex-1 text-left ${included ? "text-stone-600" : "text-stone-400"}`}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className={`text-xs tabular-nums ${included ? "text-stone-800" : "text-stone-300"}`}>
                    {wc}
                  </span>
                  <span className={`text-[10px] w-8 text-right ${included ? "text-[var(--muted)]" : "text-stone-300"}`}>
                    {included ? `${pct}%` : "off"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
