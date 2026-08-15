/**
 * **Task 328 — a cross-editor splice lands the payload or leaves both documents
 * untouched. There is no third outcome.**
 *
 * Two gestures used to produce that third outcome — content deleted from the
 * main document and inserted nowhere:
 *
 *  1. a lifted text selection released at an inline caret inside a card body
 *     (`specs/text-range-move.ts`), and
 *  2. a footnote / citation card's marker released the same way
 *     (`util/inline-atom-move.ts`) — which takes the footnote's BODY with it,
 *     since the body IS the atom's `content` attr.
 *
 * Both spliced with nodes built from the SOURCE editor's schema. ProseMirror's
 * `Fitter` compares `NodeType`s by IDENTITY, and **two `Schema` objects built
 * from the same spec hold distinct `NodeType`s** — so the fitter `dropNode()`s
 * the payload, `replaceStep` returns null, and `Transform.replace` appends no
 * step at all: `steps: 0`, `docChanged: false`, **no throw**. The move's second
 * transaction, the unconditional source delete, then ran.
 *
 * ── Why this suite needs TWO editors ────────────────────────────────────────
 *
 * This is exactly why every existing drop-mode suite misses the defect: each
 * builds ONE schema and hands the same object to both editors, where
 * `node.type.schema === schema` and the splice is native by construction. A
 * single shared mock editor cannot express the bug. So `MAIN` and `CARD` below
 * are two separate `new Schema(...)` calls, and `CARD` is additionally NARROWER
 * — no `heading`, no `footnote` — mirroring what `buildCardBodySchema` does for
 * the `"card"` scope, so the refusal legs test a target that genuinely cannot
 * represent the payload rather than one that merely disagrees about identity.
 *
 * The `same identity, different Schema` premise is asserted first, on its own,
 * because every other leg here rests on it.
 */

import { describe, expect, it } from "vitest";
import { Schema, Slice, type Mark, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import { inlineAtomMoveSpec } from "../util/inline-atom-move";
import {
  adoptNodeIntoSchema,
  adoptSliceIntoSchema,
  insertLanded,
} from "../schema-adopt";
import type { DropCtx, Placement } from "../types";

const rect = { x: 0, y: 0, width: 0, height: 0 };

// ── Two vocabularies ────────────────────────────────────────────────────────

/** The MAIN document's schema: prose, headings, and a footnote atom whose
 *  `content` attr carries the footnote's whole body. */
const MAIN = new Schema({
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
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { footnoteId: { default: "" }, content: { default: null } },
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
  },
  marks: {
    linkedAnchor: { attrs: { anchorId: {}, kind: { default: null } }, toDOM: () => ["span", 0] },
  },
});

/**
 * A CARD BODY's schema — a separate `Schema` object (so every `NodeType`
 * differs by identity even where the name matches) that is also NARROWER: the
 * `"card"` scope has no `heading` and no `footnote`, exactly as
 * `CARD_STARTER_KIT_CONFIG` describes.
 */
const CARD = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
  marks: {
    linkedAnchor: { attrs: { anchorId: {}, kind: { default: null } }, toDOM: () => ["span", 0] },
  },
});

/**
 * An ARCHIVE card body's schema — the `"excerpt"` scope, which deliberately DOES
 * mount `footnote` (a captured document slice may carry one). A separate
 * `Schema` object, so every `NodeType` still differs by identity from `MAIN`'s.
 *
 * This is the target the atom defect leg needs: a card body that can NAME the
 * footnote node and still could not receive it, because identity — not
 * vocabulary — is what ProseMirror's fitter compares.
 */
const EXCERPT = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { footnoteId: { default: "" }, content: { default: null } },
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
  },
  marks: {
    linkedAnchor: { attrs: { anchorId: {}, kind: { default: null } }, toDOM: () => ["span", 0] },
  },
});

