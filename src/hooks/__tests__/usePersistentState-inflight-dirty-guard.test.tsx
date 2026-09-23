// @vitest-environment jsdom
/**
 * Task 569 — the sidecar hook's dirty guard is ONE predicate, and it covers
 * the IN-FLIGHT window.
 *
 * `usePersistentState`'s external-change listener re-reads a sidecar off disk
 * only when the instance is CLEAN, and until 569 "clean" was
 * `pendingTimerRef.current === null`. But `persist`, `flushPending` and the
 * debounce callback all null that handle BEFORE `await writeSidecar`, so for
 * the whole in-flight window — the per-file queue, the cross-window doc lock,
 * the FSA `createWritable` + rename — the guard read clean. An external change
 * to the same file polled in that window was `setState`d over the local edit
 * in memory, and our write then landed the LOCAL payload: memory = external,
 * disk = local, and the next `update()` wrote memory back over the local edit.
 * Silent. Task 392 retired the identical predicate mistake from `useDocument`
 * (`saveTimerRef.current !== null`); this hook carried its twin.
 *
 * **No pre-569 suite could see this**: `usePersistentState.test.tsx` pins the
 * MID-DEBOUNCE deferral with a 5 s debounce that never fires, so a write is
 * never in flight in any of its legs, and the watcher-wiring suite's fake
 * `writeSidecar` resolves synchronously, so its in-flight window is zero
 * microtasks wide. Every defect leg here holds the write open on a controlled
 * promise and lands the external event INSIDE it.
 *
 * The leg with teeth is the CENSUS: the predicate was never the part that
 * could misbehave — a guard site that reads the timer handle by hand is, and
 * that type-checks perfectly. The null-handle comparison may appear in exactly
 * two declarations (the one predicate, and the one place the timer is
 * cancelled), and both guard reads in the listener must ask the predicate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecar: (...args: unknown[]) => mockRead(...args),
  readSidecarIfExists: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
  // Task 719 moved the hook's write onto the SERIALIZED read-modify-merge door:
  // a read INSIDE the write's critical section, the caller's merge applied to
  // it, then the write. Modelled faithfully here — `mockRead` is this suite's
  // disk — so `mockWrite` still receives `(handle, filename, payload)` and the
  // payload is what actually lands.
  mutateSidecar: async (
    handle: { docId: string },
    filename: string,
    defaultValue: unknown,
    mutate: (current: unknown) => unknown,
  ) => {
    const current = (await mockRead(handle.docId, filename)) ?? defaultValue;
    const next = mutate(current);
    if (next === null) return null;
    await mockWrite(handle, filename, next);
    return next;
  },
}));

import { usePersistentState } from "../usePersistentState";
import { dispatchSidecarChanged } from "@/lib/sidecar-watcher";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import {
  codeOnlyLines,
  enclosingDeclaration,
  REPO_ROOT,
} from "../../lib/__tests__/_source-scan";

interface Shape {
  words: string[];
}
const EMPTY: Shape = { words: [] };
const DOC = "doc-569";
// A file whose record collection is DECLARED (`sidecar-merge.ts`: `words`,
// value identity), so the task-719 merge these legs now drain into has real
// semantics rather than an undeclared array's scalar fallback.
const FILE = "dictionary.json";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the event → guard → (maybe) read → setState chain. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
  resetFlushers();
});
afterEach(() => {
  cleanup();
});

describe("the dirty guard covers the IN-FLIGHT window (task 569)", () => {
  it("DEFECT: DEFERS an external change that lands while the DEBOUNCED write is in flight — the timer handle is already null there", async () => {
    beginDocPipeline(DOC);
    mockRead.mockResolvedValue({ words: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 20 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    // Hold the write open: from the moment the debounce fires until we
    // release it, the instance has a write IN FLIGHT and no timer armed.
    const gate = deferred();
    mockWrite.mockImplementation(() => gate.promise);
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));

    // The watcher confirms a genuine external change to the SAME file inside
    // that window. Pre-569 both guard reads passed here.
    mockRead.mockClear();
    mockRead.mockResolvedValue({ words: ["initial", "external-only"] });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await settle();

    expect(mockRead, "the re-read was deferred, not run").not.toHaveBeenCalled();
    expect(result.current.state.words).toEqual(["initial", "local-edit"]);

    // The write lands. TASK 719: the deferral was a DEBT, not a skip — the
    // drain REPLAYS the re-read, and disk by then holds what `mutateSidecar`
    // merged (the fake disk is stateless, so point it at that union). Memory
    // converges to it without losing the local edit.
    mockRead.mockResolvedValue({
      words: ["initial", "local-edit", "external-only"],
    });
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await settle();
    expect(mockRead, "the deferred re-read is REPLAYED on the drain").toHaveBeenCalled();
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);
  });

  it("DEFECT: DEFERS on the DIRECT path too — `debounceMs: 0` hands `persist` the write with no timer ever armed", async () => {
    beginDocPipeline(DOC);
    mockRead.mockResolvedValue({ words: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    const gate = deferred();
    mockWrite.mockImplementation(() => gate.promise);
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    // The hand-off is immediate, but the merged door reads its base first, so
    // the write itself is one microtask out (task 719).
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));

    mockRead.mockClear();
    mockRead.mockResolvedValue({ words: ["initial", "external-only"] });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await settle();
    expect(mockRead, "the re-read was deferred, not run").not.toHaveBeenCalled();
    expect(result.current.state.words).toEqual(["initial", "local-edit"]);

    mockRead.mockResolvedValue({
      words: ["initial", "local-edit", "external-only"],
    });
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await settle();
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);
  });

  it("DEFECT: the SECOND guard read sees a write that STARTS while the re-read is in flight", async () => {
    beginDocPipeline(DOC);
    mockRead.mockResolvedValue({ words: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    // Clean when the event arrives, so the re-read STARTS — and is held open.
    const readGate = deferred<Shape>();
    mockRead.mockClear();
    mockRead.mockImplementation(() => readGate.promise);
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(1);

    // While the read is in flight the user edits; with `debounceMs: 0` that is
    // an immediate `persist` — a write in flight, and no timer at any point.
    const writeGate = deferred();
    mockWrite.mockImplementation(() => writeGate.promise);
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    // The merged door reads its base before writing (task 719), and this leg
    // holds `mockRead` open — so release it for the WRITE's own base read.
    readGate.resolve({ words: ["initial"] });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));

    // The re-read's own resolve already happened above; the post-await
    // re-check must see the in-flight write and decline — pre-569 it read the
    // (null) timer. It RE-ARMS the debt (task 719) rather than dropping it.
    await settle();
    expect(result.current.state.words).toEqual(["initial", "local-edit"]);

    // Draining the write pays the debt: the replayed read merges the external
    // record in without touching the local edit.
    mockRead.mockResolvedValue({
      words: ["initial", "local-edit", "external-only"],
    });
    await act(async () => {
      writeGate.resolve();
      await writeGate.promise;
    });
    await settle();
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);
  });

  it("CONTROL: once the in-flight write SETTLES the counter releases — a LATER external change re-hydrates", async () => {
    // A predicate that never returned to clean would pass every defect leg
    // above and silently disable live reactivity for the rest of the session.
    beginDocPipeline(DOC);
    mockRead.mockResolvedValue({ words: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    const gate = deferred();
    mockWrite.mockImplementation(() => gate.promise);
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    mockRead.mockClear();
    mockRead.mockResolvedValue({ words: ["initial", "local-edit", "later-external"] });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await waitFor(() =>
      expect(result.current.state.words).toEqual([
        "initial",
        "local-edit",
        "later-external",
      ]),
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a write that THROWS releases the counter too (the decrement is in `finally`)", async () => {
    beginDocPipeline(DOC);
    mockRead.mockResolvedValue({ words: ["initial"] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    mockWrite.mockRejectedValue(new Error("disk full"));
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    await settle();
    expect(errorSpy).toHaveBeenCalled();

    // The write is over (it failed), so the instance owes no write and the
    // re-read runs. TASK 719 REVISED WHAT IT DOES: 569 adopted disk wholesale
    // here, which threw away an edit disk had never taken. The re-read now
    // MERGES against the base, so the unlanded local edit survives AND the
    // external record arrives — neither writer's content is destroyed.
    mockRead.mockClear();
    mockRead.mockResolvedValue({ words: ["initial", "external-only"] });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await waitFor(() =>
      expect(result.current.state.words).toEqual([
        "initial",
        "local-edit",
        "external-only",
      ]),
    );
    errorSpy.mockRestore();
  });

  it("DECIDED: a write REFUSED before it starts (no pipeline handle) is not in flight — disk stays the truth", async () => {
    // No `beginDocPipeline` → `persist` returns before the counter moves,
    // exactly as it returns before stamping `hasMutatedRef`. A write the layer
    // below refuses is not a write this instance OWES, so an external change
    // still re-hydrates (the read-mostly host's design; stated at the site).
    mockRead.mockResolvedValue({ words: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.words).toEqual(["initial"]));

    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "memory-only"] }));
    });
    await settle();
    expect(mockWrite).not.toHaveBeenCalled();

    mockRead.mockClear();
    mockRead.mockResolvedValue({ words: ["initial", "external-only"] });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    // Same task-719 revision as the thrown-write leg: the re-read MERGES, so
    // the memory-only value a read-mostly host will never persist is not
    // destroyed by the external change it adopts.
    await waitFor(() =>
      expect(result.current.state.words).toEqual([
        "initial",
        "memory-only",
        "external-only",
      ]),
    );
  });
});

describe("census · the sidecar hook's dirty predicate is ONE thing", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "src/hooks/usePersistentState.ts"),
    "utf8",
  );
  const code = codeOnlyLines(src);

  it("the null-handle comparison lives in exactly two declarations — the predicate, and the one timer-cancel door", () => {
    const re = /pendingTimerRef\.current\s*(?:!==|===)\s*null/g;
    const owners: string[] = [];
    for (const m of code.matchAll(re)) {
      const region = enclosingDeclaration(code, m.index ?? 0);
      const header = region.split("\n")[0];
      const owner = /const\s+(cancelArmedTimer|hasPendingWrite)\s*=\s*useCallback/.exec(header);
      expect(
        owner,
        `a timer-handle null test outside the predicate / cancel door — in:\n${header}`,
      ).not.toBeNull();
      owners.push(owner![1]);
    }
    // Can-see canary + exact set: one comparison per owner, both owners present.
    expect(owners.sort()).toEqual(["cancelArmedTimer", "hasPendingWrite"]);
  });

  it("the predicate reads BOTH halves — an armed timer OR an in-flight write", () => {
    expect(code).toMatch(
      /const hasPendingWrite = useCallback\(\(\): boolean => \{\s*return pendingTimerRef\.current !== null \|\| inFlightRef\.current > 0;/,
    );
  });

  it("`persist` counts the write in flight around its await and releases in `finally`", () => {
    const at = code.indexOf("await writeSidecarMerged<S>(h, filename, base, s,");
    expect(at).toBeGreaterThan(0);
    const persist = enclosingDeclaration(code, at);
    // The region is the `async (s: S) => {…}` arrow; its owner is the line above.
    expect(persist.split("\n")[0]).toMatch(/async \(s: S\) => \{/);
    const start = code.indexOf(persist);
    expect(code.slice(Math.max(0, start - 80), start)).toContain(
      "const persist = useCallback(",
    );
    const inc = persist.indexOf("inFlightRef.current += 1");
    const awaitAt = persist.indexOf("await writeSidecarMerged");
    expect(inc, "incremented BEFORE the await").toBeGreaterThan(0);
    expect(inc).toBeLessThan(awaitAt);
    expect(persist).toMatch(/finally\s*\{\s*inFlightRef\.current -= 1;\s*\}/);
  });

  it("both guard reads in the external-change listener ask the predicate, and neither touches the timer handle", () => {
    const at = code.indexOf("window.addEventListener(SIDECAR_CHANGED_EVENT");
    expect(at).toBeGreaterThan(0);
    const effect = enclosingDeclaration(code, at);
    const asks = effect.match(/hasPendingWrite\(\)/g) ?? [];
    expect(asks, "one ask before the read, one after").toHaveLength(2);
    expect(effect).not.toMatch(/pendingTimerRef|inFlightRef/);
  });

  it("the retired claim stays retired: no production comment promises the watcher re-checks a deferred change", () => {
    // The pre-569 guard comment said "let the next poll re-check once the
    // write has flushed". False: the watcher re-baselines to the external
    // bytes BEFORE it emits, and our landed write re-baselines again to OURS,
    // so nothing re-emits — a deferral is local-wins. Read RAW source: the
    // needle is prose.
    expect(src).not.toMatch(/next poll re-(?:check|emit)s? once (?:clean|the write has flushed)/);
    expect(src).toContain("WHAT A DEFERRAL MEANS");
  });
});
