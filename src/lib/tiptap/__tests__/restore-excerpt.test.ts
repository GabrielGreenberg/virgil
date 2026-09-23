// @vitest-environment jsdom
/**
 * Task 106 — the RETURN leg of the capture law.
 *
 * `canMountInCardBody` (task 308) makes the document prove nothing is lost when
 * content moves INTO an archive card. These pin the other direction: an archive
 * card body is the only copy of prose the user deleted from the document, so
 * the restore must report honestly whether the content landed — the caller
 * drops that only copy on the strength of the answer.
 *
 * The failure is silent by construction. TipTap's `insertContent` does not
 * throw on content its schema can't build; it emits a content error and
 * inserts nothing. A `void` return therefore looks identical for "restored" and
 * "destroyed", which is exactly how the pre-106 handler could delete an archive
 * entry whose text never reached the page.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { restoreExcerptAtCaret } from "../restore-excerpt";

const PARA_UUID = "p00001";

function mainCtx(anchored: Iterable<string> = [PARA_UUID]): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set(anchored) },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];

const PLAIN_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: PARA_UUID },
      content: [{ type: "text", text: "alpha" }],
    },
  ],
};

function mountEditor(
  content: unknown = PLAIN_DOC,
  anchored: Iterable<string> = [PARA_UUID],
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(anchored)),
    content: content as never,
  });
  editors.push(editor);
  return editor;
}

/** Put the caret inside the first node of `type` and return the doc snapshot. */
function caretInside(editor: Editor, type: string): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === type) pos = p + 1;
    return pos === -1;
  });
  expect(pos, `no ${type} in the fixture`).toBeGreaterThan(-1);
  editor.commands.setTextSelection(pos + 1);
  return pos;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const excerpt = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Recovered" }] },
    { type: "paragraph", content: [{ type: "text", text: "body text" }] },
  ],
};

