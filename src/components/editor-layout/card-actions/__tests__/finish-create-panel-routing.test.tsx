// @vitest-environment jsdom
//
// Regression guard for task 095: panel header "+" must create an IN-PANEL card,
// not a popped-out floating card.
//
// Root cause was at the callers: the Notes/Reports/Cutter/Revisions header-"+"
// hosts forwarded the trigger BUTTON's DOMRect as `anchorRect` into their
// create call. The shared `finishCreate` treats "an anchorRect was passed" as
// the signal to float (`fromToolbar` → `popCardAtAnchor`), so those four panels
// popped out while Todo (which passes `createTodo({})`, no rect) stayed
// in-panel. The fix aligned all four hosts to Todo — call `createX({})`.
//
// The SSOT contract this pins (the design intent documented at
// card-creation.ts:360-365, and both "Done when" bullets of task 095):
//   • no `anchorRect`  → IN-PANEL: `popCardAtAnchor` is NOT called.
//   • with `anchorRect` → FLOAT:   `popCardAtAnchor` IS called with that rect.
// Because EVERY panel factory funnels through `finishCreate`, pinning it here
// guards all four panels at once (note stands in for the shared tail); the
// float half guards the genuine in-editor Actions/selection toolbar path, which
// MUST still float and must not regress when the header path stops floating.
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

import { useCardCreation } from "../card-creation";
import { defaultCardStore } from "@/links/_shared/anchored-card-store";

type CardDeps = Parameters<typeof useCardCreation>[0];

/** Minimal deps: only the note create path is exercised (it funnels through the
 *  shared `finishCreate`, so it stands in for all four panels). `popCardAtAnchor`
 *  is a spy — its call/no-call is the float-vs-in-panel signal. */
function makeDeps(over: Partial<CardDeps> = {}): CardDeps {
  const inert = (() => ({})) as never;
  const noop = (() => {}) as never;
  return {
    editorRef: { current: {} } as never,
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
    store: defaultCardStore,
    ...over,
  } as CardDeps;
}

let popSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  popSpy = vi.fn();
});

describe("finishCreate routes panel-header create in-panel, toolbar create to a float", () => {
  it("createNote({}) (no anchorRect — the panel header '+' path) does NOT float", () => {
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ popCardAtAnchor: popSpy as never })),
    );

    act(() => {
      result.current.createNote({});
    });

    // The whole point: the header "+" path is in-panel, so no popped float.
    expect(popSpy).not.toHaveBeenCalled();
  });

  it("createNote({ anchorRect }) (the in-editor Actions toolbar path) DOES float at the rect", () => {
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ popCardAtAnchor: popSpy as never })),
    );
    const rect = { top: 12, left: 34 } as DOMRect;

    act(() => {
      result.current.createNote({ anchorRect: rect });
    });

    // The genuine selection-toolbar create MUST still float — pin so the
    // header-path fix (dropping anchorRect) never bleeds into this path.
    expect(popSpy).toHaveBeenCalledTimes(1);
    expect(popSpy).toHaveBeenCalledWith("note", "note-1", rect);
  });
});
