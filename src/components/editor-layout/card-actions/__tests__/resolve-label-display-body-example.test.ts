// @vitest-environment jsdom
//
// Task 2026-07-03-025 — body-positioned example `\label`, resolveLabelDisplay arm.
//
// Parallel to resolve-label-display-against-main.test.ts. `resolveLabelDisplay`
// is the create/popover SSOT for "what number does this ref show." Before the
// fix it keyed ONLY on `exampleBlock.attrs.tag`/`attrs.label`, so a `\label`
// living on the example's BODY line (a raw `latexCommand`-marked text node)
// resolved to "??". This pins that it now resolves to the example number —
// parent-bound for a single `\ex`, N+sub for a `\pex` item body label.

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

import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { resolveLabelDisplay } from "@/components/editor-layout/card-actions/ref";

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

/** A body `\label{…}` as it lives in the doc: a `latexCommand`-marked text
 *  node inside the example body paragraph (NOT on `attrs.label`). */
function bodyLabel(key: string) {
  return { type: "text", text: `\\label{${key}}`, marks: [{ type: "latexCommand" }] };
}

/** Mount a MAIN editor whose only example has a BODY-line label and a seeded
 *  number (so the test doesn't depend on the async numbering tx settling). */
function mountWithBodyLabelExample(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: {
            uuid: "ex-1", kind: "single", tag: "", label: "",
            exnoOverride: null, suppressSpace: false, number: 1,
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "My example sentence." }, bodyLabel("ex:foo")],
            },
          ],
        },
        { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "body" }] },
      ],
    },
  });
}

/** Mount a MAIN editor whose only example is a `\pex` with an item-BODY label. */
function mountWithPexItemBodyLabel(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: {
            uuid: "ex-2", kind: "multi", tag: "", label: "",
            exnoOverride: null, suppressSpace: false, number: 1,
          },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "it-a", tag: "", label: "", subLabel: "a" },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "First item." }, bodyLabel("ex:one")],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph", attrs: { uuid: "para-B" }, content: [{ type: "text", text: "body" }] },
      ],
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resolveLabelDisplay — body-positioned example \\label (task 025)", () => {
  it("resolves a single-\\ex body label to the example number (NOT '??')", () => {
    const main = mountWithBodyLabelExample();
    const { display, targetKind } = resolveLabelDisplay(main.state.doc, "ex:foo", "ref");
    expect(display).toBe("1");
    expect(targetKind).toBe("example");
    main.destroy();
  });

  it("wraps the number in parens for \\getref", () => {
    const main = mountWithBodyLabelExample();
    expect(resolveLabelDisplay(main.state.doc, "ex:foo", "getref").display).toBe("(1)");
    main.destroy();
  });

  it("resolves a \\pex item body label to N+sub", () => {
    const main = mountWithPexItemBodyLabel();
    const { display, targetKind } = resolveLabelDisplay(main.state.doc, "ex:one", "ref");
    expect(display).toBe("1a");
    expect(targetKind).toBe("example");
    main.destroy();
  });

  it("still returns '??' for an unknown label", () => {
    const main = mountWithBodyLabelExample();
    expect(resolveLabelDisplay(main.state.doc, "ex:nope", "ref").display).toBe("??");
    main.destroy();
  });
});
