// @vitest-environment jsdom
//
// Chip A2 — the unsorted-inbox poll must not churn its array identity when
// the effective file list is unchanged, or `mergedEntries` (LibraryView)
// re-derives every 6 s and both catalog lists reconcile for nothing.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@library/lib/library-storage", () => ({
  listDir,
  readFile,
  SUBDIRS: { unsorted: "unsorted", queue: "queue", notifications: "notifications" },
}));

import { useUnsortedPdfs } from "../useUnsortedPdfs";

const handle = {} as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
  listDir.mockReset();
  readFile.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useUnsortedPdfs — change-guard (A2)", () => {
  it("keeps the SAME array identity across reloads when names are unchanged", async () => {
    listDir.mockResolvedValue([
      { kind: "file", name: "a.pdf" },
      { kind: "file", name: "b.pdf" },
    ]);
    readFile.mockImplementation(async (_h: unknown, path: string) => ({
      lastModified: path.endsWith("a.pdf") ? 100 : 200,
    }));

    const { result } = renderHook(() => useUnsortedPdfs(handle));
    // Mount effect runs the first reload.
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    const first = result.current.files;
    expect(first).toEqual(["b.pdf", "a.pdf"]); // mtime desc

    await act(async () => {
      await result.current.reload();
    });
    const second = result.current.files;
    // Same effective list → identity preserved (no mergedEntries churn).
    expect(second).toBe(first);
  });

  it("pushes a NEW array only when the file list actually changes", async () => {
    listDir.mockResolvedValue([
      { kind: "file", name: "a.pdf" },
      { kind: "file", name: "b.pdf" },
    ]);
    readFile.mockImplementation(async (_h: unknown, path: string) => ({
      lastModified: path.endsWith("a.pdf") ? 100 : 200,
    }));

    const { result } = renderHook(() => useUnsortedPdfs(handle));
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    const before = result.current.files;

    // A new file appears in the inbox.
    listDir.mockResolvedValue([
      { kind: "file", name: "a.pdf" },
      { kind: "file", name: "b.pdf" },
      { kind: "file", name: "c.pdf" },
    ]);
    readFile.mockImplementation(async (_h: unknown, path: string) => ({
      lastModified: path.endsWith("a.pdf") ? 100 : path.endsWith("b.pdf") ? 200 : 300,
    }));

    await act(async () => {
      await result.current.reload();
    });
    const after = result.current.files;
    expect(after).not.toBe(before); // changed → fresh identity
    expect(after).toEqual(["c.pdf", "b.pdf", "a.pdf"]);
  });
});
