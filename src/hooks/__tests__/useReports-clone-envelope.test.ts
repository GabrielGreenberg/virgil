// @vitest-environment jsdom
//
// Task 099 — `cloneReport`/`cloneRequest` build a hand-enumerated literal that
// used to DROP `archived` (both `ReportCard` and `ReportRequestCard` carry it).
// These two clone functions are DEAD CODE today — reports declare
// `lifecycle.clone:false`, so nothing dispatches them — but the same literal
// pattern is a REACHABLE bug one hook over (revisions/cutter). Routing them
// through the shared `carryCardEnvelope` SSOT future-proofs them for free; this
// test pins the behavior against the day reports are made clonable.
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

import { useReports } from "../useReports";
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

describe("useReports clone carries the archived envelope (task 099, future-proofing)", () => {
  it("cloneReport keeps archived:true, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-rep");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "report",
          id: "rep-src",
          archived: true,
          author: "ai",
          title: "T",
          text: "body",
          content: {},
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useReports("doc-rep"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneReport("rep-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("report");
    expect(clone.id).not.toBe("rep-src");
    expect(clone.archived).toBe(true);
    expect(clone.links).toEqual([]);
  });

  it("cloneRequest keeps archived:true, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-repreq");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "report-request",
          id: "repreq-src",
          archived: true,
          text: "please report",
          content: {},
          aiRequest: true,
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useReports("doc-repreq"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneRequest("repreq-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("report-request");
    expect(clone.id).not.toBe("repreq-src");
    expect(clone.archived).toBe(true);
    expect((clone as { aiRequest?: boolean }).aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("a NON-archived report clones active (no archived leakage)", async () => {
    beginDocPipeline("doc-rep2");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "report", id: "rep2", author: "ai", title: "", text: "b", content: {}, ...base },
      ],
    });
    const { result } = renderHook(() => useReports("doc-rep2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneReport("rep2");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.archived).toBeFalsy();
  });
});
