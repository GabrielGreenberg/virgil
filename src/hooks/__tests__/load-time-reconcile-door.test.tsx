// @vitest-environment jsdom
//
// TASK 570 — a reconcile that WRITES a sidecar from editor-derived inputs runs
// over the sidecar AS LOADED, never over the pre-load default: the DOOR.
//
// `usePersistentState` hydrates from disk asynchronously; until the read
// resolves `state` is the EMPTY default. `useCitations.syncFromEditor` — the
// mount-time reconcile that re-derives every anchored `CitationRef` from the
// editor's atoms — was run from an `EditorPane` effect keyed on the editor
// ALONE, through bare `update()`. `update()` stamps `hasMutatedRef`, and the
// loader bails on that stamp (correctly: a REAL user mutation must not be
// stomped by a late read). So whenever the ~20-file sidecar batch resolved
// AFTER the editor mounted, the merge ran over EMPTY, the loader declined to
// populate, and 300 ms later `citations.json` was WRITTEN with every
// unanchored / archived citation and the user's `bibPackage` / `citationStyle`
// / `bibPath` gone. Silent, and won by disk speed — which is why no fixture in
// the repo could see it: every one resolves its read before it syncs.
//
// The door — `updateWhenLoaded` — HOLDS a derivation handed to it before the
// read resolves (latest wins, nothing written, the loader-stomp guard NOT
// stamped) and applies it once, over the loaded state, in the commit after the
// loader's own `setState`. After the read it is exactly `update()`. On a read
// that THREW it applies to memory only and writes nothing.
//
// Every read below is a DEFERRED promise the leg resolves by hand, because the
// defect is an ORDER and a `mockResolvedValue` can only ever resolve first.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** One deferred read per `${docId}/${file}`, minted on first use so a leg can
 *  resolve a read BEFORE or AFTER the hook asks for it. */
const reads = new Map<string, Deferred<unknown>>();
function pendingRead(docId: string, file: string): Deferred<unknown> {
  const key = `${docId}/${file}`;
  let d = reads.get(key);
  if (!d) {
    d = deferred<unknown>();
    reads.set(key, d);
  }
  return d;
}

const writes: Array<{ docId: string; file: string; data: unknown }> = [];
const mockWrite = vi.fn(
  async (handle: { docId: string }, file: string, data: unknown) => {
    writes.push({ docId: handle.docId, file, data });
  },
);

vi.mock("@/lib/storage", () => ({
  readSidecar: (docId: string, file: string) => pendingRead(docId, file).promise,
  readSidecarIfExists: (docId: string, file: string) =>
    pendingRead(docId, file).promise,
  writeSidecar: (h: { docId: string }, f: string, d: unknown) =>
    mockWrite(h, f, d),
  // `useCitations` reads the `.bib` beside the sidecar; nothing here is about
  // it, so it answers empty with NO detected family (task 344's seed stays
  // silent, which is what lets the stored `natbib` below be the only voice).
  readBib: vi.fn(async () => ({
    bibText: "",
    bibFilename: "references.bib",
    detectedPackage: undefined,
  })),
  mutateBib: vi.fn(async () => null),
}));

import { usePersistentState } from "../usePersistentState";
import { useCitations } from "../useCitations";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";

interface Shape {
  items: string[];
}
const EMPTY: Shape = { items: [] };

const writesTo = (docId: string, file: string) =>
  writes.filter((w) => w.docId === docId && w.file === file);
const lastWrite = (docId: string, file: string) =>
  writesTo(docId, file).at(-1)?.data;

beforeEach(() => {
  reads.clear();
  writes.length = 0;
  mockWrite.mockClear();
  __resetForTests();
  resetFlushers();
});
afterEach(() => {
  cleanup();
});

