// @vitest-environment jsdom
//
// L3l — exampleItem sub-object lift float: the wrap-seed → INNER-TARGETED
// write-back round-trip law, against the REAL float schema (the same
// `getSchema(buildEditorExtensions({surface:"float"}))` the popout uses).
//
// The mirror of `list-item-inner-writeback.test.ts` one wrap level deeper:
// where listItem seeds `doc > list > item` (1 unwrap level), exampleItem seeds
// the full expex envelope `doc > exampleBlock > exampleItemList > exampleItem`,
// so the write-back unwraps TWO levels (`incoming[0].content[0].content`).
// Editing ONE item in the float must rewrite ONLY that item's range in main —
// its sibling items, the parent exampleBlock, and the block's uuid stay
// byte-intact. This pins that the body never clobbers the whole example (the
// trap the inner-targeting avoids), handles an in-float Enter-split gracefully,
// guards the two-level unwrap, and keeps the seed/sync wrapper JSON identical
// (the anti-thrash invariant).

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage`; stub it (we never
// CALL storage here) — same pattern as list-item-inner-writeback.test.ts.
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

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildWrap } from "../drop-adapters";
import {
  findExampleItemByUuid,
  resolveInnerWriteback,
  wrapItemForFloat,
} from "../floats/example-item-body";

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

const schema = getSchema(buildEditorExtensions(floatCtx()));

const text = (t: string): JSONContent => ({ type: "text", text: t });
const para = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const exItem = (uuid: string, t: string): JSONContent => ({
  type: "exampleItem",
  attrs: { uuid },
  content: [para(text(t))],
});
const exItemList = (...items: JSONContent[]): JSONContent => ({
  type: "exampleItemList",
  content: items,
});
const exBlock = (uuid: string, ...items: JSONContent[]): JSONContent => ({
  type: "exampleBlock",
  attrs: { uuid },
  content: [exItemList(...items)],
});
const makeDoc = (...content: JSONContent[]): PMNode =>
  PMNode.fromJSON(schema, { type: "doc", content });

/** Ordered [{uuid, text}] of every exampleItem, top-level items only (does not
 *  descend into a nested exampleItemList). */
function items(doc: PMNode): Array<{ uuid: unknown; text: string }> {
  const out: Array<{ uuid: unknown; text: string }> = [];
  doc.descendants((n) => {
    if (n.type.name === "exampleItem") {
      out.push({ uuid: n.attrs.uuid, text: n.textContent });
      return false;
    }
    return true;
  });
  return out;
}

/** The first exampleBlock's uuid. */
function exampleBlockUuid(doc: PMNode): unknown {
  let u: unknown = undefined;
  doc.descendants((n) => {
    if (u !== undefined) return false;
    if (n.type.name === "exampleBlock") {
      u = n.attrs.uuid;
      return false;
    }
    return true;
  });
  return u;
}

/** Apply the body's write-back exactly as the component does:
 *  `state.tr.replaceWith(from, to, items)`. */
function applyWriteback(doc: PMNode, uuid: string, floatDoc: JSONContent): PMNode {
  const wb = resolveInnerWriteback(doc, uuid, floatDoc);
  if (!wb) throw new Error("resolveInnerWriteback returned null");
  const state = EditorState.create({ schema, doc });
  const tr = state.tr.replaceWith(wb.from, wb.to, wb.items);
  return tr.doc;
}

describe("exampleItem inner-targeted write-back (L3l)", () => {
  it("finds the item by uuid", () => {
    const doc = makeDoc(exBlock("ex", exItem("it1", "one"), exItem("it2", "two")));
    expect(findExampleItemByUuid(doc, "it2")?.node.textContent).toBe("two");
    expect(findExampleItemByUuid(doc, "nope")).toBeNull();
  });

  it("editing item 2 rewrites ONLY item 2 — siblings + exampleBlock uuid intact", () => {
    const doc = makeDoc(
      exBlock("ex", exItem("it1", "one"), exItem("it2", "two"), exItem("it3", "three")),
    );
    // The float doc the popout produces: the full 3-level envelope
    // `doc > exampleBlock > exampleItemList > exampleItem(edited)`.
    const floatDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "exampleBlock", content: [exItemList(exItem("it2", "TWO EDITED"))] },
      ],
    };
    const after = applyWriteback(doc, "it2", floatDoc);
    expect(items(after)).toEqual([
      { uuid: "it1", text: "one" }, // sibling untouched
      { uuid: "it2", text: "TWO EDITED" }, // edited, uuid preserved
      { uuid: "it3", text: "three" }, // sibling untouched
    ]);
    // The parent example and its identity are never replaced.
    expect(exampleBlockUuid(after)).toBe("ex");
    expect(after.firstChild?.type.name).toBe("exampleBlock"); // still ONE block
    expect(after.firstChild?.childCount).toBe(1); // a single exampleItemList
    expect(after.firstChild?.firstChild?.childCount).toBe(3); // still 3 items
  });

  it("an in-float Enter-split (one item → two) lands as siblings; the rest intact", () => {
    const doc = makeDoc(
      exBlock("ex", exItem("it1", "one"), exItem("it2", "two"), exItem("it3", "three")),
    );
    // Float split item 2 into two items; the primary keeps it2, the new half
    // carries the float-minted id "it2b".
    const floatDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          content: [exItemList(exItem("it2", "two-A"), exItem("it2b", "two-B"))],
        },
      ],
    };
    const after = applyWriteback(doc, "it2", floatDoc);
    expect(items(after)).toEqual([
      { uuid: "it1", text: "one" },
      { uuid: "it2", text: "two-A" }, // primary keeps the source uuid
      { uuid: "it2b", text: "two-B" }, // split sibling inserted in-list
      { uuid: "it3", text: "three" },
    ]);
    expect(exampleBlockUuid(after)).toBe("ex");
    expect(after.firstChild?.firstChild?.childCount).toBe(4);
  });

  it("never writes when the source item is gone (source-missing path)", () => {
    const doc = makeDoc(exBlock("ex", exItem("it1", "one")));
    const floatDoc: JSONContent = {
      type: "doc",
      content: [{ type: "exampleBlock", content: [exItemList(exItem("gone", "x"))] }],
    };
    expect(resolveInnerWriteback(doc, "gone", floatDoc)).toBeNull();
  });

  it("guards the TWO-level unwrap — a wrong-shaped float doc writes nothing", () => {
    const doc = makeDoc(exBlock("ex", exItem("it1", "one")));
    // Wrong outer wrapper (a list, not an exampleBlock) → no write.
    const wrongOuter: JSONContent = {
      type: "doc",
      content: [{ type: "bulletList", content: [exItem("it1", "x")] }],
    };
    expect(resolveInnerWriteback(doc, "it1", wrongOuter)).toBeNull();
    // exampleBlock present but the inner level is not an exampleItemList → no write.
    const wrongInner: JSONContent = {
      type: "doc",
      content: [{ type: "exampleBlock", content: [para(text("x"))] }],
    };
    expect(resolveInnerWriteback(doc, "it1", wrongInner)).toBeNull();
    // exampleBlock > exampleItemList present but EMPTY → no write.
    const emptyList: JSONContent = {
      type: "doc",
      content: [{ type: "exampleBlock", content: [exItemList()] }],
    };
    expect(resolveInnerWriteback(doc, "it1", emptyList)).toBeNull();
  });

  it("seed (buildWrap) and sync (wrapItemForFloat) serialize identically — anti-thrash", () => {
    // useFloatMainSync's `sameDoc` fires a spurious setContent if the seed and
    // every readSource re-wrap differ. They must be byte-identical given the
    // SAME wrapper uuid — so the float never resets on a foreign main edit. The
    // wrapper here is the 3-level exampleBlock envelope (exampleItemList carries
    // no uuid; exampleBlock's non-uuid attrs default identically in both paths).
    const doc = makeDoc(exBlock("ex", exItem("it2", "two")));
    const item = findExampleItemByUuid(doc, "it2")!.node;
    const wrapped = buildWrap(schema, item, "exampleBlock");
    const viaHelper = wrapItemForFloat(
      schema,
      item,
      wrapped.attrs.uuid as string,
    );
    expect(viaHelper).toEqual(wrapped.toJSON());
  });
});
