"use client";

import type { RevisionSuggestionCard as RevisionSuggestionCardData } from "@/lib/types";
import type { CardMorphHandler } from "@/cards/types";
import { SuggestionTrailing, type SuggestionField } from "@/panels/_shared/suggestion-fields";
import { SuggestionCard } from "@/panels/_shared/SuggestionCard";

/** Status dot + author chip + status label — the revision-suggestion header
 *  trailing, shown docked and (via the `toFloatable` factory) in `FloatChrome`. */
export function RevisionSuggestionTrailing({
  card,
}: {
  card: RevisionSuggestionCardData;
}) {
  return <SuggestionTrailing status={card.status} author={card.author} />;
}

/**
 * The Revisions panel's suggestion card — the `revision-suggestion` binding of
 * the ONE shared `SuggestionCard` (task 714).
 *
 * This file used to be a hand transcription of `CutterSuggestionCard`, and the
 * transcription is what broke: task 488 shipped a RICH capture of the quoted
 * passage so an "Original" could render a citation or an `\emph{…}` as prose,
 * and this copy never asked for it on any of its four surfaces — so every quoted
 * passage in Revisions read as raw source while the identical Cutter card read
 * as prose. That was the third twin-divergence filed on the pair. The body,
 * chrome and every per-family facet now live in one component that DERIVES them
 * from `CARD_REGISTRY[family]`, so the two panels cannot answer differently
 * again. What is left here is the name its mount sites, the float factory and
 * the panel barrel import.
 */
export function RevisionSuggestionCard(props: {
  card: RevisionSuggestionCardData;
  selected: boolean;
  onUpdateField: (id: string, field: SuggestionField, value: string) => void;
  onConvert?: CardMorphHandler;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  return <SuggestionCard {...props} family="revision-suggestion" />;
}
