// @vitest-environment jsdom
//
// L3k — listItem sub-object lift float: the wrap-seed → INNER-TARGETED
// write-back round-trip law, against the REAL float schema (the same
// `getSchema(buildEditorExtensions({surface:"float"}))` the popout uses).
//
// The defining property of a sub-object float (vs. the whole-container
// `list-body`): editing ONE item in the float must rewrite ONLY that item's
// range in main — its sibling items, the parent list, and the list's uuid stay
// byte-intact. This pins that the body never clobbers the whole list (the trap
// the inner-targeting avoids), handles an in-float Enter-split gracefully, and
// keeps the seed/sync wrapper JSON identical (the anti-thrash invariant).

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage`; stub it (we never
// CALL storage here) — same pattern as single-block-lift-wiring.test.ts.
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
  findListItemByUuid,
  resolveInnerWriteback,
  wrapItemForFloat,
} from "../floats/list-item-body";

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
const li = (uuid: string, t: string): JSONContent => ({
  type: "listItem",
  attrs: { uuid },
  content: [para(text(t))],
});
const ul = (uuid: string, ...items: JSONContent[]): JSONContent => ({
  type: "bulletList",
  attrs: { uuid },
  content: items,
});
const ol = (uuid: string, ...items: JSONContent[]): JSONContent => ({
  type: "orderedList",
  attrs: { uuid },
  content: items,
});
const makeDoc = (...content: JSONContent[]): PMNode =>
  PMNode.fromJSON(schema, { type: "doc", content });

/** Ordered [{uuid, text}] of every listItem, top-level items only. */
function items(doc: PMNode): Array<{ uuid: unknown; text: string }> {
  const out: Array<{ uuid: unknown; text: string }> = [];
  doc.descendants((n) => {
    if (n.type.name === "listItem") {
      out.push({ uuid: n.attrs.uuid, text: n.textContent });
      return false;
    }
    return true;
  });
  return out;
}

/** The first bullet/ordered list's uuid. */
function listUuid(doc: PMNode): unknown {
  let u: unknown = undefined;
  doc.descendants((n) => {
    if (u !== undefined) return false;
    if (n.type.name === "bulletList" || n.type.name === "orderedList") {
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

describe("listItem inner-targeted write-back (L3k)", () => {
  it("finds the item by uuid and reports its REAL parent list kind", () => {
    const bdoc = makeDoc(ul("list", li("it1", "one"), li("it2", "two")));
    const odoc = makeDoc(ol("olist", li("a1", "alpha")));
    expect(findListItemByUuid(bdoc, "it2")?.parentKind).toBe("bulletList");
    expect(findListItemByUuid(odoc, "a1")?.parentKind).toBe("orderedList");
    expect(findListItemByUuid(bdoc, "nope")).toBeNull();
  });

  it("editing item 2 rewrites ONLY item 2 — siblings + list uuid intact", () => {
    const doc = makeDoc(
      ul("list", li("it1", "one"), li("it2", "two"), li("it3", "three")),
    );
    // The float doc the popout produces: `doc > bulletList > listItem(edited)`.
    const floatDoc: JSONContent = {
      type: "doc",
      content: [{ type: "bulletList", content: [li("it2", "TWO EDITED")] }],
    };
    const after = applyWriteback(doc, "it2", floatDoc);
    expect(items(after)).toEqual([
      { uuid: "it1", text: "one" }, // sibling untouched
      { uuid: "it2", text: "TWO EDITED" }, // edited, uuid preserved
      { uuid: "it3", text: "three" }, // sibling untouched
    ]);
    // The parent list and its identity are never replaced.
    expect(listUuid(after)).toBe("list");
    expect(after.firstChild?.childCount).toBe(3); // still a 3-item list
  });

  it("an in-float Enter-split (one item → two) lands as siblings; the rest intact", () => {
    const doc = makeDoc(
      ul("list", li("it1", "one"), li("it2", "two"), li("it3", "three")),
    );
    // Float split item 2 into two items; the primary keeps it2, the new half
    // carries the float-minted id "it2b".
    const floatDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [li("it2", "two-A"), li("it2b", "two-B")],
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
    expect(listUuid(after)).toBe("list");
    expect(after.firstChild?.childCount).toBe(4);
  });

  it("never writes when the source item is gone (source-missing path)", () => {
    const doc = makeDoc(ul("list", li("it1", "one")));
    const floatDoc: JSONContent = {
      type: "doc",
      content: [{ type: "bulletList", content: [li("gone", "x")] }],
    };
    expect(resolveInnerWriteback(doc, "gone", floatDoc)).toBeNull();
  });

  it("seed and sync wrap identically for a bulletList source (anti-thrash)", () => {
    // useFloatMainSync's `sameDoc` fires a spurious setContent if the seed and
    // every readSource re-wrap differ. They must be byte-identical given the
    // SAME wrapper uuid + numbering — so the float never resets on a foreign
    // main edit. For a bulletList the numbering is inert, so the float wrapper
    // also equals the DROP wrapper buildWrap produces (ordered diverges — next).
    const doc = makeDoc(ul("list", li("it2", "two")));
    const src = findListItemByUuid(doc, "it2")!;
    const wrapped = buildWrap(schema, src.node, "bulletList");
    const seed = wrapItemForFloat(
      schema,
      src.node,
      "bulletList",
      wrapped.attrs.uuid as string,
      src.numbering,
    );
    const resync = wrapItemForFloat(
      schema,
      src.node,
      "bulletList",
      wrapped.attrs.uuid as string,
      src.numbering,
    );
    expect(seed).toEqual(resync);
    expect(seed).toEqual(wrapped.toJSON());
  });

  it("orderedList wrapper start = source ordinal — the 1.→2. fix; bullet untouched; drop stays default", () => {
    // The live af1a shape: af1a is the 2nd item of an orderedList → start:2.
    const odoc = makeDoc(
      ol("olist", li("d51a", "one"), li("af1a", "two"), li("e56f", "three")),
    );
    const oSrc = findListItemByUuid(odoc, "af1a")!;
    expect(oSrc.parentKind).toBe("orderedList");
    expect(oSrc.numbering).toEqual({ ordinal: 2, listType: null });

    // Seed and every readSource re-wrap → byte-identical (anti-thrash).
    const seed = wrapItemForFloat(schema, oSrc.node, "orderedList", "WUID", oSrc.numbering);
    const resync = wrapItemForFloat(schema, oSrc.node, "orderedList", "WUID", oSrc.numbering);
    expect(seed).toEqual(resync);
    // The wrapper orderedList carries start:2 → renders "2.", not "1.".
    expect(seed.attrs).toMatchObject({ start: 2, type: null, uuid: "WUID" });

    // The DROP path stays default (start:1) — a dropped item renumbers to context.
    expect(buildWrap(schema, oSrc.node, "orderedList").toJSON().attrs.start).toBe(1);

    // A custom list `start` offsets the ordinal: start:5, 2nd item → 6, type copied.
    const sdoc = makeDoc({
      type: "orderedList",
      attrs: { uuid: "s", start: 5, type: "a" },
      content: [li("s1", "one"), li("s2", "two")],
    });
    expect(findListItemByUuid(sdoc, "s2")!.numbering).toEqual({
      ordinal: 6,
      listType: "a",
    });

    // bulletList items are unnumbered — the wrapper carries no `start` attr.
    const bdoc = makeDoc(ul("blist", li("b1", "one"), li("b2", "two")));
    const bSrc = findListItemByUuid(bdoc, "b2")!;
    const bWrap = wrapItemForFloat(schema, bSrc.node, "bulletList", "WUID", bSrc.numbering);
    expect(bWrap.type).toBe("bulletList");
    expect(bWrap.attrs?.start).toBeUndefined();
  });
});
