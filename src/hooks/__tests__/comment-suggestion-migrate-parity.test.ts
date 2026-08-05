// @vitest-environment jsdom
//
// Twin-fork parity (task 301, member of blocked/201's class): the Cutter and
// Revisions comment-migration paths must recover a comment's plain text the
// same way. Both `useRevisions.migrateRequestRecord` and `useCutter.migrateComment`
// take a comment record with `text: ""` but a non-empty rich `content` and are
// SUPPOSED to fall back to `richJsonToPlainText(content)` — an empty string is a
// string, so without a `.length > 0` guard the empty `text` is taken verbatim and
// the content is never consulted. Pre-301 only the revisions twin had the guard;
// this pins that both now recover identically (defensive-migration hardening for
// out-of-sync/legacy/externally-written sidecar data). Mirrors the storage-mock +
// renderHook plumbing of suggestion-applied-stale-migrate.test.ts.
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
const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Recovered body." }] },
  ],
};

// A comment persisted with an empty `text` mirror but real rich `content` — the
// out-of-sync sidecar shape the migrate fallback exists to repair.
const emptyTextComment = { kind: "comment", id: "c-empty", text: "", content, ...base };

// The migrated card union carries suggestion cards too (no `text` field); narrow
// to the comment kind before reading the recovered plain-text mirror.
function commentText(card: { kind: string; text?: string }): string {
  if (card.kind !== "comment") throw new Error(`expected comment, got ${card.kind}`);
  return card.text ?? "";
}

describe("comment migrate recovers text from content on empty `text` (twin parity)", () => {
  it("revisions twin recovers the content's plain text", async () => {
    beginDocPipeline("rev-empty-text");
    mockRead.mockResolvedValue({ cards: [emptyTextComment] });
    const { result } = renderHook(() => useRevisions("rev-empty-text"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    expect(commentText(result.current.cards[0])).toBe("Recovered body.");
  });

  it("cutter twin recovers the same way (member A: the missing `.length > 0` guard)", async () => {
    beginDocPipeline("cut-empty-text");
    mockRead.mockResolvedValue({ cards: [emptyTextComment] });
    const { result } = renderHook(() => useCutter("cut-empty-text"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    expect(commentText(result.current.cards[0])).toBe("Recovered body.");
  });

  it("a non-empty persisted `text` is still taken verbatim on both twins", async () => {
    const explicit = { kind: "comment", id: "c-explicit", text: "Explicit.", content, ...base };
    beginDocPipeline("rev-explicit-text");
    mockRead.mockResolvedValue({ cards: [explicit] });
    const rev = renderHook(() => useRevisions("rev-explicit-text"));
    await waitFor(() => expect(rev.result.current.cards.length).toBe(1));
    expect(commentText(rev.result.current.cards[0])).toBe("Explicit.");

    beginDocPipeline("cut-explicit-text");
    mockRead.mockResolvedValue({ cards: [explicit] });
    const cut = renderHook(() => useCutter("cut-explicit-text"));
    await waitFor(() => expect(cut.result.current.cards.length).toBe(1));
    expect(commentText(cut.result.current.cards[0])).toBe("Explicit.");
  });
});
