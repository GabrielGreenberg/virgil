// @vitest-environment jsdom
/**
 * Backlog #49 — ExpEx (and the wider container) grab handles must NOT land ON
 * content. The `⠿` grab-handle hover scan
 * (`resolveTextObjectsAtMouse` → `editorEl.querySelectorAll("[data-uuid]")`)
 * keys on the `data-uuid` attribute in the LIVE DOM. Since typing-latency fix
 * 2d that attribute comes from each NodeView's own `stampTextObjectAttrs`
 * (plus `makeUuidAttr` renderHTML for the NodeView-less listItem/blockquote/
 * codeBlock) — the per-block decoration union is gone — so the authoritative
 * "is this a grabbable text-object" gate is the stamp's
 * `isDeferredInnerParagraph` check: if a container's INNER body paragraph
 * carried `data-uuid`, it would get its own handle anchored at text-start
 * (right of the marker) — the reported phantom SECOND handle:
 *
 *   - SINGLE example `(16) text…` — the block's body `paragraph` is a DIRECT
 *     child of `exampleBlock`; without the gate a stale uuid would surface →
 *     a 2nd handle in the gap right of `(16)`.
 *   - MULTI example `(13)` `a./b.` — each sub-item's body `paragraph` is a
 *     child of `exampleItem`; same phantom handle landing on the `b.` marker.
 *   - The same class for listItem / blockquote / codeBlock body paragraphs.
 *
 * These tests assert against the MOUNTED editor DOM — strictly higher
 * fidelity than the old decoration-set-level pins (the synthetic grab-handle
 * harness is unfaithful per the backlog note). The React-NodeView blocks
 * (figure/graphics/tex) stamp via `ReactNodeViewRenderer`'s `attrs` option
 * and can't mount in jsdom (no ResizeObserver); their deferral-exemption is
 * pinned at the predicate level below and verified live.
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

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
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

function mountDoc(content: Content) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, el };
}

/** All `data-uuid` values live in the editor DOM, paired with their kind. */
function stampedUuids(el: HTMLElement): Array<{ uuid: string; kind: string }> {
  return [...el.querySelectorAll<HTMLElement>("[data-uuid]")].map((n) => ({
    uuid: n.getAttribute("data-uuid") ?? "",
    kind: n.getAttribute("data-text-object-kind") ?? "",
  }));
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
    // graphicsBlock dropped into a single example body stays grabbable —
    // its React NodeView stamps via ReactNodeViewRenderer's attrs option).
    const g = { type: { name: "graphicsBlock" } };
    expect(isDeferredInnerParagraph(g, { type: { name: "exampleBlock" } })).toBe(false);
    expect(isDeferredInnerParagraph(p, null)).toBe(false);
  });
});

describe("NodeView stamps — never expose a deferred inner paragraph (#49, DOM-level)", () => {
  it("SINGLE example: the block carries data-uuid, its body paragraph does NOT", () => {
    // The inner paragraph is given a uuid to simulate a stale/loaded one —
    // it must STILL be suppressed on the DOM.
    const { editor, el } = mountDoc({
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
    try {
      const stamped = stampedUuids(el);
      expect(stamped).toContainEqual({ uuid: "EX16", kind: "exampleBlock" });
      expect(stamped.find((d) => d.uuid === "BODY16")).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });

  it("MULTI example: block + sub-items carry data-uuid, their body paragraphs do NOT", () => {
    const { editor, el } = mountDoc({
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
    try {
      const stamped = stampedUuids(el);
      expect(stamped).toContainEqual({ uuid: "EX13", kind: "exampleBlock" });
      expect(stamped).toContainEqual({ uuid: "ITa", kind: "exampleItem" });
      expect(stamped).toContainEqual({ uuid: "ITb", kind: "exampleItem" });
      expect(stamped.find((d) => d.uuid === "BODYa")).toBeUndefined();
      expect(stamped.find((d) => d.uuid === "BODYb")).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });

  it("LIST ITEM: the listItem carries data-uuid + kind (renderHTML path), its inner paragraph does NOT", () => {
    const { editor, el } = mountDoc({
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
    try {
      const stamped = stampedUuids(el);
      // The list wrapper (NodeView stamp) + the item (makeUuidAttr renderHTML,
      // which now carries the kind the grab-handle resolver reads).
      expect(stamped).toContainEqual({ uuid: "UL", kind: "bulletList" });
      expect(stamped).toContainEqual({ uuid: "LI", kind: "listItem" });
      expect(stamped.find((d) => d.uuid === "LIBODY")).toBeUndefined();
    } finally {
      editor.destroy();
    }
  });

  it("a plain TOP-LEVEL paragraph is stamped (unchanged)", () => {
    const { editor, el } = mountDoc({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "top" }] },
      ],
    });
    try {
      expect(stampedUuids(el)).toContainEqual({ uuid: "P1", kind: "paragraph" });
    } finally {
      editor.destroy();
    }
  });

  it("a uuid minted AFTER mount (backfill AttrStep) appears via update()", () => {
    // The decoration used to add this via the observer diff's addedBlocks;
    // the stamp now rides the NodeView update() the AttrStep fires.
    const { editor, el } = mountDoc({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: null }, content: [{ type: "text", text: "unminted" }] },
      ],
    });
    try {
      expect(el.querySelector('[data-uuid="MINTED"]')).toBeNull();
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "uuid", "MINTED"));
      const stamped = el.querySelector('[data-uuid="MINTED"]');
      expect(stamped).not.toBeNull();
      expect(stamped!.getAttribute("data-text-object-kind")).toBe("paragraph");
    } finally {
      editor.destroy();
    }
  });
});
