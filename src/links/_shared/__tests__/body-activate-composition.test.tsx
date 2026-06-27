// @vitest-environment jsdom
//
// C15 — the single select/jump composition. Every anchored card body routes
// its click through `useAnchoredCard().onBodyActivate`. This pins the three
// invariants of the composition class the audit flagged across FN/CI/EX/REP:
//
//   - MONOTONIC select: the body always SELECTS (store SSOT), never toggles —
//     so a re-click of an already-selected card keeps its halo.
//   - SKIP-JUMP on re-click: the jump fires only on a FRESH select, so
//     re-clicking a selected card does NOT double-jump (FN-F2-01 et al.).
//   - host onSelect is mirrored (monotonically) on every body click, so the
//     per-panel selection slot tracks the store and can never diverge.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { defaultCardStore as cardStore, type AnchoredCardRef } from "@/links/_shared/anchored-card-store";

const REF: AnchoredCardRef = { kind: "footnote", id: "fn1" };
const OTHER: AnchoredCardRef = { kind: "note", id: "n9" };

beforeEach(() => {
  cardStore.clearSelection();
  for (const r of [...cardStore.getState().expandedSet]) cardStore.collapse(r);
  cardStore.setHover(null);
});

describe("useAnchoredCard.onBodyActivate — the C15 select/jump composition", () => {
  it("first click selects + expands + jumps + mirrors onSelect", () => {
    const { result } = renderHook(() => useAnchoredCard(REF));
    const onSelect = vi.fn();
    const jump = vi.fn();

    act(() => result.current.onBodyActivate({ onSelect, jump }));

    expect(cardStore.isSelected(REF)).toBe(true);
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledTimes(1); // fresh select → jump
  });

  it("re-click of a SELECTED card keeps the halo and does NOT double-jump", () => {
    const { result } = renderHook(() => useAnchoredCard(REF));
    const onSelect = vi.fn();
    const jump = vi.fn();

    act(() => result.current.onBodyActivate({ onSelect, jump }));
    act(() => result.current.onBodyActivate({ onSelect, jump }));

    // Halo stays put (monotonic select, store SSOT) ...
    expect(cardStore.isSelected(REF)).toBe(true);
    // ... onSelect mirrors on every click (monotonic — never toggles to null) ...
    expect(onSelect).toHaveBeenCalledTimes(2);
    // ... but the jump fired ONLY on the fresh select, not the re-click.
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("clicking a DIFFERENT card after one was selected is a fresh select → jumps", () => {
    const { result } = renderHook(() => useAnchoredCard(REF));
    const otherJump = vi.fn();

    // Select a sibling first (the store holds OTHER).
    act(() => cardStore.select(OTHER));
    expect(cardStore.isSelected(OTHER)).toBe(true);

    // Now activate THIS card — it was not selected, so it jumps.
    act(() => result.current.onBodyActivate({ jump: otherJump }));
    expect(cardStore.isSelected(REF)).toBe(true);
    expect(cardStore.isSelected(OTHER)).toBe(false);
    expect(otherJump).toHaveBeenCalledTimes(1);
  });

  it("re-selecting after a deselect jumps again (the skip is per-current-selection)", () => {
    const { result } = renderHook(() => useAnchoredCard(REF));
    const jump = vi.fn();

    act(() => result.current.onBodyActivate({ jump })); // fresh → jump
    act(() => cardStore.clearSelection()); // click-away clears the halo
    act(() => result.current.onBodyActivate({ jump })); // fresh again → jump

    expect(jump).toHaveBeenCalledTimes(2);
    expect(cardStore.isSelected(REF)).toBe(true);
  });

  it("a body with no jump (orphan) still composes select + onSelect idempotently", () => {
    const { result } = renderHook(() => useAnchoredCard(REF));
    const onSelect = vi.fn();

    act(() => result.current.onBodyActivate({ onSelect }));
    act(() => result.current.onBodyActivate({ onSelect }));

    expect(cardStore.isSelected(REF)).toBe(true);
    expect(cardStore.isExpanded(REF)).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(2); // monotonic, halo never dropped
  });
});
