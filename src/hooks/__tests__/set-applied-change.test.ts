// @vitest-environment jsdom
//
// Phase 1b (pending AI changes): the `setAppliedChange(id, ac | undefined)`
// hook setter on useRevisions / useCutter mirrors `setArchived`. The flag-ON
// host's Apply path calls it to stamp the in-doc splice descriptor; Keep calls
// it with `undefined` to clear it. These pin:
//   - setAppliedChange(id, ac) sets the descriptor on the matching suggestion;
//   - setAppliedChange(id, undefined) drops the key entirely (not left as
//     `appliedChange: undefined`);
//   - a non-suggestion / missing id is a no-op;
//   - the matching card's status/other fields are untouched.
// Mirrors suggestion-applied-stale-migrate.test.ts (same storage-mock plumbing).
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

import { useRevisions } from "../useRevisions";
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

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };
const suggestionFields = {
  author: "ai",
  original_text: "Before.",
  suggested_text: "After.",
  explanation: "",
  user_text: "",
  instructions: "",
};
const appliedChange = {
  anchorId: "anc-1",
  anchorUuid: "uuid-1",
  originalText: "Before.",
  replacement: "After.",
  mode: "replace" as const,
  appliedAt: "2026-01-02T00:00:00.000Z",
};

describe.each([
  ["revisions", useRevisions] as const,
  ["cutter", useCutter] as const,
])("setAppliedChange round-trip (%s)", (label, useHook) => {
  it("sets, then clears the appliedChange descriptor", async () => {
    const docId = `${label}-set-applied`;
    beginDocPipeline(docId);
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "s1", status: "pending", ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useHook(docId));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    // Set
    act(() => result.current.setAppliedChange("s1", appliedChange));
    {
      const c = result.current.cards[0];
      if (c.kind !== "suggestion") throw new Error("expected suggestion");
      expect(c.appliedChange).toEqual(appliedChange);
      // unrelated fields untouched
      expect(c.status).toBe("pending");
      expect(c.original_text).toBe("Before.");
    }

    // Clear — drops the key entirely (not `appliedChange: undefined`)
    act(() => result.current.setAppliedChange("s1", undefined));
    {
      const c = result.current.cards[0];
      if (c.kind !== "suggestion") throw new Error("expected suggestion");
      expect("appliedChange" in c).toBe(false);
    }
  });

  it("is a no-op for a missing id", async () => {
    const docId = `${label}-missing-id`;
    beginDocPipeline(docId);
    mockRead.mockResolvedValue({
      cards: [
        { kind: "suggestion", id: "s1", status: "pending", ...suggestionFields, ...base },
      ],
    });
    const { result } = renderHook(() => useHook(docId));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    act(() => result.current.setAppliedChange("does-not-exist", appliedChange));
    const c = result.current.cards[0];
    if (c.kind !== "suggestion") throw new Error("expected suggestion");
    expect(c.appliedChange).toBeUndefined();
  });
});
