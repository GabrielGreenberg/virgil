// @vitest-environment jsdom
//
// BUG #48 — popped-out text-objects must drop onto the Stack with parity to
// card floats. The asymmetry was that `textObjectFloatable.snapshotForStack`
// returned `null` (an explicit Stage-5 stub), so a popped-out paragraph /
// heading / block / list-item / range produced NO stack snapshot while card
// floats did.
//
// This pins the deep fix: ONE `snapshotTextObject(editor, ref, source)`
// dispatcher (the snapshot SSOT) serializes EVERY poppable text-object kind to
// a payload the existing stack-pull spec already round-trips:
//   • heading                 → `heading`   payload (whole dominated section)
//   • linkedRange             → `text`      payload (marked range, id stripped)
//   • listItem / exampleItem  → `text`      payload (item inner content)
//   • every other top node    → `paragraph` payload (single block by uuid)
//
// Two layers:
//   1. capture — every poppable kind produces a NON-NULL snapshot of the
//      expected payload shape, with uuids + cross-doc marks stripped.
//   2. round-trip — the produced payload re-hydrates against the same schema
//      (the core of the stack-pull spec's insert helpers), so the snapshot is
//      provably droppable back into a doc, not just non-null.

import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (figure / graphics
// / tex-block NodeViews). storage.ts picks its backend via a raw
// `require("@/lib/storage-fsa")` vitest's resolver can't follow; we never CALL
// storage here, so a stub module is enough — same pattern as
// linked-range-popout-fidelity.test.ts.
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

import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import { Node as PMNode, Slice } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  snapshotTextObject,
  snapshotLinkedRange,
  snapshotSubObjectContent,
} from "../snapshot";
import type { StackItem } from "../types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editable: true,
    cardContext: false,
    callbacks: {},
    docIdRef: null,
    host: { getMainEditor: () => null },
  };
}

const schema = getSchema(buildEditorExtensions(mainCtx()));

const SOURCE = { docId: "doc-1" };

const text = (t: string): JSONContent => ({ type: "text", text: t });
const para = (uuid: string, t: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: [text(t)],
});

/** A minimal `Editor` exposing just `state.doc` — all the snapshot helpers
 *  touch. */
function editorOf(docJson: JSONContent): Editor {
  const doc = PMNode.fromJSON(schema, docJson);
  return { state: { doc } } as unknown as Editor;
}

/** Build a one-doc editor whose single content node is `node`. */
function docOf(node: JSONContent): Editor {
  return editorOf({ type: "doc", content: [node] });
}

describe("snapshotTextObject — capture (BUG #48 parity with cards)", () => {
  it("paragraph → a `paragraph` payload with uuid stripped", () => {
    const ed = docOf(para("aaaa", "hello world"));
    const item = snapshotTextObject(ed, { kind: "paragraph", id: "aaaa" }, SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("paragraph");
    if (item!.payload.kind !== "paragraph") throw new Error("narrow");
    expect(item!.payload.node.type).toBe("paragraph");
    // uuid must be stripped so a pull regenerates a fresh one (no collision).
    expect((item!.payload.node.attrs as { uuid?: unknown } | undefined)?.uuid).toBeUndefined();
  });

  it("blockquote (a non-paragraph top-level node) → a `paragraph` payload of that block", () => {
    const bq: JSONContent = {
      type: "blockquote",
      attrs: { uuid: "bbbb" },
      content: [para("inner", "quoted")],
    };
    const ed = docOf(bq);
    const item = snapshotTextObject(ed, { kind: "blockquote", id: "bbbb" }, SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("paragraph");
    if (item!.payload.kind !== "paragraph") throw new Error("narrow");
    expect(item!.payload.node.type).toBe("blockquote");
  });

  it("heading → a `heading` payload carrying the dominated section", () => {
    const ed = editorOf({
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "h1", level: 1 }, content: [text("Title")] },
        para("body1", "body under the heading"),
      ],
    });
    const item = snapshotTextObject(ed, { kind: "heading", id: "h1" }, SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("heading");
    if (item!.payload.kind !== "heading") throw new Error("narrow");
    // The section = heading + its body block.
    expect(item!.payload.nodes.length).toBe(2);
    expect(item!.payload.nodes[0].type).toBe("heading");
  });

  it("listItem (sub-object) → a `text` payload of the item's inner content (not a bare <li>)", () => {
    const ed = docOf({
      type: "bulletList",
      attrs: { uuid: "ul1" },
      content: [
        { type: "listItem", attrs: { uuid: "li1" }, content: [para("p1", "first item")] },
        { type: "listItem", attrs: { uuid: "li2" }, content: [para("p2", "second item")] },
      ],
    });
    const item = snapshotTextObject(ed, { kind: "listItem", id: "li1" }, SOURCE);
    expect(item).not.toBeNull();
    // A bare listItem can't round-trip at top level → captured as a text slice.
    expect(item!.payload.kind).toBe("text");
    if (item!.payload.kind !== "text") throw new Error("narrow");
    expect(item!.payload.plain).toBe("first item");
  });

  it("linkedRange → a `text` payload of the marked run with the anchor identity stripped", () => {
    const ed = editorOf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "pp" },
          content: [
            { type: "text", text: "before " },
            {
              type: "text",
              text: "marked",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "rng1", kind: "transient" } }],
            },
            { type: "text", text: " after" },
          ],
        },
      ],
    });
    const item = snapshotTextObject(ed, { kind: "linkedRange", id: "rng1" }, SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("text");
    if (item!.payload.kind !== "text") throw new Error("narrow");
    expect(item!.payload.plain).toBe("marked");
    // The linkedAnchor mark must NOT ride along (no orphaned identity).
    const slice = item!.payload.slice as { content?: JSONContent[] };
    const marks =
      slice.content?.flatMap((n) => (Array.isArray(n.marks) ? n.marks : [])) ?? [];
    expect(marks.some((m) => m.type === "linkedAnchor")).toBe(false);
  });

  it("returns null when the source uuid resolves to no node (deleted / unmappable)", () => {
    const ed = docOf(para("aaaa", "hello"));
    expect(snapshotTextObject(ed, { kind: "paragraph", id: "nope" }, SOURCE)).toBeNull();
  });

  it("snapshotLinkedRange returns null for an unmappable anchorId", () => {
    const ed = docOf(para("aaaa", "hello"));
    expect(snapshotLinkedRange(ed, "ghost", SOURCE)).toBeNull();
  });

  it("snapshotSubObjectContent returns null for an empty / unmappable item", () => {
    const ed = docOf(para("aaaa", "hello"));
    expect(snapshotSubObjectContent(ed, "ghost", SOURCE)).toBeNull();
  });
});