describe("usePersistentState.updateWhenLoaded — the load-time reconcile door", () => {
  it("HOLDS a derivation handed to it before the read resolves, applies it ONCE over the LOADED state, and the write carries the merge", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "from-editor"],
      }));
    });
    // Held: nothing applied, nothing written, the read still pending.
    expect(result.current.loaded).toBe(false);
    expect(result.current.state).toEqual(EMPTY);
    expect(mockWrite).not.toHaveBeenCalled();

    // The read lands LATE — and the loader still populates, because a held
    // derivation never stamped the loader-stomp guard.
    await act(async () => {
      pendingRead("doc-1", "test.json").resolve({ items: ["on-disk"] });
    });
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["on-disk", "from-editor"]),
    );
    await waitFor(() =>
      expect(lastWrite("doc-1", "test.json")).toEqual({
        items: ["on-disk", "from-editor"],
      }),
    );
    // Exactly once: a later render does not re-apply the held derivation.
    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "later"] }));
    });
    expect(result.current.state.items).toEqual([
      "on-disk",
      "from-editor",
      "later",
    ]);
  });

  it("the LATEST held call wins — two derivations handed over before the read apply as ONE, the last", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "first"],
      }));
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "second"],
      }));
    });
    await act(async () => {
      pendingRead("doc-1", "test.json").resolve({ items: ["on-disk"] });
    });
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["on-disk", "second"]),
    );
  });

  it("after the read has resolved it is exactly update(): applied synchronously and persisted", async () => {
    beginDocPipeline("doc-1");
    pendingRead("doc-1", "test.json").resolve({ items: ["on-disk"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "from-editor"],
      }));
    });
    expect(result.current.state.items).toEqual(["on-disk", "from-editor"]);
    await waitFor(() =>
      expect(lastWrite("doc-1", "test.json")).toEqual({
        items: ["on-disk", "from-editor"],
      }),
    );
  });

  it("an ABSENT sidecar (read answers null) still applies the held derivation over the default and persists it — the never-written case", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "from-editor"],
      }));
    });
    await act(async () => {
      pendingRead("doc-1", "test.json").resolve(null);
    });
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-editor"]),
    );
    await waitFor(() =>
      expect(lastWrite("doc-1", "test.json")).toEqual({ items: ["from-editor"] }),
    );
  });

  it("a read that THREW applies the held derivation to MEMORY only and writes nothing (an automatic write over an unreadable sidecar would destroy it)", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "from-editor"],
      }));
    });
    await act(async () => {
      pendingRead("doc-1", "test.json").reject(new Error("corrupt"));
    });
    await waitFor(() => expect(result.current.loadError).toBe(true));
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-editor"]),
    );
    // Drain well past the content-tier debounce: no write may follow.
    await new Promise((r) => setTimeout(r, 400));
    expect(writesTo("doc-1", "test.json")).toHaveLength(0);
  });

  it("a docId change DROPS a held derivation — one document's reconcile is never applied to another", async () => {
    beginDocPipeline("doc-1");
    beginDocPipeline("doc-2");
    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) =>
        usePersistentState<Shape>(docId, "test.json", EMPTY),
      { initialProps: { docId: "doc-1" } },
    );
    act(() => {
      result.current.updateWhenLoaded((prev) => ({
        items: [...prev.items, "meant-for-doc-1"],
      }));
    });
    rerender({ docId: "doc-2" });
    await act(async () => {
      pendingRead("doc-2", "test.json").resolve({ items: ["two"] });
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.state.items).toEqual(["two"]);
    // Doc 1's read resolving late is cancelled, and its held derivation is gone.
    await act(async () => {
      pendingRead("doc-1", "test.json").resolve({ items: ["one"] });
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(result.current.state.items).toEqual(["two"]);
    expect(writes).toHaveLength(0);
  });

  it("CONTROL — a REAL user mutation through update() before the read still wins over disk (the loader-stomp guard is untouched)", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "typed"] }));
    });
    await act(async () => {
      pendingRead("doc-1", "test.json").resolve({ items: ["on-disk"] });
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The user's mutation stands; the stale on-disk value did not stomp it.
    expect(result.current.state.items).toEqual(["typed"]);
  });
});

/** The sidecar the DEFECT leg loads late: one parked (unanchored) citation
 *  plus every stored choice the pre-570 merge reverted to its default. */
const STORED = {
  citations: [
    {
      id: "parked-1",
      command: "\\cite{parked2019}",
      keys: ["parked2019"],
      createdAt: "2026-01-01T00:00:00.000Z",
      unanchored: true as const,
    },
  ],
  bibPath: "refs/main.bib",
  citationStyle: "chicago-author-date",
  bibPackage: "natbib" as const,
};
const EDITOR_ATOMS = [{ citationId: "live-1", command: "\\cite{live2020}" }];

