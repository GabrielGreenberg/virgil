// @vitest-environment jsdom
//
// Task 126 — the omni fold-mirror invalidation gate.
//
// `omni-host`'s `hiddenTopLevel` memo reads `getHiddenTopLevelIndices`, which
// returns the section-folding plugin's cached `hiddenIdx`: a set of ABSOLUTE
// top-level child indices. The plugin rebuilds that set on ANY structural block
// diff — a plain (non-heading) paragraph inserted/deleted/reordered ELSEWHERE
// shifts every subsequent top-level index. The omni gate used to bump on a
// strict SUBSET (fold-meta + heading add/remove only), so a block edit while a
// section was folded left the mirror stale — mis-binning cards (ghost card
// beside a collapsed section, or a wrongly-dropped visible card) until the next
// fold toggle.
//
// `subscribeFoldMirrorInvalidation` is the fix: it MIRRORS the plugin's own
// `hiddenIdx`-rebuild trigger set (fold meta + headings + blocks
// added/removed/reordered). This test pins that contract:
//   • a block insert/delete while folded FIRES the gate AND `hiddenTopLevel`
//     shifts to the new absolute indices (the bug — pre-fix the gate stayed
//     silent);
//   • a fold toggle fires the gate;
//   • plain in-block typing fires NEITHER the gate nor a structural bus emit
//     (keystroke sanctity).
//
// Builds the REAL main editor stack (schema + section-folding plugin +
// DocStructureObserver) so the plugin's cached `hiddenIdx` and the bus events
// behave faithfully (the structural-edit.test.ts pattern).
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (same pattern as structural-edit.test.ts).
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
import {
  getHiddenTopLevelIndices,
  sectionFoldingPluginKey,
} from "@/lib/section-folding";
import { subscribeFoldMirrorInvalidation } from "../omni-fold-mirror-invalidation";

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

// Top-level children (index : node):
//   0 paragraph p-intro   1 heading  sec-a (L2)   2 paragraph p-a1
//   3 paragraph p-a2      4 heading  sec-b (L2)   5 paragraph p-b1
// Folding sec-a hides indices {2,3}.
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-intro" }, content: [{ type: "text", text: "Intro" }] },
      { type: "heading", attrs: { level: 2, uuid: "sec-a" }, content: [{ type: "text", text: "Section A" }] },
      { type: "paragraph", attrs: { uuid: "p-a1" }, content: [{ type: "text", text: "A body one" }] },
      { type: "paragraph", attrs: { uuid: "p-a2" }, content: [{ type: "text", text: "A body two" }] },
      { type: "heading", attrs: { level: 2, uuid: "sec-b" }, content: [{ type: "text", text: "Section B" }] },
      { type: "paragraph", attrs: { uuid: "p-b1" }, content: [{ type: "text", text: "B body" }] },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** Fold (toggle) a top-level heading by uuid — the fold-meta transaction. */
function foldSection(editor: Editor, uuid: string) {
  editor.view.dispatch(
    editor.state.tr.setMeta(sectionFoldingPluginKey, { action: "toggle", uuid }),
  );
}

/** A uuid-bearing paragraph — anchorable, so its insert/remove hits the block diff. */
function paragraph(editor: Editor, uuid: string, text: string) {
  return editor.schema.nodes.paragraph.create({ uuid }, editor.schema.text(text));
}

function hidden(editor: Editor): number[] {
  return [...getHiddenTopLevelIndices(editor.state)].sort((a, b) => a - b);
}

describe("subscribeFoldMirrorInvalidation — the fold-mirror gate", () => {
  it("bumps AND shifts hiddenTopLevel when a block is INSERTED earlier while folded (task 126, insert direction)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3]);

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // Insert a plain top-level paragraph at the very top — NOT a fold-meta
        // tx and NOT a heading change, so the pre-fix headings-only gate stayed
        // silent. Every subsequent top-level index shifts by +1.
        editor.view.dispatch(editor.state.tr.insert(0, paragraph(editor, "p-new", "New top")));

        // THE BUG: pre-fix `bump` was never called here (headings-only gate).
        expect(bump).toHaveBeenCalled();
        // And the freshly-read set reflects the shifted indices — proving the
        // consumer's memo would have been stale had it not re-read.
        expect(hidden(editor)).toEqual([3, 4]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps AND shifts hiddenTopLevel when a block is DELETED earlier while folded (delete direction, previously unmasked)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3]);

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // Delete the leading paragraph (index 0). Everything shifts by -1.
        const introSize = editor.state.doc.child(0).nodeSize;
        editor.view.dispatch(editor.state.tr.delete(0, introSize));

        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([1, 2]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps on a fold-toggle transaction (the fold-meta path)", () => {
    const { editor, cleanup } = mount();
    try {
      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        foldSection(editor, "sec-a");
        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([2, 3]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("stays SILENT on plain in-block typing — keystroke sanctity (no gate bump, no structural emit)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      const bus = getBus(editor);
      expect(bus).not.toBeNull();

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // A stable text position inside a non-folded paragraph (p-b1).
        let typePos: number | null = null;
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === "B body") {
            typePos = pos + 1;
            return false;
          }
          return true;
        });
        expect(typePos).not.toBeNull();

        // Warm-up keystroke, then measure steady state (structural-edit pattern).
        editor.view.dispatch(editor.state.tr.insertText("a", typePos!));
        const emitBefore = bus!.emitCount;
        bump.mockClear();
        for (let i = 0; i < 8; i++) {
          editor.view.dispatch(editor.state.tr.insertText("a", typePos! + 1 + i));
        }
        // Plain typing fired ZERO structural emits and ZERO gate bumps.
        expect(bus!.emitCount).toBe(emitBefore);
        expect(bump).not.toHaveBeenCalled();
        // The fold set is unchanged by the typing.
        expect(hidden(editor)).toEqual([2, 3]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("detaches every listener on unsubscribe", () => {
    const { editor, cleanup } = mount();
    try {
      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      unsub();
      // Post-unsub: neither a fold toggle nor a block insert reaches the gate.
      foldSection(editor, "sec-a");
      editor.view.dispatch(editor.state.tr.insert(0, paragraph(editor, "p-new2", "Another")));
      expect(bump).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
