// @vitest-environment jsdom
//
// Task 1009 — the unsorted-.bib poll's change check must be EXACT: an edit
// that keeps a file's entry count (a fixed title, a renamed citekey) has to
// reach `byFile`, while an unchanged file must keep `byFile`'s identity so
// the 6 s poll can't churn LibraryView's synthesized rows.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { listDir, readTextFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock("@library/lib/library-storage", () => ({
  listDir,
  readTextFile,
  SUBDIRS: { unsorted: "unsorted", queue: "queue", notifications: "notifications" },
}));

import { useUnsortedBibEntries } from "../useUnsortedBibEntries";

const handle = {} as unknown as FileSystemDirectoryHandle;

const bib = (key: string, title: string) =>
  `@article{${key},\n  title = {${title}},\n  author = {Doe, Jane},\n  year = {2001}\n}\n`;

let files: Record<string, string>;

beforeEach(() => {
  files = {};
  listDir.mockReset();
  readTextFile.mockReset();
  listDir.mockImplementation(async () =>
    Object.keys(files).map((name) => ({ kind: "file", name })),
  );
  readTextFile.mockImplementation(async (_h: unknown, path: string) =>
    files[path.replace(/^unsorted\//, "")] ?? null,
  );
});

afterEach(() => {
  cleanup();
});

describe("useUnsortedBibEntries — change check (task 1009)", () => {
  it("publishes a same-count edit (title A → B)", async () => {
    files["refs.bib"] = bib("doe2001", "Title A");
    const { result } = renderHook(() => useUnsortedBibEntries(handle));
    await waitFor(() => expect(result.current.byFile.get("refs.bib")).toHaveLength(1));
    expect(result.current.byFile.get("refs.bib")![0].fields.title).toBe("Title A");

    files["refs.bib"] = bib("doe2001", "Title B");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.byFile.get("refs.bib")![0].fields.title).toBe("Title B");
  });

  it("publishes a same-count citekey rename", async () => {
    files["refs.bib"] = bib("doe2001", "T");
    const { result } = renderHook(() => useUnsortedBibEntries(handle));
    await waitFor(() => expect(result.current.byFile.get("refs.bib")).toHaveLength(1));

    files["refs.bib"] = bib("doe2001a", "T");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.byFile.get("refs.bib")![0].key).toBe("doe2001a");
  });

  it("publishes a file rename that keeps the count", async () => {
    files["a.bib"] = bib("doe2001", "T");
    const { result } = renderHook(() => useUnsortedBibEntries(handle));
    await waitFor(() => expect(result.current.byFile.get("a.bib")).toHaveLength(1));

    files = { "b.bib": bib("doe2001", "T") };
    await act(async () => {
      await result.current.reload();
    });
    expect([...result.current.byFile.keys()]).toEqual(["b.bib"]);
  });

  it("keeps byFile's identity when no file text changed", async () => {
    files["refs.bib"] = bib("doe2001", "T");
    const { result } = renderHook(() => useUnsortedBibEntries(handle));
    await waitFor(() => expect(result.current.byFile.get("refs.bib")).toHaveLength(1));
    const first = result.current.byFile;

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.byFile).toBe(first);
  });
});