const anchor = (id: string) => MAIN.marks.linkedAnchor.create({ anchorId: id, kind: "transient" });
const t = (text: string, marks?: Mark[]) => MAIN.text(text, marks);
const para = (...inline: PMNode[]) => MAIN.nodes.paragraph.create(null, inline);
const mainDoc = (...blocks: PMNode[]) => MAIN.nodes.doc.create(null, blocks);
const footnoteAtom = (id: string, body: string) =>
  MAIN.nodes.footnote.create({ footnoteId: id, content: body });

/** A card body holding one paragraph of the user's own prose. */
function cardBodyDoc(text = "card prose"): PMNode {
  return CARD.nodes.doc.create(null, [
    CARD.nodes.paragraph.create({ uuid: "card-1" }, [CARD.text(text)]),
  ]);
}

/** An editor whose `view.dispatch` truly applies, so a leg can read the doc the
 *  gesture actually produced rather than the transaction it hoped for. */
function liveEditor(schema: Schema, doc: PMNode) {
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
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getDoc: () => state.doc };
}

function textOf(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isTextblock) out.push(n.textContent);
    return true;
  });
  return out;
}

function countType(doc: PMNode, name: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === name) n++;
    return true;
  });
  return n;
}

// ── The premise every leg below rests on ────────────────────────────────────

describe("the premise: two Schemas from one spec hold DISTINCT NodeTypes", () => {
  it("a node built from MAIN is foreign to CARD, and PM swallows the mismatch", () => {
    expect(MAIN.nodes.paragraph).not.toBe(CARD.nodes.paragraph);
    const foreign = para(t("orphan"));
    const state = EditorState.create({ schema: CARD, doc: cardBodyDoc() });
    // No throw, no step, no change — the exact silence this task is about.
    const tr = state.tr.insert(1, foreign);
    expect(tr.steps.length).toBe(0);
    expect(tr.docChanged).toBe(false);
  });
});

/**
 * A schema that NAMES `footnote` and admits it nowhere — `paragraph` is
 * `text*`. Adoption succeeds (both types exist and `Slice.fromJSON` validates
 * the vocabulary, never the content expression) and the insert is still
 * swallowed. This is the shape the LANDED net exists for, and the reason it is
 * a second, independent obligation rather than a corollary of adoption.
 */
const STRICT = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { footnoteId: { default: "" }, content: { default: null } },
      toDOM: () => ["span", 0],
    },
  },
  marks: {
    linkedAnchor: { attrs: { anchorId: {}, kind: { default: null } }, toDOM: () => ["span", 0] },
  },
});

// ── The two primitives, on their own ────────────────────────────────────────

describe("schema-adopt primitives", () => {
  it("adoptNodeIntoSchema: identity on the same schema, re-hydrate across, null on unknown", () => {
    const native = para(t("x"));
    expect(adoptNodeIntoSchema(native, MAIN)).toBe(native); // by IDENTITY, zero cost
    const adopted = adoptNodeIntoSchema(native, CARD);
    expect(adopted).not.toBeNull();
    expect(adopted!.type).toBe(CARD.nodes.paragraph);
    expect(adopted!.textContent).toBe("x");
    // A card body has no `heading` — the refusal `canMountInCardBody` already
    // gives on the capture side of the same question.
    const heading = MAIN.nodes.heading.create({ level: 1 }, [t("H")]);
    expect(adoptNodeIntoSchema(heading, CARD)).toBeNull();
  });

  it("adoptSliceIntoSchema: preserves open depths, and refuses an unknown member", () => {
    const doc = mainDoc(para(t("alpha "), footnoteAtom("fn-1", "<p>b</p>"), t(" omega")));
    expect(adoptSliceIntoSchema(doc.slice(2, 12), CARD)).toBeNull(); // no `footnote`

    // A genuinely OPEN slice — two paragraphs cut mid-text, so the open depths
    // are the thing the inline-cursor move relies on to merge at a caret.
    const open = mainDoc(para(t("alpha")), para(t("omega"))).slice(2, 10);
    expect(open.openStart).toBe(1);
    expect(open.openEnd).toBe(1);
    const adopted = adoptSliceIntoSchema(open, CARD);
    expect(adopted).not.toBeNull();
    expect(adopted!.openStart).toBe(1);
    expect(adopted!.openEnd).toBe(1);
    expect(adopted!.content.firstChild!.type.schema).toBe(CARD);
    // Same-schema short-circuits to the very same object (identity, zero cost).
    expect(adoptSliceIntoSchema(open, MAIN)).toBe(open);
    // An EMPTY slice has no child to ask and is native to every schema.
    expect(adoptSliceIntoSchema(Slice.empty, CARD)).toBe(Slice.empty);
  });

  it("insertLanded: false when ProseMirror swallowed the payload, true when it kept it", () => {
    const state = EditorState.create({ schema: CARD, doc: cardBodyDoc() });
    // Foreign node → the fitter drops it → NO step at all.
    const swallowed = state.tr.insert(1, para(t("orphan")));
    expect(insertLanded(swallowed, 1)).toBe(false);
    // Native node → a real step and real growth.
    const native = CARD.nodes.paragraph.create(null, [CARD.text("kept")]);
    const landed = state.tr.insert(0, native);
    expect(insertLanded(landed, native.nodeSize)).toBe(true);
    // A landing that grew by LESS than the payload lost content on the way in.
    expect(insertLanded(landed, native.nodeSize + 1)).toBe(false);
  });
});

