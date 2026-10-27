import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
// A selector may spell the ATTRIBUTE name inline, but not the token: the
// `<cardKind>:<cardId>` grammar has one builder, and a query that restates it
// is a second speller that silently stops matching if it ever changes (202).
// Every card's DOM address — footnote/citation atoms and the anchor-click
// kinds alike — comes from the ONE owner, `cardEntrySelector` (task 204, then
// 1172 retired this file's own per-kind override table): a composite selector
// drifts the way selectors do — by not matching.
import { cardEntrySelector } from "../panel-selection";
// Pure dock-stack derivation — imported from the LEAF (not the hook module) so
// this bridge stays clear of `useViewPrefs`'s heavy `OmniViewPanel` → storage
// runtime chain (see view-prefs-derived.ts + anchor-route-derivation-contract).
import { isPanelDocked } from "@/hooks/view-prefs-derived";
import type { OmniCategory } from "@/panels/Omni";
import type { CardKind } from "@/panels/_shared/types";
import { CARD_KINDS, panelForCardKind } from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { MODE_B_CARD_KINDS } from "@/cards/mode-b-collections";
import type { CardStore } from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { openForCard, type OpenForCardDeps } from "./open-for-card";
import { placeSelectedCard } from "../selected-card-placement";
import { cardPopKey } from "@/panels/panel-registry";
import { anchorRowId } from "@/links/card-anchor-rows";
import {
  ATOM_CREATE_POPOVER_EVENT,
  type AtomCreateRequest,
  type AtomCreateSession,
} from "@/lib/actions/atom-create";
import { trackPos } from "@/lib/tiptap/tracked-pos";
import { REF_CLICK_EVENT, type ActiveRef, type RefClickDetail } from "@/lib/tiptap/label";
import {
  atomPopoverMayOpen,
  trackAtomPos,
  type ActiveMath,
} from "@/lib/tiptap/atom-edit-target";
import { isFigurePopoverKind, type ActiveFigure } from "@/lib/figures/popover-target";
import {
  CITATION_CLICK_EVENT,
  ERROR_MARKER_CLICK_EVENT,
  FOOTNOTE_CLICK_EVENT,
  LINKED_ANCHOR_CLICK_EVENT,
  resolveClickOrigin,
  type CitationClickDetail,
  type ClickOrigin,
  type ErrorMarkerClickDetail,
  type FootnoteClickDetail,
  type LinkedAnchorClickDetail,
} from "@/lib/pane-click-origin";

/** The card kinds that route through the shared anchor-click body
 *  (`routeAnchorClick`), DERIVED from the registry — never hand-listed (task
 *  1296: a hand-kept nine-kind union omitted `highlight`, so a click on
 *  highlighted text was dispatched and silently swallowed). Two dispatchers
 *  feed it, and the set is exactly their union:
 *   - the in-text `.linked-anchor` span click (`useTextHoverBridge`) — every
 *     Mode-B kind (`MODE_B_CARD_KINDS`, the hover bridge's own SSOT);
 *   - the margin marker click (EditorPane's marker builder — R15: margin
 *     clicks ride the same live bridge) — every kind whose
 *     `CARD_REGISTRY[kind].markerType` paints a card marker.
 *  Inline atoms (footnote, citation) use their own dedicated `virgil-*-click`
 *  events; `error` isn't a card and gets its own small bridge
 *  (`virgil-error-marker-click`) below. */
export const ANCHOR_CLICK_KINDS: readonly CardKind[] = CARD_KINDS.filter((kind) => {
  const marker = CARD_REGISTRY[kind].markerType;
  return MODE_B_CARD_KINDS.includes(kind) || (marker != null && marker !== "error");
});

/** Anchor-click kind → routing config, DERIVED: `cardKind` is the kind itself
 *  and `panelId` is `panelForCardKind(kind)` (the registry SSOT); the entry's
 *  DOM address is `cardEntrySelector(kind, id)`, resolved at click time. A
 *  pin-test asserts these derived routes ≡ frozen literals AND that the key
 *  set ≡ both dispatchers' kinds. */
export const ANCHOR_CLICK_ROUTES: Readonly<
  Partial<Record<CardKind, { panelId: PanelId; cardKind: CardKind }>>
> = Object.fromEntries(
  ANCHOR_CLICK_KINDS.map((kind) => {
    const panel = panelForCardKind(kind);
    // Every routed kind owns a panel; the registry can't return null here.
    if (panel == null) {
      throw new Error(`[marker-clicks] no owning panel for anchor-click kind "${kind}"`);
    }
    return [kind, { panelId: panel as PanelId, cardKind: kind }];
  }),
);

