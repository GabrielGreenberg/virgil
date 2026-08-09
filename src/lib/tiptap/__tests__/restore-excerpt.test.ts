// @vitest-environment jsdom
/**
 * Task 106 — the RETURN leg of the capture law.
 *
 * `canMountInCardBody` (task 308) makes the document prove nothing is lost when
 * content moves INTO an archive card. These pin the other direction: an archive
 * card body is the only copy of prose the user deleted from the document, so
 * the restore must report honestly whether the content landed — the caller
 * drops that only copy on the strength of the answer.
 *
 * The failure is silent by construction. TipTap's `insertContent` does not
 * throw on content its schema can't build; it emits a content error and
 * inserts nothing. A `void` return therefore looks identical for "restored" and
 * "destroyed", which is exactly how the pre-106 handler could delete an archive
 * entry whose text never reached the page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

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

import { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { restoreExcerptAtCaret } from "../restore-excerpt";

const PARA_UUID = "p00001";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set([PARA_UUID]) },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];

const PLAIN_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: PARA_UUID },
      content: [{ type: "text", text: "alpha" }],
    },
  ],
};

function mountEditor(content: unknown = PLAIN_DOC): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content as never,
  });
  editors.push(editor);
  return editor;
}

/** Put the caret inside the first node of `type` and return the doc snapshot. */
function caretInside(editor: Editor, type: string): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === type) pos = p + 1;
    return pos === -1;
  });
  expect(pos, `no ${type} in the fixture`).toBeGreaterThan(-1);
  editor.commands.setTextSelection(pos + 1);
  return pos;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const excerpt = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Recovered" }] },
    { type: "paragraph", content: [{ type: "text", text: "body text" }] },
  ],
};

describe("restoreExcerptAtCaret", () => {
  it("a real excerpt lands and is reported as landed", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("Recovered");
    expect(editor.state.doc.textContent).toContain("body text");
  });

  it("content the document's schema cannot hold is REFUSED, doc untouched", () => {
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    const alien = {
      type: "doc",
      content: [{ type: "notAThingTheSchemaKnows", content: [{ type: "text", text: "x" }] }],
    };
    expect(restoreExcerptAtCaret(editor, alien)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("no editor / no content is a refusal, never a silent success", () => {
    expect(restoreExcerptAtCaret(null, excerpt)).toBe(false);
    expect(restoreExcerptAtCaret(mountEditor(), null)).toBe(false);
  });

  it("an empty excerpt reports NOT landed (nothing to hand back)", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, { type: "doc", content: [] })).toBe(false);
  });

  it("a live SELECTION in the document is not consumed by the restore", () => {
    // `insertContent` replaces a non-empty selection. Restoring while the user
    // has prose selected would therefore delete that prose — the same
    // destruction this whole path exists to prevent, aimed at a different
    // victim. The restore must be purely additive.
    const editor = mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 }); // "alpha"
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("alpha");
    expect(editor.state.doc.textContent).toContain("Recovered");
  });

  // ── The caret-safety leg ────────────────────────────────────────────────
  // Every case below CHANGES the document if the insert is allowed through, so
  // the "did it land?" test reports success and the caller then retires the
  // only copy of the excerpt. Refusing is the only honest answer.

  const EXAMPLE_DOC = {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "E", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "i1" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "first item" }] }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
    ],
  };

  it("REFUSES inside an example item — the fitter would split the example in two", () => {
    const editor = mountEditor(EXAMPLE_DOC);
    caretInside(editor, "exampleItem");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("REFUSES inside a heading — a split would mint a phantom section", () => {
    const editor = mountEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, uuid: "h1" }, content: [{ type: "text", text: "Section" }] },
        { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
      ],
    });
    caretInside(editor, "heading");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("REFUSES inside a list item — the list would be torn in two", () => {
    const editor = mountEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          ],
        },
        { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
      ],
    });
    caretInside(editor, "listItem");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("ALLOWS a plain top-level paragraph — splitting it is ordinary editing", () => {
    const editor = mountEditor(EXAMPLE_DOC);
    caretInside(editor, "paragraph");
    // …but only the top-level one: `caretInside` finds the example's inner
    // paragraph first, so aim explicitly at the last block instead.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("Recovered");
    // The example survived intact — still exactly one exampleBlock.
    let examples = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock") examples += 1;
      return true;
    });
    expect(examples).toBe(1);
  });

  it("content-INVALID JSON is refused, not thrown (leg 1 accepts more than the insert)", () => {
    // `schema.nodeFromJSON` builds through `NodeType.create`, which does not
    // check content expressions; `insertContentAt` calls `node.check()` outside
    // its own try/catch. A hand- or agent-edited archive.json can therefore
    // reach the insert and throw into a click handler — a refusal nobody sees.
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    expect(() =>
      restoreExcerptAtCaret(editor, {
        type: "doc",
        content: [{ type: "exampleItemList", content: [] }],
      }),
    ).not.toThrow();
    expect(restoreExcerptAtCaret(editor, {
      type: "doc",
      content: [{ type: "exampleItemList", content: [] }],
    })).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("a legacy plain-text snippet lands as prose", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, "plain snippet")).toBe(true);
    expect(editor.state.doc.textContent).toContain("plain snippet");
  });

  it("a legacy `% ` snippet lands as a latexComment node", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, "% a latex comment")).toBe(true);
    let found = false;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "latexComment") found = true;
      return true;
    });
    expect(found).toBe(true);
  });
});
