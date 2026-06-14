// @vitest-environment jsdom
/**
 * CHIP 5c — THE `.tex` ROUND-TRIP LOCK for the unified example creator.
 *
 * The chip collapsed THREE example creators (grid `wrapSelectionInExample` /
 * slash `insertExample` / the stray `insertExampleAtCursor`) onto ONE canonical
 * `exampleRun` + one `buildExampleNode` template, and resolved the dormant
 * `multi` structural divergence (`buildExampleTemplate` emitted bare
 * `exampleItem`s as direct `exampleBlock` children; `insertExample` wrapped them
 * in an `exampleItemList`) onto the schema-correct `exampleItemList` shape.
 *
 * THE KEY RISK is that this unification silently changes the emitted `.tex` for
 * the common SINGLE case. This test pins it: the single example produced by the
 * REAL `exampleRun` (collapsed-caret insert) serializes BYTE-IDENTICALLY to the
 * frozen pre-change `\ex` output — `\vexid{<uuid>}\ex\n\xe\n\n` — the same bytes
 * the prior `buildExampleTemplate("single")` / `insertExample("single")` template
 * produced (a single `exampleBlock` with one empty paragraph). And the resolved
 * `multi` shape round-trips to the expected `\pex … \xe` with two `\a` items.
 *
 * The extension barrel transitively imports `@/lib/storage` (whose
 * `require("@/lib/storage-fsa")` vitest can't resolve) — stubbed wholesale.
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
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import {
  exampleRun,
  type ActionContext,
} from "@/lib/actions/action-registry";

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

/** Run `exampleRun` on an empty doc (collapsed caret) and return the produced
 *  `exampleBlock` PM node from the dispatched transaction. */
function runEmptyInsert(): PMNode {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  let state = EditorState.create({ schema, doc });
  // collapsed caret inside the empty paragraph
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  let dispatched: Transaction | null = null;
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      dispatched = tr;
    },
  } as unknown as EditorView;
  const ctx: ActionContext = {
    editor: { view, state } as unknown as Editor,
    view,
    ref: { kind: "cursor", pos: 1, paragraphId: "" },
    surface: "slash",
  };
  exampleRun(ctx);
  if (!dispatched) throw new Error("exampleRun did not dispatch");
  let block: PMNode | null = null;
  (dispatched as Transaction).doc.descendants((n) => {
    if (!block && n.type.name === "exampleBlock") block = n;
    return !block;
  });
  if (!block) throw new Error("no exampleBlock produced");
  return block;
}

/** Wrap a single `exampleBlock` JSON in a doc and serialize body-only. */
function serializeExample(blockJson: JSONContent): string {
  return serializeBodyOnly({ type: "doc", content: [blockJson] });
}

/** The OLD single template shape (what `buildExampleTemplate("single")` /
 *  `insertExample("single")` produced): a single `exampleBlock { kind:'single' }`
 *  with one EMPTY paragraph and the SAME default attrs. The pre-change oracle. */
function oldSingleShape(uuid: string): JSONContent {
  return {
    type: "exampleBlock",
    attrs: {
      uuid,
      tag: "",
      label: "",
      kind: "single",
      exnoOverride: null,
      suppressSpace: false,
      number: 0,
    },
    content: [{ type: "paragraph" }],
  };
}

describe("CHIP 5c — single example `.tex` is byte-identical to the pre-change output", () => {
  it("the canonical single-example builder emits exactly `\\vexid{<uuid>}\\ex\\n\\xe`", () => {
    const block = runEmptyInsert();
    expect(block.attrs.kind).toBe("single");
    const uuid = block.attrs.uuid as string;

    const actual = serializeExample(block.toJSON() as JSONContent);

    // `serializeExampleBlock` emits `\vexid{<uuid>}` then `\ex` then (no body)
    // `\xe`; `serializeBodyOnly` trims the trailing blank lines. The unification
    // did NOT touch this shape, so the bytes must be exactly this.
    expect(actual).toBe(`\\vexid{${uuid}}\\ex\n\\xe`);
  });

  it("the canonical builder's bytes EQUAL the pre-change single template's bytes", () => {
    // The explicit "before vs after" oracle: serialize the NEW canonical builder
    // output AND the OLD `buildExampleTemplate("single")` shape with the SAME
    // uuid — they must be byte-for-byte identical (the unification is a no-op on
    // the emitted `.tex` for the common single case).
    const block = runEmptyInsert();
    const uuid = block.attrs.uuid as string;
    const newBytes = serializeExample(block.toJSON() as JSONContent);
    const oldBytes = serializeExample(oldSingleShape(uuid));
    expect(newBytes).toBe(oldBytes);
  });
});

describe("CHIP 5c — the resolved `multi` shape (exampleItemList) round-trips", () => {
  it("a multi example with exampleItemList-wrapped items serializes to `\\pex … \\a … \\xe`", () => {
    // The canonical `multi` shape (the resolved divergence): two `\a` items
    // wrapped in an `exampleItemList`. The serializer walks `exampleItemList`
    // (NOT bare `exampleItem`s — the dead `buildExampleTemplate` shape), so this
    // is the only multi shape that serializes at all.
    const uuid = "pexTST";
    const multi: JSONContent = {
      type: "exampleBlock",
      attrs: {
        uuid,
        tag: "",
        label: "",
        kind: "multi",
        exnoOverride: null,
        suppressSpace: false,
        number: 0,
      },
      content: [
        {
          type: "exampleItemList",
          content: [
            {
              type: "exampleItem",
              attrs: { tag: "", label: "", subLabel: "" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
            },
            {
              type: "exampleItem",
              attrs: { tag: "", label: "", subLabel: "" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }],
            },
          ],
        },
      ],
    };
    const tex = serializeExample(multi);
    expect(tex).toContain(`\\vexid{${uuid}}\\pex`);
    expect(tex).toContain("\\a alpha");
    expect(tex).toContain("\\a beta");
    expect(tex.trimEnd().endsWith("\\xe")).toBe(true);
  });
});
