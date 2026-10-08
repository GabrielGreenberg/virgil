// @vitest-environment jsdom
//
// Task 1002 — Duplicate remints identity once per ENTITY, not once per node.
//
// One `linkedAnchor` anchorId can cover several text nodes ("plain **bold**
// plain", a span across two paragraphs). The walker used to clone the card on
// EVERY fragment, so the copy landed with N cards each on one fragment. And a
// label-declaring node's `label` was copied verbatim, so the paper declared the
// key twice and a rename of the copy carried every `\ref` to it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  duplicateSlice,
  createDuplicateDiagnostics,
} from "@/text-objects/duplicate-slice";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { linkCardKey } from "@/links/link-dom-contract";
import { collectLabelKeysIn } from "@/lib/labels";

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

const mounted: Editor[] = [];
function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

/** A lifecycle whose note clones mint `<id>-copy-N` and are counted. */
function countingLifecycle(opts?: { refuse?: boolean }): {
  api: CardLifecycleApi;
  clones: string[];
} {
  const clones: string[] = [];
  const api: CardLifecycleApi = {
    get: () => ({
      clone: (id: string) => {
        if (opts?.refuse) return null;
        clones.push(id);
        return `${id}-copy-${clones.length}`;
      },
      delete: () => {},
    }),
  };
  return { api, clones };
}

const ANCHOR = {
  type: "linkedAnchor",
  attrs: {
    anchorId: "anc-1",
    linkId: "anc-1",
    linkKind: "anchor",
    linkCard: linkCardKey("note", "note-1"),
  },
};

function anchorIdsIn(node: PMNode): { anchorIds: Set<string>; linkCards: Set<string> } {
  const anchorIds = new Set<string>();
  const linkCards = new Set<string>();
  node.descendants((n) => {
    for (const m of n.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      anchorIds.add(String(m.attrs.anchorId));
      linkCards.add(String(m.attrs.linkCard));
    }
    return true;
  });
  return { anchorIds, linkCards };
}

/** Duplicate the first `count` top-level blocks and return the copies. */
function duplicateBlocks(
  editor: Editor,
  count: number,
  api: CardLifecycleApi,
  diag = createDuplicateDiagnostics(),
): PMNode[] {
  const doc = editor.state.doc;
  let to = 0;
  for (let i = 0; i < count; i++) to += doc.child(i).nodeSize;
  const cloned = duplicateSlice(doc.slice(0, to), api, diag, {
    takenLabels: collectLabelKeysIn(doc),
  });
  const tr = editor.state.tr.replace(to, to, cloned);
  tr.doc.check();
  editor.view.dispatch(tr);
  const out: PMNode[] = [];
  for (let i = count; i < count * 2; i++) out.push(editor.state.doc.child(i));
  return out;
}

describe("duplicate remints an anchor once per entity (task 1002)", () => {
  it("an anchor split across bold text clones ONE card and mints ONE anchorId", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "aaaa" },
        content: [
          { type: "text", text: "plain ", marks: [ANCHOR] },
          { type: "text", text: "bold", marks: [{ type: "bold" }, ANCHOR] },
          { type: "text", text: " plain", marks: [ANCHOR] },
        ],
      },
    ]);
    // Precondition: the source really is three text nodes under one anchor.
    expect(editor.state.doc.child(0).childCount).toBe(3);
    const { api, clones } = countingLifecycle();
    const [copy] = duplicateBlocks(editor, 1, api);
    expect(clones).toEqual(["note-1"]);
    const { anchorIds, linkCards } = anchorIdsIn(copy);
    expect(anchorIds.size).toBe(1);
    expect(anchorIds.has("anc-1")).toBe(false);
    expect([...linkCards]).toEqual([linkCardKey("note", "note-1-copy-1")]);
  });

  it("an anchor spanning two paragraphs clones ONE card across both copies", () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "aaaa" }, content: [{ type: "text", text: "first", marks: [ANCHOR] }] },
      { type: "paragraph", attrs: { uuid: "bbbb" }, content: [{ type: "text", text: "second", marks: [ANCHOR] }] },
    ]);
    const { api, clones } = countingLifecycle();
    const copies = duplicateBlocks(editor, 2, api);
    expect(clones).toEqual(["note-1"]);
    const ids = new Set(copies.flatMap((c) => [...anchorIdsIn(c).anchorIds]));
    expect(ids.size).toBe(1);
  });

  it("an unclonable card strips the mark on EVERY fragment, with one diagnostic", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: "aaaa" },
        content: [
          { type: "text", text: "plain ", marks: [ANCHOR] },
          { type: "text", text: "bold", marks: [{ type: "bold" }, ANCHOR] },
        ],
      },
    ]);
    const diag = createDuplicateDiagnostics();
    const [copy] = duplicateBlocks(editor, 1, countingLifecycle({ refuse: true }).api, diag);
    expect(anchorIdsIn(copy).anchorIds.size).toBe(0);
    expect(diag.details.filter((d) => d.code === "missing-card-on-mark")).toHaveLength(1);
  });
});

describe("duplicate remints \\label declarations (task 1002)", () => {
  it("a duplicated labeled heading gets a fresh, unique key; the source keeps its own", () => {
    const editor = mountDoc([
      { type: "heading", attrs: { level: 1, uuid: "aaaa", label: "sec:intro" }, content: [{ type: "text", text: "Intro" }] },
      { type: "heading", attrs: { level: 1, uuid: "bbbb", label: "sec:intro-2" }, content: [{ type: "text", text: "Taken" }] },
    ]);
    const [copy] = duplicateBlocks(editor, 1, countingLifecycle().api);
    expect(editor.state.doc.child(0).attrs.label).toBe("sec:intro");
    // `-2` is already declared elsewhere in the paper, so the copy skips it.
    expect(copy.attrs.label).toBe("sec:intro-3");
    const all: string[] = [];
    editor.state.doc.forEach((n) => {
      if (n.type.name === "heading" && n.attrs.label) all.push(String(n.attrs.label));
    });
    expect(new Set(all).size).toBe(all.length);
  });

  it("the dry and real walks derive the SAME key (task 735 staging stays shape-exact)", () => {
    const editor = mountDoc([
      { type: "heading", attrs: { level: 1, uuid: "aaaa", label: "sec:intro" }, content: [{ type: "text", text: "Intro" }] },
    ]);
    const doc = editor.state.doc;
    const slice = doc.slice(0, doc.child(0).nodeSize);
    const takenLabels = collectLabelKeysIn(doc);
    const a = duplicateSlice(slice, countingLifecycle().api, undefined, { takenLabels });
    const b = duplicateSlice(slice, countingLifecycle().api, undefined, { takenLabels });
    expect(a.content.child(0).attrs.label).toBe(b.content.child(0).attrs.label);
    // Omitted taken set: the slice's own keys still count — never the source's.
    const c = duplicateSlice(slice, countingLifecycle().api);
    expect(c.content.child(0).attrs.label).toBe("sec:intro-2");
  });

  it("a \\label inside displayMath source is reminted too", () => {
    const editor = mountDoc([
      { type: "displayMath", attrs: { uuid: "aaaa", latex: "x = y \\label{eq:one}" } },
    ]);
    const [copy] = duplicateBlocks(editor, 1, countingLifecycle().api);
    expect(editor.state.doc.child(0).attrs.latex).toBe("x = y \\label{eq:one}");
    expect(copy.attrs.latex).toBe("x = y \\label{eq:one-2}");
  });
});
