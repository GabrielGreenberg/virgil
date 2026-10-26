"use client";

import { createContext, useCallback, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  useCardStore,
  useStoreSelection,
  type CardStore,
} from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";
import { STORED_KIND_BY_PANEL, type PolymorphicPanel } from "@/cards/predicates";
import { resolveStoredKind } from "@/links/_shared/stored-kind-resolver";

/**
 * "Which card is selected" state — one slot per panel kind that has a
 * selection concept. Backed by the global `cardStore` (`useSyncExternalStore`-
 * based, module-scope) so editor and reader surfaces share state. The
 * per-kind slots stay as the public shape callers consume; the implementation
 * derives them from the single store selection.
 *
 * `bib` and `error` aren't anchored cards (no doc anchor + no marginalia),
 * so their slots remain plain per-pane `useState` driven by the value the
 * provider receives. The store doesn't carry those.
 */

export interface SelectionsContextValue {
  /** The store's ONE selection, kind and all — what the per-kind slots below
   *  are projections of. Consumers that ask "which card is selected in panel
   *  P?" derive from this + `panelForCardKind` rather than switching over the
   *  slots (`getPanelSelection`, task 1172). */
  selected: { kind: EntityKind; id: string } | null;
  selectedNoteId: string | null;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  selectedFootnoteId: string | null;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  selectedCitationId: string | null;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  selectedTodoId: string | null;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  selectedArchiveId: string | null;
  setSelectedArchiveId: Dispatch<SetStateAction<string | null>>;
  selectedCutterCardId: string | null;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  selectedReportCardId: string | null;
  setSelectedReportCardId: Dispatch<SetStateAction<string | null>>;
  selectedCommentId: string | null;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  selectedBibKey: string | null;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
  selectedExampleId: string | null;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;
}

/** Bib is the one non-anchored selection slot the provider still threads
 *  externally. (Errors are panel-internal and have their own state.) */
export interface SelectionsProviderInputs {
  selectedBibKey: string | null;
  setSelectedBibKey: Dispatch<SetStateAction<string | null>>;
}

/** Build a per-kind setter that routes through the global store. The
 *  setter accepts a value or an updater, matching React's setState shape
 *  so existing callers keep compiling unchanged.
 *
 *  Writes target the SELECTION axis only (`select`/`clearSelection`): a
 *  per-kind "selected id" is the selection slot when it holds this kind. It
 *  does NOT expand the card (N1: selecting ≠ expanding) — a marker click that
 *  routes here selects + scrolls without unfurling the body.
 *
 *  `store` is the per-doc instance resolved by the caller (context for the
 *  per-pane provider, the active-doc store for the shell's slot hook). */
function makeKindSetter(store: CardStore, kind: EntityKind): Dispatch<SetStateAction<string | null>> {
  return (action) => {
    const sel = primarySelectionFor(store, kind);
    const curId = sel ? sel.id : null;
    const nextId = typeof action === "function" ? action(curId) : action;
    if (nextId == null) {
      // Clear the selection if it currently refers to this kind.
      const s = store.getState().selected;
      if (s && s.kind === kind) store.clearSelection();
      return;
    }
    store.select({ kind, id: nextId });
  };
}

function primarySelectionFor(store: CardStore, kind: EntityKind): { kind: EntityKind; id: string } | null {
  const s = store.getState().selected;
  return s && s.kind === kind ? s : null;
}

/** The card kinds panel `P`'s one collection holds — READ from the
 *  stored-kind table, first row first (its fallback kind). */
function panelKinds(panel: PolymorphicPanel): readonly EntityKind[] {
  return Object.values(STORED_KIND_BY_PANEL[panel]) as EntityKind[];
}

/** The selected id when the selection is one of `kinds`, else null. */
function idForKinds(
  sel: { kind: EntityKind; id: string } | null,
  kinds: readonly EntityKind[],
): string | null {
  return sel && kinds.includes(sel.kind) ? sel.id : null;
}

/** The slot setter for a panel whose collection holds several card kinds
 *  (`STORED_KIND_BY_PANEL`: notes, revisions, cutter, reports). An id alone
 *  does not say which kind the card is, so a select RESOLVES it through the
 *  owning pane's registered resolver (`resolveStoredKind`) — a highlight is
 *  selected as `highlight`, a cut suggestion as `cutter-suggestion` (task
 *  1296). Without a resolver (no pane mounted, an id it does not hold) it
 *  keeps the current kind when re-selecting the SAME card, and only then
 *  falls back to the panel's first kind. Clearing clears only a selection
 *  that belongs to this panel. */
function makePanelSlotSetter(
  store: CardStore,
  panel: PolymorphicPanel,
): Dispatch<SetStateAction<string | null>> {
  const kinds = panelKinds(panel);
  return (action) => {
    const s = store.getState().selected;
    const focused = s && kinds.includes(s.kind) ? s : null;
    const nextId = typeof action === "function" ? action(focused ? focused.id : null) : action;
    if (nextId == null) {
      if (focused) store.clearSelection();
      return;
    }
    const kind: EntityKind =
      resolveStoredKind(store, panel, nextId) ??
      (focused && focused.id === nextId ? focused.kind : kinds[0]);
    store.select({ kind, id: nextId });
  };
}

/** Public hook for components that own per-kind selection slots in their
 *  local scope (e.g. EditorLayout, EditorPane). Returns the full anchored
 *  slot set derived from the global store, with stable setters that route
 *  through the store. Drop-in replacement for ten `useState<string|null>(null)`
 *  declarations.
 *
 *  Excludes `selectedBibKey` because bib isn't an anchored kind — bib
 *  selection stays as its own per-pane useState, threaded into the provider
 *  separately. */
export type AnchoredSlotSet = Omit<SelectionsContextValue, "selectedBibKey" | "setSelectedBibKey">;

