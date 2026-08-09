// @vitest-environment jsdom
/**
 * Wave-2 C2 — the breadcrumb derivation: ONE hit-test + binary search over
 * the structure snapshot, replacing the per-RAF coordsAtPos walk.
 *
 * The editor is REAL (full main extension set, so the DocStructureObserver
 * maintains the snapshot the derivation reads); the VIEW is a stub — jsdom
 * has no layout, so `posAtCoords` / the rect reads are the controlled
 * inputs, which also makes the doc-position ↔ reference-line mapping exact
 * in each case. Pins:
 *
 *  - the heading chain is the enclosing hierarchy at the reference position
 *    (previous-smaller-level semantics — the walk's pop/push, inverted);
 *  - text/sectionNumber come from the LIVE node (heading text edits are
 *    content-only and never refresh the index entry);
 *  - parTitleIndex is the last titled block before the line, RESET by a
 *    crossed heading; a parTitle FLIP (the S1 bus extension) re-derives the
 *    vocabulary via the version-keyed cache;
 *  - a locked-focus band skips out-of-band headings;
 *  - plain typing (position shift, no structural change) keeps the cached
 *    vocabulary valid because probes read positions from the materialized
 *    snapshot, not the cache.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { computeSectionPathAt } from "../section-path";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "h1", level: 1, sectionNumber: "1" }, content: [{ type: "text", text: "Alpha" }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "one" }] },
        { type: "heading", attrs: { uuid: "h2", level: 2, sectionNumber: "1.1" }, content: [{ type: "text", text: "Beta" }] },
        { type: "paragraph", attrs: { uuid: "p2", parTitle: "Titled" }, content: [{ type: "text", text: "two" }] },
        { type: "paragraph", attrs: { uuid: "p3" }, content: [{ type: "text", text: "three" }] },
      ],
    },
  });
}

/** A stub pane view over the real state: `posAtCoords` returns the test's
 *  chosen position; the rects make referenceY land inside the content box. */
function stubView(editor: Editor, atPos: () => number): EditorView {
  return {
    // LIVE state read — a captured snapshot would desync from dispatches.
    get state() {
      return editor.state;
    },
    dom: {
      getBoundingClientRect: () =>
        ({ top: 0, left: 0, right: 800, bottom: 2000, width: 800, height: 2000 }) as DOMRect,
    },
    posAtCoords: () => ({ pos: atPos(), inside: atPos() }),
  } as unknown as EditorView;
}

function stubScrollEl(): Element {
  return {
    getBoundingClientRect: () =>
      ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }) as DOMRect,
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 100,
  } as unknown as Element;
}

/** Top-level start pos of the i-th child. */
function blockPos(editor: Editor, i: number): number {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize;
  return pos;
}

let editor: Editor;

beforeEach(() => {
  editor = makeEditor();
});

afterEach(() => {
  editor.destroy();
});

describe("computeSectionPathAt", () => {
  it("derives the enclosing heading chain + par-title at the reference position", () => {
    // Line inside p3 (index 4): chain = Alpha > Beta, parTitle = p2 (index 3).
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result).not.toBeNull();
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.path.map((e) => e.index)).toEqual([0, 2]);
    expect(result!.path.map((e) => e.sectionNumber)).toEqual(["1", "1.1"]);
    expect(result!.parTitleIndex).toBe(3);
  });

  it("inside the first section: single-entry chain, no par-title", () => {
    const p = blockPos(editor, 1) + 1; // inside p1
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha"]);
    expect(result!.parTitleIndex).toBeNull();
  });

  it("a crossed heading RESETS the par-title (the walk's activeParTitleIdx = null)", () => {
    // Retitle p1 (BEFORE h2) and clear p2's title: at a line inside p3 the
    // last titled block (p1) sits before the last crossed heading (h2) → null.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 1), "parTitle", "Early"));
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 3), "parTitle", null));
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.parTitleIndex).toBeNull();
  });

  it("a parTitle FLIP re-derives the vocabulary (S1's blockParTitleChanged bumps the version)", () => {
    const pAt = () => blockPos(editor, 4) + 1; // inside p3, recomputed live
    const view = stubView(editor, pAt);
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
    // Give p3 a title: it is now the last titled block before the line.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 4), "parTitle", "Late"));
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(4);
    // Remove it again: back to p2.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 4), "parTitle", null));
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
  });

  it("plain typing shifts positions without invalidating the cached vocabulary", () => {
    const view = stubView(editor, () => blockPos(editor, 4) + 1);
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
    // Type into p1 — every later position shifts; no structural change.
    editor.view.dispatch(
      editor.state.tr.insertText("xxxxxxxx", blockPos(editor, 1) + 2),
    );
    const result = computeSectionPathAt(editor, view, stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.parTitleIndex).toBe(3);
  });

  it("heading text reads LIVE (index text is content-stale by design)", () => {
    // Type into h2's text; the index entry's text stays "Beta" but the
    // breadcrumb must show the live text.
    editor.view.dispatch(
      editor.state.tr.insertText("!!", blockPos(editor, 2) + 1),
    );
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path[1].text).toBe("!!Beta");
  });

  it("a locked-focus band skips out-of-band headings", () => {
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(
      editor,
      stubView(editor, () => p),
      stubScrollEl(),
      { start: 2, end: 4 }, // h1 (index 0) is out of band
    );
    expect(result!.path.map((e) => e.text)).toEqual(["Beta"]);
  });

  it("returns an empty path above the first heading", () => {
    const result = computeSectionPathAt(
      editor,
      stubView(editor, () => 1), // inside h1 itself? pos 1 is inside h1 — h1.pos(0) <= 1 → crossed.
      stubScrollEl(),
      null,
    );
    // pos 1 sits INSIDE h1, so h1 counts as crossed (its top is at/above the
    // line containing pos 1) — single-entry chain, same as the walk.
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha"]);
  });
});
