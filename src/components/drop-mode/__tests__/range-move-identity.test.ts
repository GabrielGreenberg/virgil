// @vitest-environment jsdom
/**
 * Task 320 — "a move conserves identity; a split mints it."
 *
 * A text-range move builds its payload from `doc.slice(from, to)`, so every
 * block child arrives carrying the SOURCE block's `uuid`. The cut is
 * TEXT-bounded, so it can never remove the FIRST source block — `tr.delete`
 * opens it and joins what follows into it. Net, before this task: two live
 * blocks answering to one uuid (the moved copy and the residue), plus a blank
 * paragraph sitting where the text used to be. A uuid is the anchor identity
 * every card/sidecar resolves against, so a card anchored to the source could
 * resolve to the MOVED text, and the next save's dedup had to pick a winner.
 *
 * The fix states the identity at the MECHANISM rather than leaving it to the
 * `BlockUuidBackfill` net, and the difference is not academic: a net can only
 * see that two blocks collide, not which one the user meant to keep. Left to it
 * (document order wins) the empty residue keeps the identity and the moved text
 * is re-minted — every anchor silently detaches from its own words. So the spec
 * stages the cut, drops the residue the cut EMPTIED, then re-mints only the ids
 * still live at the destination.
 *
 * These tests run the drop spec against the REAL editor schema with NO plugins
 * mounted — deliberately. The spec must produce a correct transaction on its
 * own; if it needed the net to be correct, the net's document-order tie-break
 * would already be deciding the semantics.
 *
 * Non-destructive: build the dispatched transaction and inspect `tr.doc`.
 */

import { describe, expect, it, vi } from "vitest";

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

import { getSchema } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import type { DropCtx, Placement } from "../types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

const ZERO = { x: 0, y: 0, width: 0, height: 0 };
const RANGE_KEY = "textobject:linkedRange:a1";
const MARK = { type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } };

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const editor = {
    state: EditorState.create({ schema, doc: d }),
    view: { dispatch: (tr: Transaction) => dispatched.push(tr), focus: () => {} },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

function betweenBlocks(editor: Editor, insertPos: number): Placement {
  return { kind: "between-blocks", editor, insertPos, rect: ZERO };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return { kind: "inline-cursor", editor, pos, rect: ZERO };
}

/** Every non-null uuid in the doc, in document order. */
function uuids(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    const u = n.attrs?.uuid as string | undefined;
    if (typeof u === "string" && u) out.push(u);
    return true;
  });
  return out;
}

/** THE invariant of this task: no two live nodes answer to one uuid. */
function expectUniqueUuids(d: PMNode): void {
  const all = uuids(d);
  expect(new Set(all).size).toBe(all.length);
}

/** Top-level paragraph texts, so a leftover blank shell is visible as "". */
function topLevelTexts(d: PMNode): string[] {
  const out: string[] = [];
  d.forEach((n) => out.push(n.textContent));
  return out;
}

function para(uuid: string | null, ...content: unknown[]) {
  return { type: "paragraph", attrs: { uuid }, content };
}
const text = (t: string, marked = false) =>
  marked ? { type: "text", text: t, marks: [MARK] } : { type: "text", text: t };

// ── A. Whole-block multi-block move: identity travels with the text ─────────

