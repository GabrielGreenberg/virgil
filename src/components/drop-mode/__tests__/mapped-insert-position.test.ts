// @vitest-environment jsdom
/**
 * Task 331 — "ask the transaction where the insert position went; never predict
 * it," applied to the three specs that were still predicting it.
 *
 * Task 234 fixed exactly this in `specs/textobject.ts` and left the same
 * arithmetic standing in its twins:
 *
 *     const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
 *     const tr = state.tr.delete(from, to);
 *     tr.insert(adjustedInsert, node);
 *
 * The prediction assumes `tr.delete(from, to)` removes exactly `to - from`. It
 * does not when ProseMirror has to keep a MINIMAL VALID RESIDUE in a parent
 * whose content expression forbids emptiness — measured against the real editor
 * schema below at drift 2 (an `exampleBlock` alone in a `blockquote`) and drift
 * 4 (an `exampleItem` alone in an `exampleItemList`, the shape expex's own Tab
 * keymap creates).
 *
 * The consequence is not a misplaced block: the position lands INSIDE the
 * preceding block's text, and `tr.insert` at a position whose parent rejects the
 * node does not fail — the fitter makes room by CLOSING that block. One node
 * becomes two, both keeping the original uuid, the text severed across the
 * halves, on a document that still `check()`s clean.
 *
 * Every guard upstream is blind to it by construction (`canDropDirectAt` and
 * `fitNodesAtInsert`, probe included, resolve against the PRE-delete doc, where
 * the position is correct and the fit honestly reports `direct`), which is why
 * this needs its own leg rather than more care at the call site.
 *
 * NON-DESTRUCTIVE: build the plan, read the transaction it would dispatch.
 */

import { describe, expect, it, vi } from "vitest";

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

import { getSchema } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { blockMoveSpec } from "../util/block-move";
import {
  insertNodesAdvancing,
  resolveInsertPos,
  placeCaretAtLanding,
} from "../util/mapped-insert";
import type { DropCtx, Placement } from "../types";

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
  } as unknown as EditorExtensionsCtx;
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));
const ZERO = { x: 0, y: 0, width: 0, height: 0 };
const EXAMPLE_SPEC = blockMoveSpec({ nodeName: "exampleBlock" });

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const editor = {
    state: EditorState.create({ schema, doc: d }),
    view: { dispatch: (tr: Transaction) => dispatched.push(tr), focus: () => {} },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect: ZERO };
}

function example(uuid: string, text: string) {
  return {
    type: "exampleBlock",
    attrs: { uuid },
    content: [
      {
        type: "exampleItemList",
        content: [
          {
            type: "exampleItem",
            attrs: { uuid: `${uuid}-i` },
            content: [
              { type: "paragraph", attrs: { uuid: `${uuid}-p` }, content: [{ type: "text", text }] },
            ],
          },
        ],
      },
    ],
  };
}

const para = (uuid: string, text: string) => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});

/** Every non-null uuid in the doc, document order. */
function uuids(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    const u = n.attrs?.uuid as string | undefined;
    if (typeof u === "string" && u) out.push(u);
    return true;
  });
  return out;
}

function expectUniqueUuids(d: PMNode): void {
  const all = uuids(d);
  expect(new Set(all).size, `duplicate uuid in ${JSON.stringify(all)}`).toBe(all.length);
}

function countType(d: PMNode, type: string): number {
  let n = 0;
  d.descendants((node) => {
    if (node.type.name === type) n++;
    return true;
  });
  return n;
}

// ── A. The defect: a delete that leaves a residue ───────────────────────────

