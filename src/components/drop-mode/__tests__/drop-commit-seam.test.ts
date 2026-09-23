// @vitest-environment jsdom
/**
 * **Task 648 — a drop that mutates in two steps measures its FIRST step, and
 * refuses as a unit when that step did not happen.**
 *
 * `view.dispatch(tr)` is a REQUEST. Every plugin's `filterTransaction` runs
 * first, and a veto — Virgil's own `readOnlyEnforcer` is one — drops the
 * transaction with no throw, no step, and the state object unchanged. Three
 * shipped gestures then performed a SECOND effect on the strength of the first:
 *
 *  1. the cross-editor inline-atom MOVE: insert into the target, then delete
 *     from the source. `readOnlyEnforcer` is mounted on MAIN alone, so the veto
 *     is ASYMMETRIC — main as target means the insert dies and the delete lands,
 *     taking the footnote's BODY with it (the body IS the atom's `content` attr);
 *  2. the "anchor the unanchored" CREATE: insert the marker, then `onAnchored`,
 *     a SIDECAR write that never passes through ProseMirror and so can never be
 *     filtered. A vetoed insert left the card in NEITHER panel list;
 *  3. the cross-editor text-range move, the same shape one door over.
 *
 * And under all three, the grab addressed its atom by KIND + POSITION, so two
 * adjacent same-kind atoms (`\cite{a}\cite{b}`) or a collab shift could make the
 * commit move the neighbour of the one the user grabbed.
 *
 * The legs below drive the REAL specs. Two failure modes are kept separate on
 * purpose, because they fail at different seams: a READ-ONLY surface (caught
 * before anything is dispatched) and a VETOED dispatch on a writable-looking
 * surface (caught only by measuring the effect). A fix for one is not a fix for
 * the other.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { inlineAtomMoveSpec } from "../util/inline-atom-move";
import { inTextAtomGrabSpec } from "../specs/in-text-atom-grab";
import {
  clearInlineAtomSource,
  stashInlineAtomSource,
} from "../util/inline-atom-source";
import { resolveAtomPos } from "@/lib/tiptap/inline-atom-grab";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import type { DropCtx, Placement } from "../types";

// ── Two vocabularies, as in `cross-editor-adoption.test.ts` ─────────────────
// Separate `Schema` objects so a cross-editor splice is a genuine boundary
// crossing (ProseMirror compares `NodeType`s by IDENTITY).

function schemaWithAtoms() {
  return new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
      text: { group: "inline" },
      footnote: {
        group: "inline",
        inline: true,
        atom: true,
        selectable: false,
        attrs: { footnoteId: { default: "" }, content: { default: null } },
        toDOM: () => ["span", { "data-type": "footnote" }, "1"],
      },
      citation: {
        group: "inline",
        inline: true,
        atom: true,
        selectable: false,
        attrs: { citationId: { default: "" }, command: { default: "" } },
        toDOM: () => ["span", { "data-type": "citation" }, "c"],
      },
    },
  });
}

const MAIN = schemaWithAtoms();
const CARD = schemaWithAtoms();

/** How the editor's `dispatch` behaves — the three cases that matter here. */
type DispatchMode =
  /** A working surface: every transaction applies. */
  | "apply"
  /**
   * The `readOnlyEnforcer` shape: `view.editable` says nothing is wrong, and
   * every DOC-CHANGING transaction is silently dropped. This is the case a
   * read-only check alone cannot see.
   */
  | "veto-doc-changes";

function mockEditor(
  schema: Schema,
  doc: PMNode,
  opts: { editable?: boolean; mode?: DispatchMode } = {},
) {
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      editable: opts.editable ?? true,
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        if (opts.mode === "veto-doc-changes" && tr.docChanged) return;
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getDoc: () => state.doc };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

function atomIds(doc: PMNode, nodeName: string, idAttr: string): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === nodeName) out.push(String(n.attrs?.[idAttr] ?? ""));
    return true;
  });
  return out;
}

function firstNode(doc: PMNode, nodeName: string): PMNode | null {
  let found: PMNode | null = null;
  doc.descendants((n) => {
    if (found) return false;
    if (n.type.name === nodeName) found = n;
    return true;
  });
  return found;
}

