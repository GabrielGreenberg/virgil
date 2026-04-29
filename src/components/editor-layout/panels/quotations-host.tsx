"use client";

import QuotationsPanel from "@/panels/Quotations";
import type { useQuotations } from "@/hooks/useQuotations";
import type { useCitations } from "@/hooks/useCitations";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

type QuotationsHook = ReturnType<typeof useQuotations>;
type CitationsHook = ReturnType<typeof useCitations>;

export interface QuotationsHostProps {
  side: Side;
  quotationGroups: QuotationsHook["groups"];
  bibEntries: CitationsHook["bibEntries"];
  bibPackage: CitationsHook["bibPackage"];
  citationStyle: CitationsHook["citationStyle"];
  addQuotationGroup: QuotationsHook["addGroup"];
  deleteQuotationGroup: QuotationsHook["deleteGroup"];
  updateQuotationGroupTitle: QuotationsHook["updateGroupTitle"];
  addQuotationReference: QuotationsHook["addReference"];
  deleteQuotationReference: QuotationsHook["deleteReference"];
  updateQuotationReferenceCiteKey: QuotationsHook["updateReferenceCiteKey"];
  addQuotationQuote: QuotationsHook["addQuote"];
  updateQuotationQuote: QuotationsHook["updateQuote"];
  deleteQuotationQuote: QuotationsHook["deleteQuote"];
  updateQuotationNotes: QuotationsHook["updateNotes"];
}

export function QuotationsHost(p: QuotationsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedQuotationGroupId, setSelectedQuotationGroupId } = useSelectionsContext();
  const { aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { createQuotation } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("quotation");
  return (
    <QuotationsPanel
      groups={p.quotationGroups}
      bibEntries={p.bibEntries}
      bibPackage={p.bibPackage}
      citationStyle={p.citationStyle}
      onAddGroup={() => createQuotation({})}
      onDeleteGroup={p.deleteQuotationGroup}
      onUpdateGroupTitle={p.updateQuotationGroupTitle}
      onAddReference={p.addQuotationReference}
      onDeleteReference={p.deleteQuotationReference}
      onUpdateReferenceCiteKey={p.updateQuotationReferenceCiteKey}
      onAddQuote={p.addQuotationQuote}
      onUpdateQuote={p.updateQuotationQuote}
      onDeleteQuote={p.deleteQuotationQuote}
      onUpdateNotes={p.updateQuotationNotes}
      selectedGroupId={selectedQuotationGroupId}
      onSelectGroup={setSelectedQuotationGroupId}
      onJumpToCard={(group) => editorRef.current?.jumpToCard(group)}
      aiRequests={aiRequests}
      onAddAiRequest={() => addAiRequest("quotation")}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      editor={editorInstance}
      panelSide={p.side}
      viewMode={getPanelViewMode("quotations")}
      onViewModeChange={(m) => setPanelViewMode("quotations", m)}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
