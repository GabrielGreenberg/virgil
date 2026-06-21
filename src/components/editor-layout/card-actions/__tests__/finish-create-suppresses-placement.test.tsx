// @vitest-environment jsdom
//
// Regression guard for the "creating a footnote/citation jumps the viewport"
// bug (the post-insert half the original no-scroll-insert fix never covered).
//
// Root cause: the shared `finishCreate` tail selects the brand-new card, which
// trips `usePlacement`'s card→text alignment effect, whose `alignEntryToY`
// writes `scrollEl.scrollTop` and drags the shared row scroll. The new card is
// ALREADY surfaced at the right spot (floated at its anchorRect / pinned to its
// panel), so the editor must NOT scroll to "align" it.
//
// The contract: `finishCreate` calls `suppressNextPlacement()` BEFORE the
// selection setter — the same suppression `marker-clicks.ts` uses for the
// inverse gesture. Because EVERY card factory funnels through `finishCreate`,
// this guards all 13 kinds at once; we pin footnote (the reported case) and
// note (proves it's the shared tail, not a footnote-special path).
//
// (useCardCreation transitively imports `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest can't alias — stub it, the known gotcha.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

// Spy on the suppression primitive; keep the rest of the module real.
vi.mock("@/links/_shared/usePlacement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/links/_shared/usePlacement")>();
  return { ...actual, suppressNextPlacement: vi.fn() };
});

import { useCardCreation } from "../card-creation";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";

const suppressMock = vi.mocked(suppressNextPlacement);

type CardDeps = Parameters<typeof useCardCreation>[0];

/** Minimal useCardCreation deps: only the footnote/note paths are exercised,
 *  so the handle carries stubbed footnote methods and the rest are inert. */
function makeDeps(over: Partial<CardDeps> = {}): CardDeps {
  const inert = (() => ({})) as never;
  const noop = (() => {}) as never;
  return {
    editorRef: {
      current: {
        getEditor: () => ({ state: { doc: { descendants: () => {} } } }),
        createEmptyFootnote: () => ({ footnoteId: "fn-1" }),
        createFootnoteFromSelection: () => ({ footnoteId: "fn-1" }),
        renumberFootnotes: () => {},
      },
    } as never,
    addNote: (() => ({ id: "note-1" })) as never,
    addHighlight: inert,
    deleteNote: noop,
    addCutterComment: inert,
    addCutterSuggestion: inert,
    addRevisionComment: inert,
    addRevisionSuggestion: inert,
    addReport: inert,
    addReportRequest: inert,
    addCitation: (() => ({ id: "cit-1" })) as never,
    addTodo: (() => ({ id: "todo-1" })) as never,
    updateTodo: noop,
    addTodoTextObjectId: noop,
    setTodoAnchor: noop,
    archiveContent: inert,
    updateArchiveSnippet: noop,
    addArchiveTextObjectId: noop,
    setSelectedArchiveId: noop,
    setSelectedNoteId: noop,
    setSelectedCutterCardId: noop,
    setSelectedReportCardId: noop,
    setSelectedCommentId: noop,
    setSelectedTodoId: noop,
    setSelectedFootnoteId: noop,
    setSelectedCitationId: noop,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    setActiveLeft: noop,
    setActiveRight: noop,
    popCardAtAnchor: noop,
    markFootnotePristine: noop,
    getFootnoteCount: (() => 0) as never,
    ...over,
  } as CardDeps;
}

beforeEach(() => {
  suppressMock.mockClear();
});

describe("finishCreate suppresses card→text placement on create", () => {
  it("createFootnote suppresses placement BEFORE selecting the new card", () => {
    const setSelectedFootnoteId = vi.fn();
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ setSelectedFootnoteId: setSelectedFootnoteId as never })),
    );

    act(() => {
      result.current.createFootnote({});
    });

    expect(suppressMock).toHaveBeenCalledTimes(1);
    expect(setSelectedFootnoteId).toHaveBeenCalledWith("fn-1");
    // Order matters: the flag must be set before the selection setter that
    // trips usePlacement's effect, or the alignment scroll still fires.
    expect(suppressMock.mock.invocationCallOrder[0]).toBeLessThan(
      setSelectedFootnoteId.mock.invocationCallOrder[0],
    );
  });

  it("createNote suppresses placement too (the shared finishCreate tail)", () => {
    const setSelectedNoteId = vi.fn();
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ setSelectedNoteId: setSelectedNoteId as never })),
    );

    act(() => {
      result.current.createNote({});
    });

    expect(suppressMock).toHaveBeenCalledTimes(1);
    expect(setSelectedNoteId).toHaveBeenCalledWith("note-1");
  });
});
