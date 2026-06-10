// @vitest-environment jsdom
//
// A5 Commit D contract (R8): the two card surfaces DECLARE their compressed-
// line counts rather than relying on the silent context default. Pins:
//   - omni view   → 2 lines
//   - docked pods → 1 line
// so a silent regression to the default (1) fails loudly. Also asserts the
// hook still falls back to 1 when no provider is present (legacy default).

import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import {
  CardDisplayProvider,
  useCompressedLines,
  OMNI_COMPRESSED_LINES,
  DOCKED_COMPRESSED_LINES,
} from "@/components/editor-layout/contexts/card-display";

describe("compressed-line symmetry (R8)", () => {
  it("declares omni = 2, docked = 1", () => {
    expect(OMNI_COMPRESSED_LINES).toBe(2);
    expect(DOCKED_COMPRESSED_LINES).toBe(1);
    // The two surfaces are intentionally different — symmetry means each is
    // DECLARED, not that they're equal.
    expect(OMNI_COMPRESSED_LINES).not.toBe(DOCKED_COMPRESSED_LINES);
  });

  it("resolves the omni value under an omni provider", () => {
    const { result } = renderHook(() => useCompressedLines(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <CardDisplayProvider value={{ compressedLines: OMNI_COMPRESSED_LINES }}>
          {children}
        </CardDisplayProvider>
      ),
    });
    expect(result.current).toBe(2);
  });

  it("resolves the docked value under a docked provider", () => {
    const { result } = renderHook(() => useCompressedLines(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <CardDisplayProvider value={{ compressedLines: DOCKED_COMPRESSED_LINES }}>
          {children}
        </CardDisplayProvider>
      ),
    });
    expect(result.current).toBe(1);
  });

  it("falls back to 1 with no provider (legacy default)", () => {
    const { result } = renderHook(() => useCompressedLines());
    expect(result.current).toBe(1);
  });
});
