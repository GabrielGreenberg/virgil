// @vitest-environment jsdom
//
// P0 plugin-order regression guard: `readPendingDiff(newState)` must return
// the CURRENT transaction's diff when called from ANOTHER plugin's `apply` —
// no matter where that plugin's extension sits in the extension array.
//
// Why this is subtle: TipTap collects PM plugins in REVERSE extension order
// (`sortExtensions([...extensions].reverse())` in @tiptap/core). So the
// DocStructureObserver being extension index 1 put its plugin `apply` nearly
// LAST — and every extension AFTER it in the array (uuid-attr,
// section-folding) had its plugin `apply` run BEFORE the diff was computed,
// read `null`, and silently took its observer-absent full-doc-walk fallback
// on every keystroke. The fix is `priority: 10_000` on the observer
// extension, which sorts its plugin to the FRONT of the plugin array.
//
// The probe below emulates the uuid-attr shape exactly: DEFAULT priority,
// appended LAST in the extension array — post-reversal its plugin `apply`
// runs as early as a plugin can. If the observer's priority is ever dropped,
// the probe reads `null`/stale and this test fails.

import { describe, it, expect, vi } from "vitest";

// Same storage stub as editor-extensions.test.ts — the extension barrel
// transitively imports `@/lib/storage` via the figure/tex NodeView components,
// and storage.ts picks its backend with a raw require vitest can't follow.
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

import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";
import { EMPTY_DIFF, type StructureDiff } from "@/lib/tiptap/doc-structure/types";

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

describe("readPendingDiff from another plugin's apply (P0 plugin order)", () => {
  // Records what readPendingDiff returned inside the probe plugin's `apply`
  // for each docChanged transaction.
  const seen: (StructureDiff | null)[] = [];

  const ProbeLast = Extension.create({
    name: "probeLast",
    // DEFAULT priority + LAST array position = post-reversal this plugin's
    // `apply` runs before every other default-priority plugin — the exact
    // position uuid-attr's decorator plugin was in when the bug bit.
    addProseMirrorPlugins() {
      return [
        new Plugin({
          state: {
            init: () => null,
            apply(tr, value, _old, newState) {
              if (tr.docChanged) seen.push(readPendingDiff(newState));
              return value;
            },
          },
        }),
      ];
    },
  });

  function makeEditor() {
    seen.length = 0;
    return new Editor({
      extensions: [...buildEditorExtensions(mainCtx()), ProbeLast],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { uuid: "para-1" },
            content: [{ type: "text", text: "Hello world, a plain paragraph." }],
          },
        ],
      },
    });
  }

  it("sees the current tx's content-only diff on a plain text insert (the every-keystroke path)", () => {
    const editor = makeEditor();
    try {
      const tr = editor.state.tr.insertText("x", 5, 5);
      editor.view.dispatch(tr);
      expect(seen.length).toBeGreaterThanOrEqual(1);
      const diff = seen[0];
      expect(diff).not.toBeNull();
      expect(diff!.contentChangedUuids).toContain("para-1");
    } finally {
      editor.destroy();
    }
  });

  it("sees the current tx's structural diff when a block is inserted", () => {
    const editor = makeEditor();
    try {
      const para = editor.schema.nodes.paragraph.create(
        { uuid: "para-2" },
        editor.schema.text("Second paragraph."),
      );
      const end = editor.state.doc.content.size;
      editor.view.dispatch(editor.state.tr.insert(end, para));
      expect(seen.length).toBeGreaterThanOrEqual(1);
      const diff = seen[0];
      expect(diff).not.toBeNull();
      expect(diff!.addedBlocks.map((b) => b.uuid)).toContain("para-2");
    } finally {
      editor.destroy();
    }
  });

  it("sees EMPTY_DIFF (not null) on a docChanged-but-structurally-null tx (attr-only step)", () => {
    // An IN-PLACE `parTitle` edit ("T" → "TX") is docChanged but produces no
    // structural or content entries — the tracked datum is the BOOLEAN
    // `parTitled` (deriveParTitled), which doesn't flip when a non-empty title
    // stays non-empty — so the inspector returns the shared EMPTY_DIFF. The
    // observer must store IT (not null) so apply-time consumers can tell
    // "observer present, nothing changed" apart from "observer absent"
    // and skip their full-rebuild fallback. (The null → "T" FLIP is the
    // structural case — pinned in __tests__/par-titled.test.ts.)
    const editor = makeEditor();
    try {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "parTitle", "T"));
      seen.length = 0;
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "parTitle", "TX"));
      expect(seen.length).toBeGreaterThanOrEqual(1);
      expect(seen[0]).toBe(EMPTY_DIFF);
    } finally {
      editor.destroy();
    }
  });
});
