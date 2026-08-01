// @vitest-environment jsdom
//
// Task 271 — container-anchored `reanchorByText` + request-mark reconcile.
//
// A Mode-A card filed on text INSIDE a DEFERRING_PARENTS container (listItem /
// blockquote / exampleItem / exampleBlock) anchors to the CONTAINER uuid, not
// the deferred inner paragraph (resolveAnchorableNode / `@/lib/anchor-uuid`).
// `reanchorByText`'s uuid-scoped path must therefore map the char hit over the
// container's TEXT DESCENDANTS — its direct children are block paragraphs, not
// text, so the old per-CHILD `forEach` never advanced and returned null. And
// `reconcileRequestMarks`' PRESENT scan must resolve the mark's position to the
// same CONTAINER uuid (deferral-aware climb), or the freshly-stamped mark is
// stripped-and-restamped every reconcile (thrash).
//
// Storage stub: the extension barrel transitively imports `@/lib/storage`,
// whose `require("@/lib/storage-fsa")` vitest can't resolve.
import { describe, it, expect, vi } from "vitest";

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
import { reanchorByText, type Link } from "@/links/links";
import {
  reconcileRequestMarks,
  requestAnchorId,
  type RequestMarkCardLike,
} from "@/links/_shared/request-marks";
import type { TextObjectKind } from "@/text-objects/types";

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

function mountDoc(content: Content): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
}

/** The concatenated text of every run carrying the `linkedAnchor` with this
 *  anchorId — container-agnostic (walks the whole doc, not just paragraphs). */
function markedText(editor: Editor, anchorId: string): string {
  let text = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      text += node.text ?? "";
    }
    return true;
  });
  return text;
}

// ── Container doc builders (the container carries the anchor uuid; the inner
//    body paragraph defers, so it carries no uuid — the real load shape). ──────
function listItemDoc(uuid: string, text: string): Content {
  return {
    type: "doc",
    content: [
      {
        type: "bulletList",
        attrs: { uuid: "UL" },
        content: [
          {
            type: "listItem",
            attrs: { uuid },
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          },
        ],
      },
    ],
  };
}

function blockquoteDoc(uuid: string, text: string): Content {
  return {
    type: "doc",
    content: [
      {
        type: "blockquote",
        attrs: { uuid },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    ],
  };
}

/** SINGLE example `\ex` — the body paragraph is a DIRECT child of exampleBlock. */
function exampleBlockDoc(uuid: string, text: string): Content {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid, kind: "single", number: 1 },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    ],
  };
}

/** MULTI example `\pex` — the body paragraph lives under exampleItem. */
function exampleItemDoc(uuid: string, text: string): Content {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "EXB", kind: "multi", number: 1 },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid, subLabel: "a" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("reanchorByText — CONTAINER-anchored uuid scoping (task 271)", () => {
  const CASES: Array<[string, (u: string, t: string) => Content]> = [
    ["listItem", listItemDoc],
    ["blockquote", blockquoteDoc],
    ["exampleBlock (single \\ex)", exampleBlockDoc],
    ["exampleItem (multi \\pex)", exampleItemDoc],
  ];

  for (const [label, build] of CASES) {
    it(`resolves char→pos inside a ${label} container (was null)`, () => {
      const editor = mountDoc(build("C1", "hello world"));
      const rec = reanchorByText(
        editor,
        "note",
        "hello world",
        "anc-c1",
        "card-c1",
        null,
        "C1", // scope to the CONTAINER uuid
      );
      expect(rec).not.toBeNull();
      expect(rec!.paragraphId).toBe("C1");
      // The mark landed on the INNER text — not dropped to null.
      expect(markedText(editor, "anc-c1")).toBe("hello world");
      editor.destroy();
    });

    it(`maps a SUB-range inside a ${label} container`, () => {
      const editor = mountDoc(build("C2", "the quick brown fox"));
      const rec = reanchorByText(
        editor,
        "note",
        "brown fox",
        "anc-c2",
        "card-c2",
        null,
        "C2",
      );
      expect(rec).not.toBeNull();
      expect(markedText(editor, "anc-c2")).toBe("brown fox");
      editor.destroy();
    });
  }
});

