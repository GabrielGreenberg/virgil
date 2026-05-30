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

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  buildEditorExtensions,
  createHeadingWithLabel,
  createParagraphWithTitle,
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

// The ordered `name`s the FLOAT surface must emit: the shared core
// (now INCLUDING `textColor` — promoted to shared in FCU Chip C1, decision 4,
// so colored text renders in popouts) MINUS the doc-wide example numberer
// (`expexNumbering`) and every main-only chrome extension (`placeholder`,
// `slashPopup`, `smartQuotes`, the orphan/title/maketitle/label/cleaner
// guards, `marginaliaAnchorGuard`, `pgmarkChip`, `uuidAttrDecorator`,
// `readOnlyEnforcer`). The `sectionNumbers` + `sectionFolding` plugins are
// omitted *inside* the heading builder (a separate test asserts that).
const EXPECTED_FLOAT_ORDER = [
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
  "aiRequestMarker",
  "latexCommand",
  "linkedAnchor",
  "linkedAnchorGuard",
  "tabIndent",
];

// Extensions present on main but that MUST NOT appear in a float stack.
// (`textColor` was here pre-Chip-C1; it is now SHARED, so a float INCLUDES
// it — see the dedicated assertion below.)
const MAIN_ONLY_NAMES = [
  "placeholder",
  "expexNumbering",
  "slashPopup",
  "smartQuotes",
  "textObjectOrphanGuard",
  "titleField",
  "maketitleMarker",
  "labelHandler",
  "emptyParagraphTitleCleaner",
  "marginaliaAnchorGuard",
  "pgmarkChip",
  "uuidAttrDecorator",
  "readOnlyEnforcer",
];

function floatCtx(): EditorExtensionsCtx {
  return {
    surface: "float",
    editable: true,
    cardContext: true,
    callbacks: {},
    docIdRef: null,
    host: { getMainEditor: () => null },
  };
}

// Mount a MINIMAL editor whose only block builders are the relocated
// paragraph + heading, so we can read the ProseMirror plugin keys the
// heading builder registers per surface (`sectionNumbers` + `sectionFolding`
// on main, neither on float). Avoids the storage-backed figure/graphics
// NodeViews entirely. Runs under jsdom (the file's @vitest-environment).
function headingPluginKeys(surface: "main" | "float"): string[] {
  const el = document.createElement("div");
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
      createHeadingWithLabel(
        {},
        surface === "float" ? { surface: "float" } : { surface: "main" },
      ),
    ],
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hi" }] },
      ],
    },
  });
  const keys = editor.state.plugins.map((p) =>
    String((p as unknown as { key?: string }).key ?? ""),
  );
  editor.destroy();
  return keys;
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

  it("surface 'float' emits the shared core minus main-only chrome (FCU Chip B)", () => {
    const names = buildEditorExtensions(floatCtx()).map((e) => e.name);
    expect(names).toEqual(EXPECTED_FLOAT_ORDER);
  });

  it("surface 'float' keeps the observer at index 1 (keystroke-sanctity rule)", () => {
    const exts = buildEditorExtensions(floatCtx());
    expect(exts[0].name).toBe("starterKit");
    expect(exts[1].name).toBe("docStructureObserver");
  });

  it("surface 'float' omits every main-only chrome extension (incl. ExpexNumbering)", () => {
    const names = buildEditorExtensions(floatCtx()).map((e) => e.name);
    for (const main of MAIN_ONLY_NAMES) {
      expect(names).not.toContain(main);
    }
  });

  it("surface 'float' INCLUDES textColor (promoted to the shared core, FCU Chip C1)", () => {
    const names = buildEditorExtensions(floatCtx()).map((e) => e.name);
    expect(names).toContain("textColor");
  });

  it("float heading omits the sectionNumbers + sectionFolding plugins; main keeps them", () => {
    const mainKeys = headingPluginKeys("main");
    expect(mainKeys.some((k) => k.startsWith("sectionNumbers"))).toBe(true);
    expect(mainKeys.some((k) => k.startsWith("sectionFolding"))).toBe(true);

    const floatKeys = headingPluginKeys("float");
    expect(floatKeys.some((k) => k.startsWith("sectionNumbers"))).toBe(false);
    expect(floatKeys.some((k) => k.startsWith("sectionFolding"))).toBe(false);
  });
});
