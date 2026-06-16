// @vitest-environment jsdom
/**
 * Chip F — "anchor the unanchored" inline-atom CREATE branch of the shared
 * `inlineAtomMoveSpec` factory.
 *
 * A footnote/citation card can exist with NO marker in any editor (created via
 * the panel "+", before being dropped into the prose). `locateAtom` finds
 * nothing → the move path no-ops. When an opt-in `createAtom` factory is
 * configured, `classifyDrop` returns `apply` (not no-op) and `applyDrop`
 * inserts a freshly-built atom carrying the card's EXISTING id.
 *
 * These tests drive the REAL `inlineAtomMoveSpec` against a live EditorState
 * (a mock view whose `dispatch` actually applies each transaction), and assert:
 *  - classify returns `apply` when no atom is found AND `createAtom` is set;
 *  - applyDrop inserts an atom carrying the card's EXISTING id (NO fresh id);
 *  - the move path is byte-unchanged when `createAtom` is ABSENT (still no-op);
 *  - the inline path never returns `confirm`;
 *  - a declining factory (null — empty draft) falls back to no-op.
 *
 * (The drop-mode util barrel imports `@/lib/storage` transitively; vitest can't
 * resolve its `require("@/lib/storage-fsa")`, so we stub the module wholesale —
 * the same pattern the sibling tests use. No storage fn is called.)
 */

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

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

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { inlineAtomMoveSpec } from "../util/inline-atom-move";
import type { DropCtx, Placement } from "../types";

// Minimal schema with a `selectable:false` footnote atom carrying a
// `footnoteId` attr — mirrors the real footnote atom.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { footnoteId: { default: "" }, number: { default: 1 } },
      parseDOM: [{ tag: "span[data-type=footnote]" }],
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
  },
});

/** A plain doc with NO atom anywhere — the unanchored-card scenario. */
function docWithoutAtom(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("alpha bravo")]),
    schema.node("paragraph", null, [schema.text("charlie delta")]),
  ]);
}

/** Find the footnote atom in a doc, or null when none exists. */
function findAtom(doc: PMNode): { node: PMNode; from: number; to: number } | null {
  let found: { node: PMNode; from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "footnote") {
      found = { node, from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/** Mock editor whose `view.dispatch` truly applies to a live EditorState. */
function liveEditor(doc: PMNode) {
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      get state() {
        return state;
      },
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getState: () => state };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

const CARD_ID = "fn-existing-9z";
const CARD_KEY = `float:card:footnote:${CARD_ID}`;

/** A spec configured with a `createAtom` factory that builds a footnote atom
 *  carrying the card's EXISTING id. Records what id the factory was handed. */
function createSpec(opts?: { decline?: boolean; onCall?: (id: string) => void }) {
  return inlineAtomMoveSpec({
    nodeName: "footnote",
    idAttr: "footnoteId",
    createAtom: ({ id, schema: s }) => {
      opts?.onCall?.(id);
      if (opts?.decline) return null;
      const fnType = s.nodes.footnote;
      if (!fnType) return null;
      // Reuse the card's EXISTING id — NEVER mint a new one.
      return fnType.create({ footnoteId: id, number: 0 });
    },
  });
}

describe("Chip F — inline-atom CREATE branch (anchor the unanchored)", () => {
  it("classifyDrop returns `apply` (NOT no-op) when no atom found AND createAtom is configured", () => {
    const harness = liveEditor(docWithoutAtom());
    const spec = createSpec();
    const decision = spec.classifyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(decision.kind).toBe("apply");
  });

  it("classifyDrop never returns `confirm` on the inline path", () => {
    const harness = liveEditor(docWithoutAtom());
    const spec = createSpec();
    const decision = spec.classifyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(decision.kind).not.toBe("confirm");
  });

  it("applyDrop inserts an atom carrying the card's EXISTING id (no fresh id minted)", () => {
    const harness = liveEditor(docWithoutAtom());
    let handedId: string | null = null;
    const spec = createSpec({ onCall: (id) => (handedId = id) });

    // Before: no atom in the doc.
    expect(findAtom(harness.getState().doc)).toBeNull();

    spec.applyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );

    // The factory was handed the card's EXISTING id, not a fresh one.
    expect(handedId).toBe(CARD_ID);

    // After: exactly one atom, carrying the EXISTING id.
    const atom = findAtom(harness.getState().doc);
    expect(atom).not.toBeNull();
    expect(atom!.node.attrs.footnoteId).toBe(CARD_ID);

    // The insert landed at the drop position.
    expect(atom!.from).toBe(3);

    // Exactly one transaction (single insert — no parking, no delete).
    expect(harness.dispatched).toHaveLength(1);
    expect(harness.dispatched[0].docChanged).toBe(true);
  });

  it("a declining createAtom (empty draft) falls back to no-op — classify + apply both inert", () => {
    const harness = liveEditor(docWithoutAtom());
    const spec = createSpec({ decline: true });

    const decision = spec.classifyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(decision.kind).toBe("no-op");

    spec.applyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    // Nothing inserted, nothing dispatched.
    expect(findAtom(harness.getState().doc)).toBeNull();
    expect(harness.dispatched).toHaveLength(0);
  });

  it("the move path is byte-unchanged when createAtom is ABSENT: no atom + no createAtom ⇒ no-op", () => {
    const harness = liveEditor(docWithoutAtom());
    // A by-id move spec WITHOUT createAtom — the legacy float-header config.
    const spec = inlineAtomMoveSpec({ nodeName: "footnote", idAttr: "footnoteId" });

    const decision = spec.classifyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(decision.kind).toBe("no-op");

    spec.applyDrop(
      inlineCursor(harness.editor, 3),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(findAtom(harness.getState().doc)).toBeNull();
    expect(harness.dispatched).toHaveLength(0);
  });

  it("an EXISTING atom still MOVES silently (apply, never confirm) — create branch does not interfere", () => {
    // Doc that DOES carry the atom (id matches the card) — the re-anchor case.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("home "),
        schema.node("footnote", { footnoteId: CARD_ID }),
        schema.text(" tail"),
      ]),
      schema.node("paragraph", null, [schema.text("target paragraph")]),
    ]);
    const harness = liveEditor(doc);
    let createCalled = false;
    const spec = createSpec({ onCall: () => (createCalled = true) });

    const before = findAtom(harness.getState().doc)!;
    const targetPos = harness.getState().doc.content.size - 2;

    const decision = spec.classifyDrop(
      inlineCursor(harness.editor, targetPos),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );
    expect(decision.kind).toBe("apply"); // a silent move, never confirm
    expect(decision.kind).not.toBe("confirm");

    spec.applyDrop(
      inlineCursor(harness.editor, targetPos),
      CARD_KEY,
      { mainEditor: harness.editor } as unknown as DropCtx,
    );

    // The atom MOVED (still exactly one, now near the target, not its old home).
    const after = findAtom(harness.getState().doc)!;
    expect(after.from).not.toBe(before.from);
    expect(after.node.attrs.footnoteId).toBe(CARD_ID);
    // The create factory was NEVER consulted — the atom existed, so it's a move.
    expect(createCalled).toBe(false);
  });
});
