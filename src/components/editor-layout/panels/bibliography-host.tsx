"use client";

import type { Dispatch, SetStateAction } from "react";
import BibliographyPanel from "@/panels/Bibliography";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { useBibSettings } from "@/hooks/useBibSettings";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";

type CitationsHook = ReturnType<typeof useCitations>;
type AnnotationsHook = ReturnType<typeof useAnnotations>;
type BibReviewHook = ReturnType<typeof useBibReview>;
type BibSettingsHook = ReturnType<typeof useBibSettings>;

export interface BibliographyHostProps {
  side: Side;
  panelSide: Side | null;
  citations: CitationsHook["citations"];
  bibEntries: CitationsHook["bibEntries"];
  bibPackage: CitationsHook["bibPackage"];
  addBibEntry: CitationsHook["addBibEntry"];
  updateBibEntry: CitationsHook["updateBibEntry"];
  updateBibKeyAndType: CitationsHook["updateBibKeyAndType"];
  getFormattedBib: CitationsHook["getFormattedBib"];
  getAnnotation: AnnotationsHook["getAnnotation"];
  setAnnotation: AnnotationsHook["setAnnotation"];
  requestBibReview: BibReviewHook["requestReview"];
  cancelBibReview: BibReviewHook["cancelRequest"];
  getBibReviewStatus: BibReviewHook["getRequestStatus"];
  allEditorCitations: Array<{ citationId: string; command: string; keys: string[]; pos: number }>;
  citationPositionMap: Map<string, number>;
  setBibActiveCitationId: Dispatch<SetStateAction<string | null>>;
  currentDocId: string | null;
  entryRequests: BibSettingsHook["entryRequests"];
  addEntryRequest: BibSettingsHook["addEntryRequest"];
  removeEntryRequest: BibSettingsHook["removeEntryRequest"];
}

export function BibliographyHost(p: BibliographyHostProps) {
  const { editorRef } = useEditorRefContext();
  const { selectedBibKey, setSelectedBibKey } = useSelectionsContext();
  return (
    <BibliographyPanel
      citations={p.citations}
      bibEntries={p.bibEntries}
      selectedBibKey={selectedBibKey}
      onSelectBibKey={setSelectedBibKey}
      onUpdateBibEntry={p.updateBibEntry}
      onUpdateBibKeyAndType={p.updateBibKeyAndType}
      getFormattedBib={p.getFormattedBib}
      getAnnotation={p.getAnnotation}
      setAnnotation={p.setAnnotation}
      onRequestReview={p.requestBibReview}
      onCancelReview={p.cancelBibReview}
      getReviewStatus={p.getBibReviewStatus}
      allEditorCitations={p.allEditorCitations}
      onScrollToCitation={(id, sourceEl) => editorRef.current?.scrollToCitation(id, sourceEl)}
      onActiveCitationChange={p.setBibActiveCitationId}
      bibPackage={p.bibPackage}
      onAddBibEntry={p.addBibEntry}
      docId={p.currentDocId}
      entryRequests={p.entryRequests}
      onAddEntryRequest={p.addEntryRequest}
      onRemoveEntryRequest={p.removeEntryRequest}
    />
  );
}