// ── Round-trip: every payload re-hydrates against the same schema ─────────
// This mirrors the stack-pull spec's insert helpers (`insertParagraph` →
// `schema.nodeFromJSON`, `insertHeading` → per-node `nodeFromJSON`, `insertText`
// → `Slice.fromJSON`) — the operations that actually pull a snapshot back into
// a doc. If a payload re-hydrates here, the pull spec can drop it.

/** Re-apply the pull spec's fresh-uuid transform (it regenerates uuids on
 *  pull); we only need the JSON to be schema-valid, so a no-op clone suffices
 *  for the assertion. */
function rehydrateParagraph(item: StackItem): PMNode {
  if (item.payload.kind !== "paragraph") throw new Error("not a paragraph payload");
  return schema.nodeFromJSON(item.payload.node as Parameters<typeof schema.nodeFromJSON>[0]);
}

describe("snapshotTextObject — round-trip (pull side re-hydrates the payload)", () => {
  it("paragraph payload → schema.nodeFromJSON (insertParagraph path)", () => {
    const ed = docOf(para("aaaa", "round trip"));
    const item = snapshotTextObject(ed, { kind: "paragraph", id: "aaaa" }, SOURCE)!;
    const node = rehydrateParagraph(item);
    expect(node.type.name).toBe("paragraph");
    expect(node.textContent).toBe("round trip");
  });

  it("blockquote (paragraph payload) → schema.nodeFromJSON re-hydrates the block", () => {
    const ed = docOf({
      type: "blockquote",
      attrs: { uuid: "bbbb" },
      content: [para("inner", "quoted text")],
    });
    const item = snapshotTextObject(ed, { kind: "blockquote", id: "bbbb" }, SOURCE)!;
    const node = rehydrateParagraph(item);
    expect(node.type.name).toBe("blockquote");
    expect(node.textContent).toBe("quoted text");
  });

  it("heading payload → each node re-hydrates (insertHeading path)", () => {
    const ed = editorOf({
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "h1", level: 2 }, content: [text("Sec")] },
        para("b1", "body"),
      ],
    });
    const item = snapshotTextObject(ed, { kind: "heading", id: "h1" }, SOURCE)!;
    if (item.payload.kind !== "heading") throw new Error("narrow");
    const nodes = item.payload.nodes.map((j) =>
      schema.nodeFromJSON(j as Parameters<typeof schema.nodeFromJSON>[0]),
    );
    expect(nodes.map((n) => n.type.name)).toEqual(["heading", "paragraph"]);
  });

  it("text payload (linkedRange) → Slice.fromJSON (insertText path)", () => {
    const ed = editorOf({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "pp" },
          content: [
            {
              type: "text",
              text: "ranged",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "rng1", kind: "transient" } }],
            },
          ],
        },
      ],
    });
    const item = snapshotTextObject(ed, { kind: "linkedRange", id: "rng1" }, SOURCE)!;
    if (item.payload.kind !== "text") throw new Error("narrow");
    const slice = Slice.fromJSON(
      schema,
      item.payload.slice as Parameters<typeof Slice.fromJSON>[1],
    );
    expect(slice.content.textBetween(0, slice.content.size)).toBe("ranged");
  });

  it("text payload (listItem inner content) → Slice.fromJSON re-hydrates", () => {
    const ed = docOf({
      type: "bulletList",
      attrs: { uuid: "ul1" },
      content: [
        { type: "listItem", attrs: { uuid: "li1" }, content: [para("p1", "item body")] },
      ],
    });
    const item = snapshotTextObject(ed, { kind: "listItem", id: "li1" }, SOURCE)!;
    if (item.payload.kind !== "text") throw new Error("narrow");
    const slice = Slice.fromJSON(
      schema,
      item.payload.slice as Parameters<typeof Slice.fromJSON>[1],
    );
    expect(slice.content.textBetween(0, slice.content.size, " ")).toContain("item body");
  });
});
