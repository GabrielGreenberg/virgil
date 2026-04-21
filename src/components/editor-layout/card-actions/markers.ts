import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { UserNote, CutItem, QuotationGroup } from "@/lib/types";
import { getTextAnchor } from "@/links/links";

type AnchorKind = "note" | "revision" | "cut" | null;

/**
 * Gutter-marker click + hover handlers for the four panel kinds that
 * anchor into the text (notes, cuts, todos, quotations).
 *
 * Click semantics (OmniView as a mode):
 * - Toggle selection (second click deselects). Selecting drives the
 *   linked-anchor highlight (for notes/cuts that carry a text anchor).
 * - If OmniView hosts the card, scroll there.
 * - Only force-open the native panel when neither OmniView nor the
 *   native panel is already showing.
 *
 * Hover semantics: drive the transient `hoveredAnchorId` highlight.
 * Quotations don't expose per-marker hover because groups aren't
 * anchored by a single span.
 *
 * Note and Cut use identical structure; todo is simpler (no anchor).
 */
export function useMarkerActions(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
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
    tryScrollOmniEntry,
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
    (groupId: string) => {
      setSelectedQuotationGroupId(groupId);
      const omniHit = tryScrollOmniEntry(`quotation:${groupId}`);
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "quotations");
      const side = placement?.side ?? "left";
      const active = side === "left" ? p.activeLeft === "quotations" : p.activeRight === "quotations";
      if (!omniHit && !active) {
        if (side === "left") setActiveLeft("quotations");
        else setActiveRight("quotations");
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, setSelectedQuotationGroupId],
  );

  const handleNoteMarkerClick = useCallback(
    (noteId: string) => {
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
      const omniHit = nextSelected ? tryScrollOmniEntry(`note:${noteId}`) : false;
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "notes");
      const side = placement?.side ?? "right";
      const active = side === "left" ? p.activeLeft === "notes" : p.activeRight === "notes";
      if (nextSelected && !omniHit && !active) {
        if (side === "left") setActiveLeft("notes");
        else setActiveRight("notes");
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, selectedNoteId, setSelectedNoteId, notes, tryScrollOmniEntry, setActiveAnchorId, setActiveAnchorKind],
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
    (todoId: string) => {
      const nextSelected = selectedTodoId === todoId ? null : todoId;
      setSelectedTodoId(nextSelected);
      const omniHit = nextSelected ? tryScrollOmniEntry(`todo:${todoId}`) : false;
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "todo");
      const side = placement?.side ?? "right";
      const active = side === "left" ? p.activeLeft === "todo" : p.activeRight === "todo";
      if (nextSelected && !omniHit && !active) {
        if (side === "left") setActiveLeft("todo");
        else setActiveRight("todo");
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, selectedTodoId, setSelectedTodoId, tryScrollOmniEntry],
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