const FOOTNOTE_BODY = { type: "doc", content: [{ type: "paragraph" }] };

/** MAIN-schema doc holding one footnote marker whose `content` IS its body. */
function mainWithFootnote() {
  return MAIN.node("doc", null, [
    MAIN.node("paragraph", null, [
      MAIN.text("alpha "),
      MAIN.nodes.footnote.create({ footnoteId: "fn-1", content: FOOTNOTE_BODY }),
    ]),
  ]);
}

/** CARD-schema doc — a card body that CAN name `footnote` (the excerpt scope). */
function cardBody() {
  return CARD.node("doc", null, [
    CARD.node("paragraph", null, [CARD.text("card prose")]),
  ]);
}

const footnoteMove = inlineAtomMoveSpec({
  nodeName: "footnote",
  idAttr: "footnoteId",
});

// ── 1. The cross-editor move refuses as a UNIT ──────────────────────────────

describe("cross-editor inline-atom move — insert or nothing", () => {
  it("TARGET read-only: neither document is touched, and the footnote BODY survives", () => {
    const source = mockEditor(MAIN, mainWithFootnote());
    const target = mockEditor(CARD, cardBody(), { editable: false });
    const ctx = { mainEditor: source.editor } as unknown as DropCtx;

    footnoteMove.applyDrop(
      inlineCursor(target.editor, 1),
      "float:card:footnote:fn-1",
      ctx,
    );

    // Nothing dispatched anywhere — the refusal is BEFORE the insert, because a
    // move whose ends disagree must not deposit a copy.
    expect(target.dispatched).toHaveLength(0);
    expect(source.dispatched).toHaveLength(0);
    const atom = firstNode(source.getDoc(), "footnote");
    expect(atom?.attrs.footnoteId).toBe("fn-1");
    expect(atom?.attrs.content).toEqual(FOOTNOTE_BODY);
  });

  it("SOURCE read-only: no duplicate lands in the target", () => {
    const source = mockEditor(MAIN, mainWithFootnote(), { editable: false });
    const target = mockEditor(CARD, cardBody());
    const ctx = { mainEditor: source.editor } as unknown as DropCtx;

    footnoteMove.applyDrop(
      inlineCursor(target.editor, 1),
      "float:card:footnote:fn-1",
      ctx,
    );

    expect(atomIds(target.getDoc(), "footnote", "footnoteId")).toEqual([]);
    expect(atomIds(source.getDoc(), "footnote", "footnoteId")).toEqual(["fn-1"]);
  });

  it("VETOED insert on a writable-looking target: the source delete does NOT run", () => {
    // The shape a read-only check cannot catch — `view.editable` is true and the
    // enforcer drops the transaction anyway. Only measuring the EFFECT sees it.
    const source = mockEditor(MAIN, mainWithFootnote());
    const target = mockEditor(CARD, cardBody(), { mode: "veto-doc-changes" });
    const ctx = { mainEditor: source.editor } as unknown as DropCtx;

    footnoteMove.applyDrop(
      inlineCursor(target.editor, 1),
      "float:card:footnote:fn-1",
      ctx,
    );

    // The insert was attempted (and swallowed); the source was never touched.
    expect(target.dispatched.length).toBeGreaterThan(0);
    expect(atomIds(target.getDoc(), "footnote", "footnoteId")).toEqual([]);
    const atom = firstNode(source.getDoc(), "footnote");
    expect(atom?.attrs.footnoteId).toBe("fn-1");
    expect(atom?.attrs.content).toEqual(FOOTNOTE_BODY);
  });

  it("control: with both surfaces live, the atom MOVES and the body rides along", () => {
    const source = mockEditor(MAIN, mainWithFootnote());
    const target = mockEditor(CARD, cardBody());
    const ctx = { mainEditor: source.editor } as unknown as DropCtx;

    footnoteMove.applyDrop(
      inlineCursor(target.editor, 1),
      "float:card:footnote:fn-1",
      ctx,
    );

    expect(atomIds(source.getDoc(), "footnote", "footnoteId")).toEqual([]);
    const moved = firstNode(target.getDoc(), "footnote");
    expect(moved?.attrs.footnoteId).toBe("fn-1");
    expect(moved?.attrs.content).toEqual(FOOTNOTE_BODY);
  });
});