describe("restoreExcerptAtCaret", () => {
  it("a real excerpt lands and is reported as landed", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("Recovered");
    expect(editor.state.doc.textContent).toContain("body text");
  });

  it("content the document's schema cannot hold is REFUSED, doc untouched", () => {
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    const alien = {
      type: "doc",
      content: [{ type: "notAThingTheSchemaKnows", content: [{ type: "text", text: "x" }] }],
    };
    expect(restoreExcerptAtCaret(editor, alien)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("no editor / no content is a refusal, never a silent success", () => {
    expect(restoreExcerptAtCaret(null, excerpt)).toBe(false);
    expect(restoreExcerptAtCaret(mountEditor(), null)).toBe(false);
  });

  it("an empty excerpt reports NOT landed (nothing to hand back)", () => {
    const editor = mountEditor();
    expect(restoreExcerptAtCaret(editor, { type: "doc", content: [] })).toBe(false);
  });

  it("a live SELECTION in the document is not consumed by the restore", () => {
    // `insertContent` replaces a non-empty selection. Restoring while the user
    // has prose selected would therefore delete that prose — the same
    // destruction this whole path exists to prevent, aimed at a different
    // victim. The restore must be purely additive.
    const editor = mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 }); // "alpha"
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("alpha");
    expect(editor.state.doc.textContent).toContain("Recovered");
  });

  // ── The caret-safety leg ────────────────────────────────────────────────
  // Every case below CHANGES the document if the insert is allowed through, so
  // the "did it land?" test reports success and the caller then retires the
  // only copy of the excerpt. Refusing is the only honest answer.

  const EXAMPLE_DOC = {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "E", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "i1" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "first item" }] }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
    ],
  };

  it("REFUSES inside an example item — the fitter would split the example in two", () => {
    const editor = mountEditor(EXAMPLE_DOC);
    caretInside(editor, "exampleItem");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("REFUSES inside a heading — a split would mint a phantom section", () => {
    const editor = mountEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, uuid: "h1" }, content: [{ type: "text", text: "Section" }] },
        { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
      ],
    });
    caretInside(editor, "heading");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("REFUSES inside a list item — the list would be torn in two", () => {
    const editor = mountEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          ],
        },
        { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: "prose" }] },
      ],
    });
    caretInside(editor, "listItem");
    const before = editor.state.doc.toJSON();
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("ALLOWS a plain top-level paragraph — splitting it is ordinary editing", () => {
    const editor = mountEditor(EXAMPLE_DOC);
    caretInside(editor, "paragraph");
    // …but only the top-level one: `caretInside` finds the example's inner
    // paragraph first, so aim explicitly at the last block instead.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(editor.state.doc.textContent).toContain("Recovered");
    // The example survived intact — still exactly one exampleBlock.
    let examples = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock") examples += 1;
      return true;
    });
    expect(examples).toBe(1);
  });

  it("content-INVALID JSON is refused, not thrown (leg 1 accepts more than the insert)", () => {
    // `schema.nodeFromJSON` builds through `NodeType.create`, which does not
    // check content expressions; `insertContentAt` calls `node.check()` outside
    // its own try/catch. A hand- or agent-edited archive.json can therefore
    // reach the insert and throw into a click handler — a refusal nobody sees.
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    expect(() =>
      restoreExcerptAtCaret(editor, {
        type: "doc",
        content: [{ type: "exampleItemList", content: [] }],
      }),
    ).not.toThrow();
    expect(restoreExcerptAtCaret(editor, {
      type: "doc",
      content: [{ type: "exampleItemList", content: [] }],
    })).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("a STRING is refused at the door — the migrator is the one place a legacy string becomes content (task 565)", () => {
    // RENEGOTIATED. Two pre-565 legs pinned "a legacy plain-text snippet lands
    // as prose" and "a `% ` snippet lands as a latexComment" — a string arm
    // no production caller could reach: `useArchive.migrateSnippet` runs
    // `normalizeRichContent` over every snippet at load and its string arm
    // converts to JSON, so nothing downstream ever holds a string. The arm
    // was dead AND a hazard: it handed the string to `insertContentAt`, which
    // parses it as HTML (measured: `a < b & <b>bold</b>` inserted a BOLD
    // mark), and its `% ` branch re-derived the comment carrier by hand. The
    // door is typed JSON now; a string that somehow arrives is a REFUSAL over
    // an untouched document, never a parse.
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    const asString = (s: string) => s as unknown as Parameters<typeof restoreExcerptAtCaret>[1];
    expect(restoreExcerptAtCaret(editor, asString("plain snippet"))).toBe(false);
    expect(restoreExcerptAtCaret(editor, asString("% a latex comment"))).toBe(false);
    expect(restoreExcerptAtCaret(editor, asString("a < b & <b>bold</b>"))).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

describe("restoreExcerptAtCaret — the content half of leg 1 (task 563)", () => {
  it("a body the schema NAMES but cannot HOLD is refused at the door, doc untouched", () => {
    // Two orphan list items at doc level: the pre-563 capture shape, still
    // reachable from a hand- or agent-edited archive.json. `nodeFromJSON`
    // builds it (every type is known), so leg 1 used to wave it through and the
    // catch under the insert was the only net. `canMountInSchema` asks about
    // content now, so it is a stated refusal rather than a caught throw.
    const editor = mountEditor();
    const before = editor.state.doc.toJSON();
    const orphans = {
      type: "doc",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
      ],
    };
    expect(restoreExcerptAtCaret(editor, orphans)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("the same items captured WITH their list restore as that list (the control)", () => {
    const editor = mountEditor();
    editor.commands.setTextSelection(3);
    const list = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
          ],
        },
      ],
    };
    expect(restoreExcerptAtCaret(editor, list)).toBe(true);
    const types: string[] = [];
    editor.state.doc.forEach((n) => types.push(n.type.name));
    expect(types).toContain("bulletList");
    expect(types.filter((t) => t === "bulletList")).toHaveLength(1);
  });
});

describe("restoreExcerptAtCaret — the landing half (task 564)", () => {
  // TipTap's `insertContentAt` special-cases a collapsed caret in an EMPTY
  // textblock when the payload is all blocks: it widens the range by one on
  // each side (`from -= 1; to += 1`) and REPLACES the paragraph node. For a
  // blank line nobody refers to that is the nicer result — no stray blank
  // line left behind. For a blank line a card is ANCHORED to it is silent
  // data loss: the paragraph's uuid leaves the document, the anchor guard
  // stands down by task 367's rule (the removed node IS the remedy), and every
  // card anchored there goes to the unanchored bin — while the door reports
  // SUCCESS, since the document did change. And that uuid is DURABLE: the
  // serializer emits an empty uuid-bearing paragraph as its own `%!v:<uuid>`
  // line, the parser reads it back as exactly that node, and `assignUuids`
  // strips a uuid only on a DEFERRED inner paragraph. Task 367 built its
  // whole section around that shape.
  const EMPTY = "e0000";

  function sandwich(attrs: Record<string, unknown>) {
    return {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "pre00" }, content: [{ type: "text", text: "before" }] },
        { type: "paragraph", attrs },
        { type: "paragraph", attrs: { uuid: "post0" }, content: [{ type: "text", text: "after" }] },
      ],
    };
  }

  /** Caret inside the (empty) second top-level block. */
  function caretInSecondBlock(editor: Editor): void {
    const first = editor.state.doc.child(0).nodeSize;
    editor.commands.setTextSelection(first + 1);
    expect(editor.state.selection.$from.parent.childCount).toBe(0);
  }

  /**
   * The top-level blocks, as (type, uuid, text) — the shape every leg reads.
   * `BlockUuidBackfill` mints a fresh id for every excerpt block on the way
   * in; those are reported as `"*"` so a leg pins the FIXTURE's identities
   * and not the mint.
   */
  const FIXTURE_IDS = new Set(["pre00", EMPTY, "post0"]);
  function blocks(editor: Editor): Array<[string, string | null, string]> {
    const out: Array<[string, string | null, string]> = [];
    editor.state.doc.forEach((n) => {
      const uuid = (n.attrs.uuid as string | null) ?? null;
      out.push([n.type.name, uuid && !FIXTURE_IDS.has(uuid) ? "*" : uuid, n.textContent]);
    });
    return out;
  }

  it("an ANCHORED empty paragraph is left standing and the excerpt lands AFTER it", () => {
    const editor = mountEditor(sandwich({ uuid: EMPTY }), [EMPTY]);
    caretInSecondBlock(editor);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(blocks(editor)).toEqual([
      ["paragraph", "pre00", "before"],
      ["paragraph", EMPTY, ""],
      ["heading", "*", "Recovered"],
      ["paragraph", "*", "body text"],
      ["paragraph", "post0", "after"],
    ]);
  });

  it("…and the paragraph never LEFT — the guard had nothing to resurrect (one node, in place)", () => {
    // A resurrection puts the uuid back at the deletion site; the pre-564
    // door produced no resurrection at all (task 367's stand-down), so the
    // distinction here is between a paragraph that stayed and one that was
    // re-minted. Ask the structural diff's own instrument: count the nodes
    // carrying the id after the restore, and check it is still block #1.
    const editor = mountEditor(sandwich({ uuid: EMPTY }), [EMPTY]);
    caretInSecondBlock(editor);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    const holders = blocks(editor).filter(([, uuid]) => uuid === EMPTY);
    expect(holders).toHaveLength(1);
    expect(blocks(editor)[1]).toEqual(["paragraph", EMPTY, ""]);
  });

  it("CONTROL: an empty paragraph nobody anchors is REPLACED in place — no stray blank line", () => {
    const editor = mountEditor(sandwich({ uuid: EMPTY }), ["pre00"]);
    caretInSecondBlock(editor);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(blocks(editor)).toEqual([
      ["paragraph", "pre00", "before"],
      ["heading", "*", "Recovered"],
      ["paragraph", "*", "body text"],
      ["paragraph", "post0", "after"],
    ]);
  });

  it("CONTROL: a caret in a NON-empty paragraph still splits it (today's behaviour, byte for byte)", () => {
    const editor = mountEditor(sandwich({ uuid: EMPTY }), [EMPTY]);
    editor.commands.setTextSelection(4); // "bef|ore"
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(blocks(editor).map(([t, , text]) => [t, text])).toEqual([
      ["paragraph", "bef"],
      ["heading", "Recovered"],
      ["paragraph", "body text"],
      ["paragraph", "ore"],
      ["paragraph", ""],
      ["paragraph", "after"],
    ]);
  });

  it("a TITLED empty paragraph is not a shape the app keeps — the cleaner retires it either way, so the door has no title rung", () => {
    // `EmptyParagraphTitleCleaner` (title.ts) holds the invariant "no empty
    // titled paragraph survives an edit": on any touched block OR ITS
    // SIBLINGS it clears the title and the uuid. An excerpt landing beside
    // the paragraph is exactly such an edit, so an insert-AFTER rung keyed on
    // `parTitle` would buy a stray, now-untitled blank line and nothing else.
    // The door therefore asks only the anchored set; this leg pins that a
    // title alone changes nothing about the landing.
    const editor = mountEditor(sandwich({ uuid: EMPTY, parTitle: "Interlude" }), ["pre00"]);
    caretInSecondBlock(editor);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(blocks(editor)).toEqual([
      ["paragraph", "pre00", "before"],
      ["heading", "*", "Recovered"],
      ["paragraph", "*", "body text"],
      ["paragraph", "post0", "after"],
    ]);
    let titled = 0;
    editor.state.doc.descendants((n) => {
      if (n.attrs.parTitle) titled += 1;
      return true;
    });
    expect(titled).toBe(0);
  });

  it("a surface with NO anchor guard mounted answers 'nothing anchored' and keeps the in-place replace", () => {
    // A card body / float never mounts MarginaliaAnchorGuard. The reader
    // must answer with an empty set there rather than throw or guess.
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions({
        ...mainCtx([EMPTY]),
        anchoredUuidsRef: undefined,
      } as unknown as EditorExtensionsCtx),
      content: sandwich({ uuid: EMPTY }) as never,
    });
    editors.push(editor);
    caretInSecondBlock(editor);
    expect(restoreExcerptAtCaret(editor, excerpt)).toBe(true);
    expect(blocks(editor).map(([t]) => t)).toEqual(["paragraph", "heading", "paragraph", "paragraph"]);
  });
});
