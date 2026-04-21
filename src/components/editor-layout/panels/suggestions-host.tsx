"use client";

import SuggestionPanel from "@/panels/Suggestions";
import type { PanelId, Side } from "@/hooks/useViewPrefs";
import type { Suggestion } from "@/lib/types";

export interface SuggestionsHostProps {
  side: Side;
  currentSuggestion: Suggestion | null;
  isComplete: boolean;
  onAct: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  updateSuggestionField: (id: string, field: "revision" | "note", value: string) => void;
  clearSuggestions: () => void;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
}

export function SuggestionsHost(p: SuggestionsHostProps) {
  return (
    <SuggestionPanel
      suggestion={p.currentSuggestion}
      isComplete={p.isComplete}
      onAct={p.onAct}
      onUpdateField={p.updateSuggestionField}
      onClose={() => {
        if (p.side === "left") p.setActiveLeft("blank");
        else p.setActiveRight("blank");
        p.clearSuggestions();
      }}
      visible={true}
    />
  );
}
