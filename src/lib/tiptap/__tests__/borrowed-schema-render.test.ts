// @vitest-environment jsdom
//
// Render/round-trip test for the borrowed-schema extraction (backlog #11).
// Mounts a REAL TipTap editor with the exact extension arrays the two card
// surfaces compose post-refactor (StarterKit(CARD_STARTER_KIT_CONFIG) +
// Placeholder/TabIndent + buildBorrowedAtomSchema(...)), feeds content
// containing every inline atom + block-atom preview, and asserts:
//   (1) every atom node type is in the schema (so it is NOT silently stripped
//       on load — the exact bug class #11 is about);
//   (2) a content round-trip (setContent → getJSON) PRESERVES every atom node;
//   (3) the inline atoms render their `data-type` DOM marker.
// A dropped atom (e.g. forgetting to register a new kind in borrowed-schema.ts)
// fails (1)/(2)/(3) here.
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (we never call a storage fn — same pattern as
// editor-extensions.test.ts / borrowed-schema.test.ts).
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
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  TabIndent,
  CARD_STARTER_KIT_CONFIG,
  buildBorrowedAtomSchema,
} from "@/lib/tiptap-extensions";

// The RichTextField extension array (post-refactor): no LabelRef/Footnote.
function richTextFieldExtensions() {
  return [
    StarterKit.configure({ ...CARD_STARTER_KIT_CONFIG }),
    Placeholder.configure({ placeholder: "" }),
    TabIndent,
    ...buildBorrowedAtomSchema(),
  ];
}

// The BorrowedMainText extension array (post-refactor): read-only, WITH
// LabelRef/Footnote, no Placeholder/TabIndent.
function borrowedMainTextExtensions() {
  return [
    StarterKit.configure({ ...CARD_STARTER_KIT_CONFIG }),
    ...buildBorrowedAtomSchema({ includeLabelRefFootnote: true }),
  ];
}

// A doc exercising every inline atom shared by both surfaces + every block-atom
// preview. labelRef/footnote are appended for the read-only surface only.
function contentDoc(opts: { withRefs: boolean }) {
  const inline: Record<string, unknown>[] = [
    { type: "text", text: "Before " },
    { type: "inlineMath", attrs: { latex: "x^2" } },
    { type: "text", text: " mid " },
    { type: "citation", attrs: { citationId: "c1", command: "\\cite{foo}", displayText: "Foo 2020" } },
  ];
  if (opts.withRefs) {
    inline.push(
      { type: "text", text: " ref " },
      { type: "labelRef", attrs: { label: "sec:intro", displayText: "1" } },
      { type: "text", text: " fn " },
      { type: "footnote", attrs: { footnoteId: "f1" } },
    );
  }
  inline.push({ type: "text", text: " after." });
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: inline },
      { type: "texBlock", attrs: { code: "\\begin{equation} E=mc^2 \\end{equation}" } },
      {
        type: "figureBlock",
        content: [{ type: "figureCaption", content: [{ type: "text", text: "A figure." }] }],
      },
      { type: "graphicsBlock", attrs: { command: "\\includegraphics{img.png}" } },
      { type: "displayMath", attrs: { latex: "\\sum x" } },
      { type: "latexComment", content: [{ type: "text", text: "a comment" }] },
    ],
  };
}

// Collect every node type name present in a doc JSON (recursive).
function nodeTypesIn(json: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; content?: unknown[] };
    if (node.type) seen.add(node.type);
    (node.content ?? []).forEach(walk);
  };
  walk(json);
  return seen;
}

function mount(extensions: ReturnType<typeof richTextFieldExtensions>, content: Content, editable: boolean) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, editable, extensions, content });
  return { editor, element, cleanup: () => { editor.destroy(); element.remove(); } };
}

describe("borrowed-schema render + round-trip (backlog #11)", () => {
  it("RichTextField surface: every editable card atom survives load + round-trip", () => {
    const content = contentDoc({ withRefs: false });
    const { editor, cleanup } = mount(richTextFieldExtensions(), content, true);
    try {
      // (1) schema presence
      for (const name of [
        "inlineMath", "citation", "displayMath",
        "texBlock", "figureBlock", "figureCaption", "graphicsBlock", "latexComment",
      ]) {
        expect(editor.schema.nodes[name], `schema missing ${name}`).toBeDefined();
      }
      // (2) round-trip preserves each atom (a stripped atom would be absent)
      const types = nodeTypesIn(editor.getJSON());
      for (const name of [
        "inlineMath", "citation", "displayMath",
        "texBlock", "figureBlock", "figureCaption", "graphicsBlock", "latexComment",
      ]) {
        expect(types.has(name), `round-trip dropped ${name}`).toBe(true);
      }
      // (3) inline atoms render their data-type marker (vanilla NodeViews)
      expect(editor.view.dom.querySelector('[data-type="inline-math"]')).not.toBeNull();
      expect(editor.view.dom.querySelector('[data-type="citation"]')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("BorrowedMainText surface: every read-only atom (incl. \\ref + footnote) survives", () => {
    const content = contentDoc({ withRefs: true });
    const { editor, cleanup } = mount(borrowedMainTextExtensions(), content, false);
    try {
      const all = [
        "inlineMath", "citation", "labelRef", "footnote", "displayMath",
        "texBlock", "figureBlock", "figureCaption", "graphicsBlock", "latexComment",
      ];
      for (const name of all) {
        expect(editor.schema.nodes[name], `schema missing ${name}`).toBeDefined();
      }
      const types = nodeTypesIn(editor.getJSON());
      for (const name of all) {
        expect(types.has(name), `round-trip dropped ${name}`).toBe(true);
      }
      // Inline atoms render their data-type markers, including the read-only
      // \ref + nested footnote marker BorrowedMainText adds.
      expect(editor.view.dom.querySelector('[data-type="inline-math"]')).not.toBeNull();
      expect(editor.view.dom.querySelector('[data-type="citation"]')).not.toBeNull();
      expect(editor.view.dom.querySelector('[data-type="label-ref"]')).not.toBeNull();
      expect(editor.view.dom.querySelector('[data-type="footnote"]')).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
