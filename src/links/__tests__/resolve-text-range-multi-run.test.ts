// @vitest-environment jsdom
//
// Task 071 — `resolveTextRangeByAnchorId` must resolve a `linkedAnchor` split
// across MULTIPLE marked runs (atom-split within one paragraph, or spanning
// blocks) to its FULL span `[firstMarkedPos, lastMarkedEnd)`, not just the
// first contiguous run.
//
// The old resolver bailed at the first run (`if (to !== null) return false`),
// so a highlight/note/cutter/revision whose marked text was interrupted (an
// inline atom between two runs, or a cross-block selection) resolved short.
// Downstream that left a STALE tint on runs 2..N when the card was deleted,
// because `removeLinkedAnchorMark` only unset the (truncated) run-1 range.
//
// Both halves fold onto the codebase SSOT walker `findLinkedAnchorRange`
// (src/lib/linked-anchor-range.ts), whose multi-run / cross-block resolution is
// pinned in src/lib/__tests__/linked-anchor-range.test.ts. This test pins the
// Editor-level contract: the delegating `resolveTextRangeByAnchorId` returns
// the full span AND the clean `removeLinkedAnchor` leaves ZERO marked runs.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRead = vi.fn();
const mockWrite = vi.fn();

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
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { removeLinkedAnchor, resolveTextRangeByAnchorId } from "@/links/links";

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

function mountDoc(paras: Array<{ uuid: string; content: JSONContent[] }>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: paras.map((p) => ({
        type: "paragraph",
        attrs: { uuid: p.uuid },
        content: p.content,
      })),
    },
  });
}

/** Stamp a `linkedAnchor` mark over the first occurrence of `word`, returning
 *  its `[from, to)`. Programmatic `addMark` (not a paste) so the anchor
 *  persists — the guard only strips on `transformPasted`. */
function markWord(
  editor: Editor,
  word: string,
  anchorId: string,
): { from: number; to: number } {
  const hits: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (hits.length > 0 || !node.isText || !node.text) return true;
    const i = node.text.indexOf(word);
    if (i >= 0) hits.push({ from: pos + i, to: pos + i + word.length });
    return true;
  });
  const found = hits[0];
  if (!found) throw new Error(`word not found: ${word}`);
  const mark = editor.state.schema.marks.linkedAnchor.create({ anchorId });
  editor.view.dispatch(editor.state.tr.addMark(found.from, found.to, mark));
  return found;
}

/** Count text runs carrying a `linkedAnchor` with `anchorId`, doc-wide. */
function countMarkedRuns(editor: Editor, anchorId: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      n += 1;
    }
    return true;
  });
  return n;
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

describe("resolveTextRangeByAnchorId — multi-run anchors resolve to the full span", () => {
  it("atom-split: two marked runs with an unmarked gap in ONE paragraph resolve to the whole span", () => {
    // "alpha bravo" — mark "alpha" and "bravo" under one anchorId, leaving the
    // space between unmarked. This is the atom-split shape (an inline atom, or
    // any unmarked interior, splits the mark into two runs sharing an id).
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "alpha bravo" }] },
    ]);
    const a = markWord(editor, "alpha", "anc-1");
    const b = markWord(editor, "bravo", "anc-1");
    expect(countMarkedRuns(editor, "anc-1")).toBe(2);

    const range = resolveTextRangeByAnchorId(editor, "anc-1");
    // FULL span: start of the first run → end of the last run (NOT truncated
    // at the end of "alpha", which is what the old early-bail returned).
    expect(range).toEqual({ from: a.from, to: b.to });

    removeLinkedAnchor(editor, "anc-1");
    expect(countMarkedRuns(editor, "anc-1")).toBe(0);
    editor.destroy();
  });

  it("cross-block: a mark spanning TWO paragraphs resolves to the whole span and unsets cleanly", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "charlie tail" }] },
      { uuid: "p2", content: [{ type: "text", text: "delta head" }] },
    ]);
    const first = markWord(editor, "charlie", "anc-2");
    const second = markWord(editor, "delta", "anc-2");
    expect(countMarkedRuns(editor, "anc-2")).toBe(2);

    const range = resolveTextRangeByAnchorId(editor, "anc-2");
    // Spans across the paragraph break — the old resolver returned only the
    // first block's run.
    expect(range).toEqual({ from: first.from, to: second.to });

    removeLinkedAnchor(editor, "anc-2");
    expect(countMarkedRuns(editor, "anc-2")).toBe(0);
    editor.destroy();
  });

  it("single contiguous run still resolves to exactly that run (no regression)", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "solo word" }] },
    ]);
    const only = markWord(editor, "solo", "anc-3");
    expect(resolveTextRangeByAnchorId(editor, "anc-3")).toEqual(only);
    editor.destroy();
  });

  it("absent anchor resolves to null", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "nothing here" }] },
    ]);
    expect(resolveTextRangeByAnchorId(editor, "missing")).toBeNull();
    editor.destroy();
  });
});