/** Everything `routeAnchorClick` needs: the `openForCard` routing env (prefs
 *  read live at click time) plus the omni click-pin publisher. Built from the
 *  shell's own deps for a click from the editor's current doc, or from the
 *  ORIGIN pane's registered `PaneClickHost` otherwise (task 1093). */
interface AnchorClickEnv {
  getPrefs: () => ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  /** Resolve the routed doc's interaction store at CLICK time. A getter (not a
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
 * and place the card level with the click Y (`placeSelectedCard` — the Omni
 * pin or the native list's slide, task 1179). No document jump — `skipScroll` +
 * a `placement: "none"` select keep the editor row put; alignment happens by
 * pulling the CARD to the click instead.
 */
function routeAnchorClick(
  detail: Omit<LinkedAnchorClickDetail, "docId">,
  env: AnchorClickEnv,
): void {
  const route = ANCHOR_CLICK_ROUTES[detail.kind as CardKind];
  if (!route) return;
  routeCardClick(route, detail, env);
}

/** The inline-atom kinds, routed by the SAME body as the anchor kinds (task
 *  1252) on their own events — derived from the registry exactly as
 *  `ANCHOR_CLICK_ROUTES` is. */
const ATOM_CLICK_ROUTES = {
  footnote: { panelId: panelForCardKind("footnote") as PanelId, cardKind: "footnote" },
  citation: { panelId: panelForCardKind("citation") as PanelId, cardKind: "citation" },
} as const satisfies Record<string, { panelId: PanelId; cardKind: CardKind }>;

/** Select → `openForCard` → place, in the routed doc's env. */
function routeCardClick(
  route: { panelId: PanelId; cardKind: CardKind },
  detail: { kind: EntityKind; entityId: string; clickY?: number; anchorPid?: string },
  env: AnchorClickEnv,
): void {
  const id = detail.entityId;
  // Click → card alignment goes through placeSelectedCard below, NOT
  // through usePlacement (which would scroll the row and drag the editor).
  // See usePlacement's asymmetry-rule docstring. The intent rides the
  // routed doc's own store, bound to this selection change (task 1283).
  // Selection axis only. The event carries the exact kind (the dispatchers
  // resolve comment-vs-suggestion / report-vs-request from the record), so
  // select directly instead of going through the per-kind slot setters
  // (which would have to re-derive the polymorphic kind).
  env.getActiveCardStore().select({ kind: detail.kind, id }, { placement: "none" });

  const entrySelector = cardEntrySelector(route.cardKind, id);

  const clickY: number | undefined =
    typeof detail.clickY === "number" ? detail.clickY : undefined;
  // The omni id a panel stamps IS `cardPopKey(kind,id)` — except a MULTI-anchor
  // card draws one row per anchor keyed `…@<pid>` (T5 Pillar E-2; keyed by
  // pid, not position, since task 916). The margin marker stamps the clicked
  // paragraph's `anchorPid` (only for multi-anchor cards — single-anchor rows
  // have no suffix), so `anchorRowId` appends it here to pin/scroll the RIGHT
  // row (REP-F3-01 / OMNI-F3-01 / OMNI-F8-02). The `openForCard` presence
  // check + `placeSelectedCard` both use the shared prefix-or-exact
  // matcher, so the bare key still resolves if the pid is absent.
  const omniKey = anchorRowId(
    cardPopKey(route.cardKind, id),
    typeof detail.anchorPid === "string" ? detail.anchorPid : undefined,
  );
  openForCard(
    {
      omniKey,
      entrySelector,
      panelId: route.panelId,
      cardKind: route.cardKind,
      // skipScroll: alignment is the selection-alignment door's
      // (`placeSelectedCard`), which moves the CARD, so the document stays put.
      skipScroll: true,
    },
    {
      prefs: env.getPrefs(),
      setActiveLeft: env.setActiveLeft,
      setActiveRight: env.setActiveRight,
      tryScrollOmniEntry: env.tryScrollOmniEntry,
      getOmniEnabled: env.getOmniEnabled,
    } satisfies OpenForCardDeps,
  );
  if (typeof clickY === "number") {
    // Selection alignment (task 1179): the ONE door puts the selected card
    // level with the click in whichever host shows it — the Omni pin or the
    // native list's slide — the frame after the selection commits.
    placeSelectedCard({
      omniKey,
      entrySelector,
      viewportY: clickY,
      store: env.getActiveCardStore(),
    });
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
 * Every card click is routed by its ORIGIN doc (`resolveClickOrigin`, tasks
 * 1093 / 1252): the editor's current doc → the shell's env; another pane's doc
 * → that pane's `PaneClickHost`; a foreign doc with no host → dropped.
 */
export function useMarkerClickBridges(deps: {
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  tryScrollOmniEntry: (key: string, targetY?: number) => boolean;
  getOmniEnabled: (side: "left" | "right") => Set<OmniCategory>;
  /** Error selection setter. Now routes to the per-doc owner in EditorPane
   *  (bubbled up via `paneState.setSelectedErrorId`); the shell passes a stable
   *  `setSelectedErrorIdBridge` wrapper. Called value-only (never an updater),
   *  so a plain `(id) => void` suffices. Synced from margin error-marker clicks. */
  setSelectedErrorId: (id: string | null) => void;
  /** The clicked `\ref` chip, by IDENTITY (owning editor + pos) plus its own
   *  rect and current command — what the label popover opens on. ONE setter
   *  for one fact; the pre-550 label/rect/command triple let the bridge
   *  re-find the chip by its (non-unique) label string. */
  setActiveRef: Dispatch<SetStateAction<ActiveRef | null>>;
  /** Opens the SHARED inline-atom create popover (citation + `\ref`). The
   *  trigger surfaces dispatch `virgil-atom-create-popover` with an
   *  `AtomCreateRequest` (kind + caret rect + captured insertion pos); this
   *  setter lands it in EditorLayout's `atomCreateRequest` state as an
   *  `AtomCreateSession` — the pos now a tracker that follows the doc. */
  setAtomCreateRequest: Dispatch<SetStateAction<AtomCreateSession | null>>;
  /** The clicked math atom's popover session — its click-time `pos` now a
   *  tracker in the OWNING editor (task 1314; `ActiveMath`). */
  setActiveMath: Dispatch<SetStateAction<ActiveMath | null>>;
  /** The clicked figure/graphics block's popover session (`ActiveFigure`). */
  setActiveFigure: Dispatch<SetStateAction<ActiveFigure | null>>;
  /** Resolve the ACTIVE doc's interaction store at click time (see
   *  `AnchorClickEnv.getActiveCardStore`). */
  getActiveCardStore: () => CardStore;
  /** The editor's current doc id, read at click time. A pane-originated click
   *  (`virgil-linked-anchor-click` / `virgil-error-marker-click`, and since
   *  task 1252 `virgil-footnote-click` / `virgil-citation-click`) names its
   *  origin doc; only the current doc's clicks take the shell path — any other
   *  origin (the Library Reader) routes into its OWN pane's host (task 1093). */
  getActiveDocId: () => string | null;
}) {
  const {
    prefsRef,
    setActiveLeft,
    setActiveRight,
    tryScrollOmniEntry,
    getOmniEnabled,
    setSelectedErrorId,
    setActiveRef,
    setAtomCreateRequest,
    setActiveMath,
    setActiveFigure,
    getActiveCardStore,
    getActiveDocId,
  } = deps;

  // The routing env for a click, by ORIGIN (task 1093; the atom events joined
  // in task 1252): the editor's current doc takes the shell's store + persisted
  // prefs; a click from another pane (the Library Reader, on its own ephemeral
  // prefs) routes into THAT pane's host. `drop` is answered by the caller.
  const envFor = useCallback(
    (origin: Exclude<ClickOrigin, { route: "drop" }>): AnchorClickEnv =>
      origin.route === "shell"
        ? {
            getPrefs: () => prefsRef.current,
            setActiveLeft,
            setActiveRight,
            tryScrollOmniEntry,
            getOmniEnabled,
            getActiveCardStore,
          }
        : {
            getPrefs: origin.host.getPrefs,
            setActiveLeft: origin.host.setActiveLeft,
            setActiveRight: origin.host.setActiveRight,
            // The omni DOM helpers are pane-agnostic: they resolve the
            // VISIBLE pane's entry first (task 873), which is the pane the
            // user just clicked in.
            tryScrollOmniEntry,
            getOmniEnabled: origin.host.getOmniEnabled,
            getActiveCardStore: () => origin.host.cardStore,
          },
    [prefsRef, setActiveLeft, setActiveRight, tryScrollOmniEntry, getOmniEnabled, getActiveCardStore],
  );

  // Inline-atom marker clicks (Footnote / Citation NodeViews). They name their
  // origin doc (task 1252) and ride the SAME select → open → place body as the
  // anchor kinds, so a Reader click opens the READER's card and never selects
  // in — or docks panels through the persisted prefs of — the editor's paper.
  useEffect(() => {
    const onFootnote = (e: Event) => {
      const detail = (e as CustomEvent).detail as FootnoteClickDetail | undefined;
      if (!detail?.footnoteId) return;
      const origin = resolveClickOrigin(detail.docId, getActiveDocId());
      if (origin.route === "drop") return;
      routeCardClick(
        ATOM_CLICK_ROUTES.footnote,
        { kind: "footnote", entityId: detail.footnoteId, clickY: detail.clickY },
        envFor(origin),
      );
    };
    const onCitation = (e: Event) => {
      const detail = (e as CustomEvent).detail as CitationClickDetail | undefined;
      if (!detail?.citationId) return;
      const origin = resolveClickOrigin(detail.docId, getActiveDocId());
      if (origin.route === "drop") return;
      routeCardClick(
        ATOM_CLICK_ROUTES.citation,
        { kind: "citation", entityId: detail.citationId, clickY: detail.clickY },
        envFor(origin),
      );
    };
    window.addEventListener(FOOTNOTE_CLICK_EVENT, onFootnote);
    window.addEventListener(CITATION_CLICK_EVENT, onCitation);
    return () => {
      window.removeEventListener(FOOTNOTE_CLICK_EVENT, onFootnote);
      window.removeEventListener(CITATION_CLICK_EVENT, onCitation);
    };
  }, [envFor, getActiveDocId]);

  // The EDIT-existing-`\ref` bridge. The chip's NodeView dispatches its
  // IDENTITY — `pos` in the editor that OWNS it, plus that chip's own rect —
  // and the popover opens on exactly that chip (task 550). Pre-550 the detail
  // carried only the label string and this handler re-found the chip with a
  // document-wide `querySelector('[data-label=…]')`: the FIRST chip in DOM
  // order, so clicking the second of two `\ref{sec:intro}` chips opened the
  // popover beside the first (off-screen) and re-pointed the first; under
  // multi-doc keep-alive the first DOM match could be a HIDDEN pane's chip
  // (task 438's class). No DOM lookup now, so no pane to get wrong. Validated
  // the way the math/figure/atom-create bridges validate their owner: a
  // malformed detail is dropped rather than resolved against MAIN.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Partial<RefClickDetail> | undefined;
      if (!detail || typeof detail.label !== "string" || !detail.label) return;
      if (typeof detail.pos !== "number") return;
      if (!(detail.rect instanceof DOMRect)) return;
      const owner = detail.editor as Editor | undefined;
      if (!owner || typeof owner.isEditable !== "boolean") return;
      // Task 1071: the atom-popover door — a read-only / pen-held owner opens
      // nothing (`isEditable` is a constant `true` on MAIN).
      if (!atomPopoverMayOpen(owner)) return;
      const cmd = detail.refCommand;
      // The chip's pos FOLLOWS the owner's doc from this moment (task 1314),
      // started synchronously with the open; EditorLayout disposes it when the
      // popover closes or is replaced.
      setActiveRef({
        label: detail.label,
        at: trackAtomPos(owner, detail.pos),
        editor: owner,
        rect: detail.rect,
        refCommand:
          cmd === "getref" || cmd === "getfullref" || cmd === "ref" ? cmd : "ref",
      });
    };
    window.addEventListener(REF_CLICK_EVENT, handler);
    return () => window.removeEventListener(REF_CLICK_EVENT, handler);
  }, [setActiveRef]);

