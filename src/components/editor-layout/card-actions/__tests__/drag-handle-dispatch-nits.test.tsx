// @vitest-environment jsdom
//
// Regression guards for three drag-handle dispatch UX nits (C / D / E).
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack (buildEditorExtensions), with only the card-creation /
// card-lifecycle SIDECAR side-effects stubbed (those write to React-land panel
// state the dispatcher doesn't read back). Everything that matters here — the
// in-doc `linkedAnchor` mark drop, the stale-ref resolution, the empty-block
// short-circuit — happens inside the dispatcher against the live PM doc, so the
// stubs never mask the behavior under test.
//
//   • Nit C — `todo` from a non-empty selection must drop the SAME range
//     `linkedAnchor` anchor that `note` does (Mode-B symmetry). A cursor-only
//     todo (block ref / no text) stays Mode-A paragraph-anchored. The
//     reap-survival of that mark is covered by the sibling
//     `todo-mode-b-reconciler.test.tsx`.
//   • Nit D — `archive` / `delete` on a STALE/unresolvable ref must fail loud
//     (notify the user), mirroring `duplicate`'s fail-loud, not `return`
//     silently.
//   • Nit E — `highlight` on a truly-empty block must be a clean no-op (no
//     broken/empty anchor), while a non-empty block still whole-block-wraps.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — same
// gotcha as the sibling destructive-confirm-atoms test.)
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

// `focus-new-card` walks the real DOM for a card field that never mounts in
// this headless harness; neuter `focusNewCard` so the post-dispatch focus tail
// is a no-op, but keep the real `cardKindHasEditableBody` predicate the central
// `finishCreate` gate now reads (CHIP B).
vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";

// ---------------------------------------------------------------------------
// Real editor stack (mirrors destructive-confirm-atoms.test.ts)
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

// jsdom has no layout engine — shim the rect APIs the focus / selection path
// may touch.
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
});

// ---------------------------------------------------------------------------
// Stub deps. Card-creation methods record the `anchor` they were handed (so we
// can assert symmetry between note/todo) and return a minimal `{ id }`; the
// dispatcher only reads `.id`/`.footnoteId`. Sidecar writes are irrelevant —
// the assertions read the live PM doc, not panel state.
// ---------------------------------------------------------------------------

/** A card-creation call captured with the anchoring-relevant opts the
 *  dispatcher passes (`paragraphId` / `targetKind` / `anchor`). BUG2 hinges on
 *  these three being correct for a non-paragraph block ref. */
interface CreateCall {
  anchor: unknown;
  paragraphId: unknown;
  targetKind: unknown;
  opts: unknown;
}

interface Harness {
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => Promise<void>;
  notify: ReturnType<typeof vi.fn>;
  createNoteCalls: CreateCall[];
  createTodoCalls: Array<{ anchor: unknown; opts: unknown }>;
  createHighlightCalls: Array<{ anchor: unknown }>;
  createRevisionCalls: CreateCall[];
  createFootnoteCalls: CreateCall[];
}

