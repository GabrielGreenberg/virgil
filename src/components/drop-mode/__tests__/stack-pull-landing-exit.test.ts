/**
 * Task 1219 — a Stack pull into a block gap goes through the ONE splice door
 * (`util/mapped-insert.ts`): it advances by what landed and exits on a
 * collapsed caret, never a TextSelection over the pulled blocks (the task 482
 * payload flip: the next grab at that row would lift a text range instead of
 * the block). The inline-cursor pull keeps its run selection — what landed
 * there is text inside an existing block. The PADDED-fit advance is measured
 * against the real schema in `mapped-insert-position.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

const { readStackItemMock } = vi.hoisted(() => ({ readStackItemMock: vi.fn() }));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { stackPullDropSpec } from "../specs/stack-pull";
import type { DropCtx, Placement } from "../types";
import {
  snapshotSelection,
  snapshotParagraph,
  snapshotHeadingSection,
} from "@/lib/stack/snapshot";
import type { StackItem } from "@/lib/stack/types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null }, level: { default: 1 } },
      toDOM: () => ["h1", 0],
    },
    // A DEFERRING container: its inner paragraph carries no identity of its own.
    blockquote: {
      group: "block",
      content: "block+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["blockquote", 0],
    },
    text: { group: "inline" },
  },
});

const P = (uuid: string | null, text: string) =>
  schema.node("paragraph", { uuid }, [schema.text(text)]);
const H = (uuid: string, text: string) =>
  schema.node("heading", { uuid, level: 1 }, [schema.text(text)]);
const BQ = (uuid: string, inner: PMNode) => schema.node("blockquote", { uuid }, [inner]);

function liveEditor(doc: PMNode, selection?: { from: number; to: number }) {
  let state = EditorState.create({
    schema,
    doc,
    selection: selection
      ? TextSelection.create(doc, selection.from, selection.to)
      : undefined,
  });
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, getState: () => state };
}

const CARD_KEY = "stack-pull:item-1";
const SRC = { docId: "docA" };

/** Pull `item` into the gap AFTER the doc's first block (a gap with a block on
 *  BOTH sides, so a mis-advanced cursor would be visible in the tail). */
function pullIntoFirstGap(h: ReturnType<typeof liveEditor>, item: StackItem | null) {
  expect(item).not.toBeNull();
  readStackItemMock.mockReturnValue(item);
  const insertPos = h.getState().doc.firstChild!.nodeSize;
  const placement = {
    kind: "between-blocks",
    editor: h.editor,
    insertPos,
  } as unknown as Placement;
  stackPullDropSpec.applyDrop(placement, CARD_KEY, {
    mainEditor: h.editor,
  } as unknown as DropCtx);
  return insertPos;
}

function expectCaretAtLanding(h: ReturnType<typeof liveEditor>, insertPos: number, tail: string) {
  const { doc, selection } = h.getState();
  // The exit state is a CARET — a non-empty selection over the pulled blocks
  // makes the next grab at this row a text-lift (task 482's payload flip).
  expect(selection.empty).toBe(true);
  expect(selection.from).toBe(insertPos + 1);
  // The advance is correct: the block after the gap is untouched and last.
  expect(doc.lastChild!.attrs.uuid).toBe("tail");
  expect(doc.lastChild!.textContent).toBe(tail);
}

describe("stack-pull — a between-blocks pull exits on a caret (task 1219)", () => {
  it("paragraph payload", () => {
    const h = liveEditor(schema.node("doc", null, [P("p1", "alpha"), P("tail", "omega")]));
    const item = snapshotParagraph(h.editor, "p1", SRC);
    const at = pullIntoFirstGap(h, item);
    expect(h.getState().doc.childCount).toBe(3);
    expectCaretAtLanding(h, at, "omega");
  });

  it("heading-section payload (a multi-node run)", () => {
    const h = liveEditor(
      schema.node("doc", null, [H("h1", "Intro"), P("b1", "one"), P("tail", "omega")]),
    );
    // Capture the section, then pull it into the gap after the heading.
    const item = snapshotHeadingSection(h.editor, "h1", SRC);
    const at = pullIntoFirstGap(h, item);
    // The section runs to the next heading or doc end, so it carries all 3.
    expect(h.getState().doc.childCount).toBe(3 + 3);
    expectCaretAtLanding(h, at, "omega");
  });

  it("multi-block text payload", () => {
    const doc = schema.node("doc", null, [
      P("p1", "alpha"),
      BQ("q1", P(null, "quoted")),
      P("tail", "omega"),
    ]);
    const h = liveEditor(doc, { from: 2, to: doc.content.size - 2 });
    const item = snapshotSelection(h.editor, SRC);
    expect(item?.payload.kind).toBe("text");
    const at = pullIntoFirstGap(h, item);
    expect(h.getState().doc.childCount).toBe(3 + 3);
    expectCaretAtLanding(h, at, "omega");
  });

  it("an INLINE-cursor text pull still selects the run it merged (text in a host block)", () => {
    const h = liveEditor(schema.node("doc", null, [P("p1", "alpha"), P("tail", "omega")]), {
      from: 2,
      to: 4,
    });
    const item = snapshotSelection(h.editor, SRC);
    readStackItemMock.mockReturnValue(item);
    const placement = { kind: "inline-cursor", editor: h.editor, pos: 9 } as unknown as Placement;
    stackPullDropSpec.applyDrop(placement, CARD_KEY, {
      mainEditor: h.editor,
    } as unknown as DropCtx);
    const { doc, selection } = h.getState();
    expect(doc.lastChild!.textContent).toBe("olpmega");
    expect(doc.textBetween(selection.from, selection.to)).toBe("lp");
  });
});