// ── Member 1: a lifted selection released in a card body ────────────────────

const RANGE_KEY = "textobject:linkedRange:a1";

function inlineCursor(editor: Editor, pos: number): Placement {
  return { kind: "inline-cursor", editor, pos, rect };
}
function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect };
}

/** doc( p("alpha BETA gamma"), p("second") ) with "BETA" marked @a1. */
function markedMain() {
  return liveEditor(
    MAIN,
    mainDoc(para(t("alpha "), t("BETA", [anchor("a1")]), t(" gamma")), para(t("second")))
  );
}

/** doc( p("keep ¹ back") ) with the marked run SPANNING the footnote atom —
 *  `findLinkedAnchorRange` returns the bounding extent, so an unmarked interior
 *  atom rides along (that is its documented contract, and the realistic shape:
 *  a highlight over "text \footnote{…} more" is two marked runs and one atom). */
function markedMainAcrossFootnote() {
  return liveEditor(
    MAIN,
    mainDoc(
      para(
        t("keep "),
        t("A", [anchor("a1")]),
        footnoteAtom("fn-1", "<p>the body</p>"),
        t("B", [anchor("a1")]),
        t(" back")
      ),
      para(t("second"))
    )
  );
}

describe("text-range move into a foreign editor", () => {
  it("DEFECT LEG: plain prose into a card body actually LANDS (it used to vanish)", () => {
    // Pre-fix: the slice carried MAIN's `NodeType`s, the fitter dropped it,
    // `tr.replace` appended no step — and the source delete ran anyway. Net:
    // "BETA" gone from the document, nothing in the card, float closed.
    const src = markedMain();
    const target = liveEditor(CARD, cardBodyDoc());
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;

    expect(
      textRangeMoveDropSpec.classifyDrop(inlineCursor(target.editor, 5), RANGE_KEY, ctx)
    ).toEqual({ kind: "apply" });
    textRangeMoveDropSpec.applyDrop(inlineCursor(target.editor, 5), RANGE_KEY, ctx);

    expect(textOf(target.getDoc())).toEqual(["cardBETA prose"]);
    expect(textOf(src.getDoc())).toEqual(["alpha  gamma", "second"]);
  });

  it("REFUSES an inline-cursor drop the card scope cannot represent — both docs untouched", () => {
    // The range spans a `footnote`, which the `"card"` scope has no name for.
    // The decision must be `no-op`, not `apply` — a spec that says apply here
    // closes the popped-out float over a document it never changed (task 321).
    const src = markedMainAcrossFootnote();
    const target = liveEditor(CARD, cardBodyDoc());
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;
    const before = { main: src.getDoc(), card: target.getDoc() };

    const decision = textRangeMoveDropSpec.classifyDrop(
      inlineCursor(target.editor, 1),
      RANGE_KEY,
      ctx
    );
    textRangeMoveDropSpec.applyDrop(inlineCursor(target.editor, 1), RANGE_KEY, ctx);

    expect(decision).toEqual({ kind: "no-op" });
    expect(src.dispatched).toHaveLength(0);
    expect(target.dispatched).toHaveLength(0);
    // The prose — and the footnote's body with it — is where the user left it.
    expect(src.getDoc().eq(before.main)).toBe(true);
    expect(countType(src.getDoc(), "footnote")).toBe(1);
    expect(target.getDoc().eq(before.card)).toBe(true);
  });

  it("REFUSES the same payload at a between-blocks gap (the already-safe branch)", () => {
    // Explicitly NOT in scope for the fix — `planRangeBetweenBlocks` routes
    // through `fitNodesAtInsert`, which has adopted since task 257. Pinned so a
    // future refactor cannot quietly take the adoption back out of the fit.
    const src = markedMainAcrossFootnote();
    const target = liveEditor(CARD, cardBodyDoc());
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;

    expect(
      textRangeMoveDropSpec.classifyDrop(betweenBlocks(target.editor, 0), RANGE_KEY, ctx)
    ).toEqual({ kind: "no-op" });
    textRangeMoveDropSpec.applyDrop(betweenBlocks(target.editor, 0), RANGE_KEY, ctx);
    expect(src.dispatched).toHaveLength(0);
    expect(target.dispatched).toHaveLength(0);
    expect(countType(src.getDoc(), "footnote")).toBe(1);
  });

  it("REFUSES a payload the target can NAME but cannot HOLD — the LANDED net alone", () => {
    // `STRICT` registers `footnote`, so the adoption SUCCEEDS; its `paragraph`
    // is `text*`, so nothing can hold the atom and the fitter swallows the
    // splice. This is the one leg that exercises the second net on its own, and
    // the reason the two obligations are separate: adoption validates the
    // VOCABULARY (`Slice.fromJSON` throws on an unknown type or mark) and says
    // nothing about the CONTENT EXPRESSION.
    const src = markedMainAcrossFootnote();
    const target = liveEditor(
      STRICT,
      STRICT.nodes.doc.create(null, [STRICT.nodes.paragraph.create(null, [STRICT.text("strict")])])
    );
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;
    const before = src.getDoc();

    // The adoption really does succeed — otherwise this leg would be pinning
    // the FIRST net a second time and would pass for the wrong reason.
    const raw = src.getDoc().slice(6, 10);
    expect(adoptSliceIntoSchema(raw, STRICT)).not.toBeNull();

    expect(
      textRangeMoveDropSpec.classifyDrop(inlineCursor(target.editor, 3), RANGE_KEY, ctx)
    ).toEqual({ kind: "no-op" });
    textRangeMoveDropSpec.applyDrop(inlineCursor(target.editor, 3), RANGE_KEY, ctx);
    expect(src.dispatched).toHaveLength(0);
    expect(target.dispatched).toHaveLength(0);
    expect(src.getDoc().eq(before)).toBe(true);
  });

  it("the cross-editor BETWEEN-BLOCKS path still lands a paragraph (non-regression)", () => {
    const src = markedMain();
    const target = liveEditor(CARD, cardBodyDoc());
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;

    textRangeMoveDropSpec.applyDrop(betweenBlocks(target.editor, 0), RANGE_KEY, ctx);

    expect(textOf(target.getDoc())).toEqual(["BETA", "card prose"]);
    expect(textOf(src.getDoc())).toEqual(["alpha  gamma", "second"]);
  });

  it("a SAME-EDITOR move is byte-identical (the adoption is a no-op there)", () => {
    const src = markedMain();
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;
    // Into the second paragraph, past the source range.
    const pos = src.getDoc().firstChild!.nodeSize + 4;

    expect(
      textRangeMoveDropSpec.classifyDrop(inlineCursor(src.editor, pos), RANGE_KEY, ctx)
    ).toEqual({ kind: "apply" });
    textRangeMoveDropSpec.applyDrop(inlineCursor(src.editor, pos), RANGE_KEY, ctx);

    expect(src.dispatched).toHaveLength(1);
    expect(textOf(src.getDoc())).toEqual(["alpha  gamma", "secBETAond"]);
  });
});

