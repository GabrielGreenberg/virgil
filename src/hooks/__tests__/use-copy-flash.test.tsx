// @vitest-environment jsdom
/**
 * Task 984 — `useCopyFlash` is the one door for copy-to-clipboard + "copied"
 * flash: the reset timer rides the component's lifetime, an unmount before the
 * promise resolves arms nothing, and a refused write never escapes as an
 * unhandled rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkFiles } from "@/lib/__tests__/_source-scan";
import { useCopyFlash, COPY_FLASH_MS } from "@/hooks/useCopyFlash";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCopyFlash", () => {
  it("flips copied true, then false after the flash", async () => {
    const { result } = renderHook(() => useCopyFlash());
    await act(async () => {
      await result.current.copy("smith2020");
    });
    expect(writeText).toHaveBeenCalledWith("smith2020");
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(COPY_FLASH_MS - 1);
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a second copy inside the window restarts the flash", async () => {
    const { result } = renderHook(() => useCopyFlash(1000));
    await act(async () => {
      await result.current.copy("a");
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    await act(async () => {
      await result.current.copy("b");
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.copied).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("unmount before the write resolves arms no timer", async () => {
    let resolve!: () => void;
    writeText.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useCopyFlash());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.copy("x");
    });
    unmount();
    resolve();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount during the flash clears the reset timer", async () => {
    const { result, unmount } = renderHook(() => useCopyFlash());
    await act(async () => {
      await result.current.copy("x");
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a refused write resolves quietly and shows no flash", async () => {
    writeText.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    const { result } = renderHook(() => useCopyFlash());
    await act(async () => {
      await expect(result.current.copy("x")).resolves.toBeUndefined();
    });
    expect(result.current.copied).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("census: clipboard writes go through useCopyFlash", () => {
  it("no component outside the hook calls navigator.clipboard.writeText", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    for (const p of walkFiles(root, { skipDirs: ["__tests__"] })) {
      if (!/\.(ts|tsx)$/.test(p)) continue;
      if (readFileSync(p, "utf8").includes("clipboard.writeText")) {
        offenders.push(relative(root, p));
      }
    }
    expect(offenders).toEqual(["hooks/useCopyFlash.ts"]);
  });
});
