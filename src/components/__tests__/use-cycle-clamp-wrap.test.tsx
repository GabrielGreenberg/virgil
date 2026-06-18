// @vitest-environment jsdom
//
// SR-cycle (SR-C1-01 / SR-F2-01 / SR-F1-02) — the Search result cursor now
// rides the SHARED `useCycle` read-clamp instead of a hand-rolled `selectedIdx`
// with manual modular arithmetic. These pin the two invariants that the
// hand-rolled holder violated:
//
//   • COUNTER NEVER EXCEEDS TOTAL: `useCycle` clamps its index on READ against
//     the live items length, so when the result list shrinks under a selected
//     index the exposed `idx` resolves to null (the counter shows "<total>",
//     never the impossible "16 of 10").
//   • CYCLE WRAPS AT BOTH ENDS: next() past the last item wraps to 0; prev()
//     before the first wraps to the last.
//
// `panel-primitives` (where `useCycle` lives) transitively imports
// `@/lib/storage` — stub it so the hook can import in jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import { renderHook, act } from "@testing-library/react";
import { useCycle } from "@/components/panel-primitives";

describe("useCycle — read-clamp + wrap (the SR-cycle fix authority)", () => {
  let activate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    activate = vi.fn();
  });

  it("next() advances and wraps at the end; prev() wraps at the start", () => {
    const items = ["a", "b", "c"];
    const { result } = renderHook(() => useCycle(items, activate));

    act(() => result.current.next()); // null → 0
    expect(result.current.idx).toBe(0);
    act(() => result.current.next()); // 0 → 1
    act(() => result.current.next()); // 1 → 2
    expect(result.current.idx).toBe(2);
    act(() => result.current.next()); // 2 → wrap to 0
    expect(result.current.idx).toBe(0);

    act(() => result.current.prev()); // 0 → wrap to 2 (last)
    expect(result.current.idx).toBe(2);
    expect(activate).toHaveBeenLastCalledWith("c", 2);
  });

  it("prev() from a null cursor lands on the LAST item", () => {
    const items = ["a", "b", "c"];
    const { result } = renderHook(() => useCycle(items, activate));
    act(() => result.current.prev());
    expect(result.current.idx).toBe(2);
    expect(activate).toHaveBeenCalledWith("c", 2);
  });

  it("the exposed idx CLAMPS to null when the list shrinks under it (counter never exceeds total)", () => {
    let items = ["a", "b", "c", "d", "e"];
    const { result, rerender } = renderHook(() => useCycle(items, activate));

    act(() => result.current.setIdx(4)); // point at the last (index 4)
    expect(result.current.idx).toBe(4);

    // List shrinks to 2 — a hand-rolled "4" would render "5 of 2". The clamp
    // makes the read resolve to null, so the counter shows just the total.
    items = ["a", "b"];
    rerender();
    expect(result.current.idx).toBeNull();

    // Cycling from the clamped-null state starts cleanly at the first valid hit.
    act(() => result.current.next());
    expect(result.current.idx).toBe(0);
  });

  it("an index that is still in range after a shrink survives (only out-of-range clamps)", () => {
    let items = ["a", "b", "c", "d"];
    const { result, rerender } = renderHook(() => useCycle(items, activate));
    act(() => result.current.setIdx(1));
    expect(result.current.idx).toBe(1);

    items = ["a", "b", "c"]; // shrank to 3, but index 1 is still valid
    rerender();
    expect(result.current.idx).toBe(1);
  });

  it("next()/prev() no-op on an empty list (no activate, idx stays null)", () => {
    const { result } = renderHook(() => useCycle([] as string[], activate));
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.idx).toBeNull();
    expect(activate).not.toHaveBeenCalled();
  });
});
