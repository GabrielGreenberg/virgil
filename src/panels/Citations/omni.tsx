"use client";

import type { BibEntry, CitationRef } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
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
    // A citation is intrinsically an in-text \cite reference, so it's never
    // "free": it either resolves to its marker pos (anchored) or its marker
    // is missing from the doc (orphaned).
    items.push({
      id,
      pos,
      anchorState: pos == null ? "orphaned" : "anchored",
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
