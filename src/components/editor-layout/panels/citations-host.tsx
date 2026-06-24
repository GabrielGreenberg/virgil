"use client";

import { type Dispatch, type SetStateAction, useMemo } from "react";
import CitationsPanel from "@/panels/Citations";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { Side } from "@/hooks/useViewPrefs";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { buildNestedFootnoteInfoMap } from "./nest-footnote-children";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
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
  addBibEntry: CitationsHook["addBibEntry"];
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
  const { editorRef, editorInstance } = useEditorRefContext();
  const { selectedCitationId, setSelectedCitationId } = useSelectionsContext();
  const { getCitationDisplayText } = useCitationDisplayContext();
  const { createCitation } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("citation");

  // Part B — footnote-child nesting on the DOCKED surface. Derive the
  // `citationId → { footnoteId, footnoteNumber }` map from the
  // DocStructureObserver snapshot (`structure.citations[].nestedInFootnoteId`,
  // already in the snapshot — no doc walk). Gated on `[editorInstance,
  // rev.citations]`: runs once the editor mounts (the counter is silent on
  // load, so the editor dep triggers the first derive) and re-runs only when
  // citations / footnote-bodies change — NEVER on a plain keystroke, so
  // `__virgilBusStats().emitCount` stays flat while typing (keystroke sanctity;
  // mirrors the omni-host derivation exactly).
  const rev = useStructuralRevisions(editorInstance);
  const nestedFootnoteOf = useMemo(() => {
    if (!editorInstance) return undefined;
    const bus = getBus(editorInstance);
    if (!bus) return undefined;
    return buildNestedFootnoteInfoMap(bus.structure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance, rev.citations]);

  // CHIP 4a-ii: the `virgil-citation-create` listener that registered the card
  // for slash/typed `\cite` is GONE. The slash command + typed input rules now
  // insert the atom synchronously and register the card through the
  // action-registry bridge (`runAction("citation", …)` → `citation.run`),
  // which calls this SAME `createCitation({ unanchored: false, mode: "omni" })`
  // + soft-route + `focusNewCard`. `createCitation` stays in use below for the
  // panel "+ Add citation" draft (`onCreateCitation`).

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
      getFormattedBib={p.getFormattedBib}
      getAnnotation={p.getAnnotation}
      setAnnotation={p.setAnnotation}
      onRequestReview={p.requestBibReview}
      onCancelReview={p.cancelBibReview}
      getReviewStatus={p.getBibReviewStatus}
      onUpdateBibEntry={p.updateBibEntry}
      onUpdateBibKeyAndType={p.updateBibKeyAndType}
      onAddBibEntry={p.addBibEntry}
      recentlyAddedId={recentlyAddedId}
      nestedFootnoteOf={nestedFootnoteOf}
    />
  );
}
