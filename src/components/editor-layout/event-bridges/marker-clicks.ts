import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
// A selector may spell the ATTRIBUTE name inline, but not the token: the
// `<cardKind>:<cardId>` grammar has one builder, and a query that restates it
// is a second speller that silently stops matching if it ever changes (202).
import { linkIdSelector } from "@/links/link-dom-contract";
// The footnote/citation entry addresses below were hand-copied from
// `panelEntrySelector`'s own rows, byte for byte. One owner now (task 204):
// a composite selector drifts the way selectors do — by not matching.
import { panelEntrySelector } from "../panel-selection";
// Pure dock-stack derivation — imported from the LEAF (not the hook module) so
// this bridge stays clear of `useViewPrefs`'s heavy `OmniViewPanel` → storage
// runtime chain (see view-prefs-derived.ts + anchor-route-derivation-contract).
import { isPanelDocked } from "@/hooks/view-prefs-derived";
import type { OmniCategory } from "@/panels/Omni";
import type { CardKind } from "@/panels/_shared/types";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { panelForCardKind } from "@/cards/predicates";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";
import type { CardStore } from "@/links/_shared/anchored-card-store";
import { openForCard, type OpenForCardDeps } from "./open-for-card";
import { cardPopKey, cardDomSelector } from "@/panels/panel-registry";
import {
  ATOM_CREATE_POPOVER_EVENT,
  type AtomCreateRequest,
} from "@/lib/actions/atom-create";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

/** The card kinds that route through the shared anchor-click body
 *  (`routeAnchorClick`): the five Mode-B text-range kinds (dispatched by
 *  `useTextHoverBridge` when a `.linked-anchor` span is clicked) plus the
 *  four Mode-A paragraph-anchored kinds (dispatched by EditorPane's margin
 *  marker builder — R15: margin clicks ride the same live bridge as in-text
 *  anchor clicks). Inline atoms (footnote, citation) use their own dedicated
 *  `virgil-*-click` events; `error` isn't a card and gets its own small
 *  bridge (`virgil-error-marker-click`) below. */
type AnchorClickKind =
  | "note"
  | "cutter-comment"
  | "cutter-suggestion"
  | "revision-comment"
  | "revision-suggestion"
  | "archive"
  | "todo"
  | "report"
  | "report-request";

/** Per-kind `entrySelectorBase` overrides. The default is `data-card-key` (the
 *  canonical AF float-key selector); the overrides are the panels that stamp
 *  their entries with a legacy `data-<kind>-entry` attribute instead (cf. the
 *  same conventions in `panel-selection.ts`), so the listener queries
 *  `[data-<kind>-entry="${id}"]` instead of `cardDomSelector(kind, id)`. */
const ENTRY_SELECTOR_BASE_OVERRIDE: Partial<Record<AnchorClickKind, string>> = {
  note: "data-note-entry",
  archive: "data-archive-entry",
  todo: "data-todo-entry",
  report: "data-report-entry",
  "report-request": "data-report-request-entry",
};

/** `AnchorClickKind` → routing config, DERIVED: `cardKind` is the kind itself
 *  and `panelId` is `panelForCardKind(kind)` (the registry SSOT), with the
 *  small `entrySelectorBase` override map above. A pin-test asserts these
 *  derived routes ≡ frozen literals. */
export const ANCHOR_CLICK_ROUTES: Record<
  AnchorClickKind,
  { panelId: PanelId; cardKind: CardKind; entrySelectorBase: string }
> = Object.fromEntries(
  (
    [
      "note",
      "cutter-comment",
      "cutter-suggestion",
      "revision-comment",
      "revision-suggestion",
      "archive",
      "todo",
      "report",
      "report-request",
    ] as const
  ).map((kind) => {
    const panel = panelForCardKind(kind);
    // All five routed kinds own a panel; the registry can't return null here.
    if (panel == null) {
      throw new Error(`[marker-clicks] no owning panel for anchor-click kind "${kind}"`);
    }
    return [
      kind,
      {
        panelId: panel as PanelId,
        cardKind: kind,
        entrySelectorBase: ENTRY_SELECTOR_BASE_OVERRIDE[kind] ?? "data-card-key",
      },
    ];
  }),
) as Record<AnchorClickKind, { panelId: PanelId; cardKind: CardKind; entrySelectorBase: string }>;

/** Everything `routeAnchorClick` needs from the shell: the `openForCard`
 *  routing env (prefs read live via ref) plus the omni click-pin publisher. */
interface AnchorClickEnv {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  alignOmniCardWithClick: (cardId: string, clickY: number, sourceEl: HTMLElement | null) => void;
  /** Resolve the ACTIVE doc's interaction store at CLICK time. A getter (not a
   *  captured instance) because this bridge is shell-mounted above the per-doc
   *  CardStoreProvider and its listener effect doesn't re-subscribe on doc
   *  switch — resolving lazily keeps the select targeting the active doc. */
  getActiveCardStore: () => CardStore;
}

