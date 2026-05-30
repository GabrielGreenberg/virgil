// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components). storage.ts picks its backend with
// a raw `require("@/lib/storage-fsa")`, which vitest's resolver can't follow.
// We never CALL any storage function here (only read each extension's `name`),
// so a stub module is enough — same pattern as useDocument.test.ts. The
// factory replaces the module wholesale, so storage.ts's body never runs.
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

import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

// The exact, ordered list of extension `name`s the MAIN editor produced
// BEFORE the FCU factory extraction. It was transcribed independently from
// the inline `useEditor({ extensions: [...] })` array in Editor.tsx (order)
// plus each extension's declared `name` (looked up in its source). The FCU
// factory must reproduce it verbatim for `surface: "main"` — this is the
// byte-identical-main gate for Chip A (F0/F1).
//
// Two invariants are load-bearing:
//   - index 0 is StarterKit, index 1 is docStructureObserver (the
//     keystroke-sanctity "observer runs first" rule — see AGENTS.md /
//     docs/perf/keystroke-sanctity-findings.md).
//   - marginaliaAnchorGuard is CONDITIONAL on anchoredUuidsRef being present.
const EXPECTED_MAIN_ORDER = [
  "starterKit",
  "docStructureObserver",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "texBlock",
  "figureBlock",
  "figureCaption",
  "graphicsBlock",
  "placeholder",
  "highlight",
  "textColor",
  "inlineMath",
  "displayMath",
  "footnote",
  "latexComment",
  "citation",
  "labelRef",
  "exampleBlock",
  "exampleItemList",
  "exampleItem",
  "exampleGloss",
  "alignedGlossRow",
  "proseGlossRow",
  "glossCell",
  "expexNumbering",
  "aiRequestMarker",
  "latexCommand",
  "slashPopup",
  "smartQuotes",
  "linkedAnchor",
  "linkedAnchorGuard",
  "textObjectOrphanGuard",
  "titleField",
  "maketitleMarker",
  "labelHandler",
  "emptyParagraphTitleCleaner",
  "marginaliaAnchorGuard",
  "tabIndent",
  "pgmarkChip",
  "uuidAttrDecorator",
  "readOnlyEnforcer",
];

function mainCtx(withAnchors = true): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    // Present so the conditional MarginaliaAnchorGuard is emitted — mirrors
    // how EditorLayout invokes the live main editor.
    ...(withAnchors ? { anchoredUuidsRef: { current: new Set<string>() } } : {}),
    host: null,
  };
}

describe("buildEditorExtensions (FCU factory)", () => {
  it("surface 'main' emits the exact pre-FCU extension name order", () => {
    const names = buildEditorExtensions(mainCtx()).map((e) => e.name);
    expect(names).toEqual(EXPECTED_MAIN_ORDER);
  });

  it("keeps the observer at index 1 (keystroke-sanctity first-extension rule)", () => {
    const exts = buildEditorExtensions(mainCtx());
    expect(exts[0].name).toBe("starterKit");
    expect(exts[1].name).toBe("docStructureObserver");
  });

  it("emits MarginaliaAnchorGuard only when anchoredUuidsRef is supplied", () => {
    const names = buildEditorExtensions(mainCtx(false)).map((e) => e.name);
    expect(names).not.toContain("marginaliaAnchorGuard");
    expect(names).toEqual(
      EXPECTED_MAIN_ORDER.filter((n) => n !== "marginaliaAnchorGuard"),
    );
  });

  it("surface 'float' is reserved for FCU Chip B/C (throws for now)", () => {
    expect(() =>
      buildEditorExtensions({ ...mainCtx(), surface: "float" }),
    ).toThrow(/Chip B\/C/);
  });
});
