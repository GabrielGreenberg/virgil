// @vitest-environment jsdom
/**
 * Task 1296 — a panel whose ONE collection holds two kinds selects the card's
 * REAL kind. The Notes slot used to be `makeKindSetter(store, "note")`, so
 * clicking a HighlightCard (or creating a highlight) stored `{kind:"note"}`:
 * the halo reconciler looked for a note, missed it, and the existence prune
 * cleared the selection. And a note→highlight morph re-keyed the selection to
 * `highlight`, which `selectedNoteId` (note-only) no longer reported.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createCardStore } from "@/links/_shared/anchored-card-store";
import { registerStoredKindResolver } from "@/links/_shared/stored-kind-resolver";
import { useAnchoredSelectionSlots } from "../selections";
import type { CardKind } from "@/cards/types";

function setup() {
  const store = createCardStore();
  const kinds = new Map<string, CardKind>([
    ["n1", "note"],
    ["h1", "highlight"],
    ["c1", "cutter-comment"],
    ["s1", "cutter-suggestion"],
  ]);
  const notes = registerStoredKindResolver(store, "notes", (id) =>
    kinds.get(id) === "note" || kinds.get(id) === "highlight" ? kinds.get(id)! : null,
  );
  const cutter = registerStoredKindResolver(store, "cutter", (id) =>
    kinds.get(id)?.startsWith("cutter-") ? kinds.get(id)! : null,
  );
  const hook = renderHook(() => useAnchoredSelectionSlots(store));
  return { store, kinds, hook, release: () => { notes(); cutter(); } };
}

describe("panel slot setters resolve the card's real kind (task 1296)", () => {
  it("selecting a highlight through the Notes slot stores kind:'highlight'", () => {
    const { store, hook } = setup();
    act(() => hook.result.current.setSelectedNoteId("h1"));
    expect(store.getState().selected).toEqual({ kind: "highlight", id: "h1" });
    expect(hook.result.current.selectedNoteId).toBe("h1");
  });

  it("a note still selects as a note", () => {
    const { store, hook } = setup();
    act(() => hook.result.current.setSelectedNoteId("n1"));
    expect(store.getState().selected).toEqual({ kind: "note", id: "n1" });
  });

  it("the Notes slot reports either kind — a morph re-key keeps it selected", () => {
    const { store, hook } = setup();
    act(() => hook.result.current.setSelectedNoteId("n1"));
    // The morph policy re-keys the selection to the new kind.
    act(() => store.select({ kind: "highlight", id: "n1" }));
    expect(hook.result.current.selectedNoteId).toBe("n1");
    act(() => hook.result.current.setSelectedNoteId(null));
    expect(store.getState().selected).toBeNull();
  });

  it("a fresh cutter select of a SUGGESTION is not guessed as a comment", () => {
    const { store, hook } = setup();
    act(() => hook.result.current.setSelectedCutterCardId("c1"));
    expect(store.getState().selected).toEqual({ kind: "cutter-comment", id: "c1" });
    // The old setter kept the focused kind for a DIFFERENT card.
    act(() => hook.result.current.setSelectedCutterCardId("s1"));
    expect(store.getState().selected).toEqual({ kind: "cutter-suggestion", id: "s1" });
  });

  it("clearing a slot leaves another panel's selection alone", () => {
    const { store, hook } = setup();
    act(() => hook.result.current.setSelectedCutterCardId("s1"));
    act(() => hook.result.current.setSelectedNoteId(null));
    expect(store.getState().selected).toEqual({ kind: "cutter-suggestion", id: "s1" });
  });

  it("without a registered owner it falls back to the panel's first kind; a release removes only its own resolver", () => {
    const { store, hook, release } = setup();
    release();
    act(() => hook.result.current.setSelectedNoteId("h1"));
    expect(store.getState().selected).toEqual({ kind: "note", id: "h1" });
    // Re-selecting the SAME card keeps its current kind.
    act(() => store.select({ kind: "highlight", id: "h1" }));
    act(() => hook.result.current.setSelectedNoteId("h1"));
    expect(store.getState().selected).toEqual({ kind: "highlight", id: "h1" });
  });
});
