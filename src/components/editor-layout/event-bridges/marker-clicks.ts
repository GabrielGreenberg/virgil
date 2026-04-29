import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { OmniCategory } from "@/panels/Omni";
import type { CardKind } from "@/panels/_shared/types";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { openForCard } from "./open-for-card";

/** EntityKind → routing config for `virgil-linked-anchor-click`. Mode B
 *  text-range clicks fall into one of these three; inline atoms (footnote,
 *  citation) and one-shot kinds (archive) use their own dedicated events. */
const ANCHOR_CLICK_ROUTES: Record<
  Extract<EntityKind, "note" | "cut" | "revision">,
  { panelId: PanelId; cardKind: CardKind; omniPrefix: string; entrySelectorBase: string }
> = {
  note: {
    panelId: "notes",
    cardKind: "note",
    omniPrefix: "note",
    entrySelectorBase: "data-note-entry",
  },
  cut: {
    panelId: "cutter",
    cardKind: "cutter-comment",
    omniPrefix: "cutter-comment",
    entrySelectorBase: "data-card-key",
  },
  revision: {
    panelId: "revisions",
    cardKind: "comment",
    omniPrefix: "revision",
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
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setActiveRefCommand: Dispatch<SetStateAction<"ref" | "getref" | "getfullref">>;
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.archiveId) return;
      setSelectedArchiveId(detail.archiveId);
      openForCard(
        {
          omniKey: `archive:${detail.archiveId}`,
          entrySelector: `[data-archive-entry="${detail.archiveId}"]`,
          panelId: "archive",
          cardKind: "archive",
          targetY: typeof detail.clickY === "number" ? detail.clickY : undefined,
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
    };
    window.addEventListener("virgil-archive-click", handler);
    return () => window.removeEventListener("virgil-archive-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedArchiveId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      setSelectedFootnoteId(detail.footnoteId);
      openForCard(
        {
          omniKey: `footnote:${detail.footnoteId}`,
          entrySelector: `[data-footnote-entry="${detail.footnoteId}"], [data-link-card="footnote:${detail.footnoteId}"]`,
          panelId: "footnotes",
          cardKind: "footnote",
          targetY: typeof detail.clickY === "number" ? detail.clickY : undefined,
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
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedFootnoteId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.citationId) return;
      setSelectedCitationId(detail.citationId);
      const targetY: number | undefined =
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
          targetY,
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
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, getOmniEnabled, setSelectedCitationId]);

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
      switch (detail.kind) {
        case "note": setSelectedNoteId(id); break;
        case "cut": setSelectedCutterCardId(id); break;
        case "revision": setSelectedCommentId(id); break;
      }

      const entrySelector =
        route.entrySelectorBase === "data-card-key"
          ? `[data-card-key="${route.omniPrefix}:${id}"]`
          : `[${route.entrySelectorBase}="${id}"]`;

      openForCard(
        {
          omniKey: `${route.omniPrefix}:${id}`,
          entrySelector,
          panelId: route.panelId,
          cardKind: route.cardKind,
          targetY: typeof detail.clickY === "number" ? detail.clickY : undefined,
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
  ]);
}
