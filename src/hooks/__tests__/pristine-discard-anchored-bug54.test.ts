// @vitest-environment jsdom
//
// BUG #54 — "Empty card + click-away should silently discard". The unified
// pristine-discard contract: a freshly-created card is pristine (and so
// discards on click-away) when it has NO BODY CONTENT, *regardless* of whether
// it carries an anchor or a paragraph link. The old condition
// (`!content && !anchor && !paragraphId`) excluded anchored cards, so the
// common "+ at the cursor" note/comment/report — which carries a paragraphId —
// was never pristine and lingered on click-away. Footnotes/todos/citations
// already used the empty-body model; this pins that EVERY card hook now agrees.
//
// One representative per family + the suggestion sub-rule (a selection-seeded
// suggestion captures the anchor text as `original_text`, so it is content and
// must be KEPT; a Mode-A paragraph-anchored blank suggestion has no original
// text and must DISCARD).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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
import { useCutter } from "../useCutter";
import { useReports } from "../useReports";
import { useRevisions } from "../useRevisions";
import { useTodos } from "../useTodos";
import { usePristineCardManager } from "../usePristineCardManager";
import type { JSONContent } from "@tiptap/react";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockRead.mockResolvedValue(null);
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const PARA = "para-uuid-1";
const ANCHOR = { anchorId: "anc-1", anchorText: "the selected passage" };
const BODY: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "real content" }] }],
};

// ── notes ────────────────────────────────────────────────────────────────
describe("BUG #54: an empty ANCHORED note is pristine (discards on click-away)", () => {
  it("blank note created with a paragraphId is pristine", () => {
    beginDocPipeline("doc-note-a");
    const mgr = renderHook(() => usePristineCardManager());
    const notesPristine = mgr.result.current.forKind("notes");
    const { result } = renderHook(() => useNotes("doc-note-a", notesPristine));
    let id = "";
    act(() => {
      id = result.current.addNote(PARA).id;
    });
    expect(notesPristine.isPristine(id)).toBe(true);
  });

  it("blank note created with a text anchor is pristine", () => {
    beginDocPipeline("doc-note-b");
    const mgr = renderHook(() => usePristineCardManager());
    const notesPristine = mgr.result.current.forKind("notes");
    const { result } = renderHook(() => useNotes("doc-note-b", notesPristine));
    let id = "";
    act(() => {
      id = result.current.addNote(null, undefined, ANCHOR).id;
    });
    expect(notesPristine.isPristine(id)).toBe(true);
  });

  it("a note created WITH content is NOT pristine (kept on click-away)", () => {
    beginDocPipeline("doc-note-c");
    const mgr = renderHook(() => usePristineCardManager());
    const notesPristine = mgr.result.current.forKind("notes");
    const { result } = renderHook(() => useNotes("doc-note-c", notesPristine));
    let id = "";
    act(() => {
      id = result.current.addNote(PARA, BODY).id;
    });
    expect(notesPristine.isPristine(id)).toBe(false);
  });

  it("discardAll() drops the empty anchored note but keeps the content note", () => {
    beginDocPipeline("doc-note-d");
    const mgr = renderHook(() => usePristineCardManager());
    const notesPristine = mgr.result.current.forKind("notes");
    const { result } = renderHook(() => useNotes("doc-note-d", notesPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      notesPristine.registerDiscard((cardId) => result.current.deleteNote(cardId));
      blankId = result.current.addNote(PARA).id;
      fullId = result.current.addNote(PARA, BODY).id;
    });
    expect(result.current.notes.map((n) => n.id).sort()).toEqual(
      [blankId, fullId].sort(),
    );
    act(() => {
      notesPristine.discardAll();
    });
    expect(result.current.notes.map((n) => n.id)).toEqual([fullId]);
  });
});

// ── cutter (comment + suggestion) ──────────────────────────────────────────
describe("BUG #54: cutter comments + suggestions", () => {
  it("blank cutter comment with a paragraphId is pristine; one with content is not", () => {
    beginDocPipeline("doc-cut-a");
    const mgr = renderHook(() => usePristineCardManager());
    const cutPristine = mgr.result.current.forKind("cutter");
    const { result } = renderHook(() => useCutter("doc-cut-a", cutPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      blankId = result.current.addComment(PARA).id;
      fullId = result.current.addComment(PARA, BODY).id;
    });
    expect(cutPristine.isPristine(blankId)).toBe(true);
    expect(cutPristine.isPristine(fullId)).toBe(false);
  });

  it("a Mode-A (paragraph) blank suggestion is pristine; a selection-seeded one is kept", () => {
    beginDocPipeline("doc-cut-b");
    const mgr = renderHook(() => usePristineCardManager());
    const cutPristine = mgr.result.current.forKind("cutter");
    const { result } = renderHook(() => useCutter("doc-cut-b", cutPristine));
    let modeAId = "";
    let seededId = "";
    act(() => {
      // Blank suggestion anchored to a paragraph — empty original_text.
      modeAId = result.current.addSuggestion(PARA).id;
      // Selection-seeded suggestion — anchor text becomes original_text (content).
      seededId = result.current.addSuggestion(null, undefined, ANCHOR).id;
    });
    expect(cutPristine.isPristine(modeAId)).toBe(true);
    expect(cutPristine.isPristine(seededId)).toBe(false);
  });

  it("discardAll() drops the empty cutter cards via the registered delete", () => {
    beginDocPipeline("doc-cut-c");
    const mgr = renderHook(() => usePristineCardManager());
    const cutPristine = mgr.result.current.forKind("cutter");
    const { result } = renderHook(() => useCutter("doc-cut-c", cutPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      cutPristine.registerDiscard((id) => result.current.deleteCard(id));
      blankId = result.current.addComment(PARA).id;
      fullId = result.current.addComment(PARA, BODY).id;
    });
    act(() => {
      cutPristine.discardAll();
    });
    expect(result.current.cards.map((c) => c.id)).toEqual([fullId]);
    expect(blankId).not.toBe("");
  });
});

