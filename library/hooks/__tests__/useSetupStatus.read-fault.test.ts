// @vitest-environment jsdom
//
// Task 1210 — the setup-status poll catches a faulted manifest read per tick.
// The read door rejects on a real failure (task 1115); an uncaught rejection
// in the poll's `tick` was an unhandled rejection every 30 s, and the status
// never updated. A fault is "unknown": the last status stands.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const { readJsonFile } = vi.hoisted(() => ({ readJsonFile: vi.fn() }));
vi.mock("@library/lib/library-storage", () => ({ readJsonFile, VIRGIL_DIR: ".virgil" }));

import { useSetupStatus } from "../useSetupStatus";

const handle = {} as unknown as FileSystemDirectoryHandle;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  cleanup();
  readJsonFile.mockReset();
});

describe("useSetupStatus — a faulted read (task 1210)", () => {
  it("keeps the last status and does not claim setup is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    readJsonFile.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { result } = renderHook(() => useSetupStatus(handle));
    await act(flush);
    expect(result.current.needed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