// ── 2. The CREATE branch's sidecar reconcile hangs off the EFFECT ───────────

describe("create-drop — `onAnchored` follows the insert, never precedes it", () => {
  const createSpec = inlineAtomMoveSpec({
    nodeName: "footnote",
    idAttr: "footnoteId",
    cardApiKind: "footnote",
    createAtom: ({ id, schema: s }) =>
      s.nodes.footnote.create({ footnoteId: id, content: FOOTNOTE_BODY }),
  });

  function ctxWithCardApi(main: Editor, onAnchored: (id: string) => void) {
    return {
      mainEditor: main,
      atomCards: {
        footnote: {
          atomAttrsFor: () => ({ content: FOOTNOTE_BODY }),
          onAnchored,
        },
      },
    } as unknown as DropCtx;
  }

  it("a VETOED insert leaves the card parked — `onAnchored` is not called", () => {
    const main = mockEditor(
      MAIN,
      MAIN.node("doc", null, [MAIN.node("paragraph", null, [MAIN.text("prose")])]),
      { mode: "veto-doc-changes" },
    );
    const onAnchored = vi.fn();

    createSpec.applyDrop(
      inlineCursor(main.editor, 1),
      "float:card:footnote:fn-new",
      ctxWithCardApi(main.editor, onAnchored),
    );

    expect(atomIds(main.getDoc(), "footnote", "footnoteId")).toEqual([]);
    // The sidecar write never passes through ProseMirror, so nothing else could
    // have stopped it: the card keeps `unanchored`/`archived` and still shows in
    // the atomless list, instead of vanishing from both.
    expect(onAnchored).not.toHaveBeenCalled();
  });

  it("a READ-ONLY surface does not even attempt the insert", () => {
    const main = mockEditor(
      MAIN,
      MAIN.node("doc", null, [MAIN.node("paragraph", null, [MAIN.text("prose")])]),
      { editable: false },
    );
    const onAnchored = vi.fn();

    createSpec.applyDrop(
      inlineCursor(main.editor, 1),
      "float:card:footnote:fn-new",
      ctxWithCardApi(main.editor, onAnchored),
    );

    expect(main.dispatched).toHaveLength(0);
    expect(onAnchored).not.toHaveBeenCalled();
  });

  it("control: a landed insert DOES reconcile the card", () => {
    const main = mockEditor(
      MAIN,
      MAIN.node("doc", null, [MAIN.node("paragraph", null, [MAIN.text("prose")])]),
    );
    const onAnchored = vi.fn();

    createSpec.applyDrop(
      inlineCursor(main.editor, 1),
      "float:card:footnote:fn-new",
      ctxWithCardApi(main.editor, onAnchored),
    );

    expect(atomIds(main.getDoc(), "footnote", "footnoteId")).toEqual(["fn-new"]);
    expect(onAnchored).toHaveBeenCalledWith("fn-new");
  });
});

// ── 3. The grabbed atom is named by IDENTITY, not by position ───────────────

/** `<p>alpha omega[cite a][cite b]</p>` — two ADJACENT same-kind atoms. */
function docWithTwoCitations() {
  return MAIN.node("doc", null, [
    MAIN.node("paragraph", null, [
      MAIN.text("alpha omega"),
      MAIN.nodes.citation.create({ citationId: "c-a", command: "\\cite{a}" }),
      MAIN.nodes.citation.create({ citationId: "c-b", command: "\\cite{b}" }),
    ]),
  ]);
}

const CITE_A_POS = 12;
const CITE_B_POS = 13;