describe("multi-block text-range move — identity", () => {
  it("moves the blocks' identity WITH the text and leaves no empty shell", () => {
    // p(s1 "alpha") p(s2 "beta") p(s3 "tail") — "alpha" and "beta" both marked.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        para("s1", text("alpha", true)),
        para("s2", text("beta", true)),
        para("s3", text("tail")),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size), // gap at the very end
      RANGE_KEY,
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();

    // The reported corruption: two live blocks sharing a uuid.
    expectUniqueUuids(result);
    // The cut consumed BOTH source blocks entirely, so both identities travel —
    // a card anchored to "alpha" follows the words it was anchored to.
    expect(uuids(result)).toEqual(["s3", "s1", "s2"]);
    // …and the blank paragraph the text-bounded cut left behind is gone.
    expect(topLevelTexts(result)).toEqual(["tail", "alpha", "beta"]);
  });

  it("re-mints only the PARTIALLY-cut source block, leaving its text intact", () => {
    // p(s1 "keep alpha") — only "alpha" marked — p(s2 "beta") fully marked.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        para("s1", text("keep "), text("alpha", true)),
        para("s2", text("beta", true)),
        para("s3", text("tail")),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size),
      RANGE_KEY,
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);

    const [srcUuid, tailUuid, movedA, movedB] = uuids(result);
    // The source block SURVIVED the cut with real text, so it keeps its
    // identity — anchors on "keep " stay where their words are…
    expect(srcUuid).toBe("s1");
    expect(tailUuid).toBe("s3");
    // …and the moved fragment is a NEW presence: fresh 4-hex id, never "s1".
    expect(movedA).not.toBe("s1");
    expect(movedA).toMatch(/^[0-9a-f]{4}$/);
    // The block the cut consumed whole still travels with its identity.
    expect(movedB).toBe("s2");
    // Nothing removed at the source: "keep " is still there, and no blank shell.
    expect(topLevelTexts(result)).toEqual(["keep ", "tail", "alpha", "beta"]);
  });

  it("keeps a shell the schema needs — and re-mints against it instead", () => {
    // Only two blocks, both consumed whole: removing the emptied residue would
    // leave `doc` (content `block+`) with no children, so `Node.canReplace`
    // refuses and the shell stays. The identity rule still has to hold, which it
    // does the other way round — the surviving shell keeps "s1", so the moved
    // copy of it mints fresh.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [para("s1", text("alpha", true)), para("s2", text("beta", true))],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(betweenBlocks(editor, 0), RANGE_KEY, ctx);

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);
    expect(result.childCount).toBe(3);
    const [movedA, movedB, shell] = uuids(result);
    expect(shell).toBe("s1");
    expect(movedA).not.toBe("s1");
    expect(movedB).toBe("s2");
    expect(topLevelTexts(result)).toEqual(["alpha", "beta", ""]);
  });

  it("carries an inline atom's id with it — a move is not a copy", () => {
    // A citation inside the moved run. The atom is deleted from the source in
    // the same transaction, so its id is FREE at the destination and must be
    // conserved: re-minting it would orphan the citation's Card and its bib row.
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        para("s1", text("alpha ", true), {
          type: "citation",
          attrs: { command: "\\cite", displayText: "(Ok 2020)", citationId: "c001", linkId: "c001" },
        }),
        para("s2", text("beta", true)),
        para("s3", text("tail")),
      ],
    });
    // Mark the citation's trailing text too so the range spans both blocks.
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size),
      RANGE_KEY,
      ctx,
    );

    const result = dispatched[0].doc;
    expectUniqueUuids(result);
    const cites: string[] = [];
    result.descendants((n) => {
      if (n.type.name === "citation") cites.push(n.attrs.citationId as string);
      return true;
    });
    expect(cites).toEqual(["c001"]);
  });
});

// ── B. The identity the shell removal frees goes to the moved run ──────────

describe("single-block text-range move — identity is transferred, not destroyed", () => {
  it("hands the emptied paragraph's uuid to the moved run", () => {
    // The COMMONEST form of this gesture, and the one the shell removal would
    // otherwise break in the opposite direction: for a range inside ONE
    // textblock, `rangeSliceToBlocks` builds a BRAND-NEW paragraph
    // (`paragraph.create(null, …)`), so the source uuid is not on the payload at
    // all. Shedding the source block without transferring it would delete the
    // identity from the document entirely — orphaning every card anchored to
    // those words, i.e. the exact failure this task exists to prevent, arriving
    // from the other side (review-caught).
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [para("s1", text("alpha", true)), para("s3", text("tail"))],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size),
      RANGE_KEY,
      ctx,
    );

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);
    expect(topLevelTexts(result)).toEqual(["tail", "alpha"]);
    // "s1" is still in the document, now carried by the text it identified.
    expect(uuids(result)).toEqual(["s3", "s1"]);
  });
});

// ── C. A shell whose EXISTENCE carries meaning is never shed ───────────────

