// @vitest-environment jsdom
//
// Task 118 — archived cards must surface in search WITH their archived state.
//
// The bug: every collection search fn received the RAW hook arrays (archived
// filtering happens at the panel), matched archived cards like any other, and
// `SearchHit` carried no archived field — so the result card rendered an
// archived note/todo/citation as a normal hit, and the jump selected a card
// the target panel's default "Active" view had filtered out (a dead click —
// that half is pinned by planJumpArchiveView in jump-selection.test.ts).
//
// This file pins the CUE half: every archivable collection scope stamps the
// item's per-card `archived` flag onto its hits, uniformly at the hit — the
// same at-the-sink shape as `unanchored` — and active items stay unflagged.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import type { Editor } from "@tiptap/react";
import {
  searchNotes,
  searchCitations,
  searchTodos,
  searchArchive,
  searchCutter,
  searchReports,
  searchComments,
  searchFootnotes,
  type SearchHit,
} from "@/lib/search-sources";
import type {
  ArchivedSnippet,
  CitationRef,
  CutterCard,
  ReportItem,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";

const RE = /UNICORN/g;
// Anchor resolution falls back to lowestPos over an empty uuid map →
// unanchored, which is orthogonal to what we assert here. The fake editor is
// never dereferenced on that path (no textRange links on the fixtures).
const fakeEditor = {} as Editor;
const uuidPos = new Map<string, number>();

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Assert one archived + one active item produced hits, flagged accordingly. */
function expectStamped(hits: SearchHit[], archivedId: string, activeId: string) {
  const archivedHits = hits.filter((h) => h.itemId === archivedId);
  const activeHits = hits.filter((h) => h.itemId === activeId);
  expect(archivedHits.length).toBeGreaterThan(0);
  expect(activeHits.length).toBeGreaterThan(0);
  for (const h of archivedHits) expect(h.archived).toBe(true);
  for (const h of activeHits) expect(h.archived).toBeFalsy();
}

describe("collection search fns stamp the item's archived flag onto hits", () => {
  it("notes", () => {
    const notes = [
      { kind: "note", id: "n-arch", archived: true, title: "UNICORN note",
        content: doc("UNICORN body"), links: [] },
      { kind: "note", id: "n-act", title: "UNICORN note",
        content: doc("UNICORN body"), links: [] },
    ] as unknown as UserNote[];
    expectStamped(searchNotes(notes, fakeEditor, uuidPos, RE), "n-arch", "n-act");
  });

  it("citations (persisted, incl. the display-text field)", () => {
    const persisted = [
      { id: "c-arch", archived: true, command: "\\citep{UNICORN2020}",
        keys: ["UNICORN2020"], createdAt: "" },
      { id: "c-act", command: "\\citep{UNICORN2020}",
        keys: ["UNICORN2020"], createdAt: "" },
    ] as unknown as CitationRef[];
    const hits = searchCitations(persisted, [], (cmd) => cmd + " UNICORN display", RE);
    expectStamped(hits, "c-arch", "c-act");
  });

  it("todos (text + notes fields)", () => {
    const todos = [
      { id: "t-arch", archived: true, text: "UNICORN todo",
        notes: "UNICORN detail", links: [] },
      { id: "t-act", text: "UNICORN todo", links: [] },
    ] as unknown as TodoItem[];
    expectStamped(searchTodos(todos, uuidPos, RE), "t-arch", "t-act");
  });

  it("archive snippets (a snippet card itself can be archived)", () => {
    const snippets = [
      { id: "s-arch", archived: true, title: "UNICORN clip",
        content: doc("UNICORN text"), createdAt: "", links: [] },
      { id: "s-act", title: "UNICORN clip",
        content: doc("UNICORN text"), createdAt: "", links: [] },
    ] as unknown as ArchivedSnippet[];
    expectStamped(searchArchive(snippets, uuidPos, RE), "s-arch", "s-act");
  });

  it("cutter cards (comment + suggestion kinds)", () => {
    const cards = [
      { kind: "comment", id: "cut-arch", archived: true, text: "UNICORN cut",
        content: doc("UNICORN cut"), links: [] },
      { kind: "suggestion", id: "cut-act", original_text: "UNICORN original",
        suggested_text: "UNICORN suggested", explanation: "UNICORN why",
        user_text: "", instructions: "", links: [] },
    ] as unknown as CutterCard[];
    expectStamped(searchCutter(cards, fakeEditor, uuidPos, RE), "cut-arch", "cut-act");
  });

  it("reports", () => {
    const cards = [
      { kind: "report", id: "rep-arch", archived: true, title: "UNICORN report",
        text: "UNICORN body", content: doc("UNICORN body"), links: [] },
      { kind: "report", id: "rep-act", title: "UNICORN report",
        text: "UNICORN body", content: doc("UNICORN body"), links: [] },
    ] as unknown as ReportItem[];
    expectStamped(searchReports(cards, fakeEditor, uuidPos, RE), "rep-arch", "rep-act");
  });

  it("revision cards (comment + suggestion kinds)", () => {
    const cards = [
      { kind: "comment", id: "rev-arch", archived: true, text: "UNICORN comment",
        content: doc("UNICORN comment"), links: [] },
      { kind: "suggestion", id: "rev-act", original_text: "UNICORN original",
        suggested_text: "", explanation: "", user_text: "", instructions: "",
        links: [] },
    ] as unknown as RevisionCard[];
    expectStamped(searchComments(cards, fakeEditor, RE), "rev-arch", "rev-act");
  });

  it("footnotes carry no archived flag (live + orphans are never archived; the archived refs are atomless and not in the search corpus)", () => {
    const hits = searchFootnotes(
      [{ footnoteId: "f-1", content: doc("UNICORN fn"), pos: 5 }],
      [{ footnoteId: "o-1", content: doc("UNICORN orphan"), orphanedAt: "" }],
      RE,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.archived).toBeFalsy();
  });
});
