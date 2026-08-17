// @vitest-environment jsdom
//
// Contract test for the borrowed-schema extraction (backlog #11). It pins the
// shared card-context inline-atom + block-atom-preview set and — crucially —
// asserts the MAIN editor registers every one of those atoms, so a future atom
// added to `borrowed-schema.ts` provably surfaces in ALL THREE consumers
// (RichTextField, BorrowedMainText, the main editor). That is the whole point
// of the extraction: "add an atom kind in one place."
import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components). storage.ts picks its backend with
// a raw `require("@/lib/storage-fsa")`, which vitest's resolver can't follow.
// We never CALL any storage function here (only read each extension's `name` /
// `options`), so a stub module is enough — same pattern as
// editor-extensions.test.ts. The factory replaces the module wholesale, so
// storage.ts's body never runs.
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
  buildBorrowedAtomSchema,
  BORROWED_INLINE_ATOM_NAMES,
  BORROWED_BLOCK_ATOM_NAMES,
} from "@/lib/tiptap/borrowed-schema";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

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

const names = (exts: { name: string }[]) => exts.map((e) => e.name);

// Block atoms carry options; read `cardContext` off each to prove the card
// surfaces get the compact-preview NodeView, not the main chrome.
function optionFor(
  exts: { name: string; options?: unknown }[],
  name: string,
): Record<string, unknown> | undefined {
  const ext = exts.find((e) => e.name === name);
  return ext?.options as Record<string, unknown> | undefined;
}

