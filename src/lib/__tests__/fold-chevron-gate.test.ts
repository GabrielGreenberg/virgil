// @vitest-environment jsdom
/**
 * #29a — per-heading fold-chevron subscriber keystroke-sanctity gate.
 *
 * Each heading NodeView registers its OWN `editor.on("transaction")` chevron
 * refresher (N headings = N subscribers). Before the fix it ran the chevron
 * refresh (plugin-state read + Set.has + classList.toggle) on EVERY
 * transaction — including a plain keystroke in an UNRELATED block — for every
 * heading in the doc. That global per-transaction work is what the gate kills.
 *
 * The legitimate, kept path is the NodeView's own `update(node)` — ProseMirror
 * fires it only when THAT heading node changes (e.g. typing in its title), so
 * its `refreshFoldBtn()` is O(1) per affected node, not doc-size-proportional.
 * These tests isolate the GLOBAL subscriber: they fold one heading, then type
 * in a paragraph under a DIFFERENT heading, and assert the folded heading's
 * chevron — whose node never updated — does ZERO DOM work. A real fold toggle
 * DOES refresh it, proving the gate didn't break behavior.
 *
 * Two layers tested:
 *   1. `transactionTouchesFold` predicate — false for a non-fold tx.
 *   2. The mounted chevron's `classList.toggle` (its only fold-state DOM write)
 *      via a spy on a distant heading's button.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Same storage stub as editor-extensions.test.ts — the extension barrel pulls
// @/lib/storage transitively (figure/graphics NodeViews) and storage.ts's
// `require("@/lib/storage-fsa")` can't be resolved by vitest. We never call any
// storage fn here, so a no-op stub is enough.
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
import { TextSelection } from "@tiptap/pm/state";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  createParagraphWithTitle,
  createHeadingWithLabel,
} from "@/lib/editor-extensions";
import {
  sectionFoldingPluginKey,
  transactionTouchesFold,
} from "@/lib/section-folding";

/**
 * Two sections: heading A + its paragraph, then heading B + its paragraph.
 * Folding A and typing in B's paragraph exercises the global subscriber path
 * (A's node never changes) without touching A's `update()`.
 */
function buildTwoSectionEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
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
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-A" },
          content: [{ type: "text", text: "Alpha" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p-A" },
          content: [{ type: "text", text: "Body A" }],
        },
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-B" },
          content: [{ type: "text", text: "Beta" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p-B" },
          content: [{ type: "text", text: "Body B" }],
        },
      ],
    },
  });
  return { editor, el };
}

/** Wrap a chevron button's classList.toggle with a spy (preserving behavior). */
function spyChevron(btn: HTMLButtonElement) {
  const spy = vi.fn();
  const real = btn.classList.toggle.bind(btn.classList);
  btn.classList.toggle = ((...args: Parameters<DOMTokenList["toggle"]>) => {
    spy(...args);
    return real(...args);
  }) as DOMTokenList["toggle"];
  return spy;
}

/** All mounted fold-chevron buttons, in document order. */
function chevrons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>(".heading-fold-chevron")];
}

/** Position inside the LAST paragraph's text ("Body B"), an unrelated block. */
function posInLastParagraph(editor: Editor): number {
  // doc.content.size - 1 sits inside the trailing paragraph's text.
  return editor.state.doc.content.size - 1;
}

describe("#29a transactionTouchesFold predicate", () => {
  it("is false for a selection-only transaction (no doc change, no fold meta)", () => {
    const { editor } = buildTwoSectionEditor();
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1),
    );
    expect(tr.docChanged).toBe(false);
    expect(transactionTouchesFold(tr)).toBe(false);
    editor.destroy();
  });

  it("is true for a fold-meta transaction", () => {
    const { editor } = buildTwoSectionEditor();
    const tr = editor.state.tr.setMeta(sectionFoldingPluginKey, {
      action: "toggle",
      uuid: "h-A",
    });
    expect(transactionTouchesFold(tr)).toBe(true);
    editor.destroy();
  });
});

describe("#29a fold-chevron: global subscriber does ZERO work on unrelated typing", () => {
  let editor: Editor;
  let el: HTMLElement;

  beforeEach(() => {
    ({ editor, el } = buildTwoSectionEditor());
  });

  it("mounts a chevron per heading", () => {
    expect(chevrons(el)).toHaveLength(2);
    editor.destroy();
  });

  it("typing in an unrelated paragraph never refreshes any heading's chevron", () => {
    const spies = chevrons(el).map(spyChevron);
    for (let i = 0; i < 12; i++) {
      editor.view.dispatch(
        editor.state.tr.insertText("x", posInLastParagraph(editor)),
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("after folding A, typing in B's paragraph leaves A's chevron untouched", () => {
    // Fold the first heading.
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    // Spy AFTER the fold so we measure only subsequent typing.
    const spies = chevrons(el).map(spyChevron);
    for (let i = 0; i < 10; i++) {
      editor.view.dispatch(
        editor.state.tr.insertText("y", posInLastParagraph(editor)),
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("a fold toggle DOES refresh the toggled heading's chevron", () => {
    const spies = chevrons(el).map(spyChevron);
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    // At least one chevron repainted with the folded state.
    const anyFolded = spies.some((s) =>
      s.mock.calls.some((c) => c[0] === "is-folded" && c[1] === true),
    );
    expect(anyFolded).toBe(true);
    editor.destroy();
  });
});
