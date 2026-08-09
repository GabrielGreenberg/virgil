// @vitest-environment jsdom
//
// Task 106 — the un-archive path, both halves.
//
// A. THE PERSISTENCE PRIMITIVE — two write doors, one queue.
//    `update()` coalesces through a 300 ms debounce; `persist()` writes NOW.
//    Before this fix `persist` neither cancelled nor joined that timer, so an
//    older payload could outlive the newer write and re-appear ON DISK. That is
//    not a `useArchive` bug: every read-then-write flow in the app uses the
//    same door.
//
// B. THE VERB — un-archiving is a MOVE, so the content leaves the card only
//    once it has landed in the document. `restoreSnippet` takes the landing
//    function precisely so no caller can sequence that wrongly; the two old
//    EditorPane handlers each dropped the snippet on the strength of a `void`
//    call that could silently do nothing (no editor, read-only chrome, a body
//    the schema refuses) — the only copy of prose the user had deleted from
//    the document.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { usePersistentState } from "../usePersistentState";
import { useArchive } from "../useArchive";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockRead.mockResolvedValue(null);
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The sidecar payloads actually handed to the storage layer, in order. */
function writtenStates<T>(): T[] {
  return mockWrite.mock.calls.map((c) => c[2] as T);
}

describe("A. an immediate persist supersedes a scheduled one (usePersistentState)", () => {
  it("a pending debounced write can never outlive a later persist()", async () => {
    vi.useFakeTimers();
    beginDocPipeline("doc-p");
    const { result } = renderHook(() =>
      usePersistentState<{ items: string[] }>("doc-p", "t.json", { items: [] }),
    );

    // A title-edit-shaped update: arms the 300 ms timer with state that still
    // CONTAINS "x".
    act(() => {
      result.current.update(() => ({ items: ["x", "y"] }));
    });
    expect(mockWrite).not.toHaveBeenCalled(); // still debouncing

    // The read-then-write flow: remove "x" and write immediately.
    await act(async () => {
      await result.current.persist({ items: ["y"] });
    });
    expect(writtenStates<{ items: string[] }>()).toEqual([{ items: ["y"] }]);

    // …and the orphaned timer must NOT fire the pre-removal payload.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(writtenStates<{ items: string[] }>()).toEqual([{ items: ["y"] }]);
  });

  it("persist() stamps the mutated flag, so a slow load can't stomp it", async () => {
    beginDocPipeline("doc-l");
    // A read that resolves only after the user has already written.
    let release!: (v: unknown) => void;
    mockRead.mockReturnValue(new Promise((res) => { release = res; }));

    const { result } = renderHook(() =>
      usePersistentState<{ items: string[] }>("doc-l", "t.json", { items: [] }),
    );
    // The read-then-write shape: set state, then write that exact value.
    act(() => {
      result.current.setState({ items: ["fresh"] });
    });
    await act(async () => {
      await result.current.persist({ items: ["fresh"] });
    });
    await act(async () => {
      release({ items: ["stale-on-disk"] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.state).toEqual({ items: ["fresh"] });
  });
});

describe("B. restoreSnippet — the content leaves the card only if it landed", () => {
  const snippet = {
    id: "a1",
    title: "",
    titleAuto: true,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    createdAt: "2026-01-01T00:00:00.000Z",
    links: [],
  };

  it("a landing that FAILS retires nothing — the archive keeps the only copy", async () => {
    beginDocPipeline("doc-a");
    mockRead.mockResolvedValue({ snippets: [snippet] });
    const { result } = renderHook(() => useArchive("doc-a"));
    await waitFor(() => expect(result.current.snippets.length).toBe(1));
    mockWrite.mockClear();

    let out: boolean | undefined;
    act(() => {
      out = result.current.restoreSnippet("a1", () => false);
    });
    expect(out).toBe(false);
    expect(result.current.snippets.map((s) => s.id)).toEqual(["a1"]);
    expect(result.current.snippets[0].archived).toBeFalsy();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("the landing function receives the snippet's content", async () => {
    beginDocPipeline("doc-c");
    mockRead.mockResolvedValue({ snippets: [snippet] });
    const { result } = renderHook(() => useArchive("doc-c"));
    await waitFor(() => expect(result.current.snippets.length).toBe(1));

    const land = vi.fn((_content: unknown) => true);
    act(() => {
      result.current.restoreSnippet("a1", land);
    });
    expect(land).toHaveBeenCalledTimes(1);
    expect(land.mock.calls[0][0]).toEqual(snippet.content);
  });

  it("a landing that SUCCEEDS SETS THE CARD ASIDE — never deletes it", async () => {
    // The document insert is an undoable history entry; the sidecar write is
    // not. Deleting the entry would make the user's next Cmd+Z — the natural
    // key when an excerpt lands somewhere unintended — pull the prose out of
    // the document with nothing left in the Archive: gone from both. Set-aside
    // is reversible, so the excerpt always survives somewhere.
    vi.useFakeTimers();
    beginDocPipeline("doc-b");
    mockRead.mockResolvedValue({ snippets: [snippet] });
    const { result } = renderHook(() => useArchive("doc-b"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.snippets.length).toBe(1);
    mockWrite.mockClear();

    let out: boolean | undefined;
    act(() => {
      out = result.current.restoreSnippet("a1", () => true);
    });
    expect(out).toBe(true);
    expect(result.current.snippets.length).toBe(1);
    expect(result.current.snippets[0].archived).toBe(true);
    expect(result.current.snippets[0].content).toEqual(snippet.content);
    // Debounced, not immediate — it joined the queue rather than bypassing it.
    expect(mockWrite).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const last = writtenStates<{ snippets: Array<{ archived?: boolean }> }>().at(-1);
    expect(last?.snippets[0].archived).toBe(true);
  });

  it("a second restore of the same card lands NOTHING (no duplicate prose)", async () => {
    beginDocPipeline("doc-e");
    mockRead.mockResolvedValue({ snippets: [snippet] });
    const { result } = renderHook(() => useArchive("doc-e"));
    await waitFor(() => expect(result.current.snippets.length).toBe(1));

    const land = vi.fn((_content: unknown) => true);
    // Both calls in ONE tick — React has not re-rendered between them, so the
    // guard has to come off the ref mirror, not off `state`.
    act(() => {
      result.current.restoreSnippet("a1", land);
      result.current.restoreSnippet("a1", land);
    });
    expect(land).toHaveBeenCalledTimes(1);
  });

  it("an unknown id lands nothing and removes nothing", async () => {
    beginDocPipeline("doc-d");
    mockRead.mockResolvedValue({ snippets: [snippet] });
    const { result } = renderHook(() => useArchive("doc-d"));
    await waitFor(() => expect(result.current.snippets.length).toBe(1));
    const land = vi.fn((_content: unknown) => true);
    let out: boolean | undefined;
    act(() => {
      out = result.current.restoreSnippet("nope", land);
    });
    expect(out).toBe(false);
    expect(land).not.toHaveBeenCalled();
    expect(result.current.snippets.length).toBe(1);
  });
});
