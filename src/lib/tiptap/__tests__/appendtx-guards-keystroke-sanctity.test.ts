// @vitest-environment jsdom
//
// Task 070 — keystroke-sanctity of the two always-installed main-editor
// appendTransaction guards (`LabelHandler`, `EmptyParagraphTitleCleaner`).
//
// Before the fix both guards ran a full `doc.forEach` on every plain keystroke
// (their `couldMatter` gate keyed on `contentChangedUuids.size > 0`, which is
// non-empty on ordinary typing). The fix routes both onto the structural diff
// via `touchedBlockPositions`, so a non-triggering keystroke scans only the
// touched block(s), never the whole doc.
//
// This test pins two things:
//   (1) the O(edit-size) contract of `touchedBlockPositions` itself — the
//       primary keystroke-sanctity proof for the class; and
//   (2) that the two guards' *triggering* behaviour is preserved byte-for-byte
//       (heading `\label{}` absorption; empty-paragraph title clear, including
//       the Enter-at-start split-inheritance edge).
//
// Builds the REAL main editor stack (buildEditorExtensions) so the observer,
// uuid backfill, and both guards behave faithfully — the structural-edit test
// pattern.
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (same pattern as the sibling tests).
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

import { Editor, type Content } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  readDocStructure,
  touchedBlockPositions,
} from "@/lib/tiptap/doc-structure";
import { EMPTY_DIFF, type StructureDiff } from "@/lib/tiptap/doc-structure";

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

function mount(content: Content): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** Collect every top-level paragraph as `{ pos, text, uuid, parTitle }`. */
function paragraphs(editor: Editor) {
  const out: Array<{ pos: number; text: string; uuid: unknown; parTitle: unknown }> = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "paragraph") {
      out.push({ pos, text: node.textContent, uuid: node.attrs.uuid, parTitle: node.attrs.parTitle });
    }
  });
  return out;
}

/** The live heading node carrying `uuid`. */
function headingByUuid(editor: Editor, uuid: string) {
  let hit: { attrs: Record<string, unknown> } | null = null;
  editor.state.doc.forEach((node) => {
    if (node.type.name === "heading" && node.attrs.uuid === uuid) hit = node as never;
  });
  return hit as { attrs: Record<string, unknown> } | null;
}

