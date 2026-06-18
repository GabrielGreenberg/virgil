"use client";

import type { ExampleInfo } from "@/components/Editor";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { ExampleCard } from "./ExampleCard";

interface BuildArgs {
  examples: ExampleInfo[];
  selectedExampleId: string | null;
  setSelectedExampleId: (id: string | null) => void;
  // Carries the clicked card element so the jump can align the block to the
  // card's vertical position (EX-F3-03). ExampleCard supplies a `sourceEl`;
  // dropping it forced scrollToExample down its no-source center-scroll
  // fallback (unlike the docked panel, which already threads it).
  onJump: (id: string, sourceEl?: HTMLElement | null) => void;
}

/** Build OmniItems for each example so they surface in the unified
 *  Omni view (sorted by document position alongside notes, footnotes,
 *  citations, reports, etc). */
export function buildExampleOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];
  for (const ex of a.examples) {
    const isSelected = a.selectedExampleId === ex.exampleId;
    const omniId = popKey("examples", ex.exampleId);
    // An example is an in-text block: it either resolves to its block pos
    // (anchored) or the block is gone (orphaned). Never "free".
    items.push({
      id: omniId,
      pos: ex.pos,
      anchorState: ex.pos == null ? "orphaned" : "anchored",
      content: (
        <ExampleCard
          key={omniId}
          example={ex}
          isSelected={isSelected}
          onSelect={() => a.setSelectedExampleId(ex.exampleId)}
          onJump={(sourceEl) => a.onJump(ex.exampleId, sourceEl)}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ),
    });
  }
  return items;
}
