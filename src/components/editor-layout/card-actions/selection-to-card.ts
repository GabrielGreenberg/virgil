import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { UserNote, CutItem, QuotationGroup, Suggestion } from "@/lib/types";
import { createLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";
import type { EditorHandle } from "../../Editor";

type AddNote = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => UserNote;
type AddCut = (
  paragraphId: string | null,
  content?: JSONContent,
  anchor?: { anchorId: string; anchorText: string },
) => CutItem;
type AddQuotationGroup = (init?: { text?: string; paragraphId?: string | null }) => QuotationGroup;

/**
 * Toolbar / shortcut actions that turn the live editor selection into a
 * side-panel card.
 *
 * Each handler follows the same shape: read the current selection,
 * bail if empty, create a linked-anchor (when text-range binding is
 * needed), insert the card through its panel hook, set the selected
 * card id, and force-open the target panel on its placement side.
 *
 * `handleAct` is the odd one out — it commits an AI revision/suggestion
 * to the editor when accepted. It lives here because it's the "apply a
 * suggestion" flow invoked from the Suggestions panel's accept button.
 */
export function useSelectionToCardActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  addNote: AddNote;
  addCut: AddCut;
  addQuotationGroup: AddQuotationGroup;
  actOnSuggestion: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  currentSuggestion: Suggestion | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutId: Dispatch<SetStateAction<string | null>>;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
}) {
  const {
    editorRef,
    addNote,
    addCut,
    addQuotationGroup,
    actOnSuggestion,
    currentSuggestion,
    setSelectedNoteId,
    setSelectedCutId,
    setSelectedQuotationGroupId,
    setSelectedFootnoteId,
    prefs,
    setActiveLeft,
    setActiveRight,
  } = deps;

  const handleAct = useCallback(
    (id: string, action: "accepted" | "rejected" | "skipped") => {
      if (action === "accepted" && currentSuggestion && currentSuggestion.id === id) {
        const replacement = currentSuggestion.revision || currentSuggestion.suggested_text;
        editorRef.current?.replaceText(currentSuggestion.original_text, replacement);
      }
      actOnSuggestion(id, action);
    },
    [editorRef, actOnSuggestion, currentSuggestion],
  );

  const handleCreateFootnote = useCallback(() => {
    if (!editorRef.current) return;
    const result = editorRef.current.createFootnoteFromSelection();
    if (!result) return;
    editorRef.current.renumberFootnotes();
    const fnPlacement = prefs.placements.find((p) => p.id === "footnotes");
    if (fnPlacement?.side === "left") {
      if (prefs.activeLeft !== "footnotes") setActiveLeft("footnotes");
    } else {
      if (prefs.activeRight !== "footnotes") setActiveRight("footnotes");
    }
    setSelectedFootnoteId(result.footnoteId);
  }, [editorRef, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight, setSelectedFootnoteId]);

  const handleQuoteSelection = useCallback(() => {
    if (!editorRef.current) return;
    const ed = editorRef.current.getEditor();
    if (!ed) return;
    const { from, to } = ed.state.selection;
    if (from === to) return;
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    const paragraphId = editorRef.current.ensureParagraphUuid(from);
    const group = addQuotationGroup({ text, paragraphId });
    const placement = prefs.placements.find((p) => p.id === "quotations");
    if (placement?.side === "left") {
      if (prefs.activeLeft !== "quotations") setActiveLeft("quotations");
    } else {
      if (prefs.activeRight !== "quotations") setActiveRight("quotations");
    }
    setSelectedQuotationGroupId(group.id);
  }, [editorRef, addQuotationGroup, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight, setSelectedQuotationGroupId]);

  const handleAddNoteFromSelection = useCallback(() => {
    const ed = editorRef.current?.getEditor();
    if (!ed || !editorRef.current) return;
    const { from, to } = ed.state.selection;
    if (from === to) return;
    const paragraphId = editorRef.current.ensureParagraphUuid(from);
    const record = createLinkedAnchor(ed, "note");
    if (!record) return;
    const note = addNote(
      paragraphId,
      undefined,
      { anchorId: record.anchorId, anchorText: record.text },
    );
    updateLinkedAnchorCard(ed, record.anchorId, "note", note.id);
    setSelectedNoteId(note.id);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    const placement = prefs.placements.find((p) => p.id === "notes");
    if (placement?.side === "left") {
      if (prefs.activeLeft !== "notes") setActiveLeft("notes");
    } else {
      if (prefs.activeRight !== "notes") setActiveRight("notes");
    }
  }, [editorRef, addNote, setSelectedNoteId, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  const handleCutSelection = useCallback(() => {
    const ed = editorRef.current?.getEditor();
    if (!ed || !editorRef.current) return;
    const { from, to } = ed.state.selection;
    if (from === to) return;
    const paragraphId = editorRef.current.ensureParagraphUuid(from);
    const record = createLinkedAnchor(ed, "cut");
    if (!record) return;
    const cut = addCut(
      paragraphId,
      undefined,
      { anchorId: record.anchorId, anchorText: record.text },
    );
    updateLinkedAnchorCard(ed, record.anchorId, "cut", cut.id);
    setSelectedCutId(cut.id);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    const placement = prefs.placements.find((p) => p.id === "cutter");
    if (placement?.side === "left") {
      if (prefs.activeLeft !== "cutter") setActiveLeft("cutter");
    } else {
      if (prefs.activeRight !== "cutter") setActiveRight("cutter");
    }
  }, [editorRef, addCut, setSelectedCutId, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  return {
    handleAct,
    handleCreateFootnote,
    handleQuoteSelection,
    handleAddNoteFromSelection,
    handleCutSelection,
  };
}
