"use client";

import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";

/**
 * "Which card is selected" state — one slot per panel kind that has a
 * selection concept. Consumed by panel hosts for highlighting and by
 * `openItemInPanel` for cross-panel navigation from Search.
 *
 * Citation and bibliography selections share the same underlying item
 * catalog (bib entries) but track independently, so each panel has its
 * own pair.
 */
export interface SelectionsContextValue {
  selectedNoteId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  selectedFootnoteId: string | null;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  selectedCitationId: string | null;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  selectedTodoId: string | null;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  selectedArchiveId: string | null;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  selectedCutterCardId: string | null;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  selectedQuotationGroupId: string | null;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
  selectedCommentId: string | null;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  selectedBibKey: string | null;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
  selectedExampleId: string | null;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;
}

const SelectionsCtx = createContext<SelectionsContextValue | null>(null);

export function SelectionsProvider({
  value,
  children,
}: {
  value: SelectionsContextValue;
  children: ReactNode;
}) {
  return <SelectionsCtx.Provider value={value}>{children}</SelectionsCtx.Provider>;
}

export function useSelectionsContext(): SelectionsContextValue {
  const v = useContext(SelectionsCtx);
  if (!v) throw new Error("useSelectionsContext must be used inside SelectionsProvider");
  return v;
}
