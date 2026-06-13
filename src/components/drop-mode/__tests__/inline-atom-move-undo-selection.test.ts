// @vitest-environment jsdom
/**
 * Backlog #8 — inline-atom drag-drop must not make Cmd-Z jump the viewport to
 * the top of the page.
 *
 * Inline atoms (footnote / citation / \ref / inline-math) are `selectable:false`,
 * so the grab gesture deliberately never rests a selection on the atom. At drop
 * time the editor's selection is therefore stale — frequently a caret at doc-top.
 * prosemirror-history captures a transaction's `selectionBefore` from the
 * *pre-move* state, so an undo of the move would restore that stale doc-top caret
 * with `scrollIntoView()` → the viewport jumps to the top.
 *
 * The fix (inline-atom-move.ts `parkCaretBeforeMove`): before building the move
 * transaction, dispatch a selection-only `addToHistory:false` transaction that
 * parks a `TextSelection` caret adjacent to the atom's ORIGINAL location. That
 * makes the move's `selectionBefore` land at the atom's old home (on-screen), so
 * undo restores a caret there and scrolls to the atom, not to the top.
 *
 * These tests drive the REAL `inlineAtomMoveSpec` against a live,
 * history-enabled `EditorState` (a mock view whose `dispatch` actually applies
 * each transaction so prosemirror-history accumulates), then call `undo` and
 * assert the restored selection is near the atom's original `from` — NOT doc-top.
 *
 * (The drop-mode util barrel imports `@/lib/storage` transitively; vitest can't
 * resolve its `require("@/lib/storage-fsa")`, so we stub the module wholesale —
 * the same pattern the sibling real-schema test uses. No storage fn is called.)
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

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import {
  EditorState,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/react";
import { inlineAtomMoveSpec, type AtomLocation } from "../util/inline-atom-move";
import type { DropCtx, Placement } from "../types";

// Minimal schema with a `selectable:false` inline atom — mirrors the real
// footnote/citation atoms' selectability (the property that makes the grab
// leave the selection stale and is the root of #8).
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false, // the #8-relevant property
      attrs: { footnoteId: { default: "" } },
      parseDOM: [{ tag: "span[data-type=footnote]" }],
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
  },
});

/** Build a doc with many paragraphs so doc-top and the atom's home are far
 *  apart — the gap that becomes a visible scroll-jump in the live editor. */
function bigDocWithAtomLate(): PMNode {
  const paras: PMNode[] = [];
  // 30 filler paragraphs of plain text (doc-top region).
  for (let i = 0; i < 30; i++) {
    paras.push(schema.node("paragraph", null, [schema.text(`filler ${i}`)]));
  }
  // The paragraph that hosts the atom, deep in the doc.
  const fn = schema.node("footnote", { footnoteId: "fn-x" });
  paras.push(
    schema.node("paragraph", null, [schema.text("home before "), fn, schema.text(" home after")]),
  );
  // A later paragraph that will become the move TARGET.
  paras.push(schema.node("paragraph", null, [schema.text("target paragraph")]));
  return schema.node("doc", null, paras);
}

