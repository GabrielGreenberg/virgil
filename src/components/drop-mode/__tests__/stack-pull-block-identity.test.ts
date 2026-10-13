/**
 * Task 1101 — a Stack pull STATES its own block identity, for every content
 * payload, with no reliance on the `BlockUuidBackfill` net.
 *
 * The editor here has NO backfill: whatever uuid a pulled block ends up with,
 * the pull put there. Before 1101 the paragraph/heading mint never ran (the
 * capture deleted the `uuid` key and the mint keyed on its presence, so every
 * pulled block landed `null`), and a text slice was never minted at all (it
 * landed wearing the SOURCE's uuids — a same-doc pull duplicated them).
 *
 * Drives the REAL `snapshot*` capture → REAL `stackPullDropSpec.applyDrop`
 * against a live EditorState, the same harness as the atom-id remint suite.
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

/** Pull `item` into the END of `editor`'s doc and return the blocks it added. */
function pullAtEnd(h: ReturnType<typeof liveEditor>, item: StackItem | null) {
  expect(item).not.toBeNull();
  readStackItemMock.mockReturnValue(item);
  const before = h.getState().doc;
  const live = new Set<string>();
  before.descendants((n) => {
    if (typeof n.attrs.uuid === "string") live.add(n.attrs.uuid);
  });
  const placement = {
    kind: "between-blocks",
    editor: h.editor,
    insertPos: before.content.size,
  } as unknown as Placement;
  stackPullDropSpec.applyDrop(placement, CARD_KEY, {
    mainEditor: h.editor,
  } as unknown as DropCtx);
  const after = h.getState().doc;
  const added: PMNode[] = [];
  for (let i = before.childCount; i < after.childCount; i++) added.push(after.child(i));
  expect(added.length).toBeGreaterThan(0);
  return { added, live, after };
}

/** Every eligible pulled block has a fresh, non-null id that was not live
 *  before; a deferred inner paragraph has none; no id is held twice. */
function expectStatedIdentity(added: PMNode[], live: Set<string>, after: PMNode) {
  for (const block of added) {
    const id = block.attrs.uuid;
    expect(typeof id).toBe("string");
    expect(id).toBeTruthy();
    expect(live.has(id)).toBe(false);
    if (block.type.name === "blockquote") {
      expect(block.firstChild!.attrs.uuid).toBeNull();
    }
  }
  const all: string[] = [];
  after.descendants((n) => {
    if (typeof n.attrs.uuid === "string") all.push(n.attrs.uuid);
  });
  expect(new Set(all).size).toBe(all.length);
}

describe("stack-pull — the pull states block identity (task 1101)", () => {
  it("paragraph payload: the pulled block is minted fresh (no backfill net)", () => {
    const h = liveEditor(schema.node("doc", null, [P("p1", "alpha"), P("p2", "beta")]));
    const item = snapshotParagraph(h.editor, "p1", SRC);
    const { added, live, after } = pullAtEnd(h, item);
    expect(added).toHaveLength(1);
    expectStatedIdentity(added, live, after);
  });

  it("heading payload: heading + body are each minted fresh", () => {
    const h = liveEditor(
      schema.node("doc", null, [H("h1", "Intro"), P("b1", "one"), P("b2", "two")]),
    );
    const item = snapshotHeadingSection(h.editor, "h1", SRC);
    const { added, live, after } = pullAtEnd(h, item);
    expect(added).toHaveLength(3);
    expectStatedIdentity(added, live, after);
  });

  it("multi-block text payload: every block is minted fresh, never the source's ids", () => {
    const doc = schema.node("doc", null, [
      P("p1", "alpha"),
      BQ("q1", P(null, "quoted")),
      P("p2", "beta"),
    ]);
    // Select from inside "alpha" to inside "beta" — an open three-block slice.
    const h = liveEditor(doc, { from: 2, to: doc.content.size - 2 });
    const item = snapshotSelection(h.editor, SRC);
    expect(item?.payload.kind).toBe("text");
    // The capture carries no identity at all.
    expect(JSON.stringify(item!.payload)).not.toMatch(/"(p1|p2|q1)"/);
    const { added, live, after } = pullAtEnd(h, item);
    expect(added).toHaveLength(3);
    expectStatedIdentity(added, live, after);
  });

  it("a stored envelope with NO uuid key (pre-1101 capture) is still minted", () => {
    const h = liveEditor(schema.node("doc", null, [P("p1", "alpha")]));
    const legacy: StackItem = {
      id: "item-1",
      capturedAt: "2026-01-01T00:00:00.000Z",
      source: SRC,
      payload: {
        kind: "paragraph",
        node: { type: "paragraph", content: [{ type: "text", text: "old" }] },
      },
    } as StackItem;
    const { added, live, after } = pullAtEnd(h, legacy);
    expectStatedIdentity(added, live, after);
  });
});
