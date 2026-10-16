"use client";

import type { CitationRef } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { resolveAnchorState } from "@/links/anchor-state";
import { CitationCard } from "./CitationCard";
import { citationCardDoors, type CitationDoorSource } from "./citation-card-doors";

interface BuildArgs extends CitationDoorSource {
  citations: CitationRef[];
  citationPositionMap: Map<string, number>;
  selectedCitationId: string | null;
  setSelectedCitationId: (id: string | null) => void;
  scrollToCitation: (id: string, sourceEl?: HTMLElement | null) => void;
  deleteCitation: (id: string) => void;
}

export function buildCitationOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];
  // ONE door list, shared with the floating card (task 1143).
  const doors = citationCardDoors(a);

  for (const cit of a.citations) {
    const pos = a.citationPositionMap.get(cit.id) ?? null;
    const isSelected = a.selectedCitationId === cit.id;
    const id = popKey("citations", cit.id);
    // A citation resolves to its marker pos (anchored) when live. With no live
    // marker it's `free` if the ref carries deliberate-free intent
    // (`unanchored` — e.g. archived-then-unarchived: the `\cite` atom was
    // removed and not re-inserted, so the card is a re-placeable parked ref),
    // else `orphaned` (the marker was genuinely deleted in-text). Task 056.
    items.push({
      id,
      pos,
      anchorState: resolveAnchorState(pos, { unanchored: cit.unanchored }),
      content: (
        <CitationCard
          key={id}
          citation={cit}
          isSelected={isSelected}
          isAnchored={pos !== null}
          {...doors}
          onSelect={() => a.setSelectedCitationId(cit.id)}
          onJump={(sourceEl) => {
            a.setSelectedCitationId(cit.id);
            a.scrollToCitation(cit.id, sourceEl);
          }}
          onDelete={a.deleteCitation}
          extraDataAttrs={{ "data-omni-entry": id }}
        />
      ),
    });
  }

  return items;
}
