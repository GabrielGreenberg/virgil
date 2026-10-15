// @vitest-environment jsdom
/**
 * Task 1127 — typing inside a numbered example must not wake the expex
 * renumberer, whose body walks the whole document twice.
 *
 * Before the fix the renumberer's gate keyed off `contentChangedUuids`, whose
 * nearest-uuid attribution names the EXAMPLE BLOCK for every keystroke in a
 * plain `\ex` body or a gloss cell (the inner paragraph defers its identity to
 * the block; gloss rows/cells carry none) — so each such keystroke ran both
 * `doc.descendants` walks. The gate now reads the observer's two precise
 * facts: `diffExamplesRecomputable` (numbers) and `exampleShapeChanged`
 * (letters / colCount / widths).
 *
 * The other half of the contract is that the renumberer still WAKES on every
 * shape edit — including the old gate's inverse miss (member 2): a gloss cell
 * added inside a `\pex` item attributed to the ITEM's uuid, so `colCount`
 * upkeep never ran.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

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

const cell = (text: string) => ({
  type: "glossCell",
  content: [{ type: "text", text }],
});

const gloss = (glossId: string, colCount: number) => ({
  type: "exampleGloss",
  attrs: { glossId, colCount },
  content: [
    { type: "alignedGlossRow", attrs: { tier: "gla" }, content: [cell("wa"), cell("ta")] },
    { type: "alignedGlossRow", attrs: { tier: "glb" }, content: [cell("I"), cell("TOP")] },
  ],
});

/** ~300 prose blocks around three examples: a plain `\ex` body, a plain `\ex`
 *  with a gloss, and a `\pex` whose second item holds a gloss. */
function mount(): Editor {
  const prose = (i: number) => ({
    type: "paragraph",
    attrs: { uuid: `p${i}` },
    content: [{ type: "text", text: `Paragraph ${i}.` }],
  });
  const content = {
    type: "doc",
    content: [
      ...Array.from({ length: 100 }, (_, i) => prose(i)),
      {
        type: "exampleBlock",
        attrs: { uuid: "exPlain", kind: "single", number: 1 },
        content: [{ type: "paragraph", content: [{ type: "text", text: "plain body" }] }],
      },
      ...Array.from({ length: 100 }, (_, i) => prose(100 + i)),
      {
        type: "exampleBlock",
        attrs: { uuid: "exGloss", kind: "single", number: 2 },
        content: [{ type: "paragraph", content: [{ type: "text", text: "glossed" }] }, gloss("g1", 2)],
      },
      {
        type: "exampleBlock",
        attrs: { uuid: "exPex", kind: "multi", number: 3 },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "it1", subLabel: "a" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
              },
              {
                type: "exampleItem",
                attrs: { uuid: "it2", subLabel: "b" },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "second" }] },
                  gloss("g2", 2),
                ],
              },
            ],
          },
        ],
      },
      ...Array.from({ length: 100 }, (_, i) => prose(200 + i)),
    ],
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
}

/** Position just inside the first text-bearing node matching `pred`. */
function posIn(editor: Editor, pred: (n: PMNode, parent: PMNode | null) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((n, pos, parent) => {
    if (found >= 0) return false;
    if (pred(n, parent)) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error("target not found");
  return found;
}

function findNode(editor: Editor, pred: (n: PMNode) => boolean): { node: PMNode; pos: number } {
  let hit: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (hit) return false;
    if (pred(n)) {
      hit = { node: n, pos };
      return false;
    }
    return true;
  });
  if (!hit) throw new Error("node not found");
  return hit;
}

