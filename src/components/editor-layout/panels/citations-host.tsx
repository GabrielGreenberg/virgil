"use client";

import type { Dispatch, SetStateAction } from "react";
import CitationsPanel from "@/panels/Citations";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

type CitationsHook = ReturnType<typeof useCitations>;
type AnnotationsHook = ReturnType<typeof useAnnotations>;
type BibReviewHook = ReturnType<typeof useBibReview>;

type CitationMode = "anchored" | "unanchored";

export interface CitationsHostProps {
  side: Side;
  citations: CitationsHook["citations"];
  bibEntries: CitationsHook["bibEntries"];
  citationStyle: CitationsHook["citationStyle"];
  bibPackage: CitationsHook["bibPackage"];
  bibPath: CitationsHook["bibPath"];
  citationOrder: string[];
  addCitation: CitationsHook["addCitation"];
  updateCitation: CitationsHook["updateCitation"];
  deleteCitation: CitationsHook["deleteCitation"];
  setCitationStyle: CitationsHook["setStyle"];
  setBibPackage: CitationsHook["setBibPackage"];
  updateBibEntry: CitationsHook["updateBibEntry"];
  updateBibKeyAndType: CitationsHook["updateBibKeyAndType"];
  getFormattedBib: CitationsHook["getFormattedBib"];
  getAnnotation: AnnotationsHook["getAnnotation"];
  setAnnotation: AnnotationsHook["setAnnotation"];
  requestBibReview: BibReviewHook["requestReview"];
  cancelBibReview: BibReviewHook["cancelRequest"];
  getBibReviewStatus: BibReviewHook["getRequestStatus"];
  citationPositionMap: Map<string, number>;
  pendingCitationCreate: string | null;
  setPendingCitationCreate: Dispatch<SetStateAction<string | null>>;
  pendingCitationMode: CitationMode;
  setPendingCitationMode: Dispatch<SetStateAction<CitationMode>>;
}

export function CitationsHost(p: CitationsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedCitationId, setSelectedCitationId } = useSelectionsContext();
  const { aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { getCitationDisplayText } = useCitationDisplayContext();
  const { createCitation } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("citation");
  return (
    <CitationsPanel
      citations={p.citations}
      bibEntries={p.bibEntries}
      citationStyle={p.citationStyle}
      bibPackage={p.bibPackage}
      bibPath={p.bibPath}
      selectedId={selectedCitationId}
      citationOrder={p.citationOrder}
      onSelect={setSelectedCitationId}
      onScrollToMarker={(id, sourceEl) => editorRef.current?.scrollToCitation(id, sourceEl)}
      onUpdateCitation={p.updateCitation}
      onDeleteCitation={p.deleteCitation}
      onSetStyle={p.setCitationStyle}
      onSetBibPackage={p.setBibPackage}
      getDisplayText={getCitationDisplayText}
      pendingCreate={p.pendingCitationCreate}
      pendingCreateMode={p.pendingCitationMode}
      onCreateCitation={(cmd) => {
        const ref = createCitation({
          command: cmd,
          unanchored: p.pendingCitationMode === "unanchored",
        });
        return ref.id;
      }}
      onInsertCitation={(cmd, citId, display) => {
        editorRef.current?.insertCitation(cmd, citId, display);
      }}
      onClearPendingCreate={() => p.setPendingCitationCreate(null)}
      onStartCreate={() => {
        p.setPendingCitationMode("unanchored");
        p.setPendingCitationCreate("\\cite");
      }}
      editor={editorInstance}
      panelSide={p.side}
      citationPositions={p.citationPositionMap}
      viewMode={getPanelViewMode("citations")}
      onViewModeChange={(m) => setPanelViewMode("citations", m)}
      getFormattedBib={p.getFormattedBib}
      getAnnotation={p.getAnnotation}
      setAnnotation={p.setAnnotation}
      onRequestReview={p.requestBibReview}
      onCancelReview={p.cancelBibReview}
      getReviewStatus={p.getBibReviewStatus}
      onUpdateBibEntry={p.updateBibEntry}
      onUpdateBibKeyAndType={p.updateBibKeyAndType}
      aiRequests={aiRequests}
      onAddAiRequest={() => addAiRequest("citation")}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
