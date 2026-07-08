"use client";

import type { BibEntry, CitationRef } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { resolveAnchorState } from "@/links/anchor-state";
import { CitationCard } from "./CitationCard";

interface BuildArgs {
  citations: CitationRef[];
  citationPositionMap: Map<string, number>;
  selectedCitationId: string | null;
  setSelectedCitationId: (id: string | null) => void;
  scrollToCitation: (id: string, sourceEl?: HTMLElement | null) => void;
  bibEntries: BibEntry[];
  bibPackage: string;
  getCitationDisplayText: (command: string) => string;
  updateCitation: (id: string, command: string) => void;
  deleteCitation: (id: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  requestBibReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  getBibReviewStatus: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  updateBibEntry: (key: string, fields: Record<string, string>) => void;
  updateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
}

export function buildCitationOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

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
          bibEntries={a.bibEntries}
          bibPackage={a.bibPackage}
          getDisplayText={a.getCitationDisplayText}
          onSelect={() => a.setSelectedCitationId(cit.id)}
          onJump={(sourceEl) => {
            a.setSelectedCitationId(cit.id);
            a.scrollToCitation(cit.id, sourceEl);
          }}
          onUpdateCitation={a.updateCitation}
          onDelete={a.deleteCitation}
          getFormattedBib={a.getFormattedBib}
          getAnnotation={a.getAnnotation}
          setAnnotation={a.setAnnotation}
          onRequestReview={a.requestBibReview}
          onCancelReview={a.cancelBibReview}
          getReviewStatus={a.getBibReviewStatus}
          onUpdateBibEntry={a.updateBibEntry}
          onUpdateBibKeyAndType={a.updateBibKeyAndType}
          extraDataAttrs={{ "data-omni-entry": id }}
        />
      ),
    });
  }

  return items;
}