/** Count WHOLE-DOCUMENT `descendants` walks while `fn` runs. */
function countDocWalks(fn: () => void): number {
  let walks = 0;
  const orig = PMNode.prototype.descendants;
  const spy = vi.spyOn(PMNode.prototype, "descendants").mockImplementation(function (
    this: PMNode,
    ...args: Parameters<PMNode["descendants"]>
  ) {
    if (this.type.name === "doc") walks++;
    return orig.apply(this, args);
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return walks;
}

function typeAt(editor: Editor, pos: number, chars: string): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  for (const ch of chars) {
    editor.view.dispatch(editor.state.tr.insertText(ch));
  }
}

let editor: Editor;
afterEach(() => editor?.destroy());

describe("task 1127 — typing inside an example does not walk the document", () => {
  it("typing in a plain \\ex body runs zero whole-doc walks", () => {
    editor = mount();
    const pos = posIn(editor, (n, parent) => n.type.name === "paragraph" && parent?.attrs.uuid === "exPlain");
    expect(countDocWalks(() => typeAt(editor, pos, "hello"))).toBe(0);
  });

  it("typing in a gloss cell runs zero whole-doc walks", () => {
    editor = mount();
    const pos = posIn(editor, (n) => n.type.name === "glossCell");
    expect(countDocWalks(() => typeAt(editor, pos, "xyz"))).toBe(0);
  });

  it("typing in a \\pex item and in a nested gloss cell runs zero whole-doc walks", () => {
    editor = mount();
    const itemPos = posIn(editor, (n, parent) => n.type.name === "paragraph" && parent?.attrs.uuid === "it1");
    expect(countDocWalks(() => typeAt(editor, itemPos, "abc"))).toBe(0);
    const g2 = findNode(editor, (n) => n.type.name === "exampleGloss" && n.attrs.glossId === "g2");
    expect(countDocWalks(() => typeAt(editor, g2.pos + 3, "q"))).toBe(0);
  });
});

describe("task 1127 — the renumberer still wakes on every shape edit", () => {
  it("adding a gloss cell to a plain example's row updates colCount", () => {
    editor = mount();
    const g1 = findNode(editor, (n) => n.type.name === "exampleGloss" && n.attrs.glossId === "g1");
    const rowEnd = g1.pos + 1 + g1.node.child(0).nodeSize - 1;
    const { schema } = editor.state;
    editor.view.dispatch(editor.state.tr.insert(rowEnd, schema.nodes.glossCell.create(null, schema.text("ga"))));
    expect(findNode(editor, (n) => n.attrs.glossId === "g1").node.attrs.colCount).toBe(3);
  });

  it("member 2: adding a gloss cell inside a \\pex item updates colCount", () => {
    editor = mount();
    const g2 = findNode(editor, (n) => n.type.name === "exampleGloss" && n.attrs.glossId === "g2");
    const rowEnd = g2.pos + 1 + g2.node.child(0).nodeSize - 1;
    const { schema } = editor.state;
    editor.view.dispatch(editor.state.tr.insert(rowEnd, schema.nodes.glossCell.create(null, schema.text("ga"))));
    expect(findNode(editor, (n) => n.attrs.glossId === "g2").node.attrs.colCount).toBe(3);
  });

  it("adding an item re-letters, and deleting one re-letters back", () => {
    editor = mount();
    const it1 = findNode(editor, (n) => n.attrs.uuid === "it1");
    const { schema } = editor.state;
    const fresh = schema.nodes.exampleItem.create(
      { uuid: "it0", subLabel: "" },
      schema.nodes.paragraph.create(null, schema.text("zeroth")),
    );
    editor.view.dispatch(editor.state.tr.insert(it1.pos, fresh));
    const labels = () => {
      const out: string[] = [];
      editor.state.doc.descendants((n) => {
        if (n.type.name === "exampleItem") out.push(n.attrs.subLabel as string);
        return true;
      });
      return out;
    };
    expect(labels()).toEqual(["a", "b", "c"]);
    const it0 = findNode(editor, (n) => n.attrs.uuid === "it0");
    editor.view.dispatch(editor.state.tr.delete(it0.pos, it0.pos + it0.node.nodeSize));
    expect(labels()).toEqual(["a", "b"]);
  });

  it("reordering examples renumbers them", () => {
    editor = mount();
    const plain = findNode(editor, (n) => n.attrs.uuid === "exPlain");
    const tr = editor.state.tr;
    tr.delete(plain.pos, plain.pos + plain.node.nodeSize);
    tr.insert(tr.doc.content.size, plain.node);
    editor.view.dispatch(tr);
    const numbers: Record<string, unknown> = {};
    editor.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock") numbers[n.attrs.uuid as string] = n.attrs.number;
      return false;
    });
    expect(numbers).toEqual({ exGloss: 1, exPex: 2, exPlain: 3 });
  });
});
