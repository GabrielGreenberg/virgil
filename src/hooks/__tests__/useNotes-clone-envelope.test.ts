// @vitest-environment jsdom
//
// Task 076 — `cloneNote`/`cloneHighlight` build a hand-enumerated literal for
// the duplicate and used to DROP two record-level envelope fields that both
// `UserNote` and `HighlightCard` carry:
//   - `archived`      → duplicating an archived card produced an ACTIVE clone.
//   - `originalAnchor`→ the Mode-B "restore the original range" hint was lost.
// This is the 058/060/064/069/072 envelope-drop family; task 072 fixed it at
// the morph chokepoint, the clone literals were never covered.
//
// `aiRequest` (reset to false) and `links` (cleared for the rewire walker) are
// intentionally NOT carried — the test also pins that those stay cleared.
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

import { useNotes } from "../useNotes";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import type { OriginalAnchor } from "@/lib/types";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const ORIGINAL_ANCHOR: OriginalAnchor = {
  droppedAt: "2026-02-02T00:00:00.000Z",
  anchorId: "anc-1",
  textSnapshot: "the original span",
  paragraphIds: ["para-src"],
};
const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };

describe("cloneNote / cloneHighlight carry the envelope (task 076)", () => {
  it("cloneNote keeps archived + originalAnchor, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-cn");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "note",
          id: "n-src",
          archived: true,
          originalAnchor: ORIGINAL_ANCHOR,
          title: "Src",
          content: {},
          aiRequest: true,
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useNotes("doc-cn"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneNote("n-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("note");
    expect(clone.id).not.toBe("n-src");
    // Envelope preserved:
    expect(clone.archived).toBe(true);
    expect(clone.originalAnchor).toEqual(ORIGINAL_ANCHOR);
    // Intentionally reset / cleared:
    expect(clone.aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("cloneHighlight keeps archived + originalAnchor, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-ch");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "highlight",
          id: "h-src",
          archived: true,
          originalAnchor: ORIGINAL_ANCHOR,
          highlightColor: null,
          aiRequest: true,
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useNotes("doc-ch"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneHighlight("h-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("highlight");
    expect(clone.id).not.toBe("h-src");
    expect(clone.archived).toBe(true);
    expect(clone.originalAnchor).toEqual(ORIGINAL_ANCHOR);
    expect(clone.aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("a NON-archived note clones active with no originalAnchor leakage", async () => {
    beginDocPipeline("doc-cn2");
    mockRead.mockResolvedValue({
      cards: [{ kind: "note", id: "n2", title: "", content: {}, ...base }],
    });
    const { result } = renderHook(() => useNotes("doc-cn2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneNote("n2");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.archived).toBeFalsy();
    expect(clone.originalAnchor).toBeUndefined();
  });
});