/**
 * The ONE shared routing body for "show me this card" clicks (R15): both the
 * in-text Mode-B anchor click (`useTextHoverBridge` → `virgil-linked-anchor-
 * click`) and the margin marker click (EditorPane's marker builder dispatches
 * the same event) land here. Select (selection axis ONLY — N1: never touches
 * `expandedSet`), route through `openForCard` (omni-first, native fallback),
 * and pin the omni card at the click Y. No document jump — `skipScroll` +
 * `suppressNextPlacement` keep the editor row put; alignment happens by
 * pulling the CARD to the click instead.
 */
function routeAnchorClick(
  detail: { entityId: string; kind: EntityKind; clickY?: number; anchorIndex?: number },
  env: AnchorClickEnv,
): void {
  const route = ANCHOR_CLICK_ROUTES[detail.kind as AnchorClickKind];
  if (!route) return;

  const id = detail.entityId;
  // Click → card alignment goes through alignOmniCardWithClick below, NOT
  // through usePlacement (which would scroll the row and drag the editor).
  // See usePlacement's asymmetry-rule docstring.
  suppressNextPlacement();
  // Selection axis only. The event carries the exact kind (the dispatchers
  // resolve comment-vs-suggestion / report-vs-request from the record), so
  // select directly instead of going through the per-kind slot setters
  // (which would have to re-derive the polymorphic kind).
  env.getActiveCardStore().select({ kind: detail.kind, id });

  const entrySelector =
    route.entrySelectorBase === "data-card-key"
      ? cardDomSelector(route.cardKind, id)
      : `[${route.entrySelectorBase}="${id}"]`;

  const clickY: number | undefined =
    typeof detail.clickY === "number" ? detail.clickY : undefined;
  // The omni id a panel stamps IS `cardPopKey(kind,id)` — except a MULTI-anchor
  // card draws one row per anchor keyed `…@<anchorIndex>` (T5 Pillar E-2). The
  // margin marker stamps the clicked paragraph's `anchorIndex` (only for
  // multi-anchor cards — single-anchor rows have no suffix), so append it here
  // to pin/scroll the RIGHT row (REP-F3-01 / OMNI-F3-01 / OMNI-F8-02). The
  // `openForCard` presence check + `alignOmniCardWithClick` both use the
  // shared prefix-or-exact matcher, so the bare key still resolves if the
  // index is absent.
  const omniKey =
    typeof detail.anchorIndex === "number"
      ? `${cardPopKey(route.cardKind, id)}@${detail.anchorIndex}`
      : cardPopKey(route.cardKind, id);
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
      prefs: env.prefsRef.current,
      setActiveLeft: env.setActiveLeft,
      setActiveRight: env.setActiveRight,
      tryScrollOmniEntry: env.tryScrollOmniEntry,
      getOmniEnabled: env.getOmniEnabled,
    } satisfies OpenForCardDeps,
  );
  if (typeof clickY === "number") {
    const sourceEl = document.querySelector(
      `.linked-anchor${linkIdSelector(id)}`,
    ) as HTMLElement | null;
    // alignOmniCardWithClick converts clickY → pod-relative and
    // publishes a pin request. Retries one rAF later if the panel
    // column hasn't rendered yet (cold-mount case).
    env.alignOmniCardWithClick(omniKey, clickY, sourceEl);
  }
}

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
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  /** Error selection setter. Now routes to the per-doc owner in EditorPane
   *  (bubbled up via `paneState.setSelectedErrorId`); the shell passes a stable
   *  `setSelectedErrorIdBridge` wrapper. Called value-only (never an updater),
   *  so a plain `(id) => void` suffices. Synced from margin error-marker clicks. */
  setSelectedErrorId: (id: string | null) => void;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setActiveRefCommand: Dispatch<SetStateAction<"ref" | "getref" | "getfullref">>;
  /** Opens the SHARED inline-atom create popover (citation + `\ref`). The
   *  trigger surfaces dispatch `virgil-atom-create-popover` with an
   *  `AtomCreateRequest` (kind + caret rect + captured insertion pos); this
   *  setter lands it in EditorLayout's `atomCreateRequest` state. */
  setAtomCreateRequest: Dispatch<SetStateAction<AtomCreateRequest | null>>;
  setActiveMath: Dispatch<
    SetStateAction<{
      kind: "inline" | "display";
      latex: string;
      pos: number;
      rect: DOMRect;
      // The editor instance that OWNS the clicked math node (main OR an
      // embedded card/float surface). The save dispatches into THIS editor so
      // `pos` is interpreted in the pos-space it was minted in — never blindly
      // against MAIN. See math.ts's click handler + EditorLayout.handleMathSave.
      editor: Editor;
    } | null>
  >;
  setActiveFigure: Dispatch<
    SetStateAction<{
      kind: string;
      raw: string;
      pos: number;
      rect: DOMRect;
      // The editor instance that OWNS the clicked figure/graphics node (main OR
      // the figure's own float surface). The save dispatches into THIS editor so
      // `pos` is interpreted in the pos-space it was minted in — never blindly
      // against MAIN. See FigureBlockNodeView's click handler + handleFigureSave.
      editor: Editor;
    } | null>
  >;
  /** Pins the omni card with the given id at `clickY` (viewport-Y).
   *  Converts to pod-relative internally and publishes to omniPinStore;
   *  OmniViewPanel reads the pin and overrides that one card's transform.
   *  No document scroll. */
  alignOmniCardWithClick: (cardId: string, clickY: number, sourceEl: HTMLElement | null) => void;
  /** Resolve the ACTIVE doc's interaction store at click time (see
   *  `AnchorClickEnv.getActiveCardStore`). */
  getActiveCardStore: () => CardStore;
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedFootnoteId,
    setSelectedCitationId,
    setSelectedErrorId,
    setActiveRefLabel,
    setActiveRefRect,
    setActiveRefCommand,
    setAtomCreateRequest,
    setActiveMath,
    setActiveFigure,
    alignOmniCardWithClick,
    getActiveCardStore,
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
          omniKey: cardPopKey("footnote", detail.footnoteId),
          // Non-null: `panelEntrySelector` returns null only for the panels
          // with no selection concept, and "footnotes" is not one of them.
          entrySelector: panelEntrySelector("footnotes", detail.footnoteId)!,
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
          tryScrollOmniEntry,
          getOmniEnabled,
        },
      );
      if (typeof clickY === "number") {
        const sourceEl = document.querySelector(
          `.${ATOM_REGISTRY.footnote.domClass}[data-footnote-id="${detail.footnoteId}"]`,
        ) as HTMLElement | null;
        // alignOmniCardWithClick converts clickY → pod-relative and
        // publishes a pin request. Retries one rAF later if the panel
        // column hasn't rendered yet (cold-mount case).
        alignOmniCardWithClick(cardPopKey("footnote", detail.footnoteId), clickY, sourceEl);
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, getOmniEnabled, setSelectedFootnoteId, alignOmniCardWithClick]);

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
      // Split-aware routing is gone in the band-stack model — omni is always
      // the background, so the target citation just opens on its home side.
      openForCard(
        {
          omniKey: cardPopKey("citation", detail.citationId),
          entrySelector: panelEntrySelector("citations", detail.citationId)!,
          panelId: "citations",
          cardKind: "citation",
          // skipScroll: alignment is handled by shifting the omni cards
          // group (alignOmniCardWithClick) so the document stays put.
          skipScroll: true,
        },
        {
          prefs: prefsRef.current,
          setActiveLeft,
          setActiveRight,
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
          `.${ATOM_REGISTRY.citation.domClass}[data-citation-id="${detail.citationId}"]`,
        ) as HTMLElement | null;
        alignOmniCardWithClick(cardPopKey("citation", detail.citationId), clickY, sourceEl);
      }
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, getOmniEnabled, setSelectedCitationId, alignOmniCardWithClick]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.label) return;
      const el = document.querySelector(
        `.${ATOM_REGISTRY.ref.domClass}[data-label="${detail.label}"]`,
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

  // (`\ref` CREATE now flows through the SHARED `virgil-atom-create-popover`
  // event below — `kind: "ref"` — alongside citation. The retired
  // `virgil-ref-create-popover` event is gone; the EDIT-existing-`\ref` listener
  // above (`virgil-label-ref-click`) is untouched.)

  // The SHARED inline-atom create popover (citation + `\ref`). Trigger surfaces
  // (slash / lightning / grab / typed-bare) compute the caret rect + the
  // captured insertion `pos` and dispatch `virgil-atom-create-popover` with an
  // `AtomCreateRequest`; we land it in EditorLayout's `atomCreateRequest` state,
  // which mounts the right deferred-commit popover body. The atom + card
  // materialize only on the popover's commit — nothing lands here.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Partial<AtomCreateRequest> | undefined;
      if (!detail) return;
      const { kind, rect, pos } = detail;
      if (kind !== "citation" && kind !== "ref") return;
      if (!(rect instanceof DOMRect) || typeof pos !== "number") return;
      // The OWNING editor — the surface whose pos-space `pos` was captured at
      // trigger time. The commit inserts the atom into THIS editor (main OR an
      // embedded footnote/card editor), never blindly into MAIN. Mirrors the
      // math/figure click bridges below storing `detail.editor`. Validated by
      // the `isEditable` boolean shape the same way they do; a malformed detail
      // without it leaves `editor` undefined → the commit falls back to MAIN
      // (back-compatible) (CHIP 5).
      const owner = detail.editor as Editor | undefined;
      setAtomCreateRequest({
        kind,
        rect,
        pos,
        refCommand: detail.refCommand ?? "ref",
        editor: owner && typeof owner.isEditable === "boolean" ? owner : undefined,
      });
    };
    window.addEventListener(ATOM_CREATE_POPOVER_EVENT, handler);
    return () => window.removeEventListener(ATOM_CREATE_POPOVER_EVENT, handler);
  }, [setAtomCreateRequest]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || typeof detail.pos !== "number") return;
      if (detail.kind !== "inline" && detail.kind !== "display") return;
      if (!(detail.rect instanceof DOMRect)) return;
      // The owning editor is required: the save dispatches into THIS instance,
      // so `pos` is read in the pos-space it was minted in (main OR an embedded
      // card/float editor). A detail without it is malformed — bail rather than
      // fall back to MAIN, which would re-introduce the EX-F4-02 mis-target.
      const owner = detail.editor as Editor | undefined;
      if (!owner || typeof owner.isEditable !== "boolean") return;
      setActiveMath({
        kind: detail.kind,
        latex: typeof detail.latex === "string" ? detail.latex : "",
        pos: detail.pos,
        rect: detail.rect,
        editor: owner,
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
      // The owning editor is required: the save dispatches into THIS instance,
      // so `pos` is read in the pos-space it was minted in (main OR the figure
      // float). A detail without it is malformed — bail rather than fall back to
      // MAIN, which would re-introduce the EX-F4-02 mis-target (figure twin).
      const owner = detail.editor as Editor | undefined;
      if (!owner || typeof owner.isEditable !== "boolean") return;
      setActiveFigure({
        kind: detail.kind,
        raw: typeof detail.raw === "string" ? detail.raw : "",
        pos: detail.pos,
        rect: detail.rect,
        editor: owner,
      });
    };
    window.addEventListener("virgil-figure-click", handler);
    return () => window.removeEventListener("virgil-figure-click", handler);
  }, [setActiveFigure]);

  // Generic anchor-click bridge (R15) — `useTextHoverBridge` dispatches
  // `virgil-linked-anchor-click` whenever a Mode B `.linked-anchor` span is
  // clicked, and EditorPane's margin marker builder dispatches the SAME
  // event (with the marker's viewport Y) on a marker click. Both land in
  // `routeAnchorClick`: select + `openForCard` (omni-first) + pin the card
  // at the click Y — one shared route for in-text AND margin clicks.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { entityId: string; kind: EntityKind; clickY?: number; anchorIndex?: number }
        | undefined;
      if (!detail?.entityId || !detail.kind) return;
      routeAnchorClick(detail, {
        prefsRef,
        setActiveLeft,
        setActiveRight,
        tryScrollOmniEntry,
        getOmniEnabled,
        alignOmniCardWithClick,
        getActiveCardStore,
      });
    };
    window.addEventListener("virgil-linked-anchor-click", handler);
    return () => window.removeEventListener("virgil-linked-anchor-click", handler);
  }, [
    prefsRef,
    setActiveLeft,
    setActiveRight,
    tryScrollOmniEntry,
    getOmniEnabled,
    alignOmniCardWithClick,
    getActiveCardStore,
  ]);

  // Error margin-marker bridge — errors aren't anchored cards (no cardStore
  // ref, no omni entry), so they bypass `routeAnchorClick`. EditorPane owns
  // the toggle (uniform second-click-deselects) and dispatches the post-
  // toggle state; this bridge mirrors it into the shell's error selection
  // (driving the error text-highlight + vbar popover) and, on select, opens
  // the errors panel on whichever side it's docked — the same side-aware
  // open the retired EditorLayout marker builder performed.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { errorId: string; selected: boolean; clickY?: number }
        | undefined;
      if (!detail?.errorId) return;
      setSelectedErrorId(detail.selected ? detail.errorId : null);
      if (!detail.selected) return;
      const p = prefsRef.current;
      // Idempotence guard: only call the opener when the errors panel isn't
      // already docked on its side. The opener is internally idempotent, but
      // calling it unconditionally still churns the dock MRU + fires a spurious
      // openPanel — skip it when there's nothing to open.
      if (isPanelDocked(p, "errors")) return;
      const placement = p.placements.find((pl) => pl.id === "errors");
      if (placement?.side === "left") setActiveLeft("errors");
      else setActiveRight("errors");
    };
    window.addEventListener("virgil-error-marker-click", handler);
    return () => window.removeEventListener("virgil-error-marker-click", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setSelectedErrorId]);
}
