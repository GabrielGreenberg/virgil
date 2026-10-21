/**
 * Task 1170 — a whole-block surface is BOUND to its one root node, and its
 * write-back refusals are never silent.
 *
 * Drives the REAL float extension stack (`buildEditorExtensions({ surface:
 * "float" })`) headlessly, the exact stack the Example card and the block
 * floats mount, with each surface's declared `boundRoot`.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { soleRoot, type BoundRootPredicate } from "@/lib/tiptap/bound-root";
import {
  landFloatWrite,
  nextWriteRefusal,
  refuseWrite,
} from "@/lib/float-write-back";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function floatEditor(content: JSONContent, boundRoot: BoundRootPredicate | null) {
  const ed = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions({
      spellcheckPortRef: null,
      surface: "float",
      editable: true,
      cardContext: true,
      callbacks: {},
      boundRoot,
    }),
    content,
  });
  editors.push(ed);
  return ed;
}

const para = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});

const exampleDoc = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "exampleBlock",
      attrs: { uuid: "ex1" },
      content: [
        {
          type: "exampleItemList",
          content: [
            { type: "exampleItem", attrs: { uuid: "it1" }, content: [para("The cat sat.")] },
            { type: "exampleItem", attrs: { uuid: "it2" }, content: [para("The dog ran.")] },
          ],
        },
      ],
    },
  ],
});

const listDoc = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para("one")] },
        { type: "listItem", content: [para("two")] },
      ],
    },
  ],
});

const rootName = (ed: Editor) => {
  const d = ed.state.doc;
  return d.childCount === 1 ? d.firstChild!.type.name : `${d.childCount} blocks`;
};

describe("BoundRoot — the audit probe, unbound (the bug)", () => {
  it("without a binding, Cmd-A + type replaces the exampleBlock with a paragraph", () => {
    const ed = floatEditor(exampleDoc(), null);
    ed.commands.selectAll();
    ed.view.dispatch(ed.state.tr.insertText("New example"));
    expect(rootName(ed)).toBe("paragraph");
  });
});

describe("BoundRoot — example surfaces (card + example float)", () => {
  const bound = soleRoot("exampleBlock");

  it("Cmd-A + type rewrites inside the same exampleBlock", () => {
    const ed = floatEditor(exampleDoc(), bound);
    ed.commands.selectAll();
    ed.view.dispatch(ed.state.tr.insertText("New example"));
    expect(rootName(ed)).toBe("exampleBlock");
    expect(ed.state.doc.firstChild!.attrs.uuid).toBe("ex1");
    expect(ed.state.doc.textContent).toBe("New example");
  });

  it("Cmd-A + Backspace empties the exampleBlock, never removes it", () => {
    const ed = floatEditor(exampleDoc(), bound);
    ed.commands.selectAll();
    ed.commands.keyboardShortcut("Backspace");
    expect(rootName(ed)).toBe("exampleBlock");
    expect(ed.state.doc.textContent).toBe("");
  });

  it("Cmd-A + deleteSelection empties the exampleBlock", () => {
    const ed = floatEditor(exampleDoc(), bound);
    ed.commands.selectAll();
    ed.commands.deleteSelection();
    expect(rootName(ed)).toBe("exampleBlock");
  });

  it("a transaction that would unbind the root is refused (doc unchanged)", () => {
    const ed = floatEditor(exampleDoc(), bound);
    const before = ed.state.doc;
    const tr = ed.state.tr.replaceWith(
      0,
      ed.state.doc.content.size,
      ed.schema.nodes.paragraph.create(),
    );
    ed.view.dispatch(tr);
    expect(ed.state.doc.eq(before)).toBe(true);
  });

  it("fails OPEN: a surface not seeded in its bound shape is not frozen", () => {
    const ed = floatEditor({ type: "doc", content: [para("x"), para("y")] }, bound);
    ed.view.dispatch(ed.state.tr.insertText("!", 1, 1));
    expect(ed.state.doc.textContent).toBe("!xy");
  });
});

describe("BoundRoot — list float (either list kind)", () => {
  const bound = soleRoot("bulletList", "orderedList");

  it("Cmd-A + type keeps the list", () => {
    const ed = floatEditor(listDoc(), bound);
    ed.commands.selectAll();
    ed.view.dispatch(ed.state.tr.insertText("only"));
    expect(rootName(ed)).toBe("bulletList");
    expect(ed.state.doc.textContent).toBe("only");
  });

  it("the list-type toggle (bullet → ordered) still lands", () => {
    const ed = floatEditor(listDoc(), bound);
    ed.commands.setTextSelection(2);
    ed.commands.toggleOrderedList();
    expect(rootName(ed)).toBe("orderedList");
  });
});

describe("BoundRoot — paragraph float", () => {
  const bound = soleRoot("paragraph");

  it("Enter cannot split the paragraph into a second block the write-back would drop", () => {
    const ed = floatEditor({ type: "doc", content: [para("Hello world")] }, bound);
    ed.commands.setTextSelection(6);
    ed.commands.splitBlock();
    expect(rootName(ed)).toBe("paragraph");
    expect(ed.state.doc.textContent).toBe("Hello world");
  });

  it("Cmd-A + type replaces the paragraph's text", () => {
    const ed = floatEditor({ type: "doc", content: [para("Hello")] }, bound);
    ed.commands.selectAll();
    ed.view.dispatch(ed.state.tr.insertText("Bye"));
    expect(rootName(ed)).toBe("paragraph");
    expect(ed.state.doc.textContent).toBe("Bye");
  });
});

describe("landFloatWrite — the one whole-block write door", () => {
  const main = () => floatEditor({ type: "doc", content: [para("abc")] }, null);

  it("lands a write, tagged as a float write outside history", () => {
    const ed = main();
    let tagged: unknown = null;
    let history: unknown = null;
    ed.on("transaction", ({ transaction }) => {
      tagged = transaction.getMeta(FLOAT_WRITE_META);
      history = transaction.getMeta("addToHistory");
    });
    const p = ed.schema.nodes.paragraph.create(null, ed.schema.text("xyz!"));
    const out = landFloatWrite(ed, "f1", () => ({ from: 0, to: 5, content: p }));
    expect(out).toEqual({ status: "landed", from: 0, to: p.nodeSize });
    expect(ed.state.doc.textContent).toBe("xyz!");
    expect(tagged).toBe("f1");
    expect(history).toBe(false);
  });

  it("a stated refusal and a thrown rebuild are both REFUSED (doc untouched)", () => {
    const ed = main();
    expect(landFloatWrite(ed, "f1", () => refuseWrite("nope"))).toEqual({
      status: "refused",
      reason: "nope",
    });
    const thrown = landFloatWrite(ed, "f1", () => {
      throw new Error("invalid content");
    });
    expect(thrown.status).toBe("refused");
    expect(ed.state.doc.textContent).toBe("abc");
  });

  it("a missing source is `no-source`, an identical write is `unchanged`", () => {
    const ed = main();
    expect(landFloatWrite(ed, "f1", () => null).status).toBe("no-source");
    expect(landFloatWrite(null, "f1", () => null).status).toBe("no-source");
    const same = ed.state.doc.firstChild!;
    expect(
      landFloatWrite(ed, "f1", () => ({ from: 0, to: same.nodeSize, content: same })).status,
    ).toBe("unchanged");
  });

  it("nextWriteRefusal: refusal raises, landed/unchanged clear, no-source keeps", () => {
    expect(nextWriteRefusal(null, { status: "refused", reason: "r" })).toBe("r");
    expect(nextWriteRefusal("r", { status: "landed", from: 0, to: 1 })).toBeNull();
    expect(nextWriteRefusal("r", { status: "no-source" })).toBe("r");
    // Task 1223: `unchanged` means the surface equals main — undoing a refused
    // edit back to main's content leaves nothing rejected to describe.
    expect(nextWriteRefusal("r", { status: "unchanged" })).toBeNull();
  });
});

// ── Task 1170 CENSUS: no whole-block write-back refuses silently ────────────
//
// Every float body / the Example card writes back through `landFloatWrite`
// and renders its refusal. A body that dispatches a FLOAT_WRITE_META write
// itself must be listed here with the reason its writes cannot be silently
// refused.
const OWN_DOOR: Record<string, string> = {
  "linked-range-body.tsx":
    "own planner (`planLinkedRangeWriteBack`) with its own LinkedRangeRefusal report channel",
  "source-pod-body.tsx":
    "attr-only setNodeMarkup of a string attr — no content rebuild that can be refused",
};

describe("whole-block write-back CENSUS (task 1170)", () => {
  const dir = join(process.cwd(), "src/text-objects/floats");
  const bodies = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  const files: [string, string][] = [
    ...bodies.map((f) => [f, readFileSync(join(dir, f), "utf8")] as [string, string]),
    [
      "ExampleCard.tsx",
      readFileSync(join(process.cwd(), "src/panels/Examples/ExampleCard.tsx"), "utf8"),
    ],
  ];

  it("no float body or card swallows a write-back failure", () => {
    const offenders = files
      .filter(([, src]) => /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\/\*[^*]*swallow/.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("only declared own-door bodies dispatch FLOAT_WRITE_META writes directly", () => {
    const direct = files
      .filter(([, src]) => /setMeta\(\s*FLOAT_WRITE_META/.test(src))
      .map(([f]) => f)
      .sort();
    expect(direct).toEqual(Object.keys(OWN_DOOR).sort());
  });

  it("every surface that writes through the door renders the refusal", () => {
    const silent = files
      .filter(([, src]) => src.includes("landFloatWrite("))
      .filter(
        ([f, src]) =>
          !src.includes("<WriteRefusedBanner") &&
          !(f === "ExampleCard.tsx" && src.includes("data-example-write-error")),
      )
      .map(([f]) => f);
    expect(silent).toEqual([]);
  });
});