// ── Member 2: a footnote card's marker released in a card body ──────────────

const footnoteMoveSpec = inlineAtomMoveSpec({
  nodeName: "footnote",
  idAttr: "footnoteId",
  select: "caret-after",
});
const ATOM_KEY = "float:card:footnote:fn-1";

/** doc( p("before ¹ after") ) — the atom carries the footnote's whole body. */
function mainWithFootnote() {
  return liveEditor(
    MAIN,
    mainDoc(para(t("before "), footnoteAtom("fn-1", "<p>the body</p>"), t(" after")))
  );
}

describe("inline-atom move into a foreign editor", () => {
  it("REFUSES when the target schema has no `footnote` — the marker and its body stay put", () => {
    const src = mainWithFootnote();
    const target = liveEditor(CARD, cardBodyDoc());
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;

    const decision = footnoteMoveSpec.classifyDrop(
      inlineCursor(target.editor, 1),
      ATOM_KEY,
      ctx
    );
    footnoteMoveSpec.applyDrop(inlineCursor(target.editor, 1), ATOM_KEY, ctx);

    expect(decision).toEqual({ kind: "no-op" });
    // Nothing dispatched ANYWHERE — including the caret-parking transaction,
    // which the pre-fix path reached on its way to the delete.
    expect(src.dispatched).toHaveLength(0);
    expect(target.dispatched).toHaveLength(0);
    // The atom — and therefore the footnote's body — is still in the prose.
    expect(countType(src.getDoc(), "footnote")).toBe(1);
    let body: unknown = null;
    src.getDoc().descendants((n) => {
      if (n.type.name === "footnote") body = n.attrs.content;
      return true;
    });
    expect(body).toBe("<p>the body</p>");
  });

  it("DEFECT LEG: into an EXCERPT body that DOES know `footnote`, the atom LANDS", () => {
    // The accepting control AND the second member's defect leg in one: `EXCERPT`
    // is a DISTINCT `Schema` object that nonetheless mounts `footnote`, exactly
    // as the excerpt scope does for an archive card. Pre-fix the atom was
    // foreign by IDENTITY, so the insert appended no step while the source
    // delete removed the marker — destroying the footnote's body, which is the
    // atom's `content` attr and lives nowhere else.
    const src = mainWithFootnote();
    const target = liveEditor(
      EXCERPT,
      EXCERPT.nodes.doc.create(null, [
        EXCERPT.nodes.paragraph.create({ uuid: "ex-1" }, [EXCERPT.text("target prose")]),
      ])
    );
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;

    expect(
      footnoteMoveSpec.classifyDrop(inlineCursor(target.editor, 7), ATOM_KEY, ctx)
    ).toEqual({ kind: "apply" });
    footnoteMoveSpec.applyDrop(inlineCursor(target.editor, 7), ATOM_KEY, ctx);

    expect(countType(target.getDoc(), "footnote")).toBe(1);
    let landedBody: unknown = null;
    target.getDoc().descendants((n) => {
      if (n.type.name === "footnote") landedBody = n.attrs.content;
      return true;
    });
    expect(landedBody).toBe("<p>the body</p>");
    expect(countType(src.getDoc(), "footnote")).toBe(0);
    expect(textOf(src.getDoc())).toEqual(["before  after"]);
  });

  it("a SAME-EDITOR atom move is unchanged", () => {
    const src = mainWithFootnote();
    const ctx = { mainEditor: src.editor } as unknown as DropCtx;
    const pos = 1; // start of the paragraph, before "before "

    expect(footnoteMoveSpec.classifyDrop(inlineCursor(src.editor, pos), ATOM_KEY, ctx)).toEqual(
      { kind: "apply" }
    );
    footnoteMoveSpec.applyDrop(inlineCursor(src.editor, pos), ATOM_KEY, ctx);

    expect(countType(src.getDoc(), "footnote")).toBe(1);
    expect(src.getDoc().firstChild!.firstChild!.type.name).toBe("footnote");
  });
});
