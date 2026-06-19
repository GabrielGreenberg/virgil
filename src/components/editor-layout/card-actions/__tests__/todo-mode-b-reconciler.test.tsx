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
import { getTextAnchor, reanchorByText } from "@/links/links";
import type { LinkedAnchorKind } from "@/links/links";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";

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

/** Collect the `kind` attr of every `linkedAnchor` mark in the doc. */
function linkedAnchorKinds(editor: Editor): string[] {
  const kinds: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor") kinds.push(m.attrs.kind as string);
    }
    return true;
  });
  return kinds;
}

/**
 * Mirror of the once-per-doc `applyLinkedAnchors` RESTORE pass in
 * EditorLayout.tsx (~:3273) over a FRESH editor: build the `records` array
 * from the todo collection exactly as the effect's todo loop does, then run
 * the same `reanchorByText` re-stamp `applyLinkedAnchors` performs internally
 * (Editor.tsx :1646). This is what runs on document RELOAD, where the parse
 * has dropped the in-doc `linkedAnchor` mark and only the sidecar (the todo's
 * persisted `links[]`) survives.
 */
function restoreTodoAnchorsOnReload(
  editor: Editor,
  todoItems: ReadonlyArray<Parameters<typeof getTextAnchor>[0]>,
): void {
  const records: Array<{ anchorId: string; kind: LinkedAnchorKind; text: string }> = [];
  for (const t of todoItems) {
    const ta = getTextAnchor(t);
    if (ta && ta.anchorText) {
      records.push({ anchorId: ta.anchorId, kind: "todo", text: ta.anchorText });
    }
  }
  for (const rec of records) {
    if (!rec.anchorId || !rec.text) continue;
    reanchorByText(editor, rec.kind, rec.text, rec.anchorId);
  }
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
          ready: true,
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
        ready: true,
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

// ---------------------------------------------------------------------------
// The OTHER half of Mode-B: RELOAD restore. The reconciler keeps a live mark
// alive (the describe above); this proves the mark is RE-STAMPED from the
// sidecar on document reload, when the parse dropped it. The gap that slipped:
// EditorLayout's `applyLinkedAnchors` restore loop omitted todos, so a
// selection-anchored todo's range tint vanished on reload and jump-to degraded
// to paragraph level. (note/highlight/cutter/revision ARE in that loop.)
// ---------------------------------------------------------------------------
describe("todo Mode-B — reload restore via applyLinkedAnchors", () => {
  it("re-stamps a kind=\"todo\" linkedAnchor over the persisted snapshot on reload", async () => {
    const docContent: JSONContent[] = [
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "anchor me here please" }],
      },
    ];

    // 1. Author a todo over the selection "me here" on the live editor. The
    //    real store path drops the Mode-B mark AND persists the anchor into
    //    the todo's links[].
    const editor1 = mountDoc(docContent);
    const { result, rerender } = renderHook(() => useStack(editor1));
    await act(async () => {
      await result.current.dispatch("todo", {
        kind: "selection",
        from: 8,
        to: 15,
        paragraphId: "para-A",
      } as DragHandleRef);
    });
    rerender();

    const todos = result.current.todos;
    expect(todos).toHaveLength(1);
    const persisted = getTextAnchor(todos[0]);
    expect(persisted).toBeTruthy();
    expect(persisted?.anchorText).toBe("me here");

    // 2. Simulate RELOAD: a fresh editor parsed from the SAME source, with no
    //    in-doc linkedAnchor mark (the parse dropped it — only the sidecar
    //    todo carries the range). Sanity: the reload editor starts mark-free.
    const editor2 = mountDoc(docContent);
    expect(countLinkedAnchors(editor2)).toBe(0);

    // 3. Run the production restore pass (the EditorLayout effect's todo loop +
    //    applyLinkedAnchors' reanchorByText) over the fresh editor.
    restoreTodoAnchorsOnReload(editor2, todos);

    // The range tint is back, stamped with kind "todo".
    expect(countLinkedAnchors(editor2)).toBe(1);
    expect(linkedAnchorKinds(editor2)).toEqual(["todo"]);

    // …and it actually PAINTS: reanchorByText re-stamps with an empty linkCard
    // (no cardId on the restore path), so the per-kind tint depends entirely on
    // the kind→token fallback in linkedAnchorRenderAttrs deriving data-link-card
    // = "todo:" for the `[data-link-card^="todo:"]` CSS rule. Asserting the mark
    // kind alone (above) is NOT enough — the prior fallback emitted an empty
    // token for `todo`, so the mark existed but the span stayed untinted.
    let restoredAttrs: Record<string, unknown> | null = null;
    editor2.state.doc.descendants((node) => {
      if (!node.isText) return true;
      for (const m of node.marks) {
        if (m.type.name === "linkedAnchor") restoredAttrs = m.attrs as Record<string, unknown>;
      }
      return true;
    });
    expect(restoredAttrs).toBeTruthy();
    expect(linkedAnchorRenderAttrs(restoredAttrs!)["data-link-card"]).toBe("todo:");

    // The mark covers exactly the persisted snapshot text — not the whole
    // paragraph (the degraded-to-paragraph failure mode).
    let markedText = "";
    editor2.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "linkedAnchor")) {
        markedText += node.text ?? "";
      }
      return true;
    });
    expect(markedText).toBe("me here");

    // 4. Tie the two halves together: the restored mark then SURVIVES a real
    //    reconciler sweep with todos in the alive-set (the reload editor is
    //    now in the same steady state as a freshly-authored one).
    const recon = renderHook(() =>
      useLinkedAnchorReconciler({
        editor: editor2,
        ready: true,
        notes: [],
        highlights: [],
        cutterCards: [],
        comments: [],
        reportCards: [],
        todos,
      }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(countLinkedAnchors(editor2)).toBe(1); // not reaped
    recon.unmount();
  });

  it("CONTROL: omitting todos from the restore records leaves the reload editor mark-free", async () => {
    // This is the pre-fix EditorLayout behaviour: the restore loop never
    // iterated todoItems, so `records` carried no todo entry and no mark was
    // re-stamped. Proves the reload test above is load-bearing — it fails iff
    // the todo loop is present.
    const docContent: JSONContent[] = [
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "anchor me here please" }],
      },
    ];

    const editor1 = mountDoc(docContent);
    const { result, rerender } = renderHook(() => useStack(editor1));
    await act(async () => {
      await result.current.dispatch("todo", {
        kind: "selection",
        from: 8,
        to: 15,
        paragraphId: "para-A",
      } as DragHandleRef);
    });
    rerender();
    expect(getTextAnchor(result.current.todos[0])).toBeTruthy();

    const editor2 = mountDoc(docContent);
    // Restore with an EMPTY todo collection — mirrors the pre-fix omission.
    restoreTodoAnchorsOnReload(editor2, []);
    expect(countLinkedAnchors(editor2)).toBe(0);
  });
});
