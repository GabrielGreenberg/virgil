// @vitest-environment jsdom
//
// Task 099 — the cutter twin of the revisions clone-envelope test.
// `cloneComment`/`cloneSuggestion` used to DROP `archived` from the duplicate
// literal (both `CutterCommentCard` and `CutterSuggestionCard` carry it), so
// duplicating an ARCHIVED cut card produced an ACTIVE clone. The fix routes the
// literals through the shared `carryCardEnvelope` SSOT. Intentional resets
// (aiRequest→false, links→[], suggestion status→"pending") are pinned too.
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

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };

describe("useCutter clone carries the archived envelope (task 099)", () => {
  it("cloneComment keeps archived:true, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-cc");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "comment",
          id: "cc-src",
          archived: true,
          text: "cut me later",
          content: {},
          aiRequest: true,
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useCutter("doc-cc"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("cc-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("comment");
    expect(clone.id).not.toBe("cc-src");
    expect(clone.archived).toBe(true);
    expect((clone as { aiRequest?: boolean }).aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("cloneSuggestion keeps archived:true, resets status→pending, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-cs");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "suggestion",
          id: "cs-src",
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
    const { result } = renderHook(() => useCutter("doc-cs"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneSuggestion("cs-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("suggestion");
    expect(clone.id).not.toBe("cs-src");
    expect(clone.archived).toBe(true);
    expect((clone as { status?: string }).status).toBe("pending");
    expect(clone.links).toEqual([]);
  });

  it("a NON-archived comment clones active (no archived leakage)", async () => {
    beginDocPipeline("doc-cc2");
    mockRead.mockResolvedValue({
      cards: [{ kind: "comment", id: "cc2", text: "t", content: {}, ...base }],
    });
    const { result } = renderHook(() => useCutter("doc-cc2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("cc2");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.archived).toBeFalsy();
  });
});
