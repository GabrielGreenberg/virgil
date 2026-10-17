"use client";

import type { CutterSuggestionCard as CutterSuggestionCardData } from "@/lib/types";
import type { CardMorphHandler } from "@/cards/types";
import { SuggestionTrailing } from "@/panels/_shared/suggestion-fields";
import type { SuggestionFieldUpdater } from "@/panels/_shared/suggestion-field-vocabulary";
import { SuggestionCard } from "@/panels/_shared/SuggestionCard";

/** Status dot + author chip + status label — the cutter-suggestion header
 *  trailing, shown docked and (via the `toFloatable` factory) in `FloatChrome`. */
export function CutterSuggestionTrailing({
  card,
}: {
  card: CutterSuggestionCardData;
}) {
  return <SuggestionTrailing status={card.status} author={card.author} />;
}

/**
 * The Cutter panel's suggestion card — the `cutter-suggestion` binding of the
 * ONE shared `SuggestionCard` (task 714). Its twin in Revisions is the same
 * component under a different family token; see `SuggestionCard` for why the
 * two stopped being separate transcriptions.
 */
export function CutterSuggestionCard(props: {
  card: CutterSuggestionCardData;
  selected: boolean;
  onUpdateField: SuggestionFieldUpdater;
  /** Morph suggestion ⇄ comment via the kind-chevron. */
  onConvert?: CardMorphHandler;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  return <SuggestionCard {...props} family="cutter-suggestion" />;
}
