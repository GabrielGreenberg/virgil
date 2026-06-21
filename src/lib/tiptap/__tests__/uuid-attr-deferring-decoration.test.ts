// @vitest-environment jsdom
/**
 * Backlog #49 — ExpEx (and the wider container) grab handles must NOT land ON
 * content. The `⠿` grab-handle hover scan
 * (`resolveTextObjectsAtMouse` → `editorEl.querySelectorAll("[data-uuid]")`)
 * keys on the `data-uuid` node-attribute DECORATION this module emits. So the
 * authoritative "is this a grabbable text-object" gate is `buildUuidDecorations`:
 * if it decorates a container's INNER body paragraph, that paragraph gets its
 * own handle anchored at text-start (right of the marker) — the reported
 * phantom SECOND handle:
 *
 *   - SINGLE example `(16) text…` — the block's body `paragraph` is a DIRECT
 *     child of `exampleBlock`; without the gate it mints/keeps a uuid → a 2nd
 *     handle in the gap right of `(16)`.
 *   - MULTI example `(13)` `a./b.` — each sub-item's body `paragraph` is a child
 *     of `exampleItem`; same phantom handle landing on the `b.` marker.
 *   - The same class for listItem / blockquote / codeBlock body paragraphs.
 *
 * The fix gates `buildUuidDecorations` on `isDeferredInnerParagraph`
 * (DEFERRING_PARENTS, now incl. `exampleBlock`) — the SSOT predicate the mint
 * sites already use — so a deferred body paragraph is never decorated EVEN IF it
 * carries a stale/loaded uuid. These tests lock that at the decoration layer
 * (the synthetic-DOM grab-handle harness is unfaithful per the backlog note).
 *
 * (Storage stub: the extension barrel transitively imports `@/lib/storage`,
 * whose `require("@/lib/storage-fsa")` vitest can't resolve.)
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
import type { Decoration } from "@tiptap/pm/view";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildUuidDecorations } from "@/lib/tiptap/uuid-attr";
import {
  DEFERRING_PARENTS,
  isDeferredInnerParagraph,
} from "@/lib/anchor-uuid";

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

/** All `data-uuid` values the decoration set emits, paired with their kind. */
function decoratedUuids(doc: PMNode): Array<{ uuid: string; kind: string }> {
  const set = buildUuidDecorations(doc);
  return set
    .find()
    .map((d: Decoration) => {
      const attrs = (
        d as Decoration & { type?: { attrs?: Record<string, string> } }
      ).type?.attrs;
      return {
        uuid: attrs?.["data-uuid"] ?? "",
        kind: attrs?.["data-text-object-kind"] ?? "",
      };
    })
    .filter((x) => x.uuid);
}

describe("DEFERRING_PARENTS — exampleBlock is now in the set (the #49 gap)", () => {
  it("includes exampleBlock alongside the original three containers", () => {
    expect(DEFERRING_PARENTS.has("exampleBlock")).toBe(true);
    expect(DEFERRING_PARENTS.has("exampleItem")).toBe(true);
    expect(DEFERRING_PARENTS.has("listItem")).toBe(true);
    expect(DEFERRING_PARENTS.has("blockquote")).toBe(true);
    expect(DEFERRING_PARENTS.has("codeBlock")).toBe(true);
  });

  it("isDeferredInnerParagraph: a paragraph in a deferring parent defers", () => {
    const p = { type: { name: "paragraph" } };
    expect(isDeferredInnerParagraph(p, { type: { name: "exampleBlock" } })).toBe(true);
    expect(isDeferredInnerParagraph(p, { type: { name: "exampleItem" } })).toBe(true);
    expect(isDeferredInnerParagraph(p, { type: { name: "listItem" } })).toBe(true);
    // A top-level paragraph (parent = doc) is NOT deferred.
    expect(isDeferredInnerParagraph(p, { type: { name: "doc" } })).toBe(false);
    // A non-paragraph child of a deferring parent is NOT deferred (e.g. a
    // graphicsBlock dropped into a single example body stays grabbable).
    const g = { type: { name: "graphicsBlock" } };
    expect(isDeferredInnerParagraph(g, { type: { name: "exampleBlock" } })).toBe(false);
    expect(isDeferredInnerParagraph(p, null)).toBe(false);
  });
});