describe("useCitations.syncFromEditor — the REAL hook, a sidecar that resolves late", () => {
  it("DEFECT LEG — a sidecar that resolves AFTER the mount-time sync is MERGED: the parked citation and the stored bibPackage / citationStyle / bibPath survive, and the write carries them", async () => {
    beginDocPipeline("doc-c");
    const { result } = renderHook(() => useCitations("doc-c"));
    // The editor mounted first: EditorPane's `[editor]` effect syncs now.
    act(() => {
      result.current.syncFromEditor(EDITOR_ATOMS);
    });
    // Nothing written on the strength of a pre-load sync.
    expect(writesTo("doc-c", "citations.json")).toHaveLength(0);

    await act(async () => {
      pendingRead("doc-c", "citations.json").resolve(STORED);
    });
    await waitFor(() =>
      expect(result.current.citations.map((c) => c.id)).toEqual([
        "live-1",
        "parked-1",
      ]),
    );
    expect(result.current.bibPackage).toBe("natbib");
    expect(result.current.citationStyle).toBe("chicago-author-date");
    expect(result.current.bibPath).toBe("refs/main.bib");

    // And the bytes that reach disk are the MERGE, not the editor alone.
    await waitFor(() => {
      const w = lastWrite("doc-c", "citations.json") as
        | typeof STORED
        | undefined;
      expect(w).toBeTruthy();
      expect(w!.citations.map((c) => c.id)).toEqual(["live-1", "parked-1"]);
      expect(w!.bibPackage).toBe("natbib");
      expect(w!.citationStyle).toBe("chicago-author-date");
      expect(w!.bibPath).toBe("refs/main.bib");
    });
  });

  it("task 704 — a ref flagged archived whose atom is LIVE (an undone archive; citation ids are stable across parse) is replaced by the live ref, never listed twice", async () => {
    beginDocPipeline("doc-c");
    pendingRead("doc-c", "citations.json").resolve({
      ...STORED,
      citations: [
        {
          id: "live-1",
          command: "\\cite{live2020}",
          keys: ["live2020"],
          createdAt: "2026-01-01T00:00:00.000Z",
          archived: true,
          unanchored: true,
        },
        ...STORED.citations,
      ],
    });
    const { result } = renderHook(() => useCitations("doc-c"));
    await waitFor(() => expect(result.current.citations).toHaveLength(2));
    act(() => {
      result.current.syncFromEditor(EDITOR_ATOMS);
    });
    expect(result.current.citations.map((c) => c.id)).toEqual([
      "live-1",
      "parked-1",
    ]);
    const live = result.current.citations.find((c) => c.id === "live-1")!;
    expect(live.archived).toBeUndefined();
    expect(live.unanchored).toBeUndefined();
  });

  it("CONTROL — a sidecar that resolved BEFORE the sync behaves exactly as before: anchored refs re-derived from the editor, the parked one kept", async () => {
    beginDocPipeline("doc-c");
    pendingRead("doc-c", "citations.json").resolve({
      ...STORED,
      citations: [
        // A stale anchored id from a previous parse: the editor re-mints ids,
        // so it is DROPPED and replaced by the live atom.
        {
          id: "stale-anchored",
          command: "\\cite{old}",
          keys: ["old"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        ...STORED.citations,
      ],
    });
    const { result } = renderHook(() => useCitations("doc-c"));
    await waitFor(() =>
      expect(result.current.citations.map((c) => c.id)).toEqual([
        "stale-anchored",
        "parked-1",
      ]),
    );
    act(() => {
      result.current.syncFromEditor(EDITOR_ATOMS);
    });
    expect(result.current.citations.map((c) => c.id)).toEqual([
      "live-1",
      "parked-1",
    ]);
    expect(result.current.bibPackage).toBe("natbib");
    await waitFor(() => {
      const w = lastWrite("doc-c", "citations.json") as
        | typeof STORED
        | undefined;
      expect(w?.citations.map((c) => c.id)).toEqual(["live-1", "parked-1"]);
      expect(w?.bibPackage).toBe("natbib");
    });
  });
});
