import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { UserNote, CutItem, QuotationGroup } from "@/lib/types";
import type { OmniCategory } from "@/panels/Omni";
import { getTextAnchor } from "@/links/links";
import { openForCard } from "../event-bridges/open-for-card";

type AnchorKind = "note" | "revision" | "cut" | null;

/**
 * Gutter-marker click + hover handlers for the four panel kinds that
 * anchor into the text (notes, cuts, todos, quotations).
 *
 * Click semantics (Omni-first):
 *  - Toggle selection (second click deselects). Selecting drives the
 *    linked-anchor highlight (for notes/cuts that carry a text anchor).
 *  - Route to panels the same way as main-text atoms do: prefer Omni,
 *    fall back to the native panel if Omni can't host the kind. See
 *    `openForCard` for details.
 *
 * Hover semantics: drive the transient `hoveredAnchorId` highlight.
 * Quotations don't expose per-marker hover because groups aren't
 * anchored by a single span.
 *
 * Cutter isn't omni-eligible, so its marker click keeps the old
 * "always open native cutter panel" behavior.
 */
export function useMarkerActions(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  setActiveAnchorId: Dispatch<SetStateAction<string | null>>;
  setHoveredAnchorId: Dispatch<SetStateAction<string | null>>;
  setActiveAnchorKind: Dispatch<SetStateAction<AnchorKind>>;
  notes: UserNote[];
  selectedNoteId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  cuts: CutItem[];
  selectedCutId: string | null;
  setSelectedCutId: Dispatch<SetStateAction<string | null>>;
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
    setHoveredAnchorId,
    setActiveAnchorKind,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    cuts,
    selectedCutId,
    setSelectedCutId,
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

  const handleHoverNote = useCallback(
    (noteId: string | null) => {
      if (!noteId) {
        setHoveredAnchorId(null);
        return;
      }
      const note = notes.find((n) => n.id === noteId);
      const anchorId = note ? getTextAnchor(note)?.anchorId : undefined;
      if (anchorId) {
        setHoveredAnchorId(anchorId);
        setActiveAnchorKind("note");
      }
    },
    [notes, setHoveredAnchorId, setActiveAnchorKind],
  );

  const handleCutMarkerClick = useCallback(
    (cutId: string) => {
      const nextSelected = selectedCutId === cutId ? null : cutId;
      setSelectedCutId(nextSelected);
      const cut = cuts.find((c) => c.id === cutId);
      const anchorId = cut ? getTextAnchor(cut)?.anchorId : undefined;
      if (anchorId) {
        if (nextSelected) {
          setActiveAnchorId(anchorId);
          setActiveAnchorKind("cut");
        } else {
          setActiveAnchorId(null);
          setActiveAnchorKind(null);
        }
      }
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "cutter");
      if (placement?.side === "left") {
        if (p.activeLeft !== "cutter") setActiveLeft("cutter");
      } else {
        if (p.activeRight !== "cutter") setActiveRight("cutter");
      }
    },
    [prefsRef, cuts, selectedCutId, setSelectedCutId, setActiveLeft, setActiveRight, setActiveAnchorId, setActiveAnchorKind],
  );

  const handleHoverCut = useCallback(
    (cutId: string | null) => {
      if (!cutId) { setHoveredAnchorId(null); return; }
      const cut = cuts.find((c) => c.id === cutId);
      const anchorId = cut ? getTextAnchor(cut)?.anchorId : undefined;
      if (anchorId) {
        setHoveredAnchorId(anchorId);
        setActiveAnchorKind("cut");
      }
    },
    [cuts, setHoveredAnchorId, setActiveAnchorKind],
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
    handleHoverNote,
    handleCutMarkerClick,
    handleHoverCut,
    handleTodoMarkerClick,
  };
}
