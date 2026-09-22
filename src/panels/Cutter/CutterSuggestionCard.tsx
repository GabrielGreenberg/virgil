"use client";

import type { CutterSuggestionCard as CutterSuggestionCardData } from "@/lib/types";
import {
  CopyButton,
  FieldTitleRow,
  SuggestionTrailing,
  type SuggestionField,
} from "@/panels/_shared/suggestion-fields";
import { SuggestionCard } from "@/panels/_shared/SuggestionCard";

// Re-exported for backward compatibility — these now live in the shared
// suggestion-fields module (CutterCommentCard imports them from here, and the
// Cutter barrel re-exports them).
export { CopyButton, FieldTitleRow };

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
  onUpdateField: (id: string, field: SuggestionField, value: string) => void;
  /** Morph suggestion ⇄ comment via the kind-chevron. */
  onConvert?: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  return <SuggestionCard {...props} family="cutter-suggestion" />;
}
