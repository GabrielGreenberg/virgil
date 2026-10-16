import type { BibEntry } from "@/lib/types";
import type { BibEntrySave } from "@/hooks/useCitations";
import type { CitationCardProps } from "./CitationCard";

/**
 * The bib-side DOORS a `CitationCard` needs — everything it writes through or
 * reads from the paper's bibliography, as opposed to its per-card props
 * (citation, selection, jump, wrapper chrome).
 *
 * Three production surfaces mount the card: the docked Citations panel, the
 * floating card, and the Omni panel. Each used to spell the door list out by
 * hand, and the lists drifted — the Omni build silently left out
 * `onAddBibEntry`, so picking a library-only entry there wrote the key into
 * `\cite{}` and never added the entry to references.bib (task 1143). Here every
 * door is REQUIRED (a surface that genuinely cannot add says so with `null`),
 * and the two surfaces that read hook-shaped names build theirs through ONE
 * mapper, `citationCardDoors`, so a door added to the card is a compile error
 * at every surface rather than a quiet gap at one.
 */
export type CitationCardDoors = Required<
  Pick<
    CitationCardProps,
    | "bibEntries"
    | "bibPackage"
    | "getDisplayText"
    | "onUpdateCitation"
    | "onAddBibEntry"
    | "getFormattedBib"
    | "getAnnotation"
    | "setAnnotation"
    | "onRequestReview"
    | "onCancelReview"
    | "getReviewStatus"
    | "onSaveBibEntry"
  >
> & {
  /** Present-but-possibly-undefined: a host without stored request notes. */
  getReviewNotes: CitationCardProps["getReviewNotes"];
};

/** The same doors under the hook-side names the floating-card ctx and the Omni
 *  builder carry. `getBibReviewNotes` is the one door a host may lack (the
 *  card renders no stored request notes without it). */
export interface CitationDoorSource {
  bibEntries: BibEntry[];
  bibPackage: string;
  getCitationDisplayText: (command: string) => string;
  updateCitation: (id: string, command: string) => void;
  addBibEntry: ((entry: BibEntry) => void) | null;
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
  getBibReviewNotes?: (bibKey: string, type: "fields" | "notes") => string | undefined;
  saveBibEntry: (entry: BibEntry, patch: BibEntrySave) => void;
}

export function citationCardDoors(s: CitationDoorSource): CitationCardDoors {
  return {
    bibEntries: s.bibEntries,
    bibPackage: s.bibPackage,
    getDisplayText: s.getCitationDisplayText,
    onUpdateCitation: s.updateCitation,
    onAddBibEntry: s.addBibEntry,
    getFormattedBib: s.getFormattedBib,
    getAnnotation: s.getAnnotation,
    setAnnotation: s.setAnnotation,
    onRequestReview: s.requestBibReview,
    onCancelReview: s.cancelBibReview,
    getReviewStatus: s.getBibReviewStatus,
    getReviewNotes: s.getBibReviewNotes,
    onSaveBibEntry: s.saveBibEntry,
  };
}
