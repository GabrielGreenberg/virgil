"use client";

import { useState } from "react";
import { PanelHeader, PANEL } from "./panel-primitives";
import type { WordCounts, SelectionCounts } from "@/hooks/useWordCount";
import {
  type Category,
  type WordCountConfig,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
} from "@/hooks/useWordCountConfig";

interface WordCountPanelProps {
  counts: WordCounts;
  selection: SelectionCounts | null;
  config: WordCountConfig;
  setInclude: (cat: Category, value: boolean) => void;
}

/* ── Header menu ───────────────────────────────────────────────────── */

function IncludeMenu({
  config,
  setInclude,
}: {
  config: WordCountConfig;
  setInclude: (cat: Category, value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
        title="Include in total"
        aria-label="Include in total"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[180px]">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
              Include in total
            </div>
            {ALL_CATEGORIES.map((cat) => {
              const checked = config.include[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setInclude(cat, !checked)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors flex items-center gap-2"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      checked
                        ? "bg-[var(--accent)] border-[var(--accent)]"
                        : "border-stone-300"
                    }`}
                  >
                    {checked && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 8l3.5 3.5L13 5" />
                      </svg>
                    )}
                  </span>
                  <span className="text-stone-700">{CATEGORY_LABELS[cat]}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Selection card ────────────────────────────────────────────────── */

function SelectionCard({ selection }: { selection: SelectionCounts }) {
  return (
    <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium mb-2">
        Selection
      </div>
      <div className="flex gap-6">
        <div className="flex flex-col items-center">
          <span className="text-xl font-semibold text-stone-800 tabular-nums">
            {selection.words}
          </span>
          <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">
            Words
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl font-semibold text-stone-800 tabular-nums">
            {selection.characters}
          </span>
          <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">
            Characters
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Per-category breakdown row ────────────────────────────────────── */

function CategoryRow({
  cat,
  count,
  total,
  included,
  isLast,
}: {
  cat: Category;
  count: number;
  total: number;
  included: boolean;
  isLast: boolean;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const isComments = cat === "comments";
  const deprecated = !included && isComments;
  return (
    <div
      className={`flex items-center justify-between px-4 py-2 ${
        isLast ? "" : "border-b border-stone-50"
      } ${deprecated ? "bg-stone-50/40" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-xs ${
            included ? "text-stone-700" : "text-stone-400"
          } ${deprecated ? "line-through" : ""}`}
        >
          {CATEGORY_LABELS[cat]}
        </span>
        {!included && (
          <span className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
            {isComments ? "excluded from total" : "excluded"}
          </span>
        )}
      </div>
      <span
        className={`text-xs tabular-nums flex items-center gap-2 shrink-0 ${
          included ? "text-stone-800" : "text-stone-400"
        }`}
      >
        <span className={deprecated ? "line-through" : ""}>{count}</span>
        <span className="text-[10px] text-[var(--muted)] w-8 text-right">
          {included ? `${pct}%` : ""}
        </span>
      </span>
    </div>
  );
}

/* ── Bottom totals (de-emphasized) ─────────────────────────────────── */

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-medium text-stone-600 tabular-nums">{value}</span>
      <span className="text-[9px] text-[var(--muted)] uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function BottomTotals({ counts }: { counts: WordCounts }) {
  return (
    <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--background)] shrink-0">
      <div className="flex justify-between gap-3">
        <SmallStat label="Words" value={counts.total} />
        <SmallStat label="Characters" value={counts.characters} />
        <SmallStat label="Sentences" value={counts.sentences} />
      </div>
      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[var(--muted)]">
          ~{counts.readingTime} read
        </span>
      </div>
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────── */

export default function WordCountPanel({
  counts,
  selection,
  config,
  setInclude,
}: WordCountPanelProps) {
  // Show every category that has any words. Excluded categories still
  // appear in the breakdown (so the user can see what's being left out)
  // but rendered with deprecated styling.
  const breakdownCats = ALL_CATEGORIES.filter((c) => (counts.categories[c] ?? 0) > 0);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col h-full">
      <PanelHeader title="Word Count">
        <IncludeMenu config={config} setInclude={setInclude} />
      </PanelHeader>

      <div className={PANEL.list}>
        {selection && <SelectionCard selection={selection} />}

        {breakdownCats.length > 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-2 border-b border-stone-100">
              <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                Breakdown
              </span>
            </div>
            {breakdownCats.map((cat, i) => (
              <CategoryRow
                key={cat}
                cat={cat}
                count={counts.categories[cat] ?? 0}
                total={counts.total}
                included={config.include[cat]}
                isLast={i === breakdownCats.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className={PANEL.empty}>No content yet.</div>
        )}
      </div>

      <BottomTotals counts={counts} />
    </div>
  );
}
