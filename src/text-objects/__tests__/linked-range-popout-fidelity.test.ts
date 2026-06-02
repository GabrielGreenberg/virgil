// @vitest-environment jsdom
//
// Selection-bug A — the linkedRange popout must BE the selection: correctly
// labeled and fully rendered. Two deterministic guards:
//
//  (1) `linkedRange.computeLabel` reflects the mark's TRUE nature — a plain
//      selection grab rides a `kind:"transient"` linkedAnchor and reads "Text
//      selection"; a real annotation's range (note/highlight/cut/revision,
//      carrying a `linkCard`) returns null so the chrome keeps "Linked range".
//      This is the ONE source both the released-float header
//      (`linked-range-body.tsx` via `setHeaderLabel`) and the lift-overlay's
//      popout-mode header (`TextObjectGrabHandle`) read.
//
//  (2) The float surface's schema (`buildEditorExtensions({ surface:"float" })`,
//      now consumed by `linked-range-body.tsx`) INCLUDES the block node types
//      a selection can span — displayMath / figureBlock / lists / exampleBlock
//      / heading — so a rich range round-trips instead of being silently
//      dropped to a blank popout (the pre-FCU hand-rolled StarterKit subset
//      omitted exactly these).

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components). storage.ts picks its backend with
// a raw `require("@/lib/storage-fsa")`, which vitest's resolver can't follow.
// We never CALL any storage function here, so a stub module is enough — same
// pattern as editor-extensions.test.ts.
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

import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node as PMNode } from "@tiptap/pm/model";
import { LinkedAnchor } from "@/lib/tiptap/linked-anchor";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";

// --- (1) computeLabel: transient → "Text selection", annotation → null ------

const markSchema = getSchema([StarterKit, LinkedAnchor]);

/** A one-paragraph doc whose text carries a linkedAnchor mark with the given
 *  attrs. Returned as a minimal `{ state: { doc } }` shape — all
 *  `computeLabel` touches is `editor.state.doc`. */
function docWithAnchor(attrs: Record<string, unknown> | null): Editor {
  const marks = attrs ? [{ type: "linkedAnchor", attrs }] : [];
  const doc = PMNode.fromJSON(markSchema, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "marked text", marks }] },
    ],
  });
  return { state: { doc } } as unknown as Editor;
}

describe("linkedRange.computeLabel", () => {
  const computeLabel = TEXT_OBJECT_REGISTRY.linkedRange.computeLabel;

  it("is defined on the linkedRange entry", () => {
    expect(typeof computeLabel).toBe("function");
  });

  it("returns 'Text selection' for a transient (plain-selection) grab", () => {
    const editor = docWithAnchor({ anchorId: "aa11", kind: "transient" });
    expect(computeLabel!(editor, { kind: "linkedRange", id: "aa11" })).toBe(
      "Text selection",
    );
  });

  it("returns null for a real annotation's range (note → falls back to 'Linked range')", () => {
    const editor = docWithAnchor({
      anchorId: "bb22",
      kind: "note",
      linkCard: "note:xyz",
    });
    expect(computeLabel!(editor, { kind: "linkedRange", id: "bb22" })).toBeNull();
  });

  it("returns null for highlight/cut/revision (every non-transient kind)", () => {
    for (const kind of ["highlight", "cut", "revision"]) {
      const editor = docWithAnchor({ anchorId: "cc33", kind });
      expect(
        computeLabel!(editor, { kind: "linkedRange", id: "cc33" }),
      ).toBeNull();
    }
  });

  it("returns null when no mark with the id is present (so chrome keeps meta.label)", () => {
    const editor = docWithAnchor({ anchorId: "dd44", kind: "transient" });
    // Ask for a different id than the one stamped.
    expect(computeLabel!(editor, { kind: "linkedRange", id: "zzzz" })).toBeNull();
    // …and with no mark at all.
    const bare = docWithAnchor(null);
    expect(computeLabel!(bare, { kind: "linkedRange", id: "aa11" })).toBeNull();
  });
});

// --- (2) float schema fidelity: the range's node types survive --------------

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

describe("linkedRange float schema (buildEditorExtensions surface:'float')", () => {
  const schema = getSchema(buildEditorExtensions(floatCtx()));

  it("includes every block node type a selection can span (was BLANK pre-FCU)", () => {
    // The exact set the live reproduction showed MISSING from the narrow
    // hand-rolled stack (hasRich all-false) — now all present.
    for (const t of [
      "displayMath",
      "figureBlock",
      "figureCaption",
      "graphicsBlock",
      "bulletList",
      "orderedList",
      "listItem",
      "exampleBlock",
      "heading",
      "blockquote",
      "codeBlock",
      "inlineMath",
      "citation",
      "footnote",
    ]) {
      expect(schema.nodes[t] ?? schema.marks[t], `schema is missing "${t}"`).toBeDefined();
    }
  });

  it("round-trips a multi-block range (heading + list + paragraph) without dropping blocks", () => {
    const richDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    const node = PMNode.fromJSON(schema, richDoc);
    // Pre-fix, the narrow schema collapsed a rich range to a single empty
    // paragraph; here all three blocks survive in order.
    expect(node.childCount).toBe(3);
    const childTypes: string[] = [];
    node.forEach((c) => childTypes.push(c.type.name));
    expect(childTypes).toEqual(["heading", "bulletList", "paragraph"]);
  });
});
