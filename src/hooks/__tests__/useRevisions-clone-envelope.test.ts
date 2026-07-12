// @vitest-environment jsdom
//
// Task 099 — `cloneComment`/`cloneSuggestion` build a hand-enumerated literal
// for the duplicate and used to DROP the record-level `archived` envelope field
// (both `RevisionRequestCard` and `RevisionSuggestionCard` carry it), so
// duplicating an ARCHIVED comment/suggestion produced an ACTIVE clone that
// re-appeared out from under "View Archives". This is the 058/060/064/069/072/076
// envelope-drop family; the fix routes every clone literal through the shared
// `carryCardEnvelope` SSOT (also used by the morph chokepoint).
//
// The intentional resets are pinned too: `aiRequest`→false (comment) and
// `links`→[] (rewire walker) are cleared; a suggestion clone resets
// `status`→"pending".
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

describe("useRevisions clone carries the archived envelope (task 099)", () => {
  it("cloneComment keeps archived:true, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-rc");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "comment",
          id: "rc-src",
          archived: true,
          text: "keep me",
          content: {},
          aiRequest: true,
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-rc"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("rc-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("comment");
    expect(clone.id).not.toBe("rc-src");
    expect(clone.archived).toBe(true);
    expect((clone as { aiRequest?: boolean }).aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("cloneSuggestion keeps archived:true, resets status→pending, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-rs");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "suggestion",
          id: "rs-src",
          archived: true,
          author: "ai",
          original_text: "old",
          suggested_text: "new",
          explanation: "why",
          user_text: "",
          instructions: "",
          status: "accepted",
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-rs"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneSuggestion("rs-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("suggestion");
    expect(clone.id).not.toBe("rs-src");
    expect(clone.archived).toBe(true);
    expect((clone as { status?: string }).status).toBe("pending");
    expect(clone.links).toEqual([]);
  });

  it("a NON-archived comment clones active (no archived leakage)", async () => {
    beginDocPipeline("doc-rc2");
    mockRead.mockResolvedValue({
      cards: [{ kind: "comment", id: "rc2", text: "t", content: {}, ...base }],
    });
    const { result } = renderHook(() => useRevisions("doc-rc2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("rc2");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.archived).toBeFalsy();
  });
});
