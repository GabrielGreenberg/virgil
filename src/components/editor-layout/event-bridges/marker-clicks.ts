import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { OmniCategory } from "@/panels/Omni";
import type { CardKind } from "@/panels/_shared/types";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";
import { openForCard } from "./open-for-card";
import { cardPopKey } from "@/panels/panel-registry";

/** EntityKind → routing config for `virgil-linked-anchor-click`. Mode B
 *  text-range clicks fall into one of these; inline atoms (footnote,
 *  citation) and one-shot kinds (archive) use their own dedicated events. */
const ANCHOR_CLICK_ROUTES: Record<
  Extract<
    EntityKind,
    "note" | "cutter-comment" | "cutter-suggestion" | "revision-comment" | "revision-suggestion"
  >,
  { panelId: PanelId; cardKind: CardKind; omniPrefix: string; entrySelectorBase: string }
> = {
  note: {
    panelId: "notes",
    cardKind: "note",
    omniPrefix: "note",
    entrySelectorBase: "data-note-entry",
  },
  "cutter-comment": {
    panelId: "cutter",
    cardKind: "cutter-comment",
    omniPrefix: "cutter-comment",
    entrySelectorBase: "data-card-key",
  },
  "cutter-suggestion": {
    panelId: "cutter",
    cardKind: "cutter-suggestion",
    omniPrefix: "cutter-suggestion",
    entrySelectorBase: "data-card-key",
  },
  "revision-comment": {
    panelId: "revisions",
    cardKind: "revision-comment",
    omniPrefix: "revision",
    entrySelectorBase: "data-card-key",
  },
  "revision-suggestion": {
    panelId: "revisions",
    cardKind: "revision-suggestion",
    omniPrefix: "revision-suggestion",
    entrySelectorBase: "data-card-key",
  },
};

/**
 * Editor-side → panel-side click routing for the four link-node kinds
 * (archive, footnote, citation, \ref). Each listens on a `virgil-*-click`
 * event that the Editor's node views dispatch on mousedown.
 *
 * Routing rules (Omni-first):
 *  1. If OmniView hosts the card on any side, scroll there.
 *  2. If the native panel is already open on its home side, scroll there.
 *  3. Otherwise, open Omni on the home side (scrolling after mount).
 *     If the card's kind isn't omni-eligible or is filtered out of Omni
 *     on that side, fall back to opening the native panel instead.
 *
 * Citation clicks keep the split-aware routing — if the click originated
 * inside a same-side panel, target opens as a split so the source stays
 * visible alongside.
 */
