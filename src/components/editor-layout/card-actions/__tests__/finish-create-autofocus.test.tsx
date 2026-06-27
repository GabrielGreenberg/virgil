// @vitest-environment jsdom
//
// CHIP B — on user-initiated card creation, the central `finishCreate`
// chokepoint drops the caret into the new card's body: it EXPANDS the card (so
// the RichTextField body mounts), marks it SELECTED in the shared `cardStore`,
// and calls the SSOT `focusNewCard` helper. Programmatic / AI callers opt out
// with `autoFocus: false` so they never steal focus mid-edit.
//
// Because EVERY card factory funnels through `finishCreate`, this behavior is
// universal; we pin:
//   - an editable-body kind (note) user-initiated → expand + select + focus
//   - the same kind with `autoFocus: false` → NO expand / select / focus
//   - a bodiless kind (highlight) → never focuses (the citation/highlight
//     carve-out in `cardKindHasEditableBody`)
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

// Spy on `focusNewCard`; keep the real `cardKindHasEditableBody` predicate the
// central gate reads.
vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { useCardCreation } from "../card-creation";
import { focusNewCard } from "@/lib/focus-new-card";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { cardPopKey } from "@/panels/panel-registry";

const focusMock = vi.mocked(focusNewCard);

type CardDeps = Parameters<typeof useCardCreation>[0];

/** Minimal useCardCreation deps: only the note/highlight paths are exercised. */
function makeDeps(over: Partial<CardDeps> = {}): CardDeps {
  const inert = (() => ({})) as never;
  const noop = (() => {}) as never;
  return {
    editorRef: { current: {} } as never,
    addNote: (() => ({ id: "note-1" })) as never,
    addHighlight: (() => ({ id: "hl-1" })) as never,
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
    // The per-doc store finishCreate expands/selects in — point it at the same
    // instance the assertions read (the `as CardDeps` cast would otherwise hide
    // a missing `store`, then crash at runtime on `store.expand`).
    store: cardStore,
    ...over,
  } as CardDeps;
}

beforeEach(() => {
  focusMock.mockClear();
  // Reset the module-scope store between cases.
  cardStore.clearSelection();
  for (const r of cardStore.getState().expandedSet.slice()) cardStore.collapse(r);
});

describe("finishCreate caret-into-body (CHIP B)", () => {
  it("user-initiated create of an editable kind expands + selects + focuses the new card", () => {
    const { result } = renderHook(() => useCardCreation(makeDeps()));

    act(() => {
      result.current.createNote({}); // autoFocus defaults to true
    });

    const ref = { kind: "note" as const, id: "note-1" };
    expect(cardStore.isExpanded(ref)).toBe(true);
    expect(cardStore.isSelected(ref)).toBe(true);
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(focusMock).toHaveBeenCalledWith(cardPopKey("note", "note-1"));
  });

  it("autoFocus:false skips expand, store-select, and focus", () => {
    const { result } = renderHook(() => useCardCreation(makeDeps()));

    act(() => {
      result.current.createNote({ autoFocus: false });
    });

    const ref = { kind: "note" as const, id: "note-1" };
    expect(cardStore.isExpanded(ref)).toBe(false);
    expect(cardStore.isSelected(ref)).toBe(false);
    expect(focusMock).not.toHaveBeenCalled();
  });

  it("a bodiless kind (highlight) is never expanded/focused on create", () => {
    const { result } = renderHook(() => useCardCreation(makeDeps()));

    act(() => {
      result.current.createHighlight({
        anchor: { anchorId: "a-1", anchorText: "x" },
      });
    });

    const ref = { kind: "highlight" as const, id: "hl-1" };
    expect(cardStore.isExpanded(ref)).toBe(false);
    expect(focusMock).not.toHaveBeenCalled();
  });
});
