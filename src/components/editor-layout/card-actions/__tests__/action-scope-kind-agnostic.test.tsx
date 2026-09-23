// @vitest-environment jsdom
//
// Task 732 — the grab-bar half of "the registry's per-kind scope hooks are
// read KIND-AGNOSTICALLY."
//
// `resolveRefRange` used to read `meta.collectAnnotationRange` from INSIDE an
// `if (ref.kind === "heading")` branch, and `outerRangeFor` read no hook at
// all while its doc comment claimed it did. So a second kind declaring either
// hook — precisely the extension `types.ts` advertises — was honoured by
// nothing. Both now go through the one owner (`@/text-objects/action-scope`).
//
// This drives the REAL `useDragHandleActions` dispatcher over the REAL
// extension stack (same harness shape as `drag-handle-dispatch-nits.test.tsx`)
// and reads the answer off the live PM doc:
//   • `highlight` (an ANNOTATION action) wraps exactly the range
//     `collectAnnotationRange` returned, for a non-heading kind;
//   • `delete` (a LIFECYCLE action) removes exactly the range
//     `collectMoveSource` returned, for a non-heading kind — which is also
//     `outerRangeFor`'s door, so M3's doc-vs-code gap is pinned shut.
//
// The sibling `src/lib/actions/__tests__/action-scope-kind-agnostic.test.ts`
// proves the same for the lightning surface's `resolveScope`.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
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
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { MoveSource } from "@/text-objects/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
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

// ---------------------------------------------------------------------------
// Temporary registry slot — the stand-in for "a kind that grows scope
// asymmetry later." The resolvers read the registry at CALL time, so this is
// faithful without minting a fixture node type.
// ---------------------------------------------------------------------------

const installed: Array<() => void> = [];

function installHook(
  kind: "paragraph",
  hook: "collectAnnotationRange" | "collectMoveSource",
  fn: (doc: PMNode, uuid: string) => MoveSource | null,
): void {
  const meta = TEXT_OBJECT_REGISTRY[kind] as unknown as Record<string, unknown>;
  const prev = meta[hook];
  meta[hook] = fn;
  installed.push(() => {
    if (prev === undefined) delete meta[hook];
    else meta[hook] = prev;
  });
}

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  while (installed.length) installed.pop()!();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

interface Harness {
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => Promise<void>;
  createHighlightCalls: Array<{ anchor: unknown }>;
}

function makeHarness(editor: Editor): Harness {
  const createHighlightCalls: Array<{ anchor: unknown }> = [];
  let n = 0;
  const nextId = () => `card-${++n}`;

  const cardCreation = {
    createNote: () => ({ id: nextId() }),
    createTodo: () => ({ id: nextId() }),
    createHighlight: (opts: { anchor?: unknown }) => {
      createHighlightCalls.push({ anchor: opts.anchor });
      return { id: nextId() };
    },
    createRevisionRequest: () => ({ id: nextId() }),
    createFootnote: () => ({ footnoteId: nextId() }),
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createArchiveSnippet: () => ({ id: nextId() }),
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: { get: () => undefined } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: { retarget: () => 0 },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm: async () => true,
    notify: vi.fn(),
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { result } = renderHook(() => useDragHandleActions(deps));
  return { dispatch: result.current.dispatch, createHighlightCalls };
}

/** The [from, to) span the single `linkedAnchor` mark in the doc covers. */
function linkedAnchorSpan(editor: Editor): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === "linkedAnchor")) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  return from < 0 ? null : { from, to };
}

const TWO_BLOCKS: JSONContent[] = [
  {
    type: "paragraph",
    attrs: { uuid: "p1" },
    content: [{ type: "text", text: "alpha beta gamma" }],
  },
  {
    type: "paragraph",
    attrs: { uuid: "p2" },
    content: [{ type: "text", text: "second block" }],
  },
];

describe("task 732 — the grab-bar dispatcher reads the scope hooks for ANY kind", () => {
  it("baseline: with no hook, highlight on a paragraph wraps the WHOLE block", async () => {
    expect(TEXT_OBJECT_REGISTRY.paragraph.collectAnnotationRange).toBeUndefined();
    const editor = mountDoc(TWO_BLOCKS);
    const h = makeHarness(editor);
    await h.dispatch("highlight", { kind: "paragraph", id: "p1" });
    // "alpha beta gamma" is the paragraph's whole content range [1, 17].
    expect(linkedAnchorSpan(editor)).toEqual({ from: 1, to: 17 });
  });

  it("a NON-heading kind's collectAnnotationRange narrows what highlight wraps", async () => {
    // Wrap only "beta" — [7, 11] — a range no generic fallback can produce.
    installHook("paragraph", "collectAnnotationRange", (_doc, uuid) =>
      uuid === "p1" ? { from: 7, to: 11, nodes: [] } : null,
    );
    const editor = mountDoc(TWO_BLOCKS);
    const h = makeHarness(editor);
    await h.dispatch("highlight", { kind: "paragraph", id: "p1" });
    expect(h.createHighlightCalls).toHaveLength(1);
    expect(linkedAnchorSpan(editor)).toEqual({ from: 7, to: 11 });
  });

  it("a NON-heading kind's collectMoveSource widens what delete removes (outerRangeFor's door)", async () => {
    // Claim BOTH paragraphs as p1's lifecycle region — [0, 32] spans the two
    // blocks. `outerRangeFor` hardcoded the single node before task 732, so
    // this could not be expressed by any registry edit.
    installHook("paragraph", "collectMoveSource", (_doc, uuid) =>
      uuid === "p1" ? { from: 0, to: 32, nodes: [] } : null,
    );
    const editor = mountDoc(TWO_BLOCKS);
    const h = makeHarness(editor);
    await h.dispatch("delete", { kind: "paragraph", id: "p1" });
    // Both blocks gone — the doc is back to a single empty paragraph.
    expect(editor.state.doc.textContent).toBe("");
  });

  it("without the lifecycle hook, delete removes only the one block (baseline)", async () => {
    const editor = mountDoc(TWO_BLOCKS);
    const h = makeHarness(editor);
    await h.dispatch("delete", { kind: "paragraph", id: "p1" });
    expect(editor.state.doc.textContent).toBe("second block");
  });
});