describe("block-move — the insert position is MAPPED, not predicted", () => {
  it("lands past a residue-leaving delete without tearing the block it passes", () => {
    // The source `exampleBlock` is the SOLE child of a `blockquote` (content
    // `block+`), so the cut cannot empty it: ProseMirror keeps a minimal
    // paragraph residue and removes 13 of the declared 15. The drop target is
    // the gap at the very end, BELOW the source — the direction where the
    // prediction under-shoots.
    //
    // Pre-fix: `insertPos - (to - from)` = 24 - 15 = 9, which sits inside the
    // "after" paragraph's text; the fitter closes that paragraph to make room,
    // producing two paragraphs both carrying uuid "tail".
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "blockquote", content: [example("ex1", "example text")] },
        para("tail", "after"),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    EXAMPLE_SPEC.applyDrop(betweenBlocks(editor, d.content.size), "example:ex1", ctx);

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    // THE defect: the passed-over paragraph is torn in two, both halves keeping
    // its uuid, its text severed across them.
    expectUniqueUuids(result);
    expect(countType(result, "paragraph")).toBe(
      // the residue inside the blockquote, "after", and the example's own body
      3,
    );

    // The example moved out of the quote and landed at top level, AFTER "after".
    expect(result.childCount).toBe(3);
    expect(result.child(0).type.name).toBe("blockquote");
    expect(result.child(1).type.name).toBe("paragraph");
    expect(result.child(1).textContent).toBe("after");
    expect(result.child(2).type.name).toBe("exampleBlock");
    expect(result.child(2).attrs.uuid).toBe("ex1");
    expect(result.child(2).textContent).toBe("example text");
  });

  it("is byte-identical for an ordinary top-level move (non-regression)", () => {
    // No residue: the delete removes exactly the declared width, so the mapping
    // and the old prediction agree. Pinned so the conversion cannot be read as
    // licence to change where an ordinary move lands.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [example("ex1", "example text"), para("a", "alpha"), para("b", "beta")],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    EXAMPLE_SPEC.applyDrop(betweenBlocks(editor, d.content.size), "example:ex1", ctx);

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);
    expect(result.childCount).toBe(3);
    expect(result.child(0).textContent).toBe("alpha");
    expect(result.child(1).textContent).toBe("beta");
    expect(result.child(2).type.name).toBe("exampleBlock");
    expect(result.child(2).attrs.uuid).toBe("ex1");
  });

  it("still leaves the document untouched when the drop is inside the source", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [example("ex1", "example text"), para("a", "alpha")],
    });
    const { editor, dispatched, ctx } = mockEditor(d);
    EXAMPLE_SPEC.applyDrop(betweenBlocks(editor, 2), "example:ex1", ctx);
    expect(dispatched).toHaveLength(0);
  });
});

// ── B. The primitive's own contract ─────────────────────────────────────────

describe("mapped-insert — the shared splice door", () => {
  it("`mapThrough` asks the mapping; `liveAt` takes the caller's word", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "blockquote", content: [example("ex1", "example text")] },
        para("tail", "after"),
      ],
    });
    const state = EditorState.create({ schema, doc: d });
    let from = -1;
    let to = -1;
    d.descendants((n, pos) => {
      if (n.type.name === "exampleBlock") {
        from = pos;
        to = pos + n.nodeSize;
        return false;
      }
      return true;
    });
    const tr = state.tr.delete(from, to);

    // The residue is what makes the two answers differ — proof the fixture is
    // adversarial rather than merely convenient.
    const removed = d.content.size - tr.doc.content.size;
    expect(removed).toBeLessThan(to - from);

    const end = d.content.size;
    expect(resolveInsertPos(tr, { mapThrough: end })).toBe(tr.mapping.map(end));
    expect(resolveInsertPos(tr, { mapThrough: end })).not.toBe(end - (to - from));
    // `liveAt` is a claim about coordinates, so it is returned untouched — the
    // between-blocks range move depends on this, having already mapped (and
    // possibly re-mapped) its position through `dropEmptiedSourceBlock`.
    expect(resolveInsertPos(tr, { liveAt: 7 })).toBe(7);
  });

  it("advances by what ACTUALLY landed, not by `n.nodeSize`", () => {
    // A bare `exampleItem` at a top-level gap: the fitter PADS it (rule 3 of the
    // container fit sanctions this), so the transaction grows by more than the
    // node's own size. Advancing by `nodeSize` would put the second node inside
    // or before the first.
    const d = schema.nodeFromJSON({ type: "doc", content: [para("a", "alpha")] });
    const state = EditorState.create({ schema, doc: d });
    const tr = state.tr;
    const nodes = [
      schema.nodeFromJSON(example("n1", "one")),
      schema.nodeFromJSON(example("n2", "two")),
    ];
    const span = insertNodesAdvancing(tr, { liveAt: d.content.size }, nodes);

    expect(() => tr.doc.check()).not.toThrow();
    expect(span.end - span.start).toBe(tr.doc.content.size - d.content.size);
    // Both landed, in order, as siblings — never one nested in the other.
    expect(tr.doc.childCount).toBe(3);
    expect(tr.doc.child(1).attrs.uuid).toBe("n1");
    expect(tr.doc.child(2).attrs.uuid).toBe("n2");
  });

  it("a landing point that cannot host a caret is a no-op, never a throw", () => {
    // Since task 321 these transactions are built inside `planDrop`, and
    // `classifyDrop` is called BARE inside the controller's async
    // `commitDropSession` — an escaped throw there becomes a rejected promise
    // that never reaches `endDropSession()`, leaking the window listeners, the
    // body attr and the lift overlay past mouseup. `block-move` was the one of
    // the three call sites whose selection helper had no guard.
    //
    // Renamed at task 482: this used to SELECT the landed span, which the grab
    // handle then read as a live text-lift gesture (see the module header).
    const d = schema.nodeFromJSON({ type: "doc", content: [para("a", "alpha")] });
    const tr = EditorState.create({ schema, doc: d }).tr;
    expect(() =>
      placeCaretAtLanding(tr, { start: 0, end: d.content.size + 5_000 }),
    ).not.toThrow();
  });
});