// ── revisions (the missing-wiring class) ───────────────────────────────────
describe("BUG #54: revisions — empty anchored comment/suggestion is pristine", () => {
  it("blank revision comment with a paragraphId is pristine; with content is not", () => {
    beginDocPipeline("doc-rev-a");
    const mgr = renderHook(() => usePristineCardManager());
    const revPristine = mgr.result.current.forKind("revisions");
    const { result } = renderHook(() => useRevisions("doc-rev-a", revPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      blankId = result.current.addComment(PARA).id;
      fullId = result.current.addComment(PARA, BODY).id;
    });
    expect(revPristine.isPristine(blankId)).toBe(true);
    expect(revPristine.isPristine(fullId)).toBe(false);
  });

  it("a Mode-A blank revision suggestion is pristine; a selection-seeded one is kept", () => {
    beginDocPipeline("doc-rev-b");
    const mgr = renderHook(() => usePristineCardManager());
    const revPristine = mgr.result.current.forKind("revisions");
    const { result } = renderHook(() => useRevisions("doc-rev-b", revPristine));
    let modeAId = "";
    let seededId = "";
    act(() => {
      modeAId = result.current.addSuggestion(PARA).id;
      seededId = result.current.addSuggestion(null, undefined, ANCHOR).id;
    });
    expect(revPristine.isPristine(modeAId)).toBe(true);
    expect(revPristine.isPristine(seededId)).toBe(false);
  });

  it("discardAll() drops the empty revision cards via the registered delete", () => {
    beginDocPipeline("doc-rev-c");
    const mgr = renderHook(() => usePristineCardManager());
    const revPristine = mgr.result.current.forKind("revisions");
    const { result } = renderHook(() => useRevisions("doc-rev-c", revPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      revPristine.registerDiscard((id) => result.current.deleteCard(id));
      blankId = result.current.addComment(PARA).id;
      fullId = result.current.addComment(PARA, BODY).id;
    });
    act(() => {
      revPristine.discardAll();
    });
    expect(result.current.cards.map((c) => c.id)).toEqual([fullId]);
    expect(blankId).not.toBe("");
  });
});

// ── reports (report + report-request) ──────────────────────────────────────
describe("BUG #54: reports + report-requests", () => {
  it("blank report with a paragraphId is pristine; with content is not", () => {
    beginDocPipeline("doc-rep-a");
    const mgr = renderHook(() => usePristineCardManager());
    const repPristine = mgr.result.current.forKind("reports");
    const { result } = renderHook(() => useReports("doc-rep-a", repPristine));
    let blankId = "";
    let fullId = "";
    act(() => {
      blankId = result.current.addReport(PARA).id;
      fullId = result.current.addReport(PARA, BODY).id;
    });
    expect(repPristine.isPristine(blankId)).toBe(true);
    expect(repPristine.isPristine(fullId)).toBe(false);
  });

  it("blank report-request with a paragraphId is pristine", () => {
    beginDocPipeline("doc-rep-b");
    const mgr = renderHook(() => usePristineCardManager());
    const repPristine = mgr.result.current.forKind("reports");
    const { result } = renderHook(() => useReports("doc-rep-b", repPristine));
    let id = "";
    act(() => {
      id = result.current.addReportRequest(PARA).id;
    });
    expect(repPristine.isPristine(id)).toBe(true);
  });
});

// ── todos (the already-correct model — pinned so it can't regress) ─────────
describe("BUG #54: todos already use the empty-body model (regression pin)", () => {
  it("a freshly-added todo is pristine (empty body, no 'Task N' seed)", () => {
    beginDocPipeline("doc-todo-a");
    const mgr = renderHook(() => usePristineCardManager());
    const todoPristine = mgr.result.current.forKind("todo");
    const { result } = renderHook(() => useTodos("doc-todo-a", todoPristine));
    let id = "";
    act(() => {
      id = result.current.addItem().id;
    });
    expect(todoPristine.isPristine(id)).toBe(true);
    // The body is genuinely empty — no machine-generated "Task N" content.
    expect(result.current.items[0].text).toBe("");
  });

  it("typing into a todo marks it dirty (no longer pristine)", () => {
    beginDocPipeline("doc-todo-b");
    const mgr = renderHook(() => usePristineCardManager());
    const todoPristine = mgr.result.current.forKind("todo");
    const { result } = renderHook(() => useTodos("doc-todo-b", todoPristine));
    let id = "";
    act(() => {
      id = result.current.addItem().id;
    });
    act(() => {
      result.current.updateItem(id, "actually do the thing");
    });
    expect(todoPristine.isPristine(id)).toBe(false);
  });
});