  // (`\ref` CREATE flows through the SHARED `virgil-atom-create-popover`
  // event below — `kind: "ref"` — alongside citation. The retired
  // `virgil-ref-create-popover` event is gone; the EDIT-existing-`\ref` listener
  // above (`REF_CLICK_EVENT`) is a separate path.)

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
      const editor = owner && typeof owner.isEditable === "boolean" ? owner : undefined;
      // The captured `pos` FOLLOWS the owner's document from this moment
      // (task 1190): an edit landing while the user picks maps it, a deletion
      // of the spot nulls it and the commit refuses. Started HERE, synchronously
      // with the open, so no transaction can slip between capture and tracking.
      // EditorLayout's request effect disposes it when the popover closes or is
      // replaced.
      setAtomCreateRequest({
        kind,
        rect,
        at: trackPos(editor, pos),
        refCommand: detail.refCommand ?? "ref",
        editor,
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
      // Task 1071: the atom-popover door — a read-only / pen-held owner opens
      // nothing (`isEditable` is a constant `true` on MAIN).
      if (!atomPopoverMayOpen(owner)) return;
      setActiveMath({
        kind: detail.kind,
        latex: typeof detail.latex === "string" ? detail.latex : "",
        // Tracked from the click (task 1314) — see the `\ref` bridge above.
        at: trackAtomPos(owner, detail.pos),
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
      // Task 1082: the kind is half the clicked identity — the save runs ONLY
      // that kind's door — so an unknown kind is malformed.
      if (!isFigurePopoverKind(detail.kind)) return;
      if (!(detail.rect instanceof DOMRect)) return;
      // The owning editor is required: the save dispatches into THIS instance,
      // so `pos` is read in the pos-space it was minted in (main OR the figure
      // float). A detail without it is malformed — bail rather than fall back to
      // MAIN, which would re-introduce the EX-F4-02 mis-target (figure twin).
      const owner = detail.editor as Editor | undefined;
      if (!owner || typeof owner.isEditable !== "boolean") return;
      // Task 1071: the atom-popover door — a read-only / pen-held owner opens
      // nothing (`isEditable` is a constant `true` on MAIN).
      if (!atomPopoverMayOpen(owner)) return;
      setActiveFigure({
        kind: detail.kind,
        raw: typeof detail.raw === "string" ? detail.raw : "",
        uuid: typeof detail.uuid === "string" && detail.uuid ? detail.uuid : null,
        // Tracked from the click (task 1314) — see the `\ref` bridge above.
        at: trackAtomPos(owner, detail.pos),
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
  // `routeAnchorClick`: select + `openForCard` (omni-first) + place the card
  // at the click Y — one shared route for in-text AND margin clicks.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as LinkedAnchorClickDetail | undefined;
      if (!detail?.entityId || !detail.kind) return;
      // Route by ORIGIN (task 1093): the editor's current doc takes the shell's
      // store + persisted prefs; a click from another pane (the Library
      // Reader, on its own ephemeral prefs) routes into THAT pane's host; an
      // origin with no host is dropped — its pane already selected locally,
      // and the shell's store/prefs are not its to touch.
      const origin = resolveClickOrigin(detail.docId, getActiveDocId());
      if (origin.route === "drop") return;
      routeAnchorClick(detail, envFor(origin));
    };
    window.addEventListener(LINKED_ANCHOR_CLICK_EVENT, handler);
    return () => window.removeEventListener(LINKED_ANCHOR_CLICK_EVENT, handler);
  }, [envFor, getActiveDocId]);

  // Error margin-marker bridge — errors aren't anchored cards (no cardStore
  // ref, no omni entry), so they bypass `routeAnchorClick`. EditorPane owns
  // the toggle (uniform second-click-deselects) and dispatches the post-
  // toggle state; this bridge mirrors it into the shell's error selection
  // (driving the error text-highlight + vbar popover) and, on select, opens
  // the errors panel on whichever side it's docked — the same side-aware
  // open the retired EditorLayout marker builder performed.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as ErrorMarkerClickDetail | undefined;
      if (!detail?.errorId) return;
      // Same origin routing as the anchor-click bridge above (task 1093).
      const origin = resolveClickOrigin(detail.docId, getActiveDocId());
      if (origin.route === "drop") return;
      const route =
        origin.route === "shell"
          ? { setSelected: setSelectedErrorId, prefs: prefsRef.current, setActiveLeft, setActiveRight }
          : {
              setSelected: origin.host.setSelectedErrorId,
              prefs: origin.host.getPrefs(),
              setActiveLeft: origin.host.setActiveLeft,
              setActiveRight: origin.host.setActiveRight,
            };
      route.setSelected(detail.selected ? detail.errorId : null);
      if (!detail.selected) return;
      const p = route.prefs;
      // Idempotence guard: only call the opener when the errors panel isn't
      // already docked on its side. The opener is internally idempotent, but
      // calling it unconditionally still churns the dock MRU + fires a spurious
      // openPanel — skip it when there's nothing to open.
      if (isPanelDocked(p, "errors")) return;
      const placement = p.placements.find((pl) => pl.id === "errors");
      if (placement?.side === "left") route.setActiveLeft("errors");
      else route.setActiveRight("errors");
    };
    window.addEventListener(ERROR_MARKER_CLICK_EVENT, handler);
    return () => window.removeEventListener(ERROR_MARKER_CLICK_EVENT, handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setSelectedErrorId, getActiveDocId]);
}