describe("touchedBlockPositions — O(edit-size), not O(doc)", () => {
  // A 40-paragraph doc so an accidental whole-doc scan is unmistakable.
  const bigContent: Content = {
    type: "doc",
    content: Array.from({ length: 40 }, (_, i) => ({
      type: "paragraph",
      attrs: { uuid: `p${i}` },
      content: [{ type: "text", text: `Para ${i}` }],
    })),
  };

  it("returns only the content-changed block — not every block in the doc", () => {
    const { editor, cleanup } = mount(bigContent);
    try {
      const structure = readDocStructure(editor.state);
      const target = structure.blocks.get("p20");
      expect(target).toBeTruthy();
      const diff: StructureDiff = {
        ...EMPTY_DIFF,
        contentChangedUuids: new Set(["p20"]),
      };
      const positions = touchedBlockPositions(diff, editor.state, editor.state.doc);
      expect(positions).toEqual([target!.pos]);
      // The contract: the count is bounded by the edit, independent of the
      // 40-block document size.
      expect(positions.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("includeSiblings adds exactly the two immediate neighbours", () => {
    const { editor, cleanup } = mount(bigContent);
    try {
      const structure = readDocStructure(editor.state);
      const diff: StructureDiff = {
        ...EMPTY_DIFF,
        contentChangedUuids: new Set(["p20"]),
      };
      const positions = touchedBlockPositions(diff, editor.state, editor.state.doc, true);
      const want = [
        structure.blocks.get("p19")!.pos,
        structure.blocks.get("p20")!.pos,
        structure.blocks.get("p21")!.pos,
      ].sort((a, b) => a - b);
      expect([...positions].sort((a, b) => a - b)).toEqual(want);
      // Still bounded (≤ 3), never O(doc).
      expect(positions.length).toBe(3);
    } finally {
      cleanup();
    }
  });

  it("resolves addedBlocks by their own position", () => {
    const { editor, cleanup } = mount(bigContent);
    try {
      const structure = readDocStructure(editor.state);
      const p10 = structure.blocks.get("p10")!;
      const diff: StructureDiff = {
        ...EMPTY_DIFF,
        addedBlocks: [{ uuid: "p10", pos: p10.pos, typeName: "paragraph" }],
      };
      const positions = touchedBlockPositions(diff, editor.state, editor.state.doc);
      expect(positions).toEqual([p10.pos]);
    } finally {
      cleanup();
    }
  });
});

describe("EmptyParagraphTitleCleaner — behaviour preserved", () => {
  it("clears the stranded title on an Enter-at-start split (split-inheritance edge)", () => {
    const { editor, cleanup } = mount({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1", parTitle: "My Title" }, content: [{ type: "text", text: "Hello world" }] },
        { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "Second" }] },
      ],
    });
    try {
      // Put the caret at the very start of the first (titled) paragraph and
      // split — the classic Enter-at-start that strands the title on the new
      // empty paragraph.
      const startInsideP1 = 1; // pos 0 = before block, pos 1 = start of content
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, startInsideP1),
        ),
      );
      editor.commands.splitBlock();

      const paras = paragraphs(editor);
      // A new empty paragraph now exists…
      const empties = paras.filter((p) => p.text.trim() === "");
      expect(empties.length).toBeGreaterThan(0);
      // …and NONE of the empty paragraphs carry a stranded title (the bug).
      // (The block-uuid backfill re-mints a fresh uuid on the cleared empty
      // paragraph after the cleaner nulls it — same as the original guard —
      // so the contract is "no stranded title" + "no duplicate identity",
      // not "uuid === null".)
      for (const e of empties) {
        expect(e.parTitle ?? null).toBeNull();
      }
      // The content survived and still holds the title.
      const content = paras.find((p) => p.text === "Hello world");
      expect(content?.parTitle).toBe("My Title");
      // No two paragraphs share a uuid — the title paragraph's identity did not
      // leak onto the stranded empty sibling.
      const uuids = paras.map((p) => p.uuid).filter(Boolean);
      expect(new Set(uuids).size).toBe(uuids.length);
    } finally {
      cleanup();
    }
  });

  it("clears the title when a titled paragraph is emptied by deletion", () => {
    const { editor, cleanup } = mount({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1", parTitle: "Doomed" }, content: [{ type: "text", text: "abc" }] },
        { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "keep" }] },
      ],
    });
    try {
      // Delete all of p1's text content ("abc").
      let from = -1;
      let to = -1;
      editor.state.doc.forEach((node, pos) => {
        if (node.attrs.uuid === "p1") {
          from = pos + 1;
          to = pos + node.nodeSize - 1;
        }
      });
      editor.view.dispatch(editor.state.tr.delete(from, to));

      const p1 = paragraphs(editor).find((p) => p.text.trim() === "");
      expect(p1).toBeTruthy();
      expect(p1?.parTitle ?? null).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("LabelHandler — behaviour preserved", () => {
  it("absorbs a typed \\label{} paragraph that follows a heading", () => {
    const { editor, cleanup } = mount({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, uuid: "h1" }, content: [{ type: "text", text: "Section" }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "x" }] },
        { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "body" }] },
      ],
    });
    try {
      // Type `\label{sec:x}` into the paragraph directly after the heading
      // (replace its placeholder content) — the "typed" trigger path.
      let from = -1;
      let to = -1;
      editor.state.doc.forEach((node, pos) => {
        if (node.attrs.uuid === "p1") {
          from = pos + 1;
          to = pos + node.nodeSize - 1;
        }
      });
      editor.view.dispatch(editor.state.tr.insertText("\\label{sec:x}", from, to));

      // The heading absorbed the label…
      expect(headingByUuid(editor, "h1")?.attrs.label).toBe("sec:x");
      // …and the label paragraph is gone (absorbed), while the body remains.
      const texts = paragraphs(editor).map((p) => p.text);
      expect(texts).not.toContain("\\label{sec:x}");
      expect(texts).toContain("body");
    } finally {
      cleanup();
    }
  });

  it("is a no-op when the heading already carries the label", () => {
    const { editor, cleanup } = mount({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, uuid: "h1", label: "sec:x" }, content: [{ type: "text", text: "Section" }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "y" }] },
        { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "body" }] },
      ],
    });
    try {
      let from = -1;
      let to = -1;
      editor.state.doc.forEach((node, pos) => {
        if (node.attrs.uuid === "p1") {
          from = pos + 1;
          to = pos + node.nodeSize - 1;
        }
      });
      // Type the label the heading ALREADY has → no absorption, paragraph stays.
      editor.view.dispatch(editor.state.tr.insertText("\\label{sec:x}", from, to));

      expect(headingByUuid(editor, "h1")?.attrs.label).toBe("sec:x");
      const texts = paragraphs(editor).map((p) => p.text);
      expect(texts).toContain("\\label{sec:x}");
    } finally {
      cleanup();
    }
  });
});