describe("borrowed-schema (backlog #11)", () => {
  it("RichTextField config (no labelRef/footnote) registers the editable card atom set", () => {
    const exts = buildBorrowedAtomSchema(); // includeLabelRefFootnote: false
    const got = names(exts);
    // Inline atoms minus labelRef/footnote (RichTextField's cards never edit
    // those), plus the block-atom previews.
    expect(got).toEqual([
      "inlineMath",
      "citation",
      "latexCommand",
      "latexVerbatim",
      "latexCommentTail",
      "displayMath",
      "texBlock",
      "figureBlock",
      "figureCaption",
      "graphicsBlock",
      "latexComment",
    ]);
    expect(got).not.toContain("labelRef");
    expect(got).not.toContain("footnote");
  });

  it("BorrowedMainText config (includeLabelRefFootnote) adds read-only \\ref + footnote", () => {
    const exts = buildBorrowedAtomSchema({ includeLabelRefFootnote: true });
    const got = names(exts);
    expect(got).toContain("labelRef");
    expect(got).toContain("footnote");
    // labelRef + footnote sit right after citation (matching BorrowedMainText's
    // pre-extraction order).
    expect(got).toEqual([
      "inlineMath",
      "citation",
      "labelRef",
      "footnote",
      "latexCommand",
      "latexVerbatim",
      "latexCommentTail",
      "displayMath",
      "texBlock",
      "figureBlock",
      "figureCaption",
      "graphicsBlock",
      "latexComment",
    ]);
  });

  it("includeLabelRef (CHIP 5) adds labelRef but NOT the nested footnote marker", () => {
    // RichTextField's actual config: a footnote-nested `\ref` needs a labelRef
    // node to insert into + round-trip, but footnotes can't nest — so the
    // `footnote` marker stays out of the editable footnote body's schema.
    const exts = buildBorrowedAtomSchema({ includeLabelRef: true });
    const got = names(exts);
    expect(got).toContain("labelRef");
    expect(got).not.toContain("footnote");
    expect(got).toEqual([
      "inlineMath",
      "citation",
      "labelRef",
      "latexCommand",
      "latexVerbatim",
      "latexCommentTail",
      "displayMath",
      "texBlock",
      "figureBlock",
      "figureCaption",
      "graphicsBlock",
      "latexComment",
    ]);
  });

  it("includeFootnote adds the footnote marker but NOT labelRef", () => {
    const got = names(buildBorrowedAtomSchema({ includeFootnote: true }));
    expect(got).toContain("footnote");
    expect(got).not.toContain("labelRef");
  });

  it("includeLabelRefFootnote remains the combined alias (both)", () => {
    const got = names(buildBorrowedAtomSchema({ includeLabelRefFootnote: true }));
    expect(got).toContain("labelRef");
    expect(got).toContain("footnote");
  });

  it("registers block atoms in cardContext (compact-preview) mode", () => {
    const exts = buildBorrowedAtomSchema({ includeLabelRefFootnote: true });
    for (const blockName of ["texBlock", "figureBlock", "graphicsBlock", "latexComment"]) {
      expect(optionFor(exts, blockName)?.cardContext).toBe(true);
    }
  });

  it("registers inline math/displayMath BARE (default surface 'main')", () => {
    // The card surfaces historically registered these bare; threading any other
    // surface would be a behavior change. The default surface is "main".
    // (latexComment dropped its `surface` option in the atom→block remodel,
    // task 017 — it's a content block now, no `.selected`-at-rest float gate.)
    const exts = buildBorrowedAtomSchema({ includeLabelRefFootnote: true });
    expect(optionFor(exts, "inlineMath")?.surface).toBe("main");
    expect(optionFor(exts, "displayMath")?.surface).toBe("main");
  });

  // ── The cross-surface invariant ─────────────────────────────────────────
  // The MAIN editor must register every atom the borrowed-schema module knows
  // about. This is what makes "add an atom in one place" SAFE: adding a row to
  // BORROWED_*_ATOM_NAMES (and the builder) without also wiring it into the
  // main editor fails here.
  it("the MAIN editor registers every borrowed inline atom", () => {
    const mainNames = new Set(names(buildEditorExtensions(mainCtx())));
    for (const atom of BORROWED_INLINE_ATOM_NAMES) {
      expect(mainNames.has(atom)).toBe(true);
    }
  });

  it("the MAIN editor registers every borrowed block atom", () => {
    const mainNames = new Set(names(buildEditorExtensions(mainCtx())));
    for (const atom of BORROWED_BLOCK_ATOM_NAMES) {
      expect(mainNames.has(atom)).toBe(true);
    }
  });

  // And the card surfaces (both configs) must register every name the canonical
  // lists claim — so the two halves of the invariant can't silently diverge.
  it("the card surface (with refs) registers every canonical borrowed atom name", () => {
    const cardNames = new Set(
      names(buildBorrowedAtomSchema({ includeLabelRefFootnote: true })),
    );
    for (const atom of [...BORROWED_INLINE_ATOM_NAMES, ...BORROWED_BLOCK_ATOM_NAMES]) {
      expect(cardNames.has(atom)).toBe(true);
    }
  });

  it("the canonical name lists are EXHAUSTIVE — every builder atom is named (closes the add-to-builder-only gap, #11 teeth)", () => {
    // The builder (with refs) returns ONLY the shared atom/preview extensions —
    // StarterKit is composed per-surface, not here — so its output names must
    // equal the canonical lists EXACTLY. The other tests prove names ⊆ builder;
    // this proves builder ⊆ names. Without it, a dev could add an atom to the
    // builder (both card surfaces get it) but forget the name constant, and the
    // main-editor contract test (which iterates the name lists) would never gate
    // the main editor on it — silently re-opening bug class #11. This closes the
    // SSOT loop: builder ≡ names → (contract test) → main editor.
    const canonical = new Set<string>([
      ...BORROWED_INLINE_ATOM_NAMES,
      ...BORROWED_BLOCK_ATOM_NAMES,
    ]);
    for (const n of names(buildBorrowedAtomSchema({ includeLabelRefFootnote: true }))) {
      expect(canonical.has(n)).toBe(true);
    }
  });

  it("the editable card surface registers every borrowed atom EXCEPT labelRef/footnote", () => {
    const cardNames = new Set(names(buildBorrowedAtomSchema()));
    for (const atom of [...BORROWED_INLINE_ATOM_NAMES, ...BORROWED_BLOCK_ATOM_NAMES]) {
      if (atom === "labelRef" || atom === "footnote") {
        expect(cardNames.has(atom)).toBe(false);
      } else {
        expect(cardNames.has(atom)).toBe(true);
      }
    }
  });
});
