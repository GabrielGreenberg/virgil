// @vitest-environment jsdom
//
// Defect-2 regression (adversarial review of the footnote-atoms change): a
// RELOADED footnote-nested `\ref` rendered as "??" because RichTextField had a
// `refreshCitationDisplay` pass but NO ref-display equivalent, and the doc-level
// ref-display pass (editor-extensions.ts) can't recurse into a footnote's opaque
// `attrs.content` sub-doc. The fix resolves each labelRef's number against the
// MAIN doc via `resolveLabelDisplay` — the SAME resolver the create flow
// (`handleInsertRef`) already uses, so create-time and load-time agree.
//
// This pins that shared resolver: given a MAIN doc holding a labelled heading /
// example, resolving a footnote-nested label against it yields the number — not
// "??". (A footnote body owns no headings/examples, so resolving against the
// footnote's own doc would always give "??"; the resolver MUST read MAIN.)

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

/** Mount a real MAIN editor with a numbered, labelled heading. We seed
 *  `sectionNumber` directly so the test doesn't depend on the async numbering
 *  appendTransaction settling. */
function mountMain(): Editor {
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
          type: "heading",
          attrs: { level: 1, uuid: "h-1", label: "sec:intro", sectionNumber: "2" },
          content: [{ type: "text", text: "Introduction" }],
        },
        { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "body" }] },
      ],
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resolveLabelDisplay against MAIN (footnote-nested ref load-time refresh SSOT)", () => {
  it("resolves a heading label to its section number (NOT '??')", () => {
    const main = mountMain();
    const { display, targetKind } = resolveLabelDisplay(main.state.doc, "sec:intro", "ref");
    expect(display).toBe("2");
    expect(targetKind).toBe("heading");
    main.destroy();
  });

  it("wraps the number in parens for \\getref / \\getfullref", () => {
    const main = mountMain();
    expect(resolveLabelDisplay(main.state.doc, "sec:intro", "getref").display).toBe("(2)");
    expect(resolveLabelDisplay(main.state.doc, "sec:intro", "getfullref").display).toBe("(2)");
    main.destroy();
  });

  it("returns '??' for an unknown label (caller then KEEPS its persisted displayText)", () => {
    const main = mountMain();
    // RichTextField.refreshRefDisplay treats this "??" as "couldn't place" and
    // does NOT clobber the existing displayText — so the resolver returning "??"
    // here is the signal the refresh pass keys on.
    expect(resolveLabelDisplay(main.state.doc, "sec:nonexistent", "ref").display).toBe("??");
    main.destroy();
  });
});
