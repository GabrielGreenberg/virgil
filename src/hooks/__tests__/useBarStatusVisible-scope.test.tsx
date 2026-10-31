// @vitest-environment jsdom
//
// Task 1389 — the settle dwell has an IDENTITY. The bar's status items are
// mounted unkeyed, so a paper switch hands one mounted item another document's
// state. Paper A's dwell having elapsed must not let paper B's pill paint at
// once: B starts a fresh window, on the very render of the switch.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";

import CoworkPenBadge from "@/components/CoworkPenBadge";
import { useBarStatusVisible } from "@/hooks/useBarStatusVisible";
import { BAR_STATUS_POLICY, type BarStatusDocScopedId } from "@/lib/bar-status-policy";
import { clearCoworkPen, noteCoworkPen } from "@/lib/cowork-pen";

const SETTLE = BAR_STATUS_POLICY["save-state"].settleMs;
const UNSAVED = { tier: "unsaved", reason: null } as const;

afterEach(() => {
  cleanup();
  clearCoworkPen();
  vi.useRealTimers();
});

describe("useBarStatusVisible · the dwell is per scope (task 1389)", () => {
  it("settled for A, switched to B while still settling → hidden until B's own window elapses", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string }) => useBarStatusVisible("save-state", UNSAVED, doc),
      { initialProps: { doc: "doc-A" } },
    );
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(SETTLE + 10));
    expect(result.current).toBe(true);

    // The switch render itself must not paint B (no one-render flash).
    rerender({ doc: "doc-B" });
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(SETTLE - 1_000));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(true);
  });

  it("an unchanged scope keeps its settled dwell across re-renders", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string }) => useBarStatusVisible("save-state", UNSAVED, doc),
      { initialProps: { doc: "doc-A" } },
    );
    act(() => void vi.advanceTimersByTime(SETTLE + 10));
    rerender({ doc: "doc-A" });
    expect(result.current).toBe(true);
  });

  it("switching BACK to A also starts fresh — the dwell is not a per-doc cache", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string }) => useBarStatusVisible("save-state", UNSAVED, doc),
      { initialProps: { doc: "doc-A" } },
    );
    act(() => void vi.advanceTimersByTime(SETTLE + 10));
    rerender({ doc: "doc-B" });
    rerender({ doc: "doc-A" });
    expect(result.current).toBe(false);
  });

  it("a must-see-now verdict is unaffected by the scope", () => {
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string }) =>
        useBarStatusVisible("save-state", { tier: "blocked", reason: "preservation" }, doc),
      { initialProps: { doc: "doc-A" } },
    );
    expect(result.current).toBe(true);
    rerender({ doc: "doc-B" });
    expect(result.current).toBe(true);
  });

  it("the real item: a held pen on A, then the bar switches to B whose pen is held → B waits", () => {
    vi.useFakeTimers();
    const hold = (docId: string) =>
      noteCoworkPen(docId, {
        holder: "claude",
        since: Date.now(),
        expiresAt: Date.now() + 120_000,
        source: "pen-context",
      });
    hold("doc-A");
    hold("doc-B");
    const settle = BAR_STATUS_POLICY["cowork-pen"].settleMs;
    const { rerender } = render(<CoworkPenBadge docId="doc-A" />);
    act(() => void vi.advanceTimersByTime(settle + 10));
    expect(screen.queryByText(/./)).not.toBeNull();

    rerender(<CoworkPenBadge docId="doc-B" />);
    expect(screen.queryByText(/./)).toBeNull();
    act(() => void vi.advanceTimersByTime(settle + 10));
    expect(screen.queryByText(/./)).not.toBeNull();
  });

  it("the overloads REQUIRE a scope for exactly the policy's doc-scoped rows", () => {
    // Compile-time half (tsc is the guard): a doc-scoped id without its
    // document, or an app-wide id with one, does not type-check.
    const typeOnly = () => {
      // @ts-expect-error — a per-document item must name its document
      useBarStatusVisible("save-state", UNSAVED);
      // @ts-expect-error — a session-wide item has no document
      useBarStatusVisible("compile", { compiling: true }, "doc-A");
    };
    void typeOnly;
    // Runtime half: the table's `scope` agrees with the union the overloads use.
    const docScoped: readonly BarStatusDocScopedId[] = [
      "cowork-pen",
      "preservation",
      "mirror-recovery",
      "sync-conflict",
      "external-change",
      "save-state",
    ];
    const declared = Object.entries(BAR_STATUS_POLICY)
      .filter(([, e]) => e.scope === "doc")
      .map(([id]) => id)
      .sort();
    expect(declared).toEqual([...docScoped].sort());
    for (const [id, e] of Object.entries(BAR_STATUS_POLICY)) {
      expect(["doc", "app"], id).toContain(e.scope);
    }
  });
});