describe("shell removal is paragraph-only", () => {
  it("keeps an emptied HEADING (removing it would destroy the section)", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        // level 1 + default attrs, so ONLY the "is it the plain paragraph?" test
        // stands between this heading and deletion.
        { type: "heading", attrs: { uuid: "h1", level: 1 }, content: [text("Intro", true)] },
        para("s2", text("beta", true)),
        para("s3", text("tail")),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size),
      RANGE_KEY,
      ctx,
    );

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);
    // The heading survives, emptied but intact — its level, its outline entry
    // and its `\section` are not the cut's to remove.
    expect(result.firstChild?.type.name).toBe("heading");
    expect(result.firstChild?.attrs.uuid).toBe("h1");
    // …so the moved copy of it is the new presence and mints fresh.
    expect(uuids(result)).toHaveLength(4);
    expect(uuids(result)[0]).toBe("h1");
  });

  it("keeps an emptied GLOSS CELL (removing it would shift every column)", () => {
    // `alignedGlossRow` is `glossCell*`, so `Node.canReplace` permits the
    // removal — and permitting is not the same question as "was this residue?".
    // A gloss cell's meaning is its COLUMN POSITION; dropping one silently
    // misaligns the tiers against each other (review-caught, measured).
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "E", kind: "single" },
          content: [
            {
              type: "exampleItemList",
              content: [
                {
                  type: "exampleItem",
                  attrs: { uuid: "i1" },
                  content: [
                    { type: "paragraph", content: [text("body")] },
                    {
                      type: "exampleGloss",
                      attrs: { colCount: 3 },
                      content: [
                        {
                          type: "alignedGlossRow",
                          attrs: { tier: "gla" },
                          content: [
                            { type: "glossCell", content: [text("wa")] },
                            { type: "glossCell", content: [text("shi", true)] },
                            { type: "glossCell", content: [text("go")] },
                          ],
                        },
                        {
                          type: "alignedGlossRow",
                          attrs: { tier: "glb" },
                          content: [
                            { type: "glossCell", content: [text("I")] },
                            { type: "glossCell", content: [text("TOP")] },
                            { type: "glossCell", content: [text("GO")] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        para("s3", text("tail")),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    textRangeMoveDropSpec.applyDrop(
      betweenBlocks(editor, d.content.size),
      RANGE_KEY,
      ctx,
    );

    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    // Both tiers still have three cells — the emptied one stays, holding the
    // column open. Column counts, not text, are what a gloss means.
    const rowCellCounts: number[] = [];
    result.descendants((n) => {
      if (n.type.name === "alignedGlossRow") rowCellCounts.push(n.childCount);
      return true;
    });
    expect(rowCellCounts).toEqual([3, 3]);
  });
});

// ── D. The inline-cursor branch is deliberately untouched ──────────────────

describe("multi-block text-range move — inline-cursor branch", () => {
  it("keeps every uuid unique and loses none of the user's text", () => {
    const d = schema.nodeFromJSON({
      type: "doc",
      content: [
        para("s1", text("alpha", true)),
        para("s2", text("beta", true)),
        para("t1", text("target")),
      ],
    });
    const { editor, dispatched, ctx } = mockEditor(d);

    // Caret inside "target" (after "tar").
    const targetStart = d.content.size - "target".length - 1;
    textRangeMoveDropSpec.applyDrop(
      inlineCursor(editor, targetStart + 3),
      RANGE_KEY,
      ctx,
    );

    expect(dispatched).toHaveLength(1);
    const result = dispatched[0].doc;
    expect(() => result.check()).not.toThrow();
    expectUniqueUuids(result);
    // The emptied source block SURVIVES here, and that is the correct call, not
    // an oversight: this branch dissolves the run into an existing block, so
    // there is no payload block to hand the freed identity to. Shedding the
    // shell would delete "s1" from the document outright.
    expect(uuids(result)).toContain("s1");
    // Nothing of the user's text was lost.
    expect(result.textContent).toContain("alpha");
    expect(result.textContent).toContain("beta");
    expect(result.textContent).toContain("tar");
  });
});