function makeHarness(editor: Editor): Harness {
  const notify = vi.fn();
  const createNoteCalls: CreateCall[] = [];
  const createTodoCalls: Array<{ anchor: unknown; opts: unknown }> = [];
  const createHighlightCalls: Array<{ anchor: unknown }> = [];
  const createRevisionCalls: CreateCall[] = [];
  const createFootnoteCalls: CreateCall[] = [];

  let n = 0;
  const nextId = () => `card-${++n}`;

  const captureCreate =
    (sink: CreateCall[]) =>
    (opts: { anchor?: unknown; paragraphId?: unknown; targetKind?: unknown }) => {
      sink.push({
        anchor: opts.anchor,
        paragraphId: opts.paragraphId,
        targetKind: opts.targetKind,
        opts,
      });
      return { id: nextId() };
    };

  const cardCreation = {
    createNote: captureCreate(createNoteCalls),
    createTodo: (opts: { anchor?: unknown }) => {
      createTodoCalls.push({ anchor: opts.anchor, opts });
      return { id: nextId() };
    },
    createHighlight: (opts: { anchor?: unknown }) => {
      createHighlightCalls.push({ anchor: opts.anchor });
      return { id: nextId() };
    },
    createRevisionComment: captureCreate(createRevisionCalls),
    // createFootnote returns `{ footnoteId }`, not `{ id }`; capture the
    // anchoring opts the same way but mint the expected shape.
    createFootnote: (opts: {
      anchor?: unknown;
      paragraphId?: unknown;
      targetKind?: unknown;
    }) => {
      createFootnoteCalls.push({
        anchor: opts.anchor,
        paragraphId: opts.paragraphId,
        targetKind: opts.targetKind,
        opts,
      });
      return { footnoteId: nextId() };
    },
    // The remaining factory methods are never reached by these tests, but the
    // dispatcher type-checks the whole API surface; stub them as no-ops.
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createArchiveSnippet: () => ({ id: nextId() }),
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const cardLifecycle = {
    get: () => undefined,
  } as unknown as DragHandleActionsDeps["cardLifecycle"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle,
    confirm: async () => true,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch,
    notify,
    createNoteCalls,
    createTodoCalls,
    createHighlightCalls,
    createRevisionCalls,
    createFootnoteCalls,
  };
}

/** Does any `linkedAnchor` mark exist anywhere in the doc? */
function hasAnyLinkedAnchor(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.isText && node.marks.some((m) => m.type.name === "linkedAnchor")) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Nit C — todo from a selection is now Mode-B symmetric with note/cutter.
//
// note/cutter/revision drop a Mode-B range `linkedAnchor` from a selection
// because their card models carry a Mode-B text-anchor field (createNote &c.
// take an `anchor` opt → addNote wires it into the card's links[]) AND
// useLinkedAnchorReconciler tracks the anchor-bearing collections so the mark
// survives. Todo now matches: `createTodo` accepts an `anchor`, `setTodoAnchor`
// folds it into the card's links[], and the reconciler tracks `todos` in its
// alive-set (proven in the sibling `todo-mode-b-reconciler.test.tsx`). A
// cursor-only / block-ref todo (no selection text) still anchors Mode-A.
// These tests lock in the note reference behavior AND todo's new symmetry.
// ---------------------------------------------------------------------------

describe("Nit C — note and todo both drop a range anchor from a selection", () => {
  it("note from a selection drops a linkedAnchor mark (the reference behavior)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "hello world here" }],
      },
    ]);
    const h = makeHarness(editor);
    // Select "world" inside the paragraph.
    const ref: DragHandleRef = {
      kind: "selection",
      from: 7,
      to: 12,
      paragraphId: "para-A",
    };
    await h.dispatch("note", ref);
    expect(h.createNoteCalls).toHaveLength(1);
    expect(h.createNoteCalls[0].anchor).toBeTruthy();
    expect(hasAnyLinkedAnchor(editor)).toBe(true);
  });

  it("todo from a selection is now Mode-B: drops a linkedAnchor mark + passes an anchor", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "hello world here" }],
      },
    ]);
    const h = makeHarness(editor);
    const ref: DragHandleRef = {
      kind: "selection",
      from: 7,
      to: 12,
      paragraphId: "para-A",
    };
    await h.dispatch("todo", ref);
    expect(h.createTodoCalls).toHaveLength(1);
    // Symmetric with note: createTodo received a range anchor and a
    // `linkedAnchor` mark landed in the doc.
    expect(h.createTodoCalls[0].anchor).toBeTruthy();
    expect(hasAnyLinkedAnchor(editor)).toBe(true);
  });

  it("todo from a BLOCK ref (cursor-only) stays Mode-A: no mark, no anchor", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "hello world here" }],
      },
    ]);
    const h = makeHarness(editor);
    await h.dispatch("todo", { kind: "paragraph", id: "para-A" });
    expect(h.createTodoCalls).toHaveLength(1);
    // Block ref ⇒ wantRangeAnchor is false ⇒ no Mode-B anchor, no mark.
    expect(h.createTodoCalls[0].anchor).toBeFalsy();
    expect(hasAnyLinkedAnchor(editor)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Nit D — archive / delete on a stale ref fail loud (notify), like duplicate.
// ---------------------------------------------------------------------------

describe("Nit D — archive/delete on a stale/unresolvable ref fail loud", () => {
  it("archive on a uuid that is not in the doc notifies the user (no silent return)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "real content" }],
      },
    ]);
    const h = makeHarness(editor);
    await h.dispatch("archive", { kind: "paragraph", id: "ghost-uuid" });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("delete on a uuid that is not in the doc notifies the user (no silent return)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "real content" }],
      },
    ]);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);
    await h.dispatch("delete", { kind: "paragraph", id: "ghost-uuid" });
    expect(h.notify).toHaveBeenCalledTimes(1);
    // Happy path untouched: the real doc was not mutated.
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("archive on a RESOLVABLE ref does not notify (no false-positive on the happy path)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "real content" }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "para-B" },
        content: [{ type: "text", text: "second" }],
      },
    ]);
    const h = makeHarness(editor);
    await h.dispatch("archive", { kind: "paragraph", id: "para-A" });
    expect(h.notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Nit E — highlight on a truly-empty block is a clean no-op.
// ---------------------------------------------------------------------------

describe("Nit E — highlight on an empty block is a clean no-op", () => {
  it("highlight on an EMPTY paragraph drops NO anchor and creates NO card", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "para-A" }, content: [] },
    ]);
    const h = makeHarness(editor);
    await h.dispatch("highlight", { kind: "paragraph", id: "para-A" });
    expect(h.createHighlightCalls).toHaveLength(0);
    expect(hasAnyLinkedAnchor(editor)).toBe(false);
  });

  it("highlight on a NON-empty block still whole-block-wraps (intended behavior preserved)", async () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "wrap me whole" }],
      },
    ]);
    const h = makeHarness(editor);
    await h.dispatch("highlight", { kind: "paragraph", id: "para-A" });
    expect(h.createHighlightCalls).toHaveLength(1);
    expect(hasAnyLinkedAnchor(editor)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG2 — a collapsed-caret card action on a NON-paragraph anchorable block.
//
// BUG2 (DIAGNOSIS.md §3) was the lightning menu flattening every cursor anchor
// to a fake `{kind:"paragraph", id:<blockUuid>}` ref, which `resolveRefRange`
// could only match against a real paragraph node → null → silent annotation
// bail → "nothing happens" on a heading / listItem / etc. The CHIP 4 fix is
// upstream in `ActionsMenuPanel.runAction`: it now emits the REAL node kind
// (`{kind:"heading"|"listItem", id}`), so the SAME `resolveRefRange` the
// grab-handle surface already feeds resolves correctly.
//
// These tests drive the DISPATCHER directly with the post-fix REAL-kind ref —
// the contract the fixed `runAction` now produces — and assert the card lands
// (the dispatcher's resolve+create chain was always correct; BUG2 only ever
// fed it the wrong ref). The negative test re-feeds the PRE-FIX flattened
// paragraph ref and locks in that it no-ops, documenting the bug's mechanism.
// ---------------------------------------------------------------------------

describe("BUG2 — collapsed-caret card action on a non-paragraph block", () => {
  it("Test A — suggest-edit on a HEADING ref creates a revision-comment on the heading line (Mode-A)", async () => {
    const editor = mountDoc([
      {
        type: "heading",
        attrs: { level: 2, uuid: "head-A" },
        content: [{ type: "text", text: "Section Title" }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "para-A" },
        content: [{ type: "text", text: "body text" }],
      },
    ]);
    const h = makeHarness(editor);

    // The post-fix runAction emits the REAL node kind for a caret on a heading.
    await h.dispatch("suggest-edit", { kind: "heading", id: "head-A" });

    // The card lands (BUG2 fixed — no silent no-op).
    expect(h.createRevisionCalls).toHaveLength(1);
    // Anchored to the heading's own uuid, recorded with the heading targetKind
    // (D9 sub-object anchoring depends on this being the real kind).
    expect(h.createRevisionCalls[0].paragraphId).toBe("head-A");
    expect(h.createRevisionCalls[0].targetKind).toBe("heading");
    // A caret (no live range) is a Mode-A anchor — no linkedAnchor mark.
    expect(h.createRevisionCalls[0].anchor).toBeFalsy();
    expect(hasAnyLinkedAnchor(editor)).toBe(false);
    // No silent bail.
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("Test B — note on a LISTITEM ref creates a note (user-confirmed bug); content range does not throw", async () => {
    const editor = mountDoc([
      {
        type: "bulletList",
        attrs: { uuid: "list-A" },
        content: [
          {
            type: "listItem",
            attrs: { uuid: "li-A" },
            content: [
              {
                type: "paragraph",
                attrs: { uuid: "li-para" },
                content: [{ type: "text", text: "list item body" }],
              },
            ],
          },
        ],
      },
    ]);
    const h = makeHarness(editor);

    // The user-confirmed BUG2 repro (2026-06-19): listItem + caret + Note.
    // Post-fix runAction emits the real listItem kind. The dispatcher resolves
    // the container's inner content range and `setTextSelection` over it must
    // not throw (the lead's atom-block/container resolution decision).
    await expect(
      h.dispatch("note", { kind: "listItem", id: "li-A" }),
    ).resolves.toBeUndefined();

    expect(h.createNoteCalls).toHaveLength(1);
    expect(h.createNoteCalls[0].paragraphId).toBe("li-A");
    expect(h.createNoteCalls[0].targetKind).toBe("listItem");
    // Caret-only ⇒ Mode-A, no range anchor / mark.
    expect(h.createNoteCalls[0].anchor).toBeFalsy();
    expect(hasAnyLinkedAnchor(editor)).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("Test C — footnote on a HEADING ref lands a footnote (not a no-op)", async () => {
    const editor = mountDoc([
      {
        type: "heading",
        attrs: { level: 2, uuid: "head-A" },
        content: [{ type: "text", text: "Section Title" }],
      },
    ]);
    const h = makeHarness(editor);

    // footnote is an annotation action too — the same flattening previously
    // no-op'd it on a heading. Post-fix it resolves to the heading line range
    // and collapses the selection at range.to to insert the atom.
    await h.dispatch("footnote", { kind: "heading", id: "head-A" });

    expect(h.createFootnoteCalls).toHaveLength(1);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("Negative (RED-lock) — the PRE-FIX flattened {kind:paragraph, id:headingUuid} silently no-ops", async () => {
    // This is the exact ref the OLD `runAction` produced for a caret on a
    // heading: a paragraph ref carrying the HEADING's uuid. `resolveRefRange`
    // cannot match it (no paragraph node carries a heading uuid) → null →
    // silent annotation bail. The fix is UPSTREAM in `runAction` (it now emits
    // the real kind), so at the dispatcher level a genuinely-mislabeled
    // annotation ref correctly resolves to nothing. This documents the no-op
    // the flattening produced and stays GREEN before AND after the fix.
    const editor = mountDoc([
      {
        type: "heading",
        attrs: { level: 2, uuid: "head-A" },
        content: [{ type: "text", text: "Section Title" }],
      },
    ]);
    const h = makeHarness(editor);

    await h.dispatch("suggest-edit", { kind: "paragraph", id: "head-A" });

    // No card created (the silent annotation bail) ...
    expect(h.createRevisionCalls).toHaveLength(0);
    expect(h.createNoteCalls).toHaveLength(0);
    // ... no user feedback (annotation actions don't notifyStaleRef) ...
    expect(h.notify).not.toHaveBeenCalled();
    // ... and no mark.
    expect(hasAnyLinkedAnchor(editor)).toBe(false);
  });
});
