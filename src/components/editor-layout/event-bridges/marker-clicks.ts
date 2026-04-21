import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import { alignEntryToY, scrollEntryIntoView } from "../layout-scroll";

/**
 * Editor-side → panel-side click routing for the four link-node kinds
 * (archive, footnote, citation, \ref). Each listens on a `virgil-*-click`
 * event that the Editor's node views dispatch on mousedown.
 *
 * Routing when OmniView is treated as a mode:
 * - If OmniView hosts the card (on any side), scroll there.
 * - If the native panel is already open on its home side, scroll there too.
 * - Only force-open the native panel when neither is already showing.
 *
 * Citation clicks get the extra split-aware routing — but only when
 * neither OmniView nor the citations panel is already showing.
 */
export function useMarkerClickBridges(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    setSelectedArchiveId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setActiveRefLabel,
    setActiveRefRect,
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.archiveId) return;
      setSelectedArchiveId(detail.archiveId);
      const omniHit = tryScrollOmniEntry(`archive:${detail.archiveId}`);
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "archive");
      const side: Side = placement?.side ?? "right";
      const active = side === "left" ? p.activeLeft === "archive" : p.activeRight === "archive";
      const shouldOpen = !omniHit && !active;
      if (shouldOpen) {
        if (side === "left") setActiveLeft("archive");
        else setActiveRight("archive");
      }
      if (active || shouldOpen) {
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-archive-entry="${detail.archiveId}"]`,
          ) as HTMLElement | null;
          if (entry) scrollEntryIntoView(entry);
        });
      }
    };
    window.addEventListener("virgil-archive-click", handler);
    return () => window.removeEventListener("virgil-archive-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, setSelectedArchiveId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      setSelectedFootnoteId(detail.footnoteId);
      const omniHit = tryScrollOmniEntry(`footnote:${detail.footnoteId}`);
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "footnotes");
      const side: Side = placement?.side ?? "left";
      const active = side === "left" ? p.activeLeft === "footnotes" : p.activeRight === "footnotes";
      const shouldOpen = !omniHit && !active;
      if (shouldOpen) {
        if (side === "left") setActiveLeft("footnotes");
        else setActiveRight("footnotes");
      }
      if (active || shouldOpen) {
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-link-card="footnote:${detail.footnoteId}"]`,
          ) as HTMLElement | null;
          if (entry) scrollEntryIntoView(entry);
        });
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, setSelectedFootnoteId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.citationId) return;
      setSelectedCitationId(detail.citationId);
      const targetY: number | undefined =
        typeof detail.clickY === "number" ? detail.clickY : undefined;
      const omniHit = tryScrollOmniEntry(`citation:${detail.citationId}`, targetY);
      const p = prefsRef.current;
      const citPlacement = p.placements.find((pl) => pl.id === "citations");
      const targetSide: Side = citPlacement?.side ?? "left";
      const active = targetSide === "left" ? p.activeLeft === "citations" : p.activeRight === "citations";
      const sourceSide = detail.sourceSide as Side | undefined;
      const sourcePanelId = detail.sourcePanelId as PanelId | undefined;
      const sourceHalf = detail.sourceHalf as Half | undefined;
      const shouldOpen = !omniHit && !active;

      if (shouldOpen) {
        // If the click came from inside the citations panel itself, don't
        // re-route — just scroll. Otherwise apply split-aware routing.
        if (sourcePanelId !== "citations") {
          if (sourceSide && sourceSide === targetSide && sourcePanelId) {
            // Same side as citations' home → open as a split so the source
            // panel stays visible alongside citations.
            const isSplit =
              targetSide === "left"
                ? p.activeLeftBottom != null
                : p.activeRightBottom != null;
            if (!isSplit) {
              setActiveHalf(targetSide, "top", sourcePanelId);
              setActiveHalf(targetSide, "bottom", "citations");
            } else {
              const oppHalf: Half = sourceHalf === "bottom" ? "top" : "bottom";
              setActiveHalf(targetSide, oppHalf, "citations");
            }
          } else {
            if (targetSide === "left") setActiveLeft("citations");
            else setActiveRight("citations");
          }
        }
      }
      if (active || shouldOpen) {
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-link-card="citation:${detail.citationId}"]`,
          ) as HTMLElement | null;
          if (!entry) return;
          if (typeof targetY === "number") {
            alignEntryToY(entry, targetY);
          } else {
            scrollEntryIntoView(entry);
          }
        });
      }
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry, setSelectedCitationId]);

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
      }
    };
    window.addEventListener("virgil-label-ref-click", handler);
    return () => window.removeEventListener("virgil-label-ref-click", handler);
  }, [setActiveRefLabel, setActiveRefRect]);
}
