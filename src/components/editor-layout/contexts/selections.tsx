"use client";

import { createContext, useCallback, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  useCardStore,
  useStoreSelection,
  type CardStore,
} from "@/links/_shared/anchored-card-store";
import type { EntityKind } from "@/links/_shared/entity-hover";

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
 *  `store` is the per-doc instance the provider resolved (context for the
 *  per-pane mount, the active-doc store for the shell mount). */
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

/** Like `primarySelectionFor` but matches any of a set of kinds — for the
 *  polymorphic Cutter and Revisions slots that accept two kinds each. */
function polymorphicFocusFor(
  store: CardStore,
  kinds: ReadonlyArray<EntityKind>,
): { kind: EntityKind; id: string } | null {
  const s = store.getState().selected;
  return s && kinds.includes(s.kind) ? s : null;
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
  // per-pane mount passes nothing (uses its CardStoreProvider context store);
  // the shell mount passes the active-doc store so its setters + `sel` target
  // the active doc, not the context default.
  const ctxStore = useCardStore();
  const store = storeOverride ?? ctxStore;
  const sel = useStoreSelection(store);
  const idFor = (k: EntityKind) => (sel && sel.kind === k ? sel.id : null);

  // Setters are stable per store — the store reads "current" state at call
  // time, so they only recreate when the doc's store instance changes.
  const setSelectedNoteId = useCallback(makeKindSetter(store, "note"), [store]);
  const setSelectedFootnoteId = useCallback(makeKindSetter(store, "footnote"), [store]);
  const setSelectedCitationId = useCallback(makeKindSetter(store, "citation"), [store]);
  const setSelectedTodoId = useCallback(makeKindSetter(store, "todo"), [store]);
  const setSelectedArchiveId = useCallback(makeKindSetter(store, "archive"), [store]);
  const setSelectedExampleId = useCallback(makeKindSetter(store, "example"), [store]);
  // Cutter and Revisions still share one slot per panel until U7 splits
  // their polymorphic kinds. Both slots accept any of the panel's two
  // kinds; the slot setter routes to whichever is currently in the store
  // or defaults to the comment kind on a fresh select.
  const setSelectedCutterCardId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const focused = polymorphicFocusFor(store, ["cutter-comment", "cutter-suggestion"]);
      const curId = focused ? focused.id : null;
      const nextId = typeof action === "function" ? action(curId) : action;
      if (nextId == null) {
        const s = store.getState().selected;
        if (s && (s.kind === "cutter-comment" || s.kind === "cutter-suggestion")) {
          store.clearSelection();
        }
        return;
      }
      // Preserve the kind discriminator if the store already has a cutter
      // card focused; otherwise default to "cutter-comment". (Polymorphic
      //-aware callers should set the store directly with the right kind.)
      const kind: EntityKind =
        focused && focused.kind === "cutter-suggestion" ? "cutter-suggestion" : "cutter-comment";
      store.select({ kind, id: nextId });
    },
    [store],
  );
  // Reports shares one slot for its two polymorphic kinds (report +
  // report-request), mirroring the Cutter slot above.
  const setSelectedReportCardId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const focused = polymorphicFocusFor(store, ["report", "report-request"]);
      const curId = focused ? focused.id : null;
      const nextId = typeof action === "function" ? action(curId) : action;
      if (nextId == null) {
        const s = store.getState().selected;
        if (s && (s.kind === "report" || s.kind === "report-request")) {
          store.clearSelection();
        }
        return;
      }
      const kind: EntityKind =
        focused && focused.kind === "report-request" ? "report-request" : "report";
      store.select({ kind, id: nextId });
    },
    [store],
  );
  const setSelectedCommentId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const focused = polymorphicFocusFor(store, ["revision-comment", "revision-suggestion"]);
      const curId = focused ? focused.id : null;
      const nextId = typeof action === "function" ? action(curId) : action;
      if (nextId == null) {
        const s = store.getState().selected;
        if (s && (s.kind === "revision-comment" || s.kind === "revision-suggestion")) {
          store.clearSelection();
        }
        return;
      }
      const kind: EntityKind =
        focused && focused.kind === "revision-suggestion" ? "revision-suggestion" : "revision-comment";
      store.select({ kind, id: nextId });
    },
    [store],
  );

  const cutterId = sel && (sel.kind === "cutter-comment" || sel.kind === "cutter-suggestion") ? sel.id : null;
  const reportId = sel && (sel.kind === "report" || sel.kind === "report-request") ? sel.id : null;
  const commentId = sel && (sel.kind === "revision-comment" || sel.kind === "revision-suggestion") ? sel.id : null;

  return useMemo<SelectionsContextValue>(
    () => ({
      selectedNoteId: idFor("note"),
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
    [sel, cutterId, reportId, commentId, inputs.selectedBibKey, inputs.setSelectedBibKey,
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
  store,
  children,
}: {
  value: SelectionsContextValue | SelectionsProviderInputs;
  /** The active-doc store, passed by the SHELL mount (EditorLayout) so its
   *  derived setters target the active doc. The per-pane mount (EditorPane)
   *  omits it and uses its CardStoreProvider context store. */
  store?: CardStore;
  children: ReactNode;
}) {
  const inputs: SelectionsProviderInputs = {
    selectedBibKey: value.selectedBibKey,
    setSelectedBibKey: value.setSelectedBibKey,
  };
  const derived = useSelectionsValue(inputs, store);
  return <SelectionsCtx.Provider value={derived}>{children}</SelectionsCtx.Provider>;
}

export function useSelectionsContext(): SelectionsContextValue {
  const v = useContext(SelectionsCtx);
  if (!v) throw new Error("useSelectionsContext must be used inside SelectionsProvider");
  return v;
}