export function useMarkerClickBridges(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setActiveRefCommand: Dispatch<SetStateAction<"ref" | "getref" | "getfullref">>;
  setActiveMath: Dispatch<
    SetStateAction<{
      kind: "inline" | "display";
      latex: string;
      pos: number;
      rect: DOMRect;
    } | null>
  >;
  setActiveFigure: Dispatch<
    SetStateAction<{
      kind: string;
      raw: string;
      pos: number;
      rect: DOMRect;
    } | null>
  >;
  /** Pins the omni card with the given id at `clickY` (viewport-Y).
   *  Converts to pod-relative internally and publishes to omniPinStore;
   *  OmniViewPanel reads the pin and overrides that one card's transform.
   *  No document scroll. */
  alignOmniCardWithClick: (cardId: string, clickY: number, sourceEl: HTMLElement | null) => void;
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
    setActiveMath,
    setActiveFigure,
    alignOmniCardWithClick,
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      // Marker click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row and drag
      // the editor). See usePlacement's asymmetry-rule docstring.
      suppressNextPlacement();
      setSelectedFootnoteId(detail.footnoteId);
      const clickY: number | undefined =
        typeof detail.clickY === "number" ? detail.clickY : undefined;
      openForCard(
        {
          omniKey: `footnote:${detail.footnoteId}`,
          entrySelector: `[data-footnote-entry="${detail.footnoteId}"], [data-link-card="footnote:${detail.footnoteId}"]`,
          panelId: "footnotes",
          cardKind: "footnote",
          // skipScroll: alignment is handled by shifting the omni cards
          // group (alignOmniCardWithClick) so the document stays put.
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
          `.footnote-marker[data-footnote-id="${detail.footnoteId}"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF later if the panel
        // column hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(`footnote:${detail.footnoteId}`, clickY, sourceEl);
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedFootnoteId, alignOmniCardWithClick]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.citationId) return;
      // Marker click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row and drag
      // the editor). See usePlacement's asymmetry-rule docstring.
      suppressNextPlacement();
      setSelectedCitationId(detail.citationId);
      const clickY: number | undefined =
        typeof detail.clickY === "number" ? detail.clickY : undefined;
      const sourceSide = detail.sourceSide as Side | undefined;
      const sourcePanelId = detail.sourcePanelId as PanelId | undefined;
      const sourceHalf = detail.sourceHalf as Half | undefined;
      openForCard(
        {
          omniKey: `citation:${detail.citationId}`,
          entrySelector: `[data-link-card="citation:${detail.citationId}"]`,
          panelId: "citations",
          cardKind: "citation",
          // skipScroll: alignment is handled by shifting the omni cards
          // group (alignOmniCardWithClick) so the document stays put.
          skipScroll: true,
          splitSource:
            sourceSide && sourcePanelId
              ? { side: sourceSide, panelId: sourcePanelId, half: sourceHalf }
              : undefined,
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
      // After openForCard mounts the omni column (or confirms it's already
      // open), pull the card to align with the click. alignOmniCardWithClick
      // defers internally with double rAF so it measures AFTER React has
      // committed the new selection state AND useInTextPositions has
      // recomputed card positions.
      if (typeof clickY === "number") {
        const sourceEl = document.querySelector(
          `.citation-node[data-citation-id="${detail.citationId}"]`,
        ) as HTMLElement | null;
        alignOmniCardWithClick(`citation:${detail.citationId}`, clickY, sourceEl);
      }
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedCitationId, alignOmniCardWithClick]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.label) return;
      const el = document.querySelector(
        `.label-ref-node[data-label="${detail.label}"]`,
      ) as HTMLElement | null;
      if (el) {
        setActiveRefLabel(detail.label);
        setActiveRefRect(el.getBoundingClientRect());
        const cmd = detail.refCommand;
        if (cmd === "getref" || cmd === "getfullref" || cmd === "ref") {
          setActiveRefCommand(cmd);
        } else {
          setActiveRefCommand("ref");
        }
      }
    };
    window.addEventListener("virgil-label-ref-click", handler);
    return () => window.removeEventListener("virgil-label-ref-click", handler);
  }, [setActiveRefLabel, setActiveRefRect, setActiveRefCommand]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail.pos !== "number") return;
      if (detail.kind !== "inline" && detail.kind !== "display") return;
      if (!(detail.rect instanceof DOMRect)) return;
      setActiveMath({
        kind: detail.kind,
        latex: typeof detail.latex === "string" ? detail.latex : "",
        pos: detail.pos,
        rect: detail.rect,
      });
    };
    window.addEventListener("virgil-math-click", handler);
    return () => window.removeEventListener("virgil-math-click", handler);
  }, [setActiveMath]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail.pos !== "number") return;
      if (typeof detail.kind !== "string") return;
      if (!(detail.rect instanceof DOMRect)) return;
      setActiveFigure({
        kind: detail.kind,
        raw: typeof detail.raw === "string" ? detail.raw : "",
        pos: detail.pos,
        rect: detail.rect,
      });
    };
    window.addEventListener("virgil-figure-click", handler);
    return () => window.removeEventListener("virgil-figure-click", handler);
  }, [setActiveFigure]);

  // Generic linked-anchor click bridge — `useTextHoverBridge` dispatches
  // `virgil-linked-anchor-click` whenever a Mode B `.linked-anchor` span
  // is clicked. We select the corresponding card and route through
  // `openForCard` so the click behaves identically to clicking the
  // matching margin icon (Omni-first, vertical alignment, etc.).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { entityId: string; kind: EntityKind; clickY?: number }
        | undefined;
      if (!detail?.entityId || !detail.kind) return;
      const route = ANCHOR_CLICK_ROUTES[detail.kind as keyof typeof ANCHOR_CLICK_ROUTES];
      if (!route) return;

      const id = detail.entityId;
      // Marker click → card alignment goes through alignOmniCardWithClick
      // below, NOT through usePlacement (which would scroll the row and drag
      // the editor). See usePlacement's asymmetry-rule docstring.
      suppressNextPlacement();
      switch (detail.kind) {
        case "note": setSelectedNoteId(id); break;
        case "cutter-comment":
        case "cutter-suggestion": setSelectedCutterCardId(id); break;
        case "revision-comment":
        case "revision-suggestion": setSelectedCommentId(id); break;
      }

      const entrySelector =
        route.entrySelectorBase === "data-card-key"
          ? `[data-card-key="${cardPopKey(detail.kind as CardKind, id)}"]`
          : `[${route.entrySelectorBase}="${id}"]`;

      const clickY: number | undefined =
        typeof detail.clickY === "number" ? detail.clickY : undefined;
      const omniKey = `${route.omniPrefix}:${id}`;
      openForCard(
        {
          omniKey,
          entrySelector,
          panelId: route.panelId,
          cardKind: route.cardKind,
          // skipScroll: alignment is handled by shifting the omni cards
          // group (alignOmniCardWithClick) so the document stays put.
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
          `.linked-anchor[data-link-id="${id}"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF later if the panel
        // column hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(omniKey, clickY, sourceEl);
      }
    };
    window.addEventListener("virgil-linked-anchor-click", handler);
    return () => window.removeEventListener("virgil-linked-anchor-click", handler);
  }, [
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    alignOmniCardWithClick,
  ]);
}
