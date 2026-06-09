import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { UserNote, CutterCard } from "@/lib/types";
import type { OmniCategory } from "@/panels/Omni";
import { getTextAnchor } from "@/links/links";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";
import { openForCard } from "../event-bridges/open-for-card";
import { cardPopKey } from "@/panels/panel-registry";

type AnchorKind = "note" | "highlight" | "revision" | "cutter-comment" | "cutter-suggestion" | "report" | "report-request" | null;

/**
 * Gutter-marker click handlers for the panel kinds that anchor into
 * the text (notes, cuts, todos).
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
  /** Pulls the omni card to align with the click instead of scrolling
   *  the document. The marker → omni-key prefixes differ for some kinds
   *  (cut → cutter-comment); each handler resolves the
   *  marker DOM via `[data-marginalia-marker="${markerKind}:${id}"]`. */
  alignOmniCardWithClick: (cardId: string, clickY: number, sourceEl: HTMLElement | null) => void;
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
    alignOmniCardWithClick,
  } = deps;

  const handleNoteMarkerClick = useCallback(
    (noteId: string, clickY?: number) => {
      const nextSelected = selectedNoteId === noteId ? null : noteId;
      // Gutter click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row).
      suppressNextPlacement();
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
          skipScroll: true,
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
      if (typeof clickY === "number") {
        const sourceEl = document.querySelector(
          `[data-marginalia-marker^="note:${noteId}:"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF if the panel column
        // hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(`note:${noteId}`, clickY, sourceEl);
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, selectedNoteId, setSelectedNoteId, notes, tryScrollOmniEntry, getOmniEnabled, setActiveAnchorId, setActiveAnchorKind, alignOmniCardWithClick],
  );

  const handleCutMarkerClick = useCallback(
    (cardId: string, clickY?: number) => {
      const nextSelected = selectedCutterCardId === cardId ? null : cardId;
      // Gutter click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row).
      suppressNextPlacement();
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
      // native panel. alignOmniCardWithClick no-ops if the omni wrapper
      // doesn't exist, so the native panel handles its own scrolling.
      openForCard(
        {
          omniKey: `${kind}:${cardId}`,
          entrySelector: `[data-card-key="${cardPopKey(kind, cardId)}"]`,
          panelId: "cutter",
          cardKind: kind,
          skipScroll: true,
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
      if (typeof clickY === "number") {
        const sourceEl = document.querySelector(
          `[data-marginalia-marker^="cut:${cardId}:"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF if the panel column
        // hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(`${kind}:${cardId}`, clickY, sourceEl);
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, cutterCards, selectedCutterCardId, setSelectedCutterCardId, tryScrollOmniEntry, getOmniEnabled, setActiveAnchorId, setActiveAnchorKind, alignOmniCardWithClick],
  );

  const handleTodoMarkerClick = useCallback(
    (todoId: string, clickY?: number) => {
      const nextSelected = selectedTodoId === todoId ? null : todoId;
      // Gutter click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row).
      suppressNextPlacement();
      setSelectedTodoId(nextSelected);
      if (!nextSelected) return;
      openForCard(
        {
          omniKey: `todo:${todoId}`,
          entrySelector: `[data-todo-entry="${todoId}"]`,
          panelId: "todo",
          cardKind: "todo",
          skipScroll: true,
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
      if (typeof clickY === "number") {
        const sourceEl = document.querySelector(
          `[data-marginalia-marker^="todo:${todoId}:"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF if the panel column
        // hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(`todo:${todoId}`, clickY, sourceEl);
      }
    },
    [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, selectedTodoId, setSelectedTodoId, tryScrollOmniEntry, getOmniEnabled, alignOmniCardWithClick],
  );

  return {
    handleNoteMarkerClick,
    handleCutMarkerClick,
    handleTodoMarkerClick,
  };
}
