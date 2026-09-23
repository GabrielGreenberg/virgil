// @vitest-environment jsdom
//
// Task 271 — container-anchored `reanchorByText` + request-mark reconcile.
//
// A Mode-A card filed on text INSIDE a DEFERRING_PARENTS container (listItem /
// blockquote / exampleItem / exampleBlock) anchors to the CONTAINER uuid, not
// the deferred inner paragraph (resolveAnchorableNode / `@/lib/anchor-uuid`).
// `reanchorByText`'s uuid-scoped path must therefore map the char hit over the
// container's TEXT DESCENDANTS — its direct children are block paragraphs, not
// text, so the old per-CHILD `forEach` never advanced and returned null.
//
// The open-AI-request wash used to share that path (it stamped a
// `pending-ai-request` mark through `reanchorByText`) and needed a deferral-
// aware PRESENT scan to avoid strip/re-stamp thrash. Task 667 made the wash a
// DECORATION, so it asks for the container's RANGE instead of searching for its
// TEXT — the container case is now correct by construction and there is no
// mark to thrash. The legs below survive as that claim's proof.
//
// Storage stub: the extension barrel transitively imports `@/lib/storage`,
// whose `require("@/lib/storage-fsa")` vitest can't resolve.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { reanchorByText, type Link } from "@/links/links";
import {
  requestWashTargets,
  type RequestWashCardLike,
} from "@/links/_shared/request-wash";
import type { TextObjectKind } from "@/text-objects/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
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

// ── the open-AI-request wash for a CONTAINER-anchored card (tasks 271 + 667) ──
function modeARequestCard(
  id: string,
  containerUuid: string,
  kind = "note",
): RequestWashCardLike {
  const link: Link = {
    id: `lnk-${id}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      // Any non-"linkedRange" TextObjectKind → Mode-A (getTextAnchor === null).
      targetKind: "listItem" as TextObjectKind,
      textObjectIds: [containerUuid],
    },
    target: { type: "card", ref: { kind: "note", id }, },
    createdAt: "",
  };
  return { id, kind, aiRequest: true, links: [link] };
}

/** The document text every wash band covers, concatenated. */
function washedText(editor: Editor, cards: RequestWashCardLike[]): string {
  return requestWashTargets(editor, cards)
    .map((t) => editor.state.doc.textBetween(t.from, t.to, "\n"))
    .join("");
}

describe("the open-AI-request wash covers a container card's inner text (tasks 271 + 667)", () => {
  it("washes the inner text of a listItem-anchored card", () => {
    const editor = mountDoc(listItemDoc("LI", "hello world"));
    const card = modeARequestCard("card-1", "LI");
    expect(washedText(editor, [card])).toBe("hello world");
    editor.destroy();
  });

  it("is a pure derivation: the same cards give the same band twice, and the doc is untouched", () => {
    const editor = mountDoc(listItemDoc("LI", "hello world"));
    const card = modeARequestCard("card-1", "LI");
    const before = JSON.stringify(editor.state.doc.toJSON());

    expect(washedText(editor, [card])).toBe("hello world");
    // The mark carrier could strip-and-restamp here (its PRESENT scan resolved
    // the mark to the DEFERRED inner paragraph's absent uuid, never equal to
    // the container `desired`). A derivation has no such failure mode — and it
    // cannot have mutated the document to find out.
    expect(washedText(editor, [card])).toBe("hello world");
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    editor.destroy();
  });

  it("deferral-explicit: a STRAY uuid on the inner paragraph does not break the container match", () => {
    // Anomaly guard — the card anchors to the CONTAINER uuid, so the band must
    // come from the container's range even when the deferred inner paragraph
    // carries a uuid of its own.
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
    expect(washedText(editor, [card])).toBe("hello world");
    editor.destroy();
  });

  it("bare-paragraph card still washes (no-regression)", () => {
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
    expect(washedText(editor, [card])).toBe("top level para");
    editor.destroy();
  });
});
