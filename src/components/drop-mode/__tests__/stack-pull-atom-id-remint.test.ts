/**
 * Task 138 — a Stack pull must remint Card-bearing inline-atom ids.
 *
 * Footnotes and citations are inline ATOM NODES whose identity lives in node
 * attrs (`footnoteId` / `citationId`, mirrored by the unified `linkId`), NOT in
 * a mark. The snapshot side (`snapshot.ts`) only strips marks + block uuids, so
 * a footnote/citation atom carried its SOURCE id verbatim; a same-doc pull
 * (paste-as-new) then stranded two atoms on one id, and every id-keyed consumer
 * (jump / edit / delete / DocStructureObserver maps) resolved ambiguously.
 *
 * The fix reminting lives on the pull side (`withFreshAtomIds`, seeded from the
 * destination doc's live atom ids). These tests drive the REAL
 * `stackPullDropSpec.applyDrop` against a live EditorState after a REAL
 * `snapshotSelection` / `snapshotParagraph` / `snapshotHeadingSection`, and
 * assert the pulled atom ids differ from the source's and no id appears twice
 * in the resulting doc — for the text, paragraph, AND heading payload paths.
 *
 * Pull is copy-not-pop, so the same-doc scenario keeps the source atom in the
 * doc: the reminted id is guaranteed (not merely likely) to differ from it.
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

// Minimal schema mirroring the real footnote/citation atoms — id attr + the
// unified linkId mirror + a uuid-bearing paragraph/heading.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: "" } },
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: "" }, level: { default: 1 } },
      parseDOM: [{ tag: "h1" }],
      toDOM: () => ["h1", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { footnoteId: { default: "" }, linkId: { default: "" }, number: { default: 1 } },
      parseDOM: [{ tag: "span[data-type=footnote]" }],
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
    citation: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { citationId: { default: "" }, linkId: { default: "" }, command: { default: "" } },
      parseDOM: [{ tag: "span[data-type=citation]" }],
      toDOM: () => ["span", { "data-type": "citation" }, "c"],
    },
  },
});

const SRC_FN = "aaaa";
const SRC_CIT = "bbbb";

/** A paragraph carrying a footnote + citation atom (each with its linkId mirror). */
function atomParagraph(uuid: string): PMNode {
  return schema.node("paragraph", { uuid }, [
    schema.text("see "),
    schema.node("footnote", { footnoteId: SRC_FN, linkId: SRC_FN, number: 1 }),
    schema.text(" and "),
    schema.node("citation", { citationId: SRC_CIT, linkId: SRC_CIT, command: "\\cite{x}" }),
    schema.text(" end"),
  ]);
}

/** Mock editor whose `view.dispatch` truly applies to a live EditorState. */
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

interface AtomHit {
  name: string;
  id: string;
  linkId: string;
}

/** Every footnote/citation atom in a doc, by node name + its id + linkId. */
function collectAtoms(doc: PMNode): AtomHit[] {
  const hits: AtomHit[] = [];
  doc.descendants((node) => {
    if (node.type.name === "footnote") {
      hits.push({
        name: "footnote",
        id: node.attrs.footnoteId as string,
        linkId: node.attrs.linkId as string,
      });
    } else if (node.type.name === "citation") {
      hits.push({
        name: "citation",
        id: node.attrs.citationId as string,
        linkId: node.attrs.linkId as string,
      });
    }
    return true;
  });
  return hits;
}

const CARD_KEY = "stack-pull:item-1";
const SRC = { docId: "docA" };

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos } as unknown as Placement;
}

function pull(editor: Editor, placement: Placement) {
  stackPullDropSpec.applyDrop(placement, CARD_KEY, {
    mainEditor: editor,
  } as unknown as DropCtx);
}

/** Shared assertions: every atom id is unique, both mirrors are coherent, and
 *  the pulled atoms carry NEITHER source id. */