export function useAnchoredSelectionSlots(storeOverride?: CardStore): AnchoredSlotSet {
  // Reuse the derivation by passing a no-op bib pair; we only consume the
  // anchored slots. Cheaper than duplicating the logic. `storeOverride` is the
  // active-doc store the SHELL caller (EditorLayout) passes so its setters
  // target the active doc, not the context default.
  const v = useSelectionsValue(
    {
      selectedBibKey: null,
      setSelectedBibKey: NOOP_BIB_SETTER,
    },
    storeOverride,
  );
  // Strip the bib slots — they're undefined on this caller path.
  const { selectedBibKey: _b, setSelectedBibKey: _sb, ...rest } = v;
  void _b; void _sb;
  return rest;
}

const NOOP_BIB_SETTER: Dispatch<SetStateAction<string | null>> = () => {};

/** Hook that returns the SelectionsContextValue shape, derived live from
 *  the global store. Subscribes to selection changes via useSelection. */
function useSelectionsValue(
  inputs: SelectionsProviderInputs,
  storeOverride?: CardStore,
): SelectionsContextValue {
  // Always read context (hooks-rule), then prefer the explicit override: the
  // per-pane provider passes nothing (uses its CardStoreProvider context
  // store); the shell's `useAnchoredSelectionSlots(activeCardStore)` passes
  // the active-doc store so its setters + `sel` target the active doc.
  const ctxStore = useCardStore();
  const store = storeOverride ?? ctxStore;
  const sel = useStoreSelection(store);
  const idFor = (k: EntityKind) => (sel && sel.kind === k ? sel.id : null);

  // Setters are stable per store — the store reads "current" state at call
  // time, so they only recreate when the doc's store instance changes.
  const setSelectedNoteId = useCallback(makePanelSlotSetter(store, "notes"), [store]);
  const setSelectedFootnoteId = useCallback(makeKindSetter(store, "footnote"), [store]);
  const setSelectedCitationId = useCallback(makeKindSetter(store, "citation"), [store]);
  const setSelectedTodoId = useCallback(makeKindSetter(store, "todo"), [store]);
  const setSelectedArchiveId = useCallback(makeKindSetter(store, "archive"), [store]);
  const setSelectedExampleId = useCallback(makeKindSetter(store, "example"), [store]);
  // The four panels whose one collection holds several kinds share ONE
  // factory, read from `STORED_KIND_BY_PANEL` — never a hand-listed pair.
  const setSelectedCutterCardId = useCallback(makePanelSlotSetter(store, "cutter"), [store]);
  const setSelectedReportCardId = useCallback(makePanelSlotSetter(store, "reports"), [store]);
  const setSelectedCommentId = useCallback(makePanelSlotSetter(store, "revisions"), [store]);

  const noteId = idForKinds(sel, panelKinds("notes"));
  const cutterId = idForKinds(sel, panelKinds("cutter"));
  const reportId = idForKinds(sel, panelKinds("reports"));
  const commentId = idForKinds(sel, panelKinds("revisions"));

  return useMemo<SelectionsContextValue>(
    () => ({
      selected: sel ? { kind: sel.kind, id: sel.id } : null,
      selectedNoteId: noteId,
      setSelectedNoteId,
      selectedFootnoteId: idFor("footnote"),
      setSelectedFootnoteId,
      selectedCitationId: idFor("citation"),
      setSelectedCitationId,
      selectedTodoId: idFor("todo"),
      setSelectedTodoId,
      selectedArchiveId: idFor("archive"),
      setSelectedArchiveId,
      selectedCutterCardId: cutterId,
      setSelectedCutterCardId,
      selectedReportCardId: reportId,
      setSelectedReportCardId,
      selectedCommentId: commentId,
      setSelectedCommentId,
      selectedExampleId: idFor("example"),
      setSelectedExampleId,
      selectedBibKey: inputs.selectedBibKey,
      setSelectedBibKey: inputs.setSelectedBibKey,
    }),
    // sel changing covers all per-kind id changes; setters are stable.
    [sel, noteId, cutterId, reportId, commentId, inputs.selectedBibKey, inputs.setSelectedBibKey,
      setSelectedNoteId, setSelectedFootnoteId, setSelectedCitationId,
      setSelectedTodoId, setSelectedArchiveId, setSelectedCutterCardId,
      setSelectedReportCardId,
      setSelectedCommentId, setSelectedExampleId],
  );
}

const SelectionsCtx = createContext<SelectionsContextValue | null>(null);

/**
 * Provider — accepts the legacy 10-slot value shape for back-compat OR a
 * minimal shape carrying just the bib slot. Either way the rendered
 * context value is derived from the global cardStore for the 10 anchored
 * slots; only `selectedBibKey` flows through from the input.
 *
 * During the migration both shapes are accepted so EditorLayout's existing
 * call site keeps working without an immediate rewrite.
 */
export function SelectionsProvider({
  value,
  children,
}: {
  value: SelectionsContextValue | SelectionsProviderInputs;
  children: ReactNode;
}) {
  const inputs: SelectionsProviderInputs = {
    selectedBibKey: value.selectedBibKey,
    setSelectedBibKey: value.setSelectedBibKey,
  };
  // Per-pane only (task 870): the provider reads its pane's CardStoreProvider
  // store. The shell no longer mounts a copy — see
  // `no-shell-shadowed-pane-providers.test.ts`.
  const derived = useSelectionsValue(inputs);
  return <SelectionsCtx.Provider value={derived}>{children}</SelectionsCtx.Provider>;
}

export function useSelectionsContext(): SelectionsContextValue {
  const v = useContext(SelectionsCtx);
  if (!v) throw new Error("useSelectionsContext must be used inside SelectionsProvider");
  return v;
}
