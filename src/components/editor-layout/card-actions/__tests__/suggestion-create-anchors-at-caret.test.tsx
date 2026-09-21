// @vitest-environment jsdom
//
// TASK 695 — **a suggestion created with no target anchors itself at the caret.**
//
// A suggestion is the one card kind whose entire purpose is to aim at a
// passage: `applySuggestion` resolves its Mode-A paragraph link and can do
// nothing at all without one. Both panels' "+ Suggestion" called the factory
// with an empty opts bag (`createCutterSuggestion({})`), so every card either
// panel's own "+" produced was born with `links: []` — an Apply button that
// could never answer, on every surface.
//
// The default lives in the FACTORY, not in the two hosts, because the hosts are
// the cutter/revisions fork (task 201) and a rule written twice drifts once.
// These legs pin it there: the paragraph id the `add*Suggestion` door receives.
//
// A COMMENT deliberately keeps no such default — an unanchored comment is a
// legitimate standing note — so that asymmetry is pinned too.
//
// (useCardCreation transitively imports `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest can't alias — stub it, the known gotcha.)
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { useCardCreation } from "../card-creation";
import { defaultCardStore } from "@/links/_shared/anchored-card-store";

type CardDeps = Parameters<typeof useCardCreation>[0];

/** A caret sitting inside an anchorable node carrying `uuid`. Drives the REAL
 *  `paragraphUuidAtSelection` (it walks the selection's own ancestor chain and
 *  asks `isAnchorableNode`, i.e. "does the node SPEC declare a uuid attr?"),
 *  so this pins the shipped spelling rather than a mock of it. */
function editorWithCaretIn(uuid: string | null) {
  const node = uuid
    ? { type: { spec: { attrs: { uuid: {} } } }, attrs: { uuid } }
    : { type: { spec: { attrs: {} } }, attrs: {} };
  return {
    getEditor: () => ({
      state: { selection: { $from: { depth: 0, node: () => node } } },
    }),
  };
}

function makeDeps(over: Partial<CardDeps> = {}): CardDeps {
  const inert = (() => ({ id: "x" })) as never;
  const noop = (() => {}) as never;
  return {
    editorRef: { current: editorWithCaretIn("P7") } as never,
    addNote: inert,
    addHighlight: inert,
    deleteNote: noop,
    addCutterComment: inert,
    addCutterSuggestion: inert,
    addRevisionComment: inert,
    addRevisionSuggestion: inert,
    addReport: inert,
    addReportRequest: inert,
    addCitation: inert,
    addTodo: inert,
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

describe("task 695 — '+ Suggestion' anchors at the caret paragraph", () => {
  it("createCutterSuggestion({}) passes the caret paragraph to the add door", () => {
    const add = vi.fn(() => ({ id: "cs1" }));
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ addCutterSuggestion: add as never })),
    );
    act(() => {
      result.current.createCutterSuggestion({});
    });
    expect(add).toHaveBeenCalledWith("P7", undefined, undefined);
  });

  it("createRevisionSuggestion({}) does the same — one rule, both families", () => {
    const add = vi.fn(() => ({ id: "rs1" }));
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ addRevisionSuggestion: add as never })),
    );
    act(() => {
      result.current.createRevisionSuggestion({});
    });
    expect(add).toHaveBeenCalledWith("P7", undefined, undefined);
  });

  it("an EXPLICIT paragraphId still wins (the default only fills a gap)", () => {
    const add = vi.fn(() => ({ id: "cs1" }));
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ addCutterSuggestion: add as never })),
    );
    act(() => {
      result.current.createCutterSuggestion({ paragraphId: "P1" });
    });
    expect(add).toHaveBeenCalledWith("P1", undefined, undefined);
  });

  it("no caret paragraph → null, exactly as before (never a guess)", () => {
    const add = vi.fn(() => ({ id: "cs1" }));
    const { result } = renderHook(() =>
      useCardCreation(
        makeDeps({
          addCutterSuggestion: add as never,
          editorRef: { current: editorWithCaretIn(null) } as never,
        }),
      ),
    );
    act(() => {
      result.current.createCutterSuggestion({});
    });
    expect(add).toHaveBeenCalledWith(null, undefined, undefined);
  });

  it("no editor at all → null (the factory never throws on a dead ref)", () => {
    const add = vi.fn(() => ({ id: "cs1" }));
    const { result } = renderHook(() =>
      useCardCreation(
        makeDeps({ addCutterSuggestion: add as never, editorRef: { current: null } as never }),
      ),
    );
    act(() => {
      result.current.createCutterSuggestion({});
    });
    expect(add).toHaveBeenCalledWith(null, undefined, undefined);
  });

  it("a COMMENT keeps NO caret default — an unanchored note is legitimate", () => {
    const add = vi.fn(() => ({ id: "cc1" }));
    const { result } = renderHook(() =>
      useCardCreation(makeDeps({ addCutterComment: add as never })),
    );
    act(() => {
      result.current.createCutterComment({});
    });
    expect(add).toHaveBeenCalledWith(null, undefined, undefined, undefined);
  });
});