/** Locate the footnote atom's position in a doc. */
function findAtom(doc: PMNode): { node: PMNode; from: number; to: number } {
  let found: { node: PMNode; from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "footnote") {
      found = { node, from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (!found) throw new Error("atom not found");
  return found;
}

/**
 * A mock editor whose `view.dispatch` truly applies the transaction to a live
 * EditorState ref, so the (real) history plugin accumulates as it would in the
 * browser. Exposes the dispatched-transaction log too.
 */
function liveEditor(doc: PMNode, initialSelection: (s: EditorState) => TextSelection) {
  let state = EditorState.create({ schema, doc, plugins: [history()] });
  // Seed the stale, doc-top-ish selection the grab leaves behind.
  state = state.apply(state.tr.setSelection(initialSelection(state)).setMeta("addToHistory", false));
  const dispatched: Transaction[] = [];
  const editor = {
    get state() {
      return state;
    },
    view: {
      get state() {
        return state;
      },
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return {
    editor,
    dispatched,
    getState: () => state,
    setState: (s: EditorState) => {
      state = s;
    },
  };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

describe("backlog #8 — atom move undo does not jump to doc-top", () => {
  it("parks a TextSelection caret near the atom's original position BEFORE the move (addToHistory:false)", () => {
    const doc = bigDocWithAtomLate();
    const atom = findAtom(doc);
    // Stale selection: a caret at doc-start (pos 1), as the grab would leave it.
    const harness = liveEditor(doc, () => TextSelection.create(doc, 1));

    const spec = inlineAtomMoveSpec({
      resolveSource: (): AtomLocation => ({
        editor: harness.editor,
        node: atom.node,
        from: atom.from,
        to: atom.to,
      }),
      sameEditorOnly: true,
      select: "caret-after",
    });

    // Drop the atom into the final paragraph (after the atom's home).
    const targetPos = doc.content.size - 2;
    spec.applyDrop(
      inlineCursor(harness.editor, targetPos),
      "atom-grab:tok",
      { mainEditor: harness.editor } as unknown as DropCtx,
    );

    // First dispatched tr is the parking selection-only tr.
    const parkTr = harness.dispatched[0];
    expect(parkTr.docChanged).toBe(false); // selection-only, no doc mutation
    expect(parkTr.getMeta("addToHistory")).toBe(false); // stays out of undo stack
    // The parked caret sits at/adjacent to the atom's original location, NOT top.
    expect(parkTr.selection.from).toBeGreaterThanOrEqual(atom.from - 1);
    expect(parkTr.selection.from).toBeLessThanOrEqual(atom.to + 1);
    expect(parkTr.selection.from).toBeGreaterThan(5); // emphatically not doc-top
    expect(parkTr.selection instanceof TextSelection).toBe(true); // never NodeSelection

    // Second dispatched tr is the actual move (delete + insert) — it IS a doc edit.
    const moveTr = harness.dispatched[1];
    expect(moveTr.docChanged).toBe(true);
  });

  it("after the move, a single undo restores a caret near the atom's old home — NOT doc-top — and the atom is restored", () => {
    const doc = bigDocWithAtomLate();
    const atom = findAtom(doc);
    const originalFrom = atom.from;
    const harness = liveEditor(doc, () => TextSelection.create(doc, 1)); // stale top caret

    const spec = inlineAtomMoveSpec({
      resolveSource: (): AtomLocation => ({
        editor: harness.editor,
        node: atom.node,
        from: atom.from,
        to: atom.to,
      }),
      sameEditorOnly: true,
      select: "caret-after",
    });

    const targetPos = doc.content.size - 2;
    spec.applyDrop(
      inlineCursor(harness.editor, targetPos),
      "atom-grab:tok",
      { mainEditor: harness.editor } as unknown as DropCtx,
    );

    // The atom moved (one footnote, now near the target, not at its old home).
    const afterMove = harness.getState();
    const movedAtom = findAtom(afterMove.doc);
    expect(movedAtom.from).not.toBe(originalFrom);

    // A SINGLE undo (the parking tr was addToHistory:false, so it isn't a step).
    const stateBeforeUndo = harness.getState();
    const handled = undo(stateBeforeUndo, (tr) => harness.setState(stateBeforeUndo.apply(tr)));
    expect(handled).toBe(true);

    const undone = harness.getState();
    // The move is fully reverted in ONE undo: the atom is back at its old home.
    const restoredAtom = findAtom(undone.doc);
    expect(restoredAtom.from).toBe(originalFrom);

    // The crux: the post-undo selection is near the atom's original home, NOT
    // doc-top. (Pre-fix, history's selectionBefore was the stale pos-1 caret, so
    // undo restored a doc-top caret → scrollIntoView jumped the viewport.)
    expect(undone.selection.from).toBeGreaterThan(5); // not doc-top
    expect(undone.selection.from).toBeGreaterThanOrEqual(originalFrom - 2);
    expect(undone.selection.from).toBeLessThanOrEqual(restoredAtom.to + 2);
  });

  it("the move is undoable in exactly one step (parking tr is excluded from history)", () => {
    const doc = bigDocWithAtomLate();
    const atom = findAtom(doc);
    const harness = liveEditor(doc, () => TextSelection.create(doc, 1));

    const spec = inlineAtomMoveSpec({
      resolveSource: (): AtomLocation => ({
        editor: harness.editor,
        node: atom.node,
        from: atom.from,
        to: atom.to,
      }),
      sameEditorOnly: true,
      select: "caret-after",
    });

    spec.applyDrop(
      inlineCursor(harness.editor, doc.content.size - 2),
      "atom-grab:tok",
      { mainEditor: harness.editor } as unknown as DropCtx,
    );

    // One undo reverts the whole move; a second undo finds nothing to do.
    let s = harness.getState();
    expect(undo(s, (tr) => harness.setState(s.apply(tr)))).toBe(true);
    s = harness.getState();
    expect(undo(s, (tr) => harness.setState(s.apply(tr)))).toBe(false);
  });
});
