"use client";

import type { LatexError } from "@/lib/latex-errors";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { ErrorCard, errorTitle } from "./ErrorCard";

interface BuildArgs {
  errors: LatexError[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Maps `err.id` → paragraph anchor uuid (when the error's source line
   *  was resolved to a paragraph). Used to look up the omni item's `pos`. */
  paragraphByErrorId: Map<string, string>;
  /** Source-snippet preview, keyed by `err.id`. */
  snippets: Map<string, string>;
  anchoredIds: Set<string>;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  onJump: (err: LatexError) => void;
  findParagraphPos: (uuid: string | null) => number | null;
}

/** Build OmniItems for LaTeX errors. Anchors errors whose source line
 *  resolved to a paragraph; surfaces the rest as unanchored. Dismissed
 *  errors are skipped (matches ErrorsPanel's visibility filter). */
export function buildErrorOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const err of a.errors) {
    if (a.dismissedIds.has(err.id)) continue;
    const isSelected = a.selectedId === err.id;
    const omniId = cardPopKey("error", err.id);
    const paraId = a.paragraphByErrorId.get(err.id) ?? null;
    const pos = a.findParagraphPos(paraId);

    items.push({
      id: omniId,
      pos,
      content: (
        <div data-omni-entry={omniId}>
          <ErrorCard
            key={omniId}
            err={err}
            title={errorTitle(err)}
            snippet={a.snippets.get(err.id)}
            selected={isSelected}
            hasAnchor={a.anchoredIds.has(err.id)}
            onSelect={a.setSelectedId}
            onJump={() => a.onJump(err)}
            onDismiss={a.onDismiss}
          />
        </div>
      ),
    });
  }

  return items;
}