describe("buildUuidDecorations — never decorates a deferred inner paragraph (#49)", () => {
  it("SINGLE example: the block is decorated, its body paragraph is NOT (no 2nd handle)", () => {
    // A single `\ex` holds its body paragraph DIRECTLY (the `(16)` case). The
    // inner paragraph is given a uuid to simulate a stale/loaded one — it must
    // STILL be suppressed.
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "EX16", kind: "single", number: 16 },
          content: [
            {
              type: "paragraph",
              attrs: { uuid: "BODY16" },
              content: [{ type: "text", text: "There's a biscuit" }],
            },
          ],
        },
      ],
    });
    const decos = decoratedUuids(doc);
    // The exampleBlock IS the grabbable text-object.
    expect(decos).toContainEqual({ uuid: "EX16", kind: "exampleBlock" });
    // Its body paragraph is NOT decorated → no phantom handle right of `(16)`.
    expect(decos.find((d) => d.uuid === "BODY16")).toBeUndefined();
  });

  it("MULTI example: each exampleItem is decorated, its body paragraph is NOT (no handle on b.)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "EX13", kind: "multi", number: 13 },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "ITa", subLabel: "a" },
                  content: [
                    {
                      type: "paragraph",
                      attrs: { uuid: "BODYa" },
                      content: [{ type: "text", text: "alpha" }],
                    },
                  ],
                },
                {
                  type: "exampleItem",
                  attrs: { uuid: "ITb", subLabel: "b" },
                  content: [
                    {
                      type: "paragraph",
                      attrs: { uuid: "BODYb" },
                      content: [{ type: "text", text: "beta" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const decos = decoratedUuids(doc);
    // The block + both sub-items are grabbable.
    expect(decos).toContainEqual({ uuid: "EX13", kind: "exampleBlock" });
    expect(decos).toContainEqual({ uuid: "ITa", kind: "exampleItem" });
    expect(decos).toContainEqual({ uuid: "ITb", kind: "exampleItem" });
    // NEITHER sub-item's body paragraph is decorated (the on-the-`b.` handle).
    expect(decos.find((d) => d.uuid === "BODYa")).toBeUndefined();
    expect(decos.find((d) => d.uuid === "BODYb")).toBeUndefined();
  });

  it("LIST ITEM: the listItem is decorated, its inner paragraph is NOT (same class)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "UL" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "LI" },
              content: [
                {
                  type: "paragraph",
                  attrs: { uuid: "LIBODY" },
                  content: [{ type: "text", text: "item" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const decos = decoratedUuids(doc);
    expect(decos).toContainEqual({ uuid: "LI", kind: "listItem" });
    expect(decos.find((d) => d.uuid === "LIBODY")).toBeUndefined();
  });

  it("a SINGLE example whose body is a non-paragraph (graphicsBlock) keeps it grabbable", () => {
    // Feature A2: a picture dropped into a single example body is its own
    // anchor — only `paragraph` defers, so the graphicsBlock stays decorated.
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "EXG", kind: "single", number: 5 },
          content: [
            {
              type: "graphicsBlock",
              attrs: { uuid: "PIC", command: "\\includegraphics{x}" },
            },
          ],
        },
      ],
    });
    const decos = decoratedUuids(doc);
    expect(decos).toContainEqual({ uuid: "EXG", kind: "exampleBlock" });
    expect(decos.find((d) => d.uuid === "PIC")).toBeTruthy();
  });

  it("a plain TOP-LEVEL paragraph is still decorated (unchanged)", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "top" }] },
      ],
    });
    const decos = decoratedUuids(doc);
    expect(decos).toContainEqual({ uuid: "P1", kind: "paragraph" });
  });
});
