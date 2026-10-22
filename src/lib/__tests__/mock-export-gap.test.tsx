// @vitest-environment jsdom
//
// A `vi.mock` factory that omits an export the code under test CALLS fails the
// test that made the call (task 1231).
//
// The 2026-10-22 gate sweep found nineteen `Failed to save citations: Error:
// [vitest] No "mutateSidecar" export is defined on the "@/lib/storage" mock`
// lines from seven GREEN suites: their hand-written factories predated task
// 1078's one write door, the save threw inside `usePersistentState`'s catch,
// the catch logged it, and each test passed without the write it meant to
// exercise. `vitest.setup.ts` now records that message and fails the test.
//
//   1. BEHAVIOUR — the real hook, over a storage mock with NO `mutateSidecar`,
//      saves: the gap is recorded, and the very assertion the setup's
//      `afterEach` runs throws. (This leg drains its own gap, so the suite
//      itself stays green; neuter the detector and it fails.)
//   2. The recognizer reads the message wherever a `catch` put it — a bare
//      string, an Error, an Error's `cause` — and ignores everything else.
//   3. CENSUS — the setup file installs the detector and checks it in both an
//      `afterEach` and an `afterAll`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { commentsStripped } from "./_source-scan";

const mockWrite = vi.fn(async () => undefined);

// Deliberately the PRE-1078 shape: read + write, no `mutateSidecar`.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({ words: [] })),
  readSidecarIfExists: vi.fn(async () => ({ words: [] })),
  writeSidecar: (...args: unknown[]) => mockWrite(...(args as [])),
}));

import { usePersistentState } from "@/hooks/usePersistentState";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import {
  assertNoMockExportGaps,
  noteMockExportGaps,
  takeMockExportGaps,
} from "./_mock-export-gap";

beforeEach(() => {
  __resetForTests();
  resetFlushers();
  takeMockExportGaps();
});

describe("a missing mock export fails its test (task 1231)", () => {
  it("BEHAVIOUR: a hook's save through a factory without `mutateSidecar` is recorded, and the setup's check throws", async () => {
    const DOC = "doc-1231";
    beginDocPipeline(DOC);
    const errors = vi.fn();
    const original = console.error;
    // Pass-through, so the detector beneath still sees the call.
    console.error = (...args: unknown[]) => {
      errors(...args);
      original(...args);
    };
    try {
      const { result } = renderHook(() =>
        usePersistentState<{ words: string[] }>(DOC, "dictionary.json", { words: [] }, {
          debounceMs: 0,
          errorLabel: "dictionary",
        }),
      );
      await act(async () => {
        result.current.update((prev) => ({ words: [...prev.words, "w"] }));
      });
      await waitFor(() => expect(errors).toHaveBeenCalled());
    } finally {
      console.error = original;
    }

    // The save never landed — this is the write a pre-1231 suite believed it
    // had exercised.
    expect(mockWrite).not.toHaveBeenCalled();
    // …and the gap is what the setup's afterEach would now throw on.
    expect(() => assertNoMockExportGaps("pinning leg")).toThrow(
      /"mutateSidecar" is not defined on the "@\/lib\/storage" mock/,
    );
    // Drained by the throw: the suite's own afterEach stays green.
    expect(takeMockExportGaps()).toEqual([]);
  });

  it("recognizes the message as a string, an Error, or an Error's cause — and nothing else", () => {
    const msg = '[vitest] No "foo" export is defined on the "@/lib/bar" mock. Did you forget';
    noteMockExportGaps(["Failed to save x:", new Error(msg)]);
    noteMockExportGaps([msg]);
    noteMockExportGaps([new Error("wrapped", { cause: new Error(msg) })]);
    noteMockExportGaps(["Failed to save x:", new Error("disk full"), { message: 3 }, null]);
    expect(takeMockExportGaps()).toEqual([
      '"foo" is not defined on the "@/lib/bar" mock',
      '"foo" is not defined on the "@/lib/bar" mock',
      '"foo" is not defined on the "@/lib/bar" mock',
    ]);
    expect(() => assertNoMockExportGaps("clean")).not.toThrow();
  });
});

describe("census · the setup file arms the detector for every file", () => {
  it("installs it and checks it in afterEach AND afterAll", () => {
    const setup = commentsStripped(
      fs.readFileSync(path.resolve(__dirname, "../../../vitest.setup.ts"), "utf8"),
    );
    expect(setup).toMatch(/from\s*["']\.\/src\/lib\/__tests__\/_mock-export-gap["']/);
    expect(setup).toMatch(/^installMockExportGapDetector\(\);/m);
    expect(setup).toMatch(/afterEach\(\(\)\s*=>\s*assertNoMockExportGaps\(/);
    expect(setup).toMatch(/afterAll\(\(\)\s*=>\s*assertNoMockExportGaps\(/);
  });
});
