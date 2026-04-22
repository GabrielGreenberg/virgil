"use client";

import type { JSONContent } from "@tiptap/react";
import CutterPanel from "@/panels/Cutter";
import type { CutItem } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";

export interface CutterHostProps {
  side: Side;
  panelSide: Side | null;
  cuts: CutItem[];
  addCut: (paragraphId: string | null) => CutItem;
  updateCut: (id: string, content: JSONContent) => void;
  updateCutTitle: (id: string, title: string) => void;
  deleteCut: (id: string) => void;
  onHoverCut: (id: string | null) => void;
  onDropSelection: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph: (paragraphId: string) => void;
}

export function CutterHost(p: CutterHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedCutId, setSelectedCutId } = useSelectionsContext();
  return (
    <CutterPanel
      cuts={p.cuts}
      onAdd={() => p.addCut(null)}
      onUpdate={p.updateCut}
      onUpdateTitle={p.updateCutTitle}
      onDelete={p.deleteCut}
      onSelect={setSelectedCutId}
      selectedId={selectedCutId}
      onJumpToCard={(cut) => editorRef.current?.jumpToCard(cut)}
      onHoverCut={p.onHoverCut}
      onDropSelection={p.onDropSelection}
      onDropParagraph={p.onDropParagraph}
      editor={editorInstance}
      panelSide={p.panelSide ?? p.side}
      viewMode={getPanelViewMode("cutter")}
      onViewModeChange={(m) => setPanelViewMode("cutter", m)}
    />
  );
}
