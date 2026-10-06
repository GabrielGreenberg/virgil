// @vitest-environment jsdom
//
// Task 963 — the ONE door between `useAnchoredCard` and the card shell.
//
// Twelve anchored cards used to hand-roll this glue, each with optional
// `onTogglePopout` / `onHoverChange` overrides no caller ever passed. The door
// now owns it, so its contract is pinned here once instead of per card:
//
//   - HOVER publishes to the card store (what lights the in-text anchor), on
//     BOTH shells — `PanelCard` now carries the `onHoverChange` channel
//     `EditableCard` always had, and composes with a caller's own
//     `onMouseEnter`/`onMouseLeave`;
//   - the POP toggle comes from the popped-cards context, keyed by
//     `cardPopKey(kind, id)`, and is absent with no provider;
//   - JUMP is offered iff the card has a jump target, and resolves the source
//     `[data-card]` element for both the chevron and the body click;
//   - COMPRESSED = neither expanded nor popped out.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, renderHook, act, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { PanelCard, CARD_THEMES } from "@/components/panel-primitives";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCardShell } from "../useAnchoredCardShell";

const REF = { kind: "note" as const, id: "n1" };

beforeEach(() => {
  cardStore.clearSelection();
  for (const r of [...cardStore.getState().expandedSet]) cardStore.collapse(r);
  cardStore.setHover(null);
});
afterEach(cleanup);

describe("useAnchoredCardShell — the anchored card's shell bundle", () => {
  it("hover publishes to the card store", () => {
    const { result } = renderHook(() => useAnchoredCardShell(REF));
    act(() => result.current.shell.onHoverChange(true));
    expect(cardStore.getState().hover).toEqual(REF);
    act(() => result.current.shell.onHoverChange(false));
    expect(cardStore.getState().hover).toBeNull();
  });

  it("the pop toggle is the context's, keyed by cardPopKey; none without a provider", () => {
    const toggleAtAnchor = vi.fn();
    const popped = { toggleAtAnchor } as unknown as PoppedCardsValue;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PoppedCardsContext.Provider value={popped}>{children}</PoppedCardsContext.Provider>
    );
    const { result } = renderHook(() => useAnchoredCardShell(REF), { wrapper });
    expect(result.current.cardKey).toBe(cardPopKey("note", "n1"));
    const rect = new DOMRect(1, 2, 3, 4);
    result.current.shell.onTogglePopout!(rect);
    expect(toggleAtAnchor).toHaveBeenCalledWith(cardPopKey("note", "n1"), rect);

    const bare = renderHook(() => useAnchoredCardShell(REF));
    expect(bare.result.current.shell.onTogglePopout).toBeUndefined();
  });

  it("jump is offered iff there is a target; the body click selects and jumps from the card element", () => {
    const none = renderHook(() => useAnchoredCardShell(REF));
    expect(none.result.current.shell.canJump).toBe(false);
    expect(none.result.current.shell.onJump).toBeUndefined();

    const onJump = vi.fn();
    const onSelect = vi.fn();
    const { result } = renderHook(() => useAnchoredCardShell({ ...REF, onJump, onSelect }));
    expect(result.current.shell.canJump).toBe(true);

    const card = document.createElement("div");
    card.setAttribute("data-card", "1");
    const inner = document.createElement("span");
    card.appendChild(inner);
    act(() => result.current.shell.onClick({ currentTarget: inner } as unknown as React.MouseEvent));
    expect(cardStore.isSelected(REF)).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(card);

    result.current.shell.onJump!({ currentTarget: inner } as unknown as React.MouseEvent);
    expect(onJump).toHaveBeenLastCalledWith(card);
  });

  it("compressed = neither expanded nor popped out; the summary is built only when asked for", () => {
    const docked = renderHook(() => useAnchoredCardShell({ ...REF, summaryContent: undefined }));
    expect(docked.result.current.compressed).toBe(true);
    expect(docked.result.current.compressedSummary).toBe("");
    const popped = renderHook(() => useAnchoredCardShell({ ...REF, isPoppedOut: true }));
    expect(popped.result.current.compressed).toBe(false);
    expect(popped.result.current.shell.chromeless).toBe(true);
    const bespoke = renderHook(() => useAnchoredCardShell(REF));
    expect(bespoke.result.current.compressedSummary).toBeUndefined();
  });
});

describe("PanelCard's hover channel (the one hover spelling)", () => {
  it("onHoverChange fires on enter/leave and composes with the caller's own handlers", () => {
    const onHoverChange = vi.fn();
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const { container } = render(
      <PanelCard
        theme={CARD_THEMES.note}
        selected={false}
        onHoverChange={onHoverChange}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div />
      </PanelCard>,
    );
    const root = container.querySelector("[data-card]")!;
    fireEvent.mouseEnter(root);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(root);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });
});
