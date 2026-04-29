import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { UserNote, CutterCard, QuotationGroup } from "@/lib/types";
import type { OmniCategory } from "@/panels/Omni";
import { getTextAnchor } from "@/links/links";
import { openForCard } from "../event-bridges/open-for-card";

type AnchorKind = "note" | "revision" | "cutter-comment" | "cutter-suggestion" | null;

/**
 * Gutter-marker click handlers for the four panel kinds that anchor into
 * the text (notes, cuts, todos, quotations).
 *
 * Click semantics (Omni-first): toggle selection (second click deselects).
 * Selecting drives the linked-anchor highlight (for kinds that carry a
 * Mode B anchor). Routing always goes through `openForCard`, which decides
 * Omni vs. native panel and aligns the card to `clickY`.
 *
 * Hover is **not** wired here — it's centralized through the
 * `setHoveredEntity` callback used by every marker's generic `onHover`.
 */
export function useMarkerActions(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  setActiveAnchorId: Dispatch<SetStateAction<string | null>>;
  setActiveAnchorKind: Dispatch<SetStateAction<AnchorKind>>;
  notes: UserNote[];
  selectedNoteId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  cutterCards: CutterCard[];
  selectedCutterCardId: string | null;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  selectedTodoId: string | null;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
  quotationGroups: QuotationGroup[];
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setActiveAnchorId,
    setActiveAnchorKind,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    cutterCards,
    selectedCutterCardId,
    setSelectedCutterCardId,
    selectedTodoId,
    setSelectedTodoId,
    setSelectedQuotationGroupId,
  } = deps;

  const handleQuotationMarkerClick = useCallback(
    (groupId: string, clickY?: number) => {
      setSelectedQuotationGroupId(groupId);
      openForCard(
        {
          omniKey: `quotation:${groupId}`,
          entrySelector: `[data-quotation-group-id="${groupId}"]`,
          panelId: "quotations",
          cardKind: "quotation",
          targetY: clickY,
        },
        {
          prefs: prefsRef.current,
          setActiveLeft,
          setActiveRight,
          setActiveHalf,
          tryScrollOmniEntry,
          getOmniEnabled,
        },
      );
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedQuotationGroupId],
  );

  const handleNoteMarkerClick = useCallback(
    (noteId: string, clickY?: number) => {
      const nextSelected = selectedNoteId === noteId ? null : noteId;
      setSelectedNoteId(nextSelected);
      const note = notes.find((n) => n.id === noteId);
      const anchorId = note ? getTextAnchor(note)?.anchorId : undefined;
      if (anchorId) {
        if (nextSelected) {
          setActiveAnchorId(anchorId);
          setActiveAnchorKind("note");
        } else {
          setActiveAnchorId(null);
          setActiveAnchorKind(null);
        }
      }
      if (!nextSelected) return;
      openForCard(
        {
          omniKey: `note:${noteId}`,
          entrySelector: `[data-note-entry="${noteId}"]`,
          panelId: "notes",
          cardKind: "note",
          targetY: clickY,
        },
        {
          prefs: prefsRef.current,
          setActiveLeft,
          setActiveRight,
          setActiveHalf,
          tryScrollOmniEntry,
          getOmniEnabled,
        },
      );
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, selectedNoteId, setSelectedNoteId, notes, tryScrollOmniEntry, getOmniEnabled, setActiveAnchorId, setActiveAnchorKind],
  );

  const handleCutMarkerClick = useCallback(
    (cardId: string, clickY?: number) => {
      const nextSelected = selectedCutterCardId === cardId ? null : cardId;
      setSelectedCutterCardId(nextSelected);
      const card = cutterCards.find((c) => c.id === cardId);
      const anchorId = card ? getTextAnchor(card)?.anchorId : undefined;
      const kind: AnchorKind =
        card?.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
      if (anchorId) {
        if (nextSelected) {
          setActiveAnchorId(anchorId);
          setActiveAnchorKind(kind);
        } else {
          setActiveAnchorId(null);
          setActiveAnchorKind(null);
        }
      }
      if (!nextSelected) return;
      // Cutter isn't omni-eligible, so openForCard falls through to the
      // native panel. clickY still flows through for vertical alignment.
      openForCard(
        {
          omniKey: `${kind}:${cardId}`,
          entrySelector: `[data-card-key="${kind}:${cardId}"]`,
          panelId: "cutter",
          cardKind: kind,
          targetY: clickY,
        },
        {
          prefs: prefsRef.current,
          setActiveLeft,
          setActiveRight,
          setActiveHalf,
          tryScrollOmniEntry,
          getOmniEnabled,
        },
      );
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, cutterCards, selectedCutterCardId, setSelectedCutterCardId, tryScrollOmniEntry, getOmniEnabled, setActiveAnchorId, setActiveAnchorKind],
  );

  const handleTodoMarkerClick = useCallback(
    (todoId: string, clickY?: number) => {
      const nextSelected = selectedTodoId === todoId ? null : todoId;
      setSelectedTodoId(nextSelected);
      if (!nextSelected) return;
      openForCard(
        {
          omniKey: `todo:${todoId}`,
          entrySelector: `[data-todo-entry="${todoId}"]`,
          panelId: "todo",
          cardKind: "todo",
          targetY: clickY,
        },
        {
          prefs: prefsRef.current,
          setActiveLeft,
          setActiveRight,
          setActiveHalf,
          tryScrollOmniEntry,
          getOmniEnabled,
        },
      );
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, selectedTodoId, setSelectedTodoId, tryScrollOmniEntry, getOmniEnabled],
  );

  return {
    handleQuotationMarkerClick,
    handleNoteMarkerClick,
    handleCutMarkerClick,
    handleTodoMarkerClick,
  };
}
