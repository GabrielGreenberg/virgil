// @vitest-environment jsdom
//
// Wave-2b C6 — active-block resolution: ONE posAtCoords + the structure
// snapshot, replacing the triple doc-walk × coordsAtPos in Editor.tsx's
// `getActiveParagraphId`. Pins the decision ladder against a REAL editor
// (real DocStructureObserver snapshot; view geometry mocked, since jsdom
// lays nothing out): cursor-visible short-circuit, topmost-visible,
// overlap-at-top-edge, and the hidden/DOC_TOP contract of the wrapper.
// Also pins the fast path's read budget: O(1) coords reads, never O(blocks).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import {
  computeActiveBlockId,
  computeActiveParagraphId,
  DOC_TOP_SENTINEL,
} from "../active-block";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

const N = 6;

function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Array.from({ length: N }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `P${i}` },
        content: [{ type: "text", text: `Paragraph ${i}.` }],
      })),
    },
  });
}

/** Scroll container: viewport band = [0, 250) in client coords. */
function makeScrollEl(scrollTop = 500): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ top: 0, bottom: 250, left: 0, right: 800, width: 800, height: 250, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, "clientHeight", { value: 250 });
  el.scrollTop = scrollTop;
  return el;
}

/** Stub the view geometry: per-uuid client tops + a top-edge hit-test pos. */
function stubViewGeometry(
  editor: Editor,
  tops: Record<string, number>,
  posAtTopEdge: number,
) {
  const structure = getBus(editor)!.structure;
  const posToTop = new Map<number, number>();
  for (const [uuid, top] of Object.entries(tops)) {
    const b = structure.blocks.get(uuid);
    if (b) posToTop.set(b.pos, top);
  }
  const coordsSpy = vi
    .spyOn(editor.view, "coordsAtPos")
    .mockImplementation((pos: number) => {
      const top = posToTop.get(pos) ?? 10_000;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
    pos: posAtTopEdge,
    inside: posAtTopEdge,
  });
  (editor.view.dom as HTMLElement).getBoundingClientRect = () =>
    ({ top: -500, bottom: 1500, left: 100, right: 700, width: 600, height: 2000, x: 100, y: -500, toJSON: () => ({}) }) as DOMRect;
  return coordsSpy;
}

const posOf = (editor: Editor, uuid: string) =>
  getBus(editor)!.structure.blocks.get(uuid)!.pos;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("computeActiveBlockId (fast path)", () => {
  it("rule 1: the cursor's block wins while its top is on-screen", () => {
    const editor = mountDoc();
    // Cursor sits in P0 (default selection at doc start); P0 top visible.
    stubViewGeometry(editor, { P0: 40 }, posOf(editor, "P0") + 1);
    expect(computeActiveBlockId(editor, makeScrollEl())).toBe("P0");
    editor.destroy();
  });

  it("rule 2: cursor off-screen → the topmost block whose top is visible — at O(1) coords reads", () => {
    const editor = mountDoc();
    // Cursor in P0 (top -300, off). Top edge hit-test lands inside P2;
    // P3 is the first block starting after it, top 50 → visible.
    const coordsSpy = stubViewGeometry(
      editor,
      { P0: -300, P1: -200, P2: -100, P3: 50, P4: 150, P5: 260 },
      posOf(editor, "P2") + 2,
    );
    expect(computeActiveBlockId(editor, makeScrollEl())).toBe("P3");
    // The read budget IS the contract: one read for the cursor block, one
    // for the rule-2 candidate — never one per block (the legacy walk).
    expect(coordsSpy.mock.calls.length).toBeLessThanOrEqual(2);
    editor.destroy();
  });

  it("rule 3: no block top visible (mid-giant-paragraph) → the block overlapping the top edge", () => {
    const editor = mountDoc();
    // Every top out of band; the top edge sits INSIDE P1.
    stubViewGeometry(
      editor,
      { P0: -900, P1: -400, P2: 300, P3: 400, P4: 500, P5: 600 },
      posOf(editor, "P1") + 2,
    );
    expect(computeActiveBlockId(editor, makeScrollEl())).toBe("P1");
    editor.destroy();
  });

  it("returns null (→ caller falls back to the legacy walk) when the hit-test cannot answer", () => {
    const editor = mountDoc();
    stubViewGeometry(editor, { P0: -300 }, 1);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);
    expect(computeActiveBlockId(editor, makeScrollEl())).toBeNull();
    editor.destroy();
  });
});

describe("computeActiveParagraphId (the full contract)", () => {
  it("hidden pane → null; scrolled-to-top → DOC_TOP sentinel", () => {
    const editor = mountDoc();
    const editorEl = editor.view.dom as HTMLElement;
    // Hidden: offsetHeight 0 (jsdom default) → null, and NO scroll resolve.
    expect(computeActiveParagraphId(editor)).toBeNull();

    // Visible + row scroll at the very top → sentinel.
    Object.defineProperty(editorEl, "offsetHeight", {
      value: 800,
      configurable: true,
    });
    const row = document.createElement("div");
    row.setAttribute("data-virgil-row-scroll", "");
    Object.defineProperty(row, "offsetParent", { value: document.body });
    row.scrollTop = 0;
    document.body.appendChild(row);
    expect(computeActiveParagraphId(editor)).toBe(DOC_TOP_SENTINEL);
    editor.destroy();
  });
});
