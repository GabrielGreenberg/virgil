// @vitest-environment jsdom
//
// Task 108 — editing the Cutter word-goal must NOT re-baseline `initialWords`.
// `initialWords`/`setAt` are the snapshot captured at goal START and are the SSOT
// for cut-so-far progress (bar = initialWords − currentWords). The strip's "edit"
// affordance used to call `onSetGoal(target, currentWords)` and the hook wrote
// `initialWords := currentWords` unconditionally, so editing the target (or merely
// blurring the field) collapsed progress to 0%. The fix folds the baseline
// decision into `useCutter.setGoal`: preserve the existing baseline when a goal
// is present, capture `currentWords` only on FIRST set. These tests pin that
// contract so the two concerns can't re-conflate.
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { useCutter } from "../useCutter";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

describe("useCutter.setGoal baseline is the SSOT (task 108)", () => {
  it("first set captures currentWords as the baseline", async () => {
    beginDocPipeline("doc-g1");
    mockRead.mockResolvedValue({ cards: [] });
    const { result } = renderHook(() => useCutter("doc-g1"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setGoal(800, 1000);
    });
    await waitFor(() => expect(result.current.goal).toBeTruthy());

    expect(result.current.goal!.target).toBe(800);
    expect(result.current.goal!.initialWords).toBe(1000);
    // Derived progress after cutting to 900 words: totalToCut = 200, cutSoFar = 100.
  });

  it("editing an existing goal's target preserves the original baseline (the reported bug)", async () => {
    beginDocPipeline("doc-g2");
    mockRead.mockResolvedValue({ cards: [] });
    const { result } = renderHook(() => useCutter("doc-g2"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Set goal at 1000 words.
    act(() => {
      result.current.setGoal(800, 1000);
    });
    await waitFor(() => expect(result.current.goal).toBeTruthy());
    const setAt = result.current.goal!.setAt;

    // User cut down to 900 words, then edits target 800 -> 750. The strip passes
    // the CURRENT word count (900) as the second arg — the hook must NOT re-baseline.
    act(() => {
      result.current.setGoal(750, 900);
    });
    await waitFor(() => expect(result.current.goal!.target).toBe(750));

    expect(result.current.goal!.initialWords).toBe(1000); // NOT re-baselined to 900
    expect(result.current.goal!.setAt).toBe(setAt); // goal-start snapshot preserved
    // Derived cutSoFar = initialWords − currentWords = 1000 − 900 = 100 (progress held).
    const cutSoFar = result.current.goal!.initialWords - 900;
    expect(cutSoFar).toBe(100);
  });

  it("a no-op commit (blur with no change) does not move the baseline", async () => {
    beginDocPipeline("doc-g3");
    mockRead.mockResolvedValue({ cards: [] });
    const { result } = renderHook(() => useCutter("doc-g3"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setGoal(800, 1000);
    });
    await waitFor(() => expect(result.current.goal).toBeTruthy());

    // Blur re-commits the same target while the doc is now at 900 words.
    act(() => {
      result.current.setGoal(800, 900);
    });
    await waitFor(() => expect(result.current.goal!.target).toBe(800));

    expect(result.current.goal!.initialWords).toBe(1000);
  });

  it("clearGoal then a fresh setGoal re-captures the baseline (Clear is the reset affordance)", async () => {
    beginDocPipeline("doc-g4");
    mockRead.mockResolvedValue({ cards: [] });
    const { result } = renderHook(() => useCutter("doc-g4"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setGoal(800, 1000);
    });
    await waitFor(() => expect(result.current.goal).toBeTruthy());

    act(() => {
      result.current.clearGoal();
    });
    await waitFor(() => expect(result.current.goal).toBeNull());

    // New goal at the current (cut-down) word count re-baselines — intended.
    act(() => {
      result.current.setGoal(700, 900);
    });
    await waitFor(() => expect(result.current.goal).toBeTruthy());
    expect(result.current.goal!.initialWords).toBe(900);
  });
});