describe("two adjacent same-kind atoms — the one you grab is the one that moves", () => {
  it("resolveAtomPos picks the atom whose DOM id matches, not the neighbour at pos-1", () => {
    const { editor } = mockEditor(MAIN, docWithTwoCitations());
    // `posAtDOM` on an inline leaf lands at or adjacent to the node; here it
    // lands one short, so the kind-only probe would answer the FIRST citation.
    const view = {
      posAtDOM: () => CITE_A_POS,
      state: editor.state,
    } as unknown as Parameters<typeof resolveAtomPos>[0];
    const atomEl = { dataset: { citationId: "c-b" } } as unknown as HTMLElement;

    expect(resolveAtomPos(view, atomEl, ATOM_REGISTRY.citation)).toBe(CITE_B_POS);
  });

  it("an id-less kind still resolves by kind alone (ref / inline-math own no Card)", () => {
    expect(ATOM_REGISTRY.ref.idAttr).toBeNull();
    expect(ATOM_REGISTRY["inline-math"].idAttr).toBeNull();
  });

  it("a collab shift under the gesture moves the CAPTURED atom, not the one now at its position", () => {
    const harness = mockEditor(MAIN, docWithTwoCitations());
    const ctx = { mainEditor: harness.editor } as unknown as DropCtx;
    stashInlineAtomSource({
      token: "t1",
      kind: "citation",
      nodeName: "citation",
      atomId: "c-b",
      editor: harness.editor,
      pos: CITE_B_POS,
    });
    // A peer inserts one character at the head of the paragraph: every atom
    // shifts by one, so the CAPTURED position now holds citation "c-a" — the
    // same kind, the wrong atom.
    harness.editor.view.dispatch(harness.editor.state.tr.insert(1, MAIN.text("x")));
    expect(harness.getDoc().nodeAt(CITE_B_POS)?.attrs.citationId).toBe("c-a");

    try {
      inTextAtomGrabSpec.applyDrop(
        inlineCursor(harness.editor, 1),
        "atom-grab:t1",
        ctx,
      );
    } finally {
      clearInlineAtomSource();
    }

    // "c-b" moved to the head; "c-a" stayed where it was.
    expect(atomIds(harness.getDoc(), "citation", "citationId")).toEqual([
      "c-b",
      "c-a",
    ]);
  });
});

// ── 4. The census: one door, and nothing may route around it ────────────────

const DROP_MODE_DIR = join(process.cwd(), "src/components/drop-mode");

function readSource(rel: string): string {
  return readFileSync(join(DROP_MODE_DIR, rel), "utf8");
}

/** The file with its comments removed — so a census leg tests the CODE and not
 *  the prose that explains it (the door's own jsdoc names the thing it forbids). */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("census — every cross-editor commit goes through the ONE door", () => {
  // The two sites that move content BETWEEN editors. Pinned by name so that
  // deleting a member cannot empty the census silently; the detector leg below
  // is what catches a THIRD site appearing.
  const CROSS_EDITOR_SITES = [
    "util/inline-atom-move.ts",
    "specs/text-range-move.ts",
  ];

  it("each known cross-editor site imports `commitCrossEditorMove`", () => {
    for (const rel of CROSS_EDITOR_SITES) {
      expect(readSource(rel)).toContain("commitCrossEditorMove");
    }
  });

  it("no cross-editor site dispatches its own SOURCE delete", () => {
    for (const rel of CROSS_EDITOR_SITES) {
      // The pre-648 shape: a delete dispatched on the editor the payload is
      // LEAVING, on the unmeasured strength of the target insert above it. (A
      // dispatch on the TARGET is not the defect — the same-editor branches of
      // both specs are one transaction and legitimately dispatch their own.)
      expect(codeOf(readSource(rel))).not.toMatch(/sourceEditor\.view\.dispatch\(/);
    }
  });

  it("the door asks the editability SSOT rather than re-deriving `view.editable`", () => {
    const door = codeOf(readSource("commit-seam.ts"));
    // Task 733 widened that SSOT from the pen alone (`collabReadOnly`, i.e.
    // `!view.editable`) to pen ∧ host (`surfaceEditableNow`, which also reads
    // the React `editable` prop a Library Reader pane sets false). What this
    // leg holds is unchanged: the seam names a door, it does not re-derive one.
    expect(door).toContain("surfaceEditableNow");
    expect(door).not.toMatch(/\.editable/);
  });

  it("the landed measurement is a POST-dispatch read, not the built transform", () => {
    const door = readSource("commit-seam.ts");
    // `insertLanded` (schema-adopt) inspects the Transform BEFORE dispatch and
    // cannot see a veto; this door's measurement must sit after the dispatch.
    const body = door.slice(door.indexOf("export function dispatchLanded"));
    const dispatchAt = body.indexOf("editor.view.dispatch(tr)");
    const measureAt = body.indexOf("return editor.state.doc !== before");
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(measureAt).toBeGreaterThan(dispatchAt);
  });
});
