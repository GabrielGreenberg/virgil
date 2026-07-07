// @vitest-environment jsdom
//
// Regression: the per-card `archived` flag must survive a reload. The bug —
// each hook's `migrate*` rebuilds its records field-by-field on load and used
// to DROP `archived`, so an archived card came back as active (and
// persistMigrationOnLoad then re-wrote the stripped record, losing the flag on
// disk too). These pin that every archivable store carries `archived` through
// its migrate. One representative per distinct migrate SHAPE: flat-with-kind
// (notes), flat-no-kind (todos), snippet (archive), and kind-discriminated
// rebuild (reports — the same shape revisions/cutter use).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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
import { useTodos } from "../useTodos";
import { useArchive } from "../useArchive";
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

describe("archived flag survives reload (migrate carry-through)", () => {
  it("notes.json: an archived note loads back archived; an active note stays active", async () => {
    beginDocPipeline("doc-n");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "note", id: "n-arch", archived: true, title: "", content: {}, ...base },
        { kind: "note", id: "n-active", title: "", content: {}, ...base },
      ],
    });
    const { result } = renderHook(() => useNotes("doc-n"));
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const byId = Object.fromEntries(result.current.cards.map((c) => [c.id, c]));
    expect(byId["n-arch"].archived).toBe(true);
    expect(byId["n-active"].archived).toBeFalsy();
  });

  it("notes.json: an archived HIGHLIGHT loads back archived + keeps originalAnchor (task 076)", async () => {
    // The highlight migrate SHAPE differs from the note one (no title/content)
    // and used to drop BOTH `archived` (→ un-archived on reload) and
    // `originalAnchor` (the Mode-B restore hint). Same envelope-drop class.
    beginDocPipeline("doc-h");
    const originalAnchor = {
      droppedAt: "2026-02-02T00:00:00.000Z",
      anchorId: "anc-h",
      textSnapshot: "span",
      paragraphIds: ["p-h"],
    };
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "highlight",
          id: "h-arch",
          archived: true,
          highlightColor: null,
          originalAnchor,
          ...base,
        },
        { kind: "highlight", id: "h-active", highlightColor: null, ...base },
      ],
    });
    const { result } = renderHook(() => useNotes("doc-h"));
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const byId = Object.fromEntries(result.current.cards.map((c) => [c.id, c]));
    expect(byId["h-arch"].archived).toBe(true);
    expect(byId["h-arch"].originalAnchor).toEqual(originalAnchor);
    expect(byId["h-active"].archived).toBeFalsy();
  });

  it("todos.json: an archived todo loads back archived", async () => {
    beginDocPipeline("doc-t");
    mockRead.mockResolvedValue({
      items: [
        { id: "t-arch", archived: true, text: "x", notes: "", done: false, ...base },
        { id: "t-active", text: "y", notes: "", done: false, ...base },
      ],
    });
    const { result } = renderHook(() => useTodos("doc-t"));
    await waitFor(() => expect(result.current.items.length).toBe(2));
    const byId = Object.fromEntries(result.current.items.map((t) => [t.id, t]));
    expect(byId["t-arch"].archived).toBe(true);
    expect(byId["t-active"].archived).toBeFalsy();
  });

  it("archive.json: an archived snippet loads back archived", async () => {
    beginDocPipeline("doc-a");
    mockRead.mockResolvedValue({
      snippets: [
        { id: "s-arch", archived: true, title: "", content: {}, ...base },
        { id: "s-active", title: "", content: {}, ...base },
      ],
    });
    const { result } = renderHook(() => useArchive("doc-a"));
    await waitFor(() => expect(result.current.snippets.length).toBe(2));
    const byId = Object.fromEntries(result.current.snippets.map((s) => [s.id, s]));
    expect(byId["s-arch"].archived).toBe(true);
    expect(byId["s-active"].archived).toBeFalsy();
  });

  it("reports.json: an archived report loads back archived (kind-discriminated rebuild)", async () => {
    beginDocPipeline("doc-r");
    mockRead.mockResolvedValue({
      cards: [
        { kind: "report", id: "r-arch", archived: true, author: "human", title: "", text: "", content: {}, ...base },
        { kind: "report", id: "r-active", author: "human", title: "", text: "", content: {}, ...base },
      ],
    });
    const { result } = renderHook(() => useReports("doc-r"));
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const byId = Object.fromEntries(result.current.cards.map((c) => [c.id, c]));
    expect(byId["r-arch"].archived).toBe(true);
    expect(byId["r-active"].archived).toBeFalsy();
  });
});
