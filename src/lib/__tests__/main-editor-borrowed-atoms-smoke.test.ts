// @vitest-environment jsdom
//
// MAIN-editor smoke test for the borrowed-schema extraction (backlog #11).
// Builds the REAL main stack (buildEditorExtensions, surface "main") and proves
// the refactor is behavior-preserving on the third surface:
//   (1) every borrowed atom kind still renders in the main editor (a dropped
//       atom would fail — the cross-surface invariant in human-observable form);
//   (2) KEYSTROKE SANCTITY: plain typing (insertText transactions inside a
//       paragraph) leaves the DocStructureBus `emitCount` FLAT and the doc
//       version advances — i.e. typing works AND does no structural work;
//   (3) the DocStructureObserver is still extension index 1 (observer-first).
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (we never call a storage fn — same pattern as
// editor-extensions.test.ts).
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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";

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

// A doc exercising every borrowed atom kind on the MAIN surface.
const CONTENT: Content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        { type: "inlineMath", attrs: { latex: "x^2" } },
        { type: "text", text: " " },
        { type: "citation", attrs: { citationId: "c1", command: "\\cite{foo}", displayText: "Foo 2020" } },
        { type: "text", text: " " },
        { type: "labelRef", attrs: { label: "sec:intro", displayText: "1" } },
        { type: "text", text: " " },
        { type: "footnote", attrs: { footnoteId: "f1" } },
        { type: "text", text: " after." },
      ],
    },
    { type: "texBlock", attrs: { code: "\\begin{equation} E=mc^2 \\end{equation}" } },
    {
      type: "figureBlock",
      content: [{ type: "figureCaption", content: [{ type: "text", text: "A figure." }] }],
    },
    { type: "graphicsBlock", attrs: { command: "\\includegraphics{img.png}" } },
    { type: "displayMath", attrs: { latex: "\\sum x" } },
    { type: "latexComment", attrs: { text: "a comment" } },
  ],
};

function mountMain(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: CONTENT,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

describe("main editor — borrowed atoms smoke (backlog #11)", () => {
  it("the observer is still extension index 1 (observer-first invariant)", () => {
    const exts = buildEditorExtensions(mainCtx());
    expect(exts[0].name).toBe("starterKit");
    expect(exts[1].name).toBe("docStructureObserver");
  });

  it("every borrowed atom kind still renders / survives on the main surface", () => {
    const { editor, cleanup } = mountMain();
    try {
      // Inline atoms with vanilla NodeViews paint their data-type DOM markers.
      for (const sel of [
        '[data-type="inline-math"]',
        '[data-type="citation"]',
        '[data-type="label-ref"]',
        '[data-type="footnote"]',
        '[data-type="display-math"]',
      ]) {
        expect(editor.view.dom.querySelector(sel), `missing DOM ${sel}`).not.toBeNull();
      }
      // The remaining atoms (texBlock/figureBlock/figureCaption/graphicsBlock
      // render via React NodeViews; latexComment's MAIN — cardContext:false —
      // NodeView differs from the card preview) are proven NOT-stripped by
      // round-trip survival: a node absent from the schema would never make it
      // into getJSON. This is exactly the "silently stripped" bug class #11
      // targets.
      const types = new Set<string>();
      const walk = (n: { type?: string; content?: unknown[] }) => {
        if (n.type) types.add(n.type);
        ((n.content as { type?: string; content?: unknown[] }[]) ?? []).forEach(walk);
      };
      walk(editor.getJSON() as { type?: string; content?: unknown[] });
      for (const name of [
        "inlineMath", "citation", "labelRef", "footnote", "displayMath",
        "texBlock", "figureBlock", "figureCaption", "graphicsBlock", "latexComment",
      ]) {
        expect(types.has(name), `round-trip dropped ${name}`).toBe(true);
        expect(editor.schema.nodes[name], `schema missing ${name}`).toBeDefined();
      }
    } finally {
      cleanup();
    }
  });

  it("plain typing works AND leaves emitCount flat (keystroke sanctity)", () => {
    const { editor, cleanup } = mountMain();
    try {
      const bus = getBus(editor);
      expect(bus).not.toBeNull();
      // Find a text position inside the first paragraph.
      let typePos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (typePos == null && node.type.name === "text") {
          typePos = pos + 1; // inside the text node
          return false;
        }
        return true;
      });
      expect(typePos).not.toBeNull();

      // Warm-up keystroke: the FIRST insertion transaction can trigger a
      // one-off structural emit from BlockUuidBackfill (it mints uuids onto the
      // freshly-loaded blocks on their first mutating tx). That is a load-time
      // artifact, not per-keystroke work — measure STEADY-STATE typing after it.
      editor.view.dispatch(editor.state.tr.insertText("a", typePos!));

      const textBefore = editor.state.doc.textContent;
      const emitBefore = bus!.emitCount;
      // Type N plain characters via insertText transactions (the same step kind
      // RichTextField's beforeinput interceptor dispatches). Typing inside a
      // paragraph is structurally null, so the observer must emit nothing.
      const N = 8;
      for (let i = 0; i < N; i++) {
        const tr = editor.state.tr.insertText("a", typePos! + 1 + i);
        editor.view.dispatch(tr);
      }
      // Typing landed (the doc text grew by exactly N plain chars) …
      const textAfter = editor.state.doc.textContent;
      expect(textAfter.length).toBe(textBefore.length + N);
      expect(textAfter).toContain("aaaaaaaaa"); // warm-up 'a' + N more
      // … and ZERO structural emits fired for those N steady-state keystrokes.
      expect(bus!.emitCount).toBe(emitBefore);
    } finally {
      cleanup();
    }
  });
});
