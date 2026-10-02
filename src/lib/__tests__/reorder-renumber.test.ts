// @vitest-environment jsdom
/**
 * TASK 892 — moving sections in the Outline left them numbered "3, 1, 2".
 *
 * An Outline reorder (`handleReorderBlocks`) is one transaction: an insert plus
 * a delete of the SAME nodes, uuids preserved. The step inspector reconciled a
 * same-uuid heading/figure by ATTRS only, so the move reported nothing in
 * `changedHeadings` / `changedFigures`, and the numberer's structural gate —
 * which reads those buckets — never woke. Order is a numbering input; the fix
 * makes a same-uuid entity that survives at a different (mapped) position a
 * change, by the inspector's own definition.
 *
 * These run on the FULL main stack (observer installed): without the observer,
 * `readPendingDiff` is null and the numberer runs unconditionally, which hides
 * the bug.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { undo } from "@tiptap/pm/history";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { inspectSteps } from "@/lib/tiptap/doc-structure/step-inspector";
import { readDocStructure } from "@/lib/tiptap/doc-structure/observer-plugin";

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

const editors: Editor[] = [];
/** Mount on the full main stack. Every top-level block is stamped with a uuid
 *  first, as a loaded paper's blocks are in the app — the inspector keys
 *  headings/figures by uuid, and an unstamped fixture (the test stack mints
 *  none on load) would never exercise the same-uuid MOVE this task is about. */
function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const stamped: JSONContent = {
    ...content,
    content: (content.content ?? []).map((n, i) => ({ ...n, attrs: { ...n.attrs, uuid: n.attrs?.uuid ?? `b${i}` } })),
  };
  const ed = new Editor({ element, editable: true, extensions: buildEditorExtensions(mainCtx()), content: stamped });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  for (const ed of editors.splice(0)) ed.destroy();
  document.body.innerHTML = "";
});

/** The top-level span [fromIndex, fromIndex+count) moved to land before
 *  top-level index `toIndex` — the same insert+delete (or delete+insert)
 *  `handleReorderBlocks` dispatches (editor-ops.ts). */
function moveBlocks(ed: Editor, fromIndex: number, count: number, toIndex: number): void {
  const doc = ed.state.doc;
  const positions: { from: number; to: number }[] = [];
  doc.forEach((node, offset) => positions.push({ from: offset, to: offset + node.nodeSize }));
  const sliceFrom = positions[fromIndex].from;
  const sliceTo = positions[fromIndex + count - 1].to;
  const slice = doc.slice(sliceFrom, sliceTo);
  const landingPos = toIndex >= positions.length ? positions[positions.length - 1].to : positions[toIndex].from;
  let tr = ed.state.tr;
  if (toIndex < fromIndex) {
    tr = tr.insert(landingPos, slice.content);
    tr = tr.delete(tr.mapping.map(sliceFrom), tr.mapping.map(sliceTo));
  } else {
    tr = tr.delete(sliceFrom, sliceTo);
    tr = tr.insert(tr.mapping.map(landingPos), slice.content);
  }
  ed.view.dispatch(tr);
}

function topIndexOf(doc: PMNode, pred: (n: PMNode) => boolean): number {
  let idx = -1;
  doc.forEach((n, _o, i) => {
    if (idx < 0 && pred(n)) idx = i;
  });
  return idx;
}

function headings(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "heading") out.push(`${n.attrs.sectionNumber} ${n.textContent}`);
  });
  return out;
}

function figures(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "figureBlock") out.push(`${n.attrs.figureNumber} ${n.attrs.label}`);
  });
  return out;
}

function refs(doc: PMNode): Record<string, string> {
  const out: Record<string, string> = {};
  doc.descendants((n) => {
    if (n.type.name === "labelRef") out[n.attrs.label as string] = n.attrs.displayText as string;
  });
  return out;
}

const SECTIONS = String.raw`\documentclass{article}
\begin{document}
\section{A}\label{sec:a}
Alpha.
\section{B}\label{sec:b}
Beta.
\section{C}\label{sec:c}
See \ref{sec:c} and \ref{sec:a}.
\end{document}`;

const FIGURES = String.raw`\documentclass{article}
\begin{document}
\section{Only}
\begin{figure}
\centering
\caption{First}\label{fig:one}
\end{figure}
\begin{figure}
\centering
\caption{Second}\label{fig:two}
\end{figure}
See \ref{fig:one} and \ref{fig:two}.
\end{document}`;

