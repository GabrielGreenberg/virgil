"use client";

import { createContext, useCallback, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  cardStore,
  useSelection,
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
  selectedQuotationGroupId: string | null;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
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
 *  Writes target the `transient` slot only — sticky cards are managed
 *  separately via `cardStore.toggleSelection` (direct card click) and
 *  `markSticky` (focus promotion). The slot setter's read side derives
 *  from the primary focus (transient || newest sticky), so per-kind
 *  callers still see the currently-focused id for their kind. */
function makeKindSetter(kind: EntityKind): Dispatch<SetStateAction<string | null>> {
  return (action) => {
    const sel = primarySelectionFor(kind);
    const curId = sel ? sel.id : null;
    const nextId = typeof action === "function" ? action(curId) : action;
    if (nextId == null) {
      // Clear the transient if it currently refers to this kind. Sticky
      // entries of this kind are not cleared — close them by clicking the
      // card again, which goes through toggleSelection.
      const t = cardStore.getState().transient;
      if (t && t.kind === kind) cardStore.setTransient(null);
      return;
    }
    cardStore.setTransient({ kind, id: nextId });
  };
}

function primarySelectionFor(kind: EntityKind): { kind: EntityKind; id: string } | null {
  const s = cardStore.getState();
  if (s.transient && s.transient.kind === kind) return s.transient;
  for (let i = s.stickySet.length - 1; i >= 0; i--) {
    const ref = s.stickySet[i];
    if (ref.kind === kind) return ref;
  }
  return null;
}

/** Like `primarySelectionFor` but matches any of a set of kinds — for the
 *  polymorphic Cutter and Revisions slots that accept two kinds each. */
function polymorphicFocusFor(
  kinds: ReadonlyArray<EntityKind>,
): { kind: EntityKind; id: string } | null {
  const s = cardStore.getState();
  if (s.transient && kinds.includes(s.transient.kind)) return s.transient;
  for (let i = s.stickySet.length - 1; i >= 0; i--) {
    const ref = s.stickySet[i];
    if (kinds.includes(ref.kind)) return ref;
  }
  return null;
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

export function useAnchoredSelectionSlots(): AnchoredSlotSet {
  // Reuse the derivation by passing a no-op bib pair; we only consume the
  // anchored slots. Cheaper than duplicating the logic.
  const v = useSelectionsValue({
    selectedBibKey: null,
    setSelectedBibKey: NOOP_BIB_SETTER,
  });
  // Strip the bib slots — they're undefined on this caller path.
  const { selectedBibKey: _b, setSelectedBibKey: _sb, ...rest } = v;
  void _b; void _sb;
  return rest;
}

const NOOP_BIB_SETTER: Dispatch<SetStateAction<string | null>> = () => {};

/** Hook that returns the SelectionsContextValue shape, derived live from
 *  the global store. Subscribes to selection changes via useSelection. */
function useSelectionsValue(inputs: SelectionsProviderInputs): SelectionsContextValue {
  const sel = useSelection();
  const idFor = (k: EntityKind) => (sel && sel.kind === k ? sel.id : null);

  // Setters are stable across renders — the store reads "current" state at
  // call time, so the setters never need to be recreated.
  const setSelectedNoteId = useCallback(makeKindSetter("note"), []);
  const setSelectedFootnoteId = useCallback(makeKindSetter("footnote"), []);
  const setSelectedCitationId = useCallback(makeKindSetter("citation"), []);
  const setSelectedTodoId = useCallback(makeKindSetter("todo"), []);
  const setSelectedArchiveId = useCallback(makeKindSetter("archive"), []);
  const setSelectedQuotationGroupId = useCallback(makeKindSetter("quotation"), []);
  const setSelectedExampleId = useCallback(makeKindSetter("example"), []);
  // Cutter and Revisions still share one slot per panel until U7 splits
  // their polymorphic kinds. Both slots accept any of the panel's two
  // kinds; the slot setter routes to whichever is currently in the store
  // or defaults to the comment kind on a fresh select.
  const setSelectedCutterCardId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const focused = polymorphicFocusFor(["cutter-comment", "cutter-suggestion"]);
      const curId = focused ? focused.id : null;
      const nextId = typeof action === "function" ? action(curId) : action;
      if (nextId == null) {
        const t = cardStore.getState().transient;
        if (t && (t.kind === "cutter-comment" || t.kind === "cutter-suggestion")) {
          cardStore.setTransient(null);
        }
        return;
      }
      // Preserve the kind discriminator if the store already has a cutter
      // card focused; otherwise default to "cutter-comment". (Polymorphic
      //-aware callers should set the store directly with the right kind.)
      const kind: EntityKind =
        focused && focused.kind === "cutter-suggestion" ? "cutter-suggestion" : "cutter-comment";
      cardStore.setTransient({ kind, id: nextId });
    },
    [],
  );
  const setSelectedCommentId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const focused = polymorphicFocusFor(["comment", "revision-suggestion"]);
      const curId = focused ? focused.id : null;
      const nextId = typeof action === "function" ? action(curId) : action;
      if (nextId == null) {
        const t = cardStore.getState().transient;
        if (t && (t.kind === "comment" || t.kind === "revision-suggestion")) {
          cardStore.setTransient(null);
        }
        return;
      }
      const kind: EntityKind =
        focused && focused.kind === "revision-suggestion" ? "revision-suggestion" : "comment";
      cardStore.setTransient({ kind, id: nextId });
    },
    [],
  );

  const cutterId = sel && (sel.kind === "cutter-comment" || sel.kind === "cutter-suggestion") ? sel.id : null;
  const commentId = sel && (sel.kind === "comment" || sel.kind === "revision-suggestion") ? sel.id : null;

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
      selectedQuotationGroupId: idFor("quotation"),
      setSelectedQuotationGroupId,
      selectedCommentId: commentId,
      setSelectedCommentId,
      selectedExampleId: idFor("example"),
      setSelectedExampleId,
      selectedBibKey: inputs.selectedBibKey,
      setSelectedBibKey: inputs.setSelectedBibKey,
    }),
    // sel changing covers all per-kind id changes; setters are stable.
    [sel, cutterId, commentId, inputs.selectedBibKey, inputs.setSelectedBibKey,
      setSelectedNoteId, setSelectedFootnoteId, setSelectedCitationId,
      setSelectedTodoId, setSelectedArchiveId, setSelectedCutterCardId,
      setSelectedQuotationGroupId, setSelectedCommentId, setSelectedExampleId],
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
  const derived = useSelectionsValue(inputs);
  return <SelectionsCtx.Provider value={derived}>{children}</SelectionsCtx.Provider>;
}

export function useSelectionsContext(): SelectionsContextValue {
  const v = useContext(SelectionsCtx);
  if (!v) throw new Error("useSelectionsContext must be used inside SelectionsProvider");
  return v;
}
