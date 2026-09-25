// @vitest-environment jsdom
//
// Task 766 — the library root is ONE app-level fact. Two mounted Library
// surfaces (the Library tab and a popped-out paper) must agree on which folder
// is the library immediately after a Reset or re-pick in EITHER of them, and a
// peer window's change (signalled through the localStorage stamp) re-resolves.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const lf = vi.hoisted(() => ({
  getLibraryHandle: vi.fn(),
  pickLibraryFolder: vi.fn(),
  ensureReadWritePermission: vi.fn(),
  queryReadWritePermission: vi.fn(),
  clearLibraryHandle: vi.fn(),
  resolveLibraryRootPath: vi.fn(),
}));
vi.mock("@library/lib/library-folder", () => lf);
vi.mock("@library/lib/skill-sync", () => ({ syncSkillBundle: vi.fn(async () => ({})) }));
vi.mock("@library/lib/library-storage", () => ({ ensureLibraryStructure: vi.fn(async () => {}) }));

import { useLibraryHandle } from "../useLibraryHandle";
import {
  __resetLibraryRootStoreForTests,
  LIBRARY_ROOT_STAMP_KEY,
} from "@library/lib/library-root-store";

const dir = (name: string) =>
  ({ name, isSameEntry: async (o: { name: string }) => o.name === name }) as unknown as FileSystemDirectoryHandle;

const A = dir("A");
const B = dir("B");

function twoSurfaces() {
  return renderHook(() => ({ tab: useLibraryHandle(), paper: useLibraryHandle() }));
}

const handleOf = (s: { kind: string; handle?: FileSystemDirectoryHandle }) => s.handle?.name;

beforeEach(() => {
  for (const f of Object.values(lf)) f.mockReset();
  lf.resolveLibraryRootPath.mockResolvedValue(null);
  lf.queryReadWritePermission.mockResolvedValue("granted");
  lf.clearLibraryHandle.mockResolvedValue(undefined);
  localStorage.clear();
  __resetLibraryRootStoreForTests();
});
afterEach(() => cleanup());

describe("useLibraryHandle — one library root for every surface", () => {
  it("reset + pick B in one surface moves the other (none in between)", async () => {
    lf.getLibraryHandle.mockResolvedValue(A);
    const { result } = twoSurfaces();
    await waitFor(() => expect(result.current.paper.state.kind).toBe("ready"));
    expect(handleOf(result.current.tab.state)).toBe("A");
    expect(handleOf(result.current.paper.state)).toBe("A");

    await act(async () => {
      await result.current.tab.reset();
    });
    expect(result.current.tab.state.kind).toBe("none");
    expect(result.current.paper.state.kind).toBe("none");

    lf.pickLibraryFolder.mockResolvedValue({ kind: "ok", handle: B });
    await act(async () => {
      await result.current.tab.pick();
    });
    expect(handleOf(result.current.tab.state)).toBe("B");
    expect(handleOf(result.current.paper.state)).toBe("B");
  });

  it("pickerError stays on the surface that clicked", async () => {
    lf.getLibraryHandle.mockResolvedValue(null);
    const { result } = twoSurfaces();
    await waitFor(() => expect(result.current.tab.state.kind).toBe("none"));
    lf.pickLibraryFolder.mockResolvedValue({ kind: "error", message: "nope" });
    await act(async () => {
      await result.current.tab.pick();
    });
    expect(result.current.tab.pickerError).toBe("nope");
    expect(result.current.paper.pickerError).toBeNull();
  });

  it("a slow resolve that finishes after a reset does not resurrect the old folder", async () => {
    let release!: (h: FileSystemDirectoryHandle) => void;
    lf.getLibraryHandle.mockReturnValue(new Promise((r) => (release = r)));
    const { result } = twoSurfaces();
    await act(async () => {
      await result.current.tab.reset();
    });
    await act(async () => {
      release(A);
    });
    expect(result.current.paper.state.kind).toBe("none");
  });

  it("a re-resolve of the SAME folder keeps the handle's identity", async () => {
    lf.getLibraryHandle.mockResolvedValue(A);
    const { result } = twoSurfaces();
    await waitFor(() => expect(result.current.tab.state.kind).toBe("ready"));
    const before = (result.current.tab.state as { handle: FileSystemDirectoryHandle }).handle;
    lf.getLibraryHandle.mockResolvedValue(dir("A"));
    await act(async () => {
      await result.current.tab.refresh();
    });
    expect((result.current.paper.state as { handle: FileSystemDirectoryHandle }).handle).toBe(before);
  });

  it("a peer window's stamp re-resolves from the stored handle", async () => {
    lf.getLibraryHandle.mockResolvedValue(A);
    const { result } = twoSurfaces();
    await waitFor(() => expect(handleOf(result.current.paper.state)).toBe("A"));

    // Another window picked B: IndexedDB now holds B, and its stamp arrives.
    lf.getLibraryHandle.mockResolvedValue(B);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: LIBRARY_ROOT_STAMP_KEY, newValue: "x", storageArea: localStorage }),
      );
    });
    await waitFor(() => expect(handleOf(result.current.paper.state)).toBe("B"));
    expect(handleOf(result.current.tab.state)).toBe("B");
  });

  it("this window's own reset/pick posts the stamp peers listen for", async () => {
    lf.getLibraryHandle.mockResolvedValue(A);
    const { result } = twoSurfaces();
    await waitFor(() => expect(result.current.tab.state.kind).toBe("ready"));
    expect(localStorage.getItem(LIBRARY_ROOT_STAMP_KEY)).toBeNull();
    await act(async () => {
      await result.current.tab.reset();
    });
    const first = localStorage.getItem(LIBRARY_ROOT_STAMP_KEY);
    expect(first).toBeTruthy();
    lf.pickLibraryFolder.mockResolvedValue({ kind: "ok", handle: B });
    await act(async () => {
      await result.current.tab.pick();
    });
    expect(localStorage.getItem(LIBRARY_ROOT_STAMP_KEY)).not.toBe(first);
  });
});