describe("task 892: a reorder renumbers (order is a numbering input)", () => {
  it("moving section C above A renumbers every heading in doc order and updates \\ref text", () => {
    const ed = mount(parseLatex(SECTIONS));
    expect(headings(ed.state.doc)).toEqual(["1 A", "2 B", "3 C"]);
    expect(refs(ed.state.doc)).toEqual({ "sec:c": "3", "sec:a": "1" });

    const cIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "C");
    const count = ed.state.doc.childCount - cIdx;
    const aIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "A");
    moveBlocks(ed, cIdx, count, aIdx);

    expect(headings(ed.state.doc)).toEqual(["1 C", "2 A", "3 B"]);
    expect(refs(ed.state.doc)).toEqual({ "sec:c": "1", "sec:a": "2" });
  });

  it("undo of the move restores the original numbers", () => {
    const ed = mount(parseLatex(SECTIONS));
    const cIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "C");
    const count = ed.state.doc.childCount - cIdx;
    const aIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "A");
    moveBlocks(ed, cIdx, count, aIdx);
    expect(headings(ed.state.doc)).toEqual(["1 C", "2 A", "3 B"]);

    undo(ed.state, ed.view.dispatch);
    expect(headings(ed.state.doc)).toEqual(["1 A", "2 B", "3 C"]);
    expect(refs(ed.state.doc)).toEqual({ "sec:c": "3", "sec:a": "1" });
  });

  it("swapping two captioned figures renumbers them and their \\refs", () => {
    const ed = mount(parseLatex(FIGURES));
    expect(figures(ed.state.doc)).toEqual(["1 fig:one", "2 fig:two"]);
    const second = topIndexOf(ed.state.doc, (n) => n.type.name === "figureBlock" && n.attrs.label === "fig:two");
    const first = topIndexOf(ed.state.doc, (n) => n.type.name === "figureBlock" && n.attrs.label === "fig:one");
    moveBlocks(ed, second, 1, first);
    expect(figures(ed.state.doc)).toEqual(["1 fig:two", "2 fig:one"]);
    expect(refs(ed.state.doc)).toEqual({ "fig:one": "2", "fig:two": "1" });
  });

  it("the structure index follows the move (outline order = doc order)", () => {
    const ed = mount(parseLatex(SECTIONS));
    const cIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "C");
    const count = ed.state.doc.childCount - cIdx;
    const aIdx = topIndexOf(ed.state.doc, (n) => n.type.name === "heading" && n.textContent === "A");
    moveBlocks(ed, cIdx, count, aIdx);
    const live: number[] = [];
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === "heading") live.push(pos);
    });
    expect(readDocStructure(ed.state).headings.map((h) => h.pos)).toEqual(live);
  });
});

describe("task 892: inspector — a same-uuid heading move is a numbering change", () => {
  it("a move lands the heading in changedHeadings; typing inside a heading does not", () => {
    // Explicit uuids: the inspector keys headings by uuid, and a fresh mount's
    // parsed blocks only get theirs from the backfill on a later transaction.
    const h = (text: string, uuid: string): JSONContent => ({
      type: "heading",
      attrs: { level: 1, uuid },
      content: [{ type: "text", text }],
    });
    const p = (text: string, uuid: string): JSONContent => ({
      type: "paragraph",
      attrs: { uuid },
      content: [{ type: "text", text }],
    });
    const ed = mount({
      type: "doc",
      content: [p("Lead.", "p0"), h("A", "ha"), p("Alpha.", "pa"), h("B", "hb"), p("Beta.", "pb"), h("C", "hc"), p("Gamma.", "pc")],
    });
    const state: EditorState = ed.state;
    const doc = state.doc;
    const positions: { from: number; to: number; node: PMNode }[] = [];
    doc.forEach((node, offset) => positions.push({ from: offset, to: offset + node.nodeSize, node }));
    const cIdx = positions.findIndex((p) => p.node.type.name === "heading" && p.node.textContent === "C");
    const slice = doc.slice(positions[cIdx].from, positions[positions.length - 1].to);
    let tr = state.tr.insert(0, slice.content);
    tr = tr.delete(tr.mapping.map(positions[cIdx].from), tr.mapping.map(positions[positions.length - 1].to));
    const moved = inspectSteps(tr, state.doc, tr.doc);
    expect(moved.changedHeadings.map((h) => h.uuid)).toContain(positions[cIdx].node.attrs.uuid);

    // Typing inside heading A: a same-pos re-scan, never a numbering change.
    const aPos = positions.find((p) => p.node.type.name === "heading" && p.node.textContent === "A")!.from;
    const typed = state.tr.insertText("x", aPos + 2);
    const typedDiff = inspectSteps(typed, state.doc, typed.doc);
    expect(typedDiff.changedHeadings).toEqual([]);
    expect(typedDiff.addedHeadings).toEqual([]);

    // Typing ABOVE every heading (in the lead paragraph) shifts their raw
    // positions — mapped through the tx, so no change.
    const above = state.tr.insertText("y", 2);
    const aboveDiff = inspectSteps(above, state.doc, above.doc);
    expect(aboveDiff.changedHeadings).toEqual([]);
  });
});
