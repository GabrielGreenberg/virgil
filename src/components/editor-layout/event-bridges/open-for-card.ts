import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";
import type { CardKind, PanelKind } from "@/panels/_shared/types";
import type { OmniCategory } from "@/panels/Omni";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { alignEntryToY, scrollEntryIntoView } from "../layout-scroll";

/**
 * Routing helper used by every main-text click that wants to "show me
 * this card in a panel." Omni-first: if Omni is already displaying the
 * card, or the panel's home side has room for Omni to show it, prefer
 * Omni. Only open the native panel when Omni can't host the card (not
 * omni-eligible, or filtered out on that side).
 *
 * Rules:
 *  1. Omni is already showing the card on some side → scroll there.
 *  2. Native panel is already active on its home side → scroll there.
 *  3. Otherwise → open Omni on the home side and scroll, unless the
 *     card's kind is not omni-eligible or the user has filtered it
 *     out, in which case fall back to opening the native panel.
 *
 * Returns nothing; all effects go through the injected prefs setters.
 */

export interface OpenForCardDeps {
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setActiveHalf: (side: Side, half: Half, id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
}

export interface SplitSource {
  side: Side;
  panelId: PanelId;
  half: Half | undefined;
}

export interface OpenForCardArgs {
  /** `data-omni-entry` key, e.g. "footnote:abc". */
  omniKey: string;
  /** Selector for the native-panel card, e.g. `[data-link-card="footnote:abc"]`. */
  entrySelector: string;
  /** The panel whose home side we target. */
  panelId: PanelId;
  /** The card kind used for the Omni filter check. */
  cardKind: CardKind;
  /** Optional viewport Y to align the card to (citations). */
  targetY?: number;
  /** Optional split-aware routing source (citations). */
  splitSource?: SplitSource;
  /** When true, skip all scroll-into-view / align calls. Used by callers
   *  that handle alignment some other way (e.g. citation clicks set an
   *  anchor override that pulls the card to the click without scrolling
   *  the document). */
  skipScroll?: boolean;
}

function resolveHomeSide(prefs: ViewPrefs, panelId: PanelId, fallback: Side): Side {
  return prefs.placements.find((p) => p.id === panelId)?.side ?? fallback;
}

function scrollAfterMount(selector: string, targetY?: number) {
  requestAnimationFrame(() => {
    const entry = document.querySelector(selector) as HTMLElement | null;
    if (!entry) return;
    if (typeof targetY === "number") alignEntryToY(entry, targetY);
    else scrollEntryIntoView(entry);
  });
}

export function openForCard(args: OpenForCardArgs, deps: OpenForCardDeps): void {
  const { omniKey, entrySelector, panelId, targetY, splitSource, skipScroll } = args;
  const {
    prefs,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    tryScrollOmniEntry,
    getOmniEnabled,
  } = deps;

  // Rule 1: Omni is already hosting the card somewhere → scroll there
  // (unless the caller is handling alignment itself).
  if (skipScroll) {
    const entry = document.querySelector(
      `[data-omni-entry="${omniKey}"], [data-omni-entry^="${omniKey}@"]`,
    );
    if (entry) return;
  } else if (tryScrollOmniEntry(omniKey, targetY)) {
    return;
  }

  const registry = PANEL_REGISTRY[panelId as keyof typeof PANEL_REGISTRY];
  const fallbackSide: Side = registry?.defaultStripSide ?? "left";
  const homeSide = resolveHomeSide(prefs, panelId, fallbackSide);
  const isActive =
    homeSide === "left" ? prefs.activeLeft === panelId : prefs.activeRight === panelId;

  // Rule 2: Native panel already open on home side → just scroll.
  if (isActive) {
    scrollAfterMount(entrySelector, targetY);
    return;
  }

  // Rule 3: Open Omni on home side, or fall back to native if Omni
  // can't host this card (not omni-eligible, or filtered out). Filter
  // categories are PanelKinds, so we test by the home panel id.
  const omniWillShow =
    !!registry?.omniEligible && getOmniEnabled(homeSide).has(panelId as PanelKind);
  const target: PanelId = omniWillShow ? "omni" : panelId;

  // Citation-style split-aware routing: when the click originates inside
  // a same-side panel and that side isn't already split, open target as a
  // split so the source panel stays visible. Only applied for native
  // fallback AND Omni open, since in both cases the target panel differs
  // from the source.
  const applySplit =
    splitSource &&
    splitSource.panelId !== target &&
    splitSource.side === homeSide;

  if (applySplit && splitSource) {
    const isSplit =
      homeSide === "left"
        ? prefs.activeLeftBottom != null
        : prefs.activeRightBottom != null;
    if (!isSplit) {
      setActiveHalf(homeSide, "top", splitSource.panelId);
      setActiveHalf(homeSide, "bottom", target);
    } else {
      const oppHalf: Half = splitSource.half === "bottom" ? "top" : "bottom";
      setActiveHalf(homeSide, oppHalf, target);
    }
  } else {
    if (homeSide === "left") setActiveLeft(target);
    else setActiveRight(target);
  }

  // Scroll: prefer the Omni entry (if we just opened Omni), else the
  // native entry. We do both queries in the rAF because by then whichever
  // one exists will be in the DOM. Skipped when the caller handles
  // alignment itself.
  if (skipScroll) return;
  requestAnimationFrame(() => {
    const omniEntry =
      (target === "omni"
        ? (document.querySelector(
            `[data-omni-entry="${omniKey}"], [data-omni-entry^="${omniKey}@"]`,
          ) as HTMLElement | null)
        : null);
    const entry =
      omniEntry ?? (document.querySelector(entrySelector) as HTMLElement | null);
    if (!entry) return;
    if (typeof targetY === "number") alignEntryToY(entry, targetY);
    else scrollEntryIntoView(entry);
  });
}
