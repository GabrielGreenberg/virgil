"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import BibliographyPanel from "@/panels/Bibliography";
import type { useCitations } from "@/hooks/useCitations";
import type { useAnnotations } from "@/hooks/useAnnotations";
import type { useBibReview } from "@/hooks/useBibReview";
import type { useBibSettings } from "@/hooks/useBibSettings";
import type { Side, ViewPrefs } from "@/hooks/useViewPrefs";
import type { RegistryPrefs, ViewPrefKey } from "@/lib/view-prefs/registry";
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
  replaceBibEntry: CitationsHook["replaceBibEntry"];
  updateBibKeyAndType: CitationsHook["updateBibKeyAndType"];
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
  /** Bug 3: the persisted "Cited only / Full" filter (per-window) + the generic
   *  registry setter that writes it (task 274 — `bibFilter` is a `kind: "enum"`
   *  registry pref, so there is no bespoke `setBibFilter`). Both optional so the
   *  Reader path (no `viewPrefs`) falls back to the panel's own default. */
  bibFilter?: ViewPrefs["bibFilter"];
  setViewPref?: <K extends ViewPrefKey>(key: K, value: RegistryPrefs[K]) => void;
}

export function BibliographyHost(p: BibliographyHostProps) {
  const { editorRef } = useEditorRefContext();
  const { selectedBibKey, setSelectedBibKey } = useSelectionsContext();
  // Bind the panel-local filter control to the registry key ONCE, here — the
  // panel keeps a presentational `onSetBibFilter` prop and the store keeps its
  // one keyed writer. `useCallback` so the panel's memo isn't defeated per
  // render.
  const setViewPref = p.setViewPref;
  const onSetBibFilter = useCallback(
    (v: ViewPrefs["bibFilter"]) => setViewPref?.("bibFilter", v),
    [setViewPref],
  );
  return (
    <BibliographyPanel
      citations={p.citations}
      bibEntries={p.bibEntries}
      selectedBibKey={selectedBibKey}
      onSelectBibKey={setSelectedBibKey}
      onUpdateBibEntry={p.updateBibEntry}
      onReplaceBibEntry={p.replaceBibEntry}
      onUpdateBibKeyAndType={p.updateBibKeyAndType}
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
      bibFilter={p.bibFilter}
      onSetBibFilter={p.setViewPref ? onSetBibFilter : undefined}
    />
  );
}
