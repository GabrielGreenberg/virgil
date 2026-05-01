"use client";

import type { ExampleInfo } from "@/components/Editor";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { ExampleCard } from "./ExampleCard";

interface BuildArgs {
  examples: ExampleInfo[];
  selectedExampleId: string | null;
  setSelectedExampleId: (id: string | null) => void;
  onJump: (id: string) => void;
  onUpdateLatex?: (exampleId: string, latex: string) => boolean;
}

/** Build OmniItems for each example so they surface in the unified
 *  Omni view (sorted by document position alongside notes, footnotes,
 *  citations, quotations, etc). */
export function buildExampleOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];
  for (const ex of a.examples) {
    const isSelected = a.selectedExampleId === ex.exampleId;
    const omniId = popKey("examples", ex.exampleId);
    items.push({
      id: omniId,
      pos: ex.pos,
      content: (
        <ExampleCard
          key={omniId}
          example={ex}
          isSelected={isSelected}
          onSelect={() =>
            a.setSelectedExampleId(isSelected ? null : ex.exampleId)
          }
          onJump={() => a.onJump(ex.exampleId)}
          onUpdateLatex={
            a.onUpdateLatex
              ? (latex) => a.onUpdateLatex!(ex.exampleId, latex)
              : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ),
    });
  }
  return items;
}
