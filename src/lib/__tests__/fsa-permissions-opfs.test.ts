// @vitest-environment jsdom
//
// OPFS / non-Chromium permission guard: handles that don't expose the FSA
// permissions extension (OPFS handles everywhere; any handle on Firefox/
// Safari) must be treated as already-granted, NOT routed into a gate that
// can never resolve (there is no picker to grant from). Without this guard,
// the example document bricks at the permission gate on non-Chromium.

import { describe, it, expect } from "vitest";
import { queryRW, requestRW, ensureRW } from "@/lib/fsa-permissions";

describe("fsa-permissions OPFS guard", () => {
  it("treats a handle without the permissions API as granted", async () => {
    const handle = { kind: "directory", name: "opfs" } as unknown as FileSystemHandle;
    expect(await queryRW(handle)).toBe("granted");
    expect(await requestRW(handle)).toBe("granted");
    expect(await ensureRW(handle)).toBe(true);
  });

  it("delegates to the permissions API when present", async () => {
    const handle = {
      queryPermission: async () => "prompt",
      requestPermission: async () => "granted",
    } as unknown as FileSystemHandle;
    expect(await queryRW(handle)).toBe("prompt");
    // ensureRW: query→prompt, so it requests, which grants.
    expect(await ensureRW(handle)).toBe(true);
  });

  it("respects a denied grant from a real handle", async () => {
    const handle = {
      queryPermission: async () => "prompt",
      requestPermission: async () => "denied",
    } as unknown as FileSystemHandle;
    expect(await ensureRW(handle)).toBe(false);
  });
});
