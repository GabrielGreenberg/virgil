/**
 * **Task 235 — the defect leg. A cross-doc pull of citation-bearing CONTENT
 * must arrive with its bibliography.**
 *
 * The Stack is deliberately cross-document, so pulling into a DIFFERENT doc is
 * a first-class flow — and `references.bib` is per-doc, with bib annotations in
 * a per-doc `annotations.json` sidecar, so nothing global rescues an unknown
 * citekey in the destination. Before this task the CARD family carried its
 * bibliography (task 069) and the three CONTENT families did not, although the
 * remint code's own comment names them as the headline case for atoms riding a
 * slice. Net: a pulled `\cite{smith2020}` with no entry in doc B's
 * `references.bib` (a LaTeX undefined reference) and the source's bib-review
 * note silently gone.
 *
 * These tests drive the REAL `snapshotSelection` / `snapshotParagraph` /
 * `snapshotHeadingSection` → the REAL add door (`withBibCarry`) → the REAL
 * `stackPullDropSpec.applyDrop` into a SEPARATE destination editor whose
 * `StackPullApi` records what reached the doc's bibliography. Every one of them
 * fails on the pre-235 tree, where no content payload had anywhere to put a
 * `BibEntry` and no content branch upserted one.
 *
 * Harness note: the schema mirrors the atoms the way its sibling
 * `stack-pull-atom-id-remint.test.ts` does — the real editor extension stack is
 * not needed to ask whether a cite's bibliography travelled, and the snapshot /
 * pull code under test is schema-agnostic.
 */

import { describe, expect, it, vi } from "vitest";

const { readStackItemMock } = vi.hoisted(() => ({ readStackItemMock: vi.fn() }));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { stackPullDropSpec } from "../specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "../types";
import {
  snapshotSelection,
  snapshotParagraph,
  snapshotHeadingSection,
} from "@/lib/stack/snapshot";
import { withBibCarry, type StackBibCtx } from "@/lib/stack/bib-carry";
import type { StackItem } from "@/lib/stack/types";
import type { BibEntry } from "@/lib/types";

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
      attrs: { footnoteId: { default: "" }, linkId: { default: "" }, content: { default: null } },
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

// ── The SOURCE doc's bibliography ────────────────────────────────────
const SMITH: BibEntry = {
  uid: "uid-smith",
  key: "smith2020",
  type: "article",
  fields: { title: "On Annotation", author: "Smith" },
  raw: "@article{smith2020}",
};
const JONES: BibEntry = { ...SMITH, uid: "uid-jones", key: "jones1990", raw: "@article{jones1990}" };
const SMITH_NOTE = "<p>Key source for §2.</p>";

/** Doc A's resolvers, as `EditorPane` builds them for the stack-add door. */
const SOURCE_BIB: StackBibCtx = {
  getBibEntry: (k) => ({ smith2020: SMITH, jones1990: JONES })[k],
  getAnnotation: (k) => (k === "smith2020" ? SMITH_NOTE : ""),
};

const SRC = { docId: "docA", docTitle: "Doc A" };
const CARD_KEY = "stack-pull:item-1";

function citeAtom(command: string): PMNode {
  return schema.node("citation", { citationId: "cit-1", linkId: "cit-1", command });
}

