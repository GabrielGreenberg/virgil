import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import { alignEntryToY, scrollEntryIntoView } from "../layout-scroll";

/**
 * Editor-side → panel-side click routing for the four link-node kinds
 * (archive, footnote, citation, \ref). Each listens on a `virgil-*-click`
 * event that the Editor's node views dispatch on mousedown.
 *
 * All four share the same shape: set the selection slot, try to scroll
 * an Omni entry into view, and if Omni doesn't host the item, force-open
 * the native panel on its placement side and scroll the entry there.
 *
 * Citation clicks get the extra split-aware routing (same-side source →
 * split; opposite side or main text → activate on home side).
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
      if (detail?.archiveId) {
        setSelectedArchiveId(detail.archiveId);
        if (tryScrollOmniEntry(`ar:${detail.archiveId}`)) return;
        const p = prefsRef.current;
        const archivePlacement = p.placements.find((pl) => pl.id === "archive");
        if (archivePlacement?.side === "left") {
          if (p.activeLeft !== "archive") setActiveLeft("archive");
        } else {
          if (p.activeRight !== "archive") setActiveRight("archive");
        }
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
      if (detail?.footnoteId) {
        setSelectedFootnoteId(detail.footnoteId);
        if (tryScrollOmniEntry(`fn:${detail.footnoteId}`)) return;
        const p = prefsRef.current;
        const fnPlacement = p.placements.find((pl) => pl.id === "footnotes");
        if (fnPlacement?.side === "left") {
          if (p.activeLeft !== "footnotes") setActiveLeft("footnotes");
        } else {
          if (p.activeRight !== "footnotes") setActiveRight("footnotes");
        }
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
      if (detail?.citationId) {
        setSelectedCitationId(detail.citationId);
        const targetY: number | undefined =
          typeof detail.clickY === "number" ? detail.clickY : undefined;
        if (tryScrollOmniEntry(`ci:${detail.citationId}`, targetY)) return;
        const p = prefsRef.current;
        const citPlacement = p.placements.find((pl) => pl.id === "citations");
        const targetSide: Side = citPlacement?.side ?? "left";
        const sourceSide = detail.sourceSide as Side | undefined;
        const sourcePanelId = detail.sourcePanelId as PanelId | undefined;
        const sourceHalf = detail.sourceHalf as Half | undefined;

        // If the click came from inside the citations panel itself, don't
        // re-route — just let the scroll logic below bring the entry into view.
        if (sourcePanelId !== "citations") {
          if (sourceSide && sourceSide === targetSide && sourcePanelId) {
            // Same side as citations' home → open as a split so the source
            // panel stays visible alongside citations.
            const isSplit =
              targetSide === "left"
                ? p.activeLeftBottom != null
                : p.activeRightBottom != null;
            if (!isSplit) {
              // Not split yet: pin source to top, open citations in bottom.
              setActiveHalf(targetSide, "top", sourcePanelId);
              setActiveHalf(targetSide, "bottom", "citations");
            } else {
              // Already split: put citations in the half opposite the source.
              const oppHalf: Half = sourceHalf === "bottom" ? "top" : "bottom";
              setActiveHalf(targetSide, oppHalf, "citations");
            }
          } else {
            // From main text or from a panel on the opposite side — just
            // activate citations on its home side.
            if (targetSide === "left") {
              if (p.activeLeft !== "citations") setActiveLeft("citations");
            } else {
              if (p.activeRight !== "citations") setActiveRight("citations");
            }
          }
        }
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
