// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecar: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
}));

import { usePersistentState } from "../usePersistentState";

interface Shape {
  items: string[];
}

const EMPTY: Shape = { items: [] };

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

describe("usePersistentState", () => {
  it("hydrates state from readSidecar on mount", async () => {
    mockRead.mockResolvedValue({ items: ["a", "b"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["a", "b"]));
    expect(mockRead).toHaveBeenCalledWith("doc-1", "test.json", EMPTY);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("persists on update()", async () => {
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    expect(result.current.state.items).toEqual(["x"]);
    await waitFor(() =>
      expect(mockWrite).toHaveBeenCalledWith("doc-1", "test.json", { items: ["x"] }),
    );
  });

  it("resets to defaultValue without writing when docId becomes null", async () => {
    mockRead.mockResolvedValue({ items: ["loaded"] });
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        usePersistentState<Shape>(id, "test.json", EMPTY),
      { initialProps: { id: "doc-1" as string | null } },
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["loaded"]));

    mockWrite.mockClear();
    rerender({ id: null });
    await waitFor(() => expect(result.current.state).toBe(EMPTY));
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("reloads when docId switches", async () => {
    mockRead
      .mockResolvedValueOnce({ items: ["from-doc-1"] })
      .mockResolvedValueOnce({ items: ["from-doc-2"] });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        usePersistentState<Shape>(id, "test.json", EMPTY),
      { initialProps: { id: "doc-1" } },
    );
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-doc-1"]),
    );
    rerender({ id: "doc-2" });
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-doc-2"]),
    );
  });

  it("runs migrate() on loaded data", async () => {
    mockRead.mockResolvedValue({ items: ["raw"] });
    const migrate = vi.fn((raw: unknown) => {
      const r = raw as Shape;
      return { items: r.items.map((s) => s.toUpperCase()) };
    });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY, { migrate }),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["RAW"]));
    expect(migrate).toHaveBeenCalledWith({ items: ["raw"] });
  });

  it("persists migrated state when persistMigrationOnLoad is true", async () => {
    mockRead.mockResolvedValue({ items: ["legacy"] });
    const migrate = (raw: unknown) => {
      const r = raw as Shape;
      return { items: r.items.map((s) => s + "-upgraded") };
    };
    renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY, {
        migrate,
        persistMigrationOnLoad: true,
      }),
    );
    await waitFor(() =>
      expect(mockWrite).toHaveBeenCalledWith("doc-1", "test.json", {
        items: ["legacy-upgraded"],
      }),
    );
  });
});
