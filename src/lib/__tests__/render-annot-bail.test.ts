// @vitest-environment jsdom
/**
 * renderAnnot keystroke bail (typing-latency fix 1c).
 *
 * The paragraph/list/heading NodeViews rebuild their annotation DOM
 * (`titleAnnot.innerHTML = ""` + span/button re-create + listener re-attach)
 * inside `renderAnnot()`. Before the bail, `update()` called it on EVERY
 * transaction touching the node — i.e. every keystroke typed inside the
 * block. The bail memoizes the render inputs (paragraph: parTitle + hasText;
 * heading: numbered + label) and skips the rebuild when they're unchanged.
 *
 * Pinned here via ELEMENT IDENTITY: typing must leave the annotation's child
 * elements identical (no rebuild); an actual input change must re-render.
 */
import { describe, it, expect, vi } from "vitest";

// Same storage stub as editor-extensions.test.ts — the extension barrel pulls
// @/lib/storage transitively and vitest can't resolve its backend require.
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

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  createParagraphWithTitle,
  createHeadingWithLabel,
} from "@/lib/editor-extensions";

function buildEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p-titled", parTitle: "My title" },
          content: [{ type: "text", text: "Hello world" }],
        },
        { type: "paragraph", attrs: { uuid: "p-empty" } },
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-1" },
          content: [{ type: "text", text: "Head" }],
        },
      ],
    },
  });
  return { editor, el };
}

const wrapperFor = (el: HTMLElement, uuid: string) =>
  el.querySelector<HTMLElement>(`[data-uuid="${uuid}"]`)!;

describe("renderAnnot keystroke bail (1c)", () => {
  it("paragraph: typing does not rebuild the title annotation; a parTitle change does", () => {
    const { editor, el } = buildEditor();
    try {
      const titleSpanBefore = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanBefore).not.toBeNull();
      expect(titleSpanBefore!.textContent).toBe("My title");

      // Plain keystroke inside the titled paragraph (parTitle + hasText
      // unchanged) → the annotation's element identity must be stable.
      editor.view.dispatch(editor.state.tr.insertText("x", 5, 5));
      const titleSpanAfterTyping = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanAfterTyping).toBe(titleSpanBefore);

      // Actual input change → re-render with the new title.
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "parTitle", "Renamed"));
      const titleSpanAfterRename = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanAfterRename!.textContent).toBe("Renamed");
    } finally {
      editor.destroy();
    }
  });

  it("paragraph: the has-text flip still re-renders (empty → typed)", () => {
    const { editor, el } = buildEditor();
    try {
      const emptyWrapper = wrapperFor(el, "p-empty");
      expect(emptyWrapper.classList.contains("has-text")).toBe(false);
      // p-titled nodeSize = 11 text + 2 = 13; p-empty content starts at 14.
      editor.view.dispatch(editor.state.tr.insertText("a", 14, 14));
      const after = wrapperFor(el, "p-empty");
      expect(after.classList.contains("has-text")).toBe(true);
      // The +T affordance materialized (hasText flip re-ran renderAnnot).
      expect(after.querySelector(".par-title-add")).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("heading: typing does not rebuild the annotation; a label change does", () => {
    const { editor, el } = buildEditor();
    try {
      const chipBefore = wrapperFor(el, "h-1").querySelector(".heading-annotation-type-chip");
      expect(chipBefore).not.toBeNull();

      // Type inside the heading text (pos: p-titled 13 + p-empty 2 = 15;
      // heading content starts at 16).
      editor.view.dispatch(editor.state.tr.insertText("x", 17, 17));
      const chipAfterTyping = wrapperFor(el, "h-1").querySelector(".heading-annotation-type-chip");
      expect(chipAfterTyping).toBe(chipBefore);

      // Label change → re-render (label span appears).
      editor.view.dispatch(editor.state.tr.setNodeAttribute(15, "label", "sec:x"));
      const labelSpan = wrapperFor(el, "h-1").querySelector(".heading-label-text");
      expect(labelSpan).not.toBeNull();
      expect(labelSpan!.textContent).toBe("sec:x");
    } finally {
      editor.destroy();
    }
  });
});