function expectNoCollision(atoms: AtomHit[]) {
  const fns = atoms.filter((a) => a.name === "footnote");
  const cits = atoms.filter((a) => a.name === "citation");
  expect(fns).toHaveLength(2);
  expect(cits).toHaveLength(2);
  // Distinct ids per kind.
  expect(new Set(fns.map((a) => a.id)).size).toBe(2);
  expect(new Set(cits.map((a) => a.id)).size).toBe(2);
  // The unified linkId mirror stays in lock-step with each atom's own id.
  for (const a of atoms) expect(a.linkId).toBe(a.id);
  // No id appears on two different atoms anywhere in the doc.
  const allIds = atoms.map((a) => a.id);
  expect(new Set(allIds).size).toBe(allIds.length);
  // Exactly one footnote/citation still carries the SOURCE id (the un-popped
  // original); the pulled copy carries a fresh one.
  expect(fns.filter((a) => a.id === SRC_FN)).toHaveLength(1);
  expect(cits.filter((a) => a.id === SRC_CIT)).toHaveLength(1);
}

describe("stack-pull — inline-atom id remint (task 138)", () => {
  it("text payload: selection spanning a footnote + citation → pulled atoms get fresh ids", () => {
    const doc = schema.node("doc", null, [atomParagraph("para-1")]);
    const paraContentSize = doc.child(0).content.size;
    // Select the whole paragraph inline range (spans both atoms).
    const harness = liveEditor(doc, { from: 1, to: 1 + paraContentSize });

    const item = snapshotSelection(harness.editor, SRC);
    expect(item?.payload.kind).toBe("text");
    readStackItemMock.mockReturnValue(item);

    // Pull between blocks AFTER the source paragraph (same-doc paste-as-new).
    pull(harness.editor, betweenBlocks(harness.editor, harness.getState().doc.content.size));

    expectNoCollision(collectAtoms(harness.getState().doc));
  });

  it("paragraph payload: a footnote/citation-bearing paragraph → pulled atoms get fresh ids", () => {
    const doc = schema.node("doc", null, [atomParagraph("para-1")]);
    const harness = liveEditor(doc);

    const item = snapshotParagraph(harness.editor, "para-1", SRC);
    expect(item?.payload.kind).toBe("paragraph");
    readStackItemMock.mockReturnValue(item);

    pull(harness.editor, betweenBlocks(harness.editor, harness.getState().doc.content.size));

    expectNoCollision(collectAtoms(harness.getState().doc));
  });

  it("heading payload: a heading section carrying atoms → pulled atoms get fresh ids", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { uuid: "h-1", level: 1 }, [
        schema.text("Title "),
        schema.node("footnote", { footnoteId: SRC_FN, linkId: SRC_FN, number: 1 }),
        schema.node("citation", { citationId: SRC_CIT, linkId: SRC_CIT, command: "\\cite{x}" }),
      ]),
    ]);
    const harness = liveEditor(doc);

    const item = snapshotHeadingSection(harness.editor, "h-1", SRC);
    expect(item?.payload.kind).toBe("heading");
    readStackItemMock.mockReturnValue(item);

    pull(harness.editor, betweenBlocks(harness.editor, harness.getState().doc.content.size));

    expectNoCollision(collectAtoms(harness.getState().doc));
  });

  it("id-less atoms are untouched: a labelRef-style kind with idAttr null keeps its attrs", () => {
    // Sanity: the remint only touches footnoteId/citationId; a citation with an
    // EMPTY id (no identity) is left as-is rather than reminted to a stray id.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { uuid: "p-empty" }, [
        schema.text("x "),
        schema.node("citation", { citationId: "", linkId: "", command: "\\cite{y}" }),
      ]),
    ]);
    const harness = liveEditor(doc);
    const item = snapshotParagraph(harness.editor, "p-empty", SRC);
    readStackItemMock.mockReturnValue(item);

    pull(harness.editor, betweenBlocks(harness.editor, harness.getState().doc.content.size));

    const cits = collectAtoms(harness.getState().doc).filter((a) => a.name === "citation");
    // Both citations (source + pulled) still carry an empty id — an id-less
    // atom has no Card identity to collide, so nothing is minted.
    expect(cits).toHaveLength(2);
    for (const c of cits) expect(c.id).toBe("");
  });
});
