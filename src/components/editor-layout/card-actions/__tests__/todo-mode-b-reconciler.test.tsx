// @vitest-environment jsdom
//
// The specific failure-mode guard for the todo Mode-B chip.
//
// A prior chip correctly REFUSED a naive "just drop a linkedAnchor for a todo"
// fix: `useLinkedAnchorReconciler` built its alive-set from
// {notes, highlights, cutterCards, comments, reportCards} — todos EXCLUDED — so
// any todo range anchor would be reaped as an orphan on the next sweep
// (phantom-tint break). This chip adds todos to the alive-set in the SAME
// change. These tests prove the wiring end-to-end against the REAL stack:
//
//   1. Reap-survival: a todo created from a selection drops a `linkedAnchor`
//      mark that SURVIVES a reconciler sweep when `todos` is in the alive-set.
//   2. Control: the SAME mark IS reaped when `todos` is omitted — i.e. the
//      test would actually catch a regression that drops todos from the set.
//   3. Mode-A: a cursor-only todo drops no mark (nothing for the reconciler
//      to either keep or reap).
//
// REAL pieces: the main-editor extension stack (buildEditorExtensions), the
// real `useDragHandleActions` dispatch, the real `useTodos` store, the real
// `useLinkedAnchorReconciler`. Only the OTHER card factories are stubbed; the
// todo path goes through the genuine store so its `links[]` carry the Mode-B
// anchor the reconciler reads.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — same
// gotcha as the sibling dispatch-nits test. With docId=null, usePersistentState
// keeps todos purely in React state, no disk I/O.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
  return mod;
});

vi.mock("@/lib/focus-new-card", () => ({ focusNewCard: vi.fn() }));

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import { useCardCreation } from "../card-creation";
import { useTodos } from "@/hooks/useTodos";
import { useLinkedAnchorReconciler } from "@/links/_shared/useLinkedAnchorReconciler";
import { getTextAnchor } from "@/links/links";