/** Mock editor whose `view.dispatch` truly applies to a live EditorState. */
function liveEditor(doc: PMNode, selection?: { from: number; to: number }) {
  let state = EditorState.create({
    schema,
    doc,
    selection: selection ? TextSelection.create(doc, selection.from, selection.to) : undefined,
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

/** Doc B: an empty destination whose bibliography starts EMPTY, recording what
 *  the pull writes into it. `landedCiteAt` snapshots how many cite atoms the
 *  doc held when the first entry was upserted — the ordering guarantee (a
 *  pulled cite is never momentarily dangling). */
function destination(existingNotes: Record<string, string> = {}) {
  const doc = schema.node("doc", null, [schema.node("paragraph", { uuid: "dest-1" }, [schema.text("dest")])]);
  const harness = liveEditor(doc);
  const upserts: BibEntry[] = [];
  const annotations: Array<[string, string]> = [];
  let citesAtFirstUpsert: number | null = null;
  const countCites = () => {
    let n = 0;
    harness.getState().doc.descendants((node) => {
      if (node.type.name === "citation") n++;
      return true;
    });
    return n;
  };
  const stack = {
    upsertBibEntry: (e: BibEntry) => {
      if (citesAtFirstUpsert === null) citesAtFirstUpsert = countCites();
      upserts.push(e);
    },
    getAnnotation: (k: string) => existingNotes[k] ?? "",
    setAnnotation: (k: string, html: string) => annotations.push([k, html]),
    addNote: vi.fn(),
    addHighlight: vi.fn(),
    addTodo: vi.fn(),
    addArchive: vi.fn(),
    addRevisionComment: vi.fn(),
    addRevisionSuggestion: vi.fn(),
    addCutterComment: vi.fn(),
    addCutterSuggestion: vi.fn(),
    addFootnote: vi.fn(),
    addCitation: vi.fn(),
  } as unknown as StackPullApi;
  return {
    ...harness,
    stack,
    upserts,
    annotations,
    countCites,
    citesAtFirstUpsert: () => citesAtFirstUpsert,
  };
}

/** Add to the Stack the way every producer does — through the ADD door, which
 *  is where the bib question is answered for every payload family alike. */
function addToStack(item: StackItem | null): StackItem {
  expect(item).not.toBeNull();
  return withBibCarry(item!, SOURCE_BIB);
}

function pullInto(dest: ReturnType<typeof destination>) {
  const placement = {
    kind: "between-blocks",
    editor: dest.editor,
    insertPos: dest.getState().doc.content.size,
  } as unknown as Placement;
  stackPullDropSpec.applyDrop(placement, CARD_KEY, {
    mainEditor: dest.editor,
    stack: dest.stack,
  } as unknown as DropCtx);
}

/** Doc A: one paragraph citing smith2020, plus a heading section for the
 *  heading payload. */
function sourceDoc(): PMNode {
  return schema.node("doc", null, [
    schema.node("heading", { uuid: "h-1", level: 1 }, [schema.text("Section")]),
    schema.node("paragraph", { uuid: "para-1" }, [
      schema.text("as shown "),
      citeAtom("\\citep{smith2020}"),
      schema.text(" here"),
    ]),
  ]);
}

describe("cross-doc stack pull — a cite riding CONTENT carries its bibliography (task 235)", () => {
  it("TEXT slice: a selection spanning a \\cite upserts the entry + annotation in the destination", () => {
    const doc = sourceDoc();
    const para = doc.child(1);
    const paraStart = doc.child(0).nodeSize + 1;
    const source = liveEditor(doc, { from: paraStart, to: paraStart + para.content.size });

    readStackItemMock.mockReturnValue(addToStack(snapshotSelection(source.editor, SRC)));

    const dest = destination();
    expect(dest.upserts).toEqual([]); // doc B knows nothing about smith2020
    pullInto(dest);

    expect(dest.upserts.map((e) => e.key)).toEqual(["smith2020"]);
    expect(dest.upserts[0].fields.title).toBe("On Annotation");
    expect(dest.annotations).toEqual([["smith2020", SMITH_NOTE]]);
    // …and the cite itself really landed, so this is a bib-complete insert
    // rather than a refusal that trivially satisfies the assertions above.
    expect(dest.countCites()).toBe(1);
    // The entry is in place BEFORE the cite lands — never momentarily dangling.
    expect(dest.citesAtFirstUpsert()).toBe(0);
  });

  it("PARAGRAPH payload: the whole block's cites travel with it", () => {
    const source = liveEditor(sourceDoc());
    readStackItemMock.mockReturnValue(
      addToStack(snapshotParagraph(source.editor, "para-1", SRC)),
    );

    const dest = destination();
    pullInto(dest);

    expect(dest.upserts.map((e) => e.key)).toEqual(["smith2020"]);
    expect(dest.annotations).toEqual([["smith2020", SMITH_NOTE]]);
    expect(dest.countCites()).toBe(1);
  });

  it("HEADING section: every cite in the captured section travels, deduped", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { uuid: "h-1", level: 1 }, [schema.text("Section")]),
      schema.node("paragraph", { uuid: "p-1" }, [citeAtom("\\citep{smith2020}")]),
      schema.node("paragraph", { uuid: "p-2" }, [citeAtom("\\citep{smith2020,jones1990}")]),
    ]);
    const source = liveEditor(doc);
    readStackItemMock.mockReturnValue(
      addToStack(snapshotHeadingSection(source.editor, "h-1", SRC)),
    );

    const dest = destination();
    pullInto(dest);

    expect(dest.upserts.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    // jones1990 has no bib-review note in doc A; only the annotated key is written.
    expect(dest.annotations).toEqual([["smith2020", SMITH_NOTE]]);
    expect(dest.countCites()).toBe(2);
  });

  it("NESTED: a cite inside a pulled FOOTNOTE's body travels too", () => {
    // The subtlest scope case the task named — a footnote keeps its body in
    // `attrs.content`, which no schema walk over the slice would enter.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { uuid: "para-fn" }, [
        schema.text("claim"),
        schema.node("footnote", {
          footnoteId: "fn-1",
          linkId: "fn-1",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "citation", attrs: { citationId: "c9", command: "\\cite{jones1990}" } },
                ],
              },
            ],
          },
        }),
      ]),
    ]);
    const source = liveEditor(doc);
    readStackItemMock.mockReturnValue(
      addToStack(snapshotParagraph(source.editor, "para-fn", SRC)),
    );

    const dest = destination();
    pullInto(dest);

    expect(dest.upserts.map((e) => e.key)).toEqual(["jones1990"]);
  });

  it("a cite-less pull writes NOTHING to the destination bibliography", () => {
    // The no-regression half: an ordinary content pull must not touch doc B's
    // `.bib` at all, and its stack blob must persist exactly as before 235.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { uuid: "plain-1" }, [schema.text("no citations here")]),
    ]);
    const source = liveEditor(doc);
    const item = addToStack(snapshotParagraph(source.editor, "plain-1", SRC));
    expect(item.bib).toBeUndefined();
    readStackItemMock.mockReturnValue(item);

    const dest = destination();
    pullInto(dest);

    expect(dest.upserts).toEqual([]);
    expect(dest.annotations).toEqual([]);
  });

  it("KEEPS a note the DESTINATION already authored for that key", () => {
    // `upsertBibEntry` is insert-if-absent, so doc B keeps its own entry for a
    // key it knows — and a note written over doc B's would then describe the
    // entry that was discarded, on a work that may merely share the citekey
    // (author-year keys collide across papers routinely). Same rule, both
    // halves: what the destination has, it keeps.
    const source = liveEditor(sourceDoc());
    readStackItemMock.mockReturnValue(
      addToStack(snapshotParagraph(source.editor, "para-1", SRC)),
    );

    const dest = destination({ smith2020: "<p>Superseded — see Lee 2024.</p>" });
    pullInto(dest);

    expect(dest.annotations).toEqual([]);
    // The entry still travels — filling doc B's `.bib` is the whole point, and
    // its own upsert declines on a key it already knows.
    expect(dest.upserts.map((e) => e.key)).toEqual(["smith2020"]);
    expect(dest.countCites()).toBe(1);
  });

  it("REFUSES a carry it cannot discharge — and lands the same payload when it can", () => {
    // The refusal `withBibUpsert` itself owns. Deliberately a CONTENT payload:
    // for a CARD payload `planCardDrop`'s own pre-321 `if (!stack) return null`
    // refuses first, so a card-shaped leg would pass without reaching this code.
    const source = liveEditor(sourceDoc());
    readStackItemMock.mockReturnValue(
      addToStack(snapshotParagraph(source.editor, "para-1", SRC)),
    );

    const dest = destination();
    const placement = {
      kind: "between-blocks",
      editor: dest.editor,
      insertPos: dest.getState().doc.content.size,
    } as unknown as Placement;

    // No `ctx.stack`: landing the content anyway is exactly the dangling-cite
    // outcome this task closes, and a pull is a copy — refusing costs nothing.
    expect(
      stackPullDropSpec.classifyDrop(placement, CARD_KEY, {
        mainEditor: dest.editor,
      } as unknown as DropCtx),
    ).toEqual({ kind: "no-op" });
    expect(dest.countCites()).toBe(0);

    // The control, so the leg cannot pass because the plan failed for some
    // other reason: the same payload at the same placement WITH a stack applies.
    expect(
      stackPullDropSpec.classifyDrop(placement, CARD_KEY, {
        mainEditor: dest.editor,
        stack: dest.stack,
      } as unknown as DropCtx),
    ).toEqual({ kind: "apply" });
  });

  it("a key the SOURCE doc cannot resolve is not invented in the destination", () => {
    // Doc A was already dangling for `ghost2099`; carrying a fabricated entry
    // would be worse than carrying none.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { uuid: "ghost-1" }, [citeAtom("\\cite{ghost2099}")]),
    ]);
    const source = liveEditor(doc);
    readStackItemMock.mockReturnValue(
      addToStack(snapshotParagraph(source.editor, "ghost-1", SRC)),
    );

    const dest = destination();
    pullInto(dest);

    expect(dest.upserts).toEqual([]);
    expect(dest.countCites()).toBe(1);
  });
});
