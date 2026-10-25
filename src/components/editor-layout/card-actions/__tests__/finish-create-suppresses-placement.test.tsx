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
// The contract: the selection change `finishCreate` makes is tagged
// `placement: "none"` on THIS doc's CardStore (task 1283 — it used to raise a
// module-level flag before the setter) — the same intent `marker-clicks.ts`
// uses for the inverse gesture. Because EVERY card factory funnels through `finishCreate`,
// this guards all 13 kinds at once; we pin footnote (the reported case) and
// note (proves it's the shared tail, not a footnote-special path).
//
// (useCardCreation transitively imports `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest can't alias — stub it, the known gotcha.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { useCardCreation } from "../card-creation";
import { createCardStore, type CardStore } from "@/links/_shared/anchored-card-store";

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
    // finishCreate expands/selects in this store; supply one so it doesn't
    // crash (the `as CardDeps` cast hides the missing field at compile time).
    store,
    ...over,
  } as CardDeps;
}

let store: CardStore;
beforeEach(() => {
  store = createCardStore();
});

describe("finishCreate suppresses card→text placement on create", () => {
  it("createFootnote's selection change carries placement: none on the doc's store", () => {
    const setSelectedFootnoteId = vi.fn((id: string) =>
      store.select({ kind: "footnote", id }),
    );
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ setSelectedFootnoteId: setSelectedFootnoteId as never })),
    );

    act(() => {
      result.current.createFootnote({});
    });

    expect(setSelectedFootnoteId).toHaveBeenCalledWith("fn-1");
    expect(store.isPlacementSuppressed({ kind: "footnote", id: "fn-1" })).toBe(true);
  });

  it("createNote suppresses placement too (the shared finishCreate tail)", () => {
    const setSelectedNoteId = vi.fn((id: string) => store.select({ kind: "note", id }));
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ setSelectedNoteId: setSelectedNoteId as never })),
    );

    act(() => {
      result.current.createNote({});
    });

    expect(setSelectedNoteId).toHaveBeenCalledWith("note-1");
    expect(store.isPlacementSuppressed({ kind: "note", id: "note-1" })).toBe(true);
  });
});