// ---------------------------------------------------------------------------
// Real editor stack (mirrors dispatch-nits.test.tsx)
// ---------------------------------------------------------------------------

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Count `linkedAnchor` marks in the doc (any kind). */
function countLinkedAnchors(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "linkedAnchor")) n += 1;
    return true;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Combined harness: REAL useTodos + REAL useCardCreation (todo wired to the
// store; the rest stubbed) + REAL useDragHandleActions. Returns both the
// dispatch and the live `todos` array so the test can feed the reconciler.
// ---------------------------------------------------------------------------

function useStack(editor: Editor) {
  const todosHook = useTodos(null);

  let n = 0;
  const nextId = () => `stub-${++n}`;
  const stubFactories = {
    createNote: () => ({ id: nextId() }),
    createHighlight: () => ({ id: nextId() }),
    createFootnote: () => ({ footnoteId: nextId() }),
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createRevisionComment: () => ({ id: nextId() }),
    createArchiveSnippet: () => ({ id: nextId() }),
  };

  // The real createTodo wiring — addItem / updateItem / addParagraphId /
  // setTodoAnchor all hit the genuine store, so the resulting todo carries
  // the Mode-B anchor in its links[].
  const cardCreation = useCardCreation({
    editorRef: { current: { getEditor: () => editor } as never },
    addTodo: todosHook.addItem,
    updateTodo: todosHook.updateItem,
    addTodoTextObjectId: todosHook.addParagraphId,
    setTodoAnchor: todosHook.setTodoAnchor,
    // Everything below is unused by the todo path; supply inert stubs so the
    // hook builds. (useCardCreation reads them lazily inside per-kind
    // callbacks we never invoke here.)
    addNote: (() => ({})) as never,
    addHighlight: (() => ({})) as never,
    deleteNote: (() => {}) as never,
    addCutterComment: (() => ({})) as never,
    addCutterSuggestion: (() => ({})) as never,
    addRevisionComment: (() => ({})) as never,
    addRevisionSuggestion: (() => ({})) as never,
    addReport: (() => ({})) as never,
    addReportRequest: (() => ({})) as never,
    addCitation: (() => ({})) as never,
    archiveContent: (() => ({})) as never,
    updateArchiveSnippet: (() => {}) as never,
    addArchiveTextObjectId: (() => {}) as never,
    setSelectedArchiveId: (() => {}) as never,
    setSelectedNoteId: (() => {}) as never,
    setSelectedCutterCardId: (() => {}) as never,
    setSelectedReportCardId: (() => {}) as never,
    setSelectedCommentId: (() => {}) as never,
    setSelectedTodoId: (() => {}) as never,
    setSelectedFootnoteId: (() => {}) as never,
    setSelectedCitationId: (() => {}) as never,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    setActiveLeft: (() => {}) as never,
    setActiveRight: (() => {}) as never,
    popCardAtAnchor: (() => {}) as never,
    markFootnotePristine: (() => {}) as never,
    getFootnoteCount: (() => 0) as never,
  });

  // Override the stubbed factories the dispatcher type-checks but the todo
  // path never calls. (createTodo above is the real one.)
  const cardCreationWithStubs = {
    ...cardCreation,
    ...stubFactories,
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation: cardCreationWithStubs,
    cardLifecycle: { get: () => undefined } as unknown as DragHandleActionsDeps["cardLifecycle"],
    confirm: async () => true,
    notify: () => {},
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { dispatch } = useDragHandleActions(deps);
  return { dispatch, todos: todosHook.items };
}

describe("todo Mode-B — reconciler alive-set wiring", () => {
  it("a todo-from-selection's linkedAnchor SURVIVES a reconciler sweep (todos in alive-set)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "anchor me here please" }],
      },
    ]);

    const { result, rerender } = renderHook(() => useStack(editor));

    // Dispatch a todo over the selection "me here" → drops a Mode-B mark and
    // writes the anchor into the real todo store.
    await act(async () => {
      await result.current.dispatch("todo", {
        kind: "selection",
        from: 8,
        to: 15,
        paragraphId: "para-A",
      } as DragHandleRef);
    });
    rerender();

    // The store now holds a todo carrying a Mode-B text anchor.
    const todos = result.current.todos;
    expect(todos).toHaveLength(1);
    const anchor = getTextAnchor(todos[0]);
    expect(anchor).toBeTruthy();
    expect(countLinkedAnchors(editor)).toBe(1);

    // Run the REAL reconciler with the live todos in the alive-set, then let
    // its deferred (setTimeout 0) strip pass run. The mark must SURVIVE.
    const recon = renderHook(
      (props: { todos: typeof todos }) =>
        useLinkedAnchorReconciler({
          editor,
          notes: [],
          highlights: [],
          cutterCards: [],
          comments: [],
          reportCards: [],
          todos: props.todos,
        }),
      { initialProps: { todos } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(countLinkedAnchors(editor)).toBe(1); // not reaped
    recon.unmount();
  });

  it("CONTROL: the SAME mark IS reaped when todos are omitted from the alive-set", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "anchor me here please" }],
      },
    ]);

    const { result, rerender } = renderHook(() => useStack(editor));
    await act(async () => {
      await result.current.dispatch("todo", {
        kind: "selection",
        from: 8,
        to: 15,
        paragraphId: "para-A",
      } as DragHandleRef);
    });
    rerender();
    expect(countLinkedAnchors(editor)).toBe(1);

    // Reconciler with an EMPTY todos set (simulating the pre-fix bug where
    // todos were excluded). The orphan sweep must strip the mark — proving
    // the survival test above is load-bearing, not vacuous.
    const recon = renderHook(() =>
      useLinkedAnchorReconciler({
        editor,
        notes: [],
        highlights: [],
        cutterCards: [],
        comments: [],
        reportCards: [],
        todos: [],
      }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(countLinkedAnchors(editor)).toBe(0); // reaped as orphan
    recon.unmount();
  });

  it("a cursor-only (block-ref) todo drops no mark and stays Mode-A", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "plain paragraph todo" }],
      },
    ]);

    const { result, rerender } = renderHook(() => useStack(editor));
    await act(async () => {
      await result.current.dispatch("todo", {
        kind: "paragraph",
        id: "para-A",
      } as DragHandleRef);
    });
    rerender();

    const todos = result.current.todos;
    expect(todos).toHaveLength(1);
    expect(getTextAnchor(todos[0])).toBeNull(); // Mode-A, no text-range anchor
    expect(countLinkedAnchors(editor)).toBe(0);
  });
});
