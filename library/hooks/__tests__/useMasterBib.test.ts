// @vitest-environment jsdom
//
// useMasterBib must (1) take the fast path when a slim bib-index is present —
// never running citation-js — (2) short-circuit an unchanged reload via the
// stamp so downstream identity-keyed memos stay stable, and (3) fall back to
// parsing master.bib when the index is absent (old libraries).

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { readBibIndexStamp, readBibIndex } = vi.hoisted(() => ({
  readBibIndexStamp: vi.fn(),
  readBibIndex: vi.fn(),
}));
const { parseBibFile } = vi.hoisted(() => ({ parseBibFile: vi.fn() }));
const { readTextFile } = vi.hoisted(() => ({ readTextFile: vi.fn() }));

vi.mock("@library/lib/bib-index", () => ({ readBibIndexStamp, readBibIndex }));
vi.mock("@library/lib/bib-parser", () => ({ parseBibFile }));
vi.mock("@library/lib/library-storage", () => ({
  readTextFile,
  ROOT_FILES: { masterBib: "master.bib" },
}));

import { useMasterBib } from "../useMasterBib";

const handle = {} as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
  readBibIndexStamp.mockReset();
  readBibIndex.mockReset();
  parseBibFile.mockReset();
  readTextFile.mockReset();
});
afterEach(() => cleanup());

describe("useMasterBib — slim index fast path", () => {
  it("reads the slim index and NEVER parses master.bib", async () => {
    readBibIndexStamp.mockResolvedValue("s1");
    readBibIndex.mockResolvedValue({
      stamp: "s1",
      entries: [
        { key: "a", type: "misc", fields: { title: "A" }, raw: "" },
        { key: "b", type: "misc", fields: { title: "B" }, raw: "" },
      ],
    });

    const { result } = renderHook(() => useMasterBib(handle));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(parseBibFile).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("short-circuits an unchanged reload (stable array identity)", async () => {
    readBibIndexStamp.mockResolvedValue("s1");
    readBibIndex.mockResolvedValue({
      stamp: "s1",
      entries: [{ key: "a", type: "misc", fields: {}, raw: "" }],
    });

    const { result } = renderHook(() => useMasterBib(handle));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const first = result.current.entries;

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.entries).toBe(first); // same identity
    expect(readBibIndex).toHaveBeenCalledTimes(1); // not re-read on same stamp
  });

  it("re-reads when the stamp changes", async () => {
    readBibIndexStamp.mockResolvedValueOnce("s1").mockResolvedValueOnce("s2");
    readBibIndex
      .mockResolvedValueOnce({ stamp: "s1", entries: [{ key: "a", type: "misc", fields: {}, raw: "" }] })
      .mockResolvedValueOnce({ stamp: "s2", entries: [{ key: "a", type: "misc", fields: {}, raw: "" }, { key: "c", type: "misc", fields: {}, raw: "" }] });

    const { result } = renderHook(() => useMasterBib(handle));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(readBibIndex).toHaveBeenCalledTimes(2);
  });
});

describe("useMasterBib — master.bib fallback (no index)", () => {
  it("parses master.bib when the index is absent", async () => {
    readBibIndexStamp.mockResolvedValue(null); // no bib-index
    readTextFile.mockResolvedValue("@article{x, title={X}}");
    parseBibFile.mockReturnValue([{ key: "x", type: "article", fields: { title: "X" }, raw: "@article{x, title={X}}" }]);

    const { result } = renderHook(() => useMasterBib(handle));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(parseBibFile).toHaveBeenCalledTimes(1);
    expect(result.current.entries[0].key).toBe("x");
  });

  it("falls back to master.bib when the index is present but UNREADABLE", async () => {
    // A torn/corrupt index: stamp file exists, but readBibIndex returns null.
    // We must parse master.bib, never render an empty list.
    readBibIndexStamp.mockResolvedValue("s1");
    readBibIndex.mockResolvedValue(null);
    readTextFile.mockResolvedValue("@article{x, title={X}}");
    parseBibFile.mockReturnValue([{ key: "x", type: "article", fields: { title: "X" }, raw: "@article{x, title={X}}" }]);

    const { result } = renderHook(() => useMasterBib(handle));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(parseBibFile).toHaveBeenCalledTimes(1);
    expect(result.current.entries[0].key).toBe("x");
  });
});
