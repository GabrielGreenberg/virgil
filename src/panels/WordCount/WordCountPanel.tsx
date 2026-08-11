"use client";

import { type CategoryCounts, includedTotals } from "@/lib/word-count-core";
import {
  type Category,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  useWordCountConfig,
} from "@/hooks/useWordCountConfig";
import { Panel } from "@/panels/_shared/Panel";
import { CardMetaLabel } from "@/components/panel-primitives";

interface WordCountPanelProps {
  counts: CategoryCounts;
  selection: CategoryCounts | null;
}

const ALL_CATS: Category[] = ALL_CATEGORIES;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-base font-medium text-ink-strong tabular-nums">
        {value}
      </span>
      <CardMetaLabel>{label}</CardMetaLabel>
    </div>
  );
}

export default function WordCountPanel({
  counts,
  selection,
}: WordCountPanelProps) {
  const { config, setInclude } = useWordCountConfig();

  const visible = (cat: Category) => config.include[cat] ?? true;
  const toggleCat = (cat: Category) => setInclude(cat, !visible(cat));

  // Words and chars come from the ONE filter door in word-count-core, which
  // the Cutter goal strip and the selection counter read too — this panel's
  // headline is no longer a private reduce that its siblings had no way to
  // share (task 122). `config.include` is the same include-set the Outline's
  // per-section sums gate on.
  const { words: filteredTotal, characters: filteredChars } = includedTotals(
    counts,
    config.include,
  );
  const selectionTotals = includedTotals(selection, config.include);

  const catsWithWords = ALL_CATS.filter((c) => (counts.words[c] ?? 0) > 0);

  return (
    <Panel kind="wordcount">
      <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-medium text-ink-strong tabular-nums leading-none">
            {filteredTotal.toLocaleString()}
          </span>
          <CardMetaLabel className="leading-none">words</CardMetaLabel>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-medium text-ink-strong tabular-nums leading-none">
            {filteredChars.toLocaleString()}
          </span>
          <CardMetaLabel className="leading-none">chars</CardMetaLabel>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium mb-2">
          Selection
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Stat label="Words" value={selectionTotals.words} />
          <Stat label="Characters" value={selectionTotals.characters} />
        </div>
      </div>

      {catsWithWords.length > 0 && (
        <div className="rounded-lg border border-edge-subtle bg-surface overflow-hidden">
          <div className="px-4 py-2 border-b border-edge-subtle">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
              Breakdown
            </span>
          </div>
          {catsWithWords.map((cat, i) => {
            const wc = counts.words[cat] ?? 0;
            const included = visible(cat);
            const pct =
              filteredTotal > 0 && included
                ? Math.round((wc / filteredTotal) * 100)
                : 0;
            return (
              <button
                key={cat}
                onClick={() => toggleCat(cat)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 hover-on-light ${
                  i < catsWithWords.length - 1
                    ? "border-b border-edge-subtle"
                    : ""
                }`}
                data-hint="Toggle category"
              >
                <span className="w-4 text-center text-xs text-[var(--accent)]">
                  {included ? "\u2713" : ""}
                </span>
                <span
                  className={`text-xs flex-1 text-left ${included ? "text-ink-body" : "text-ink-muted"}`}
                >
                  {CATEGORY_LABELS[cat]}
                </span>
                <span
                  className={`text-xs tabular-nums ${included ? "text-ink-strong" : "text-ink-faint"}`}
                >
                  {wc}
                </span>
                <span
                  className={`text-[10px] w-8 text-right ${included ? "text-[var(--muted)]" : "text-ink-faint"}`}
                >
                  {included ? `${pct}%` : "off"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
