// @vitest-environment jsdom
/**
 * DA-1 — `wrapSelectionInExample` must never place block-level nodes into the
 * example template's inline-only paragraph slot.
 *
 * The Format grid's "Example (ex)" cell wraps the current selection into a
 * fresh single-example template (`buildExampleTemplate("single", …)`) and drops
 * the selection's inline content into the first `exampleItem` paragraph, whose
 * content is `inline*`. The old code shoveled the raw slice JSON in, guarded
 * only by `Array.isArray` — but a slice spanning a block boundary serializes to
 * *block* nodes (paragraphs, lists, displayMath), so that slot received
 * block-level JSON → a ProseMirror schema violation / document corruption.
 *
 * This locks the fix on the REAL editor schema (same harness as
 * single-example-expex-real-schema.test.ts): we replay the helper's exact
 * extract-then-assemble pipeline (`extractInlineJSON` → splice into the
 * template's first paragraph → `schema.nodeFromJSON(...).check()`) for:
 *   (a) a plain inline selection            → wrapped, valid, words survive;
 *   (b) a multi-paragraph selection         → inline-only, valid, NO throw;
 *   (c) a selection containing a list       → inline-only, valid, NO throw;
 *   (d) an inline selection with an atom     → atom preserved inline;
 *   (e) a whitespace-only / collapsed sel    → empty ⇒ empty-template fallback.
 *
 * The extension barrel transitively imports `@/lib/storage` (whose
 * `require("@/lib/storage-fsa")` vitest can't resolve) — stubbed wholesale, the
 * same pattern editor-extensions.test.ts uses. We never call a storage fn.
 */

import { describe, expect, it, vi } from "vitest";

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

import { getSchema } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildExampleTemplate } from "../MenuBar";
import { extractInlineJSON } from "../ActionsMenuPanel";

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

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

/**
 * Replay the production `wrapSelectionInExample` pipeline exactly:
 * extract inline JSON from the slice, splice it into the template's first
 * paragraph (only when non-empty), then build the example block on the REAL
 * schema and return it (so the caller can `check()` it).
 */
function buildWrappedExample(doc: PMNode, from: number, to: number): PMNode {
  const inlineContent = extractInlineJSON(doc.slice(from, to));
  const { node } = buildExampleTemplate("single", new Set<string>());
  const content = node.content as Array<{ type: string; content?: unknown[] }>;
  if (content[0] && content[0].type === "paragraph" && inlineContent.length) {
    content[0].content = inlineContent;
  }
  return schema.nodeFromJSON(node);
}

/** The text in the example template's first (and only) item paragraph. */
function firstItemText(block: PMNode): string {
  // single template → content is [{ paragraph }]
  return block.child(0).textContent;
}

describe("DA-1 — the slot is inline-only on the real schema", () => {
  it("the example template's first paragraph holds `inline*` (rejects blocks)", () => {
    const para = schema.nodes.paragraph;
    expect(para.contentMatch.matchType(schema.nodes.paragraph)).toBeNull();
    expect(para.contentMatch.matchType(schema.nodes.displayMath)).toBeNull();
    expect(para.contentMatch.matchType(schema.nodes.bulletList)).toBeNull();
    // …but it DOES accept text.
    expect(para.contentMatch.matchType(schema.nodes.text)).not.toBeNull();
  });
});

describe("DA-1 — wrapSelectionInExample never corrupts the doc", () => {
  it("(a) plain inline selection → wrapped, valid, words survive", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
      ],
    });
    // select "ello wor"
    const block = buildWrappedExample(doc, 2, 10);
    expect(() => block.check()).not.toThrow();
    expect(block.type.name).toBe("exampleBlock");
    expect(block.attrs.kind).toBe("single");
    expect(firstItemText(block)).toBe("ello wor");
  });

  it("(b) MULTI-BLOCK selection (two paragraphs) → inline-only, no schema throw", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "beta" }] },
      ],
    });
    // from inside para1 ("lpha") to inside para2 ("be")
    const block = buildWrappedExample(doc, 2, 10);
    // The crux: this would THROW on the old code (block paragraphs into an
    // inline-only slot). It must build cleanly now.
    expect(() => block.check()).not.toThrow();
    // Inline content joined, block boundary collapsed — no nested paragraphs.
    expect(block.child(0).type.name).toBe("paragraph");
    expect(firstItemText(block)).toBe("lphabe");
    // No block leaked into the inline slot.
    block.child(0).forEach((inline) => {
      expect(inline.isInline).toBe(true);
    });
  });

  it("(c) selection containing a LIST → inline-only, no schema throw", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item1" }] },
              ],
            },
          ],
        },
      ],
    });
    // from "intro" paragraph content start through the end of the list
    const block = buildWrappedExample(doc, 1, doc.content.size);
    expect(() => block.check()).not.toThrow();
    // The list's inline leaves are harvested; no list/listItem/paragraph
    // structure survives inside the inline slot.
    block.child(0).forEach((inline) => expect(inline.isInline).toBe(true));
    expect(firstItemText(block)).toBe("introitem1");
  });

  it("(d) inline selection with an inline atom (inline math) preserves the atom", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " here" },
          ],
        },
      ],
    });
    const block = buildWrappedExample(doc, 1, doc.child(0).nodeSize - 1);
    expect(() => block.check()).not.toThrow();
    let sawMath = false;
    block.child(0).forEach((inline) => {
      expect(inline.isInline).toBe(true);
      if (inline.type.name === "inlineMath") sawMath = true;
    });
    expect(sawMath).toBe(true);
  });

  it("(e) whitespace-only selection → empty-template fallback (blank item)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a    b" }] },
      ],
    });
    // select the run of spaces between "a" and "b"
    expect(extractInlineJSON(doc.slice(2, 6))).toEqual([]);
    const block = buildWrappedExample(doc, 2, 6);
    expect(() => block.check()).not.toThrow();
    // Empty template: first paragraph has no content.
    expect(block.child(0).content.size).toBe(0);
  });

  it("(f) collapsed selection → empty-template fallback (no throw)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    });
    expect(extractInlineJSON(doc.slice(3, 3))).toEqual([]);
    const block = buildWrappedExample(doc, 3, 3);
    expect(() => block.check()).not.toThrow();
    expect(block.child(0).content.size).toBe(0);
  });
});
