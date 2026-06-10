// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePristineCardManager } from "../usePristineCardManager";
import {
  usePristineCardsContext,
  usePristineKind,
} from "@/components/editor-layout/contexts/pristine-cards";

/**
 * A3 Commit E (R21) pin-test. EditorLayout's duplicate pristine-card manager
 * + its `<PristineCardsProvider>` wrapper were render-dead (panels moved to
 * EditorPane post-7.8) and were deleted. The SINGLE live manager now lives in
 * EditorPane.
 *
 * These pins guard the two invariants the deletion relied on:
 *   1. The pristine context returning null (no provider in the tree) breaks
 *      nothing — the reader-pane mount and the EditorLayout parity mounts run
 *      WITHOUT a PristineCardsProvider, falling back to each hook's own
 *      `usePristineTracker` (the `?? localPristine` net, kept per the WS2
 *      defer ruling).
 *   2. The standalone manager (EditorPane's single instance) still works.
 */
describe("R21: pristine context is render-dead-safe; one live manager", () => {
  it("usePristineCardsContext() returns null with no provider (does not throw)", () => {
    const { result } = renderHook(() => usePristineCardsContext());
    expect(result.current).toBeNull();
  });

  it("usePristineKind(...) returns null with no provider (the dead-context path)", () => {
    const { result } = renderHook(() => usePristineKind("note"));
    expect(result.current).toBeNull();
  });

  it("the single standalone manager (EditorPane's) tracks + discards per kind", () => {
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("note");
    let discarded: string | null = null;
    act(() => {
      notes.registerDiscard((id) => {
        discarded = id;
      });
      notes.markNew("note-1");
    });
    expect(notes.isPristine("note-1")).toBe(true);
    act(() => {
      notes.discardAll();
    });
    expect(notes.isPristine("note-1")).toBe(false);
    expect(discarded).toBe("note-1");
  });
});