describe("reanchorByText — bare-paragraph + codeBlock unchanged (no-regression pin)", () => {
  it("bare top-level paragraph: single text run at offset 0", () => {
    const editor = mountDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P1" },
          content: [{ type: "text", text: "plain paragraph text" }],
        },
      ],
    });
    const rec = reanchorByText(editor, "note", "paragraph", "anc-p", "card-p", null, "P1");
    expect(rec).not.toBeNull();
    expect(markedText(editor, "anc-p")).toBe("paragraph");
    editor.destroy();
  });

  it("codeBlock: NOT in the affected set — returns null (code content forbids marks)", () => {
    // The task lists codeBlock as SAFE: its direct children ARE text (the offset
    // walk resolves `from`/`to` identically to a bare paragraph), but code
    // content has `marks: ""` in the schema, so the `linkedAnchor` setMark can
    // never land → `reanchorByText` returns null. This is pre-existing and
    // UNCHANGED by the descendants-walk fix (a container-body paragraph, by
    // contrast, freely accepts the mark). The walk math itself is pinned by the
    // bare-paragraph case above + the atom-interleave cases in
    // reanchor-uuid-scoped.test.ts.
    const editor = mountDoc({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { uuid: "CB" },
          content: [{ type: "text", text: "const x = 42" }],
        },
      ],
    });
    const rec = reanchorByText(editor, "note", "const x", "anc-cb", "card-cb", null, "CB");
    expect(rec).toBeNull();
    editor.destroy();
  });
});

// ── reconcileRequestMarks: the open-AI-request blue wash for a container card ──
function modeARequestCard(
  id: string,
  containerUuid: string,
  kind = "note",
): RequestMarkCardLike {
  const link: Link = {
    id: `lnk-${id}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      // Any non-"linkedRange" TextObjectKind → Mode-A (getTextAnchor === null).
      targetKind: "listItem" as TextObjectKind,
      textObjectIds: [containerUuid],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id }, },
    createdAt: "",
  };
  return { id, kind, aiRequest: true, links: [link] };
}

describe("reconcileRequestMarks — container-anchored wash paints + survives (task 271)", () => {
  it("stamps the pending-ai-request mark on the inner text of a listItem card", () => {
    const editor = mountDoc(listItemDoc("LI", "hello world"));
    const card = modeARequestCard("card-1", "LI");
    const anchorId = requestAnchorId("card-1");

    reconcileRequestMarks(editor, [card]);
    // The blue wash is painted on the inner text — previously null → never painted.
    expect(markedText(editor, anchorId)).toBe("hello world");
    editor.destroy();
  });

  it("does NOT thrash: the mark survives a SECOND reconcile (present-scan climbs to the container uuid)", () => {
    const editor = mountDoc(listItemDoc("LI", "hello world"));
    const card = modeARequestCard("card-1", "LI");
    const anchorId = requestAnchorId("card-1");

    reconcileRequestMarks(editor, [card]);
    expect(markedText(editor, anchorId)).toBe("hello world");

    // Second pass: PRESENT resolves the mark to "LI" === desired → skip, not
    // strip+restamp. If the scan read the immediate (deferred, uuid-less) inner
    // paragraph, present would be "" ≠ "LI" → the mark would be stripped here.
    reconcileRequestMarks(editor, [card]);
    expect(markedText(editor, anchorId)).toBe("hello world");
    editor.destroy();
  });

  it("deferral-explicit: a STRAY uuid on the inner paragraph does not break the container match", () => {
    // Anomaly guard — even if the deferred inner paragraph carries a uuid, the
    // present scan must skip it (isDeferredInnerParagraph) and climb to the
    // container, matching `desired`. A plain first-uuid climb would bind "STRAY".
    const editor = mountDoc({
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
                  attrs: { uuid: "STRAY" },
                  content: [{ type: "text", text: "hello world" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const card = modeARequestCard("card-1", "LI");
    const anchorId = requestAnchorId("card-1");

    reconcileRequestMarks(editor, [card]);
    reconcileRequestMarks(editor, [card]); // must not thrash despite the stray uuid
    expect(markedText(editor, anchorId)).toBe("hello world");
    editor.destroy();
  });

  it("bare-paragraph card still paints + survives (no-regression)", () => {
    const editor = mountDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P1" },
          content: [{ type: "text", text: "top level para" }],
        },
      ],
    });
    const card = modeARequestCard("card-2", "P1");
    const anchorId = requestAnchorId("card-2");

    reconcileRequestMarks(editor, [card]);
    reconcileRequestMarks(editor, [card]);
    expect(markedText(editor, anchorId)).toBe("top level para");
    editor.destroy();
  });
});
