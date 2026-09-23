// @vitest-environment jsdom
//
// Task 2026-09-19-651 — a fact derived from a node's BODY must re-derive when
// the BODY is touched, not only when the node's opening token is.
//
// `collectRange`'s start-in-range rule answers "did this node's IDENTITY
// change?". It was answering "did this node's DERIVED FACTS change?" too, and
// those are different questions: whether a figure takes a NUMBER is
// `emitsCaption` (tasks 318/319), derived from the caption's own content, and
// typing into an empty caption produces a `ReplaceStep` strictly INSIDE the
// caption — the figureBlock's opening token is never in range, so the block was
// collected on neither side, `changedFigures` stayed empty, and the numberer's
// structural gate never fired. The figure stayed unnumbered and every LATER
// figure's number — and every `\ref` resolving through them — was off by one.
//
// Why no pre-existing leg could see it: `figure-save-routing.test.ts` drives
// `saveFigure`, a whole-node writeback whose step range CONTAINS the
// figureBlock's opening token, so the block is collected and the transition is
// seen. That pins the popover leg. The direct-editing leg — the ordinary
// gesture, since the editor always renders an editable caption — had none.
//
// Every leg drives the REAL main extension stack (observer + numberer) over
// the REAL parse, and each asserts the user-visible NUMBER as well as the diff
// bucket, so a green run means the two agree.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// Count the numberer's O(doc) walk directly rather than trusting a sentence
// about when it runs — the keystroke-sanctity leg below is an assertion about
// invocations, so it counts invocations.
let refIndexCalls = 0;
vi.mock("@/lib/ref-display", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ref-display")>(
    "@/lib/ref-display",
  );
  return {
    ...actual,
    buildRefTargetIndexPM: (...args: Parameters<typeof actual.buildRefTargetIndexPM>) => {
      refIndexCalls++;
      return actual.buildRefTargetIndexPM(...args);
    },
  };
});

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { inspectSteps } from "@/lib/tiptap/doc-structure/step-inspector";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

/**
 * The parser emits no `uuid` (the backfill mints them against a live anchored
 * set the app supplies). Figure entries are KEYED on uuid, so an un-stamped
 * fixture reports no figure change of any kind and every leg below would pass
 * vacuously. Stamp one on every non-text node before mounting — ProseMirror
 * ignores an attr its schema does not declare, so this is safe to apply
 * blanket rather than by type.
 */
function stampUuids(json: unknown): unknown {
  let n = 0;
  const walk = (node: Record<string, unknown>): void => {
    if (node.type !== "text") {
      const attrs = (node.attrs as Record<string, unknown> | undefined) ?? {};
      attrs.uuid = `u${++n}`;
      node.attrs = attrs;
    }
    const content = node.content as Record<string, unknown>[] | undefined;
    if (Array.isArray(content)) for (const c of content) walk(c);
  };
  walk(json as Record<string, unknown>);
  return json;
}

let editor: Editor | null = null;
beforeEach(() => {
  refIndexCalls = 0;
});
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: stampUuids(
      parseLatex(
        `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
      ),
    ) as never,
  });
  return editor;
}

function figures(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "figureBlock") out.push({ pos, node: n });
    return true;
  });
  return out;
}

/** The content position inside a figure's own `figureCaption` child. */
function captionContentPos(doc: PMNode, figurePos: number): number {
  const fig = doc.nodeAt(figurePos)!;
  expect(fig.firstChild?.type.name).toBe("figureCaption");
  return figurePos + 1 + 1;
}

function refDisplays(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "labelRef") out.push((n.attrs.displayText as string) ?? "");
    return true;
  });
  return out;
}

const TWO_FIGURES = [
  // Captionless — emits no `\caption`, so it takes NO number (tasks 318/319).
  "\\begin{figure}",
  "\\includegraphics{a.png}",
  "\\label{fig:one}",
  "\\end{figure}",
  "",
  "\\begin{figure}",
  "\\includegraphics{b.png}",
  "\\caption{Second}",
  "\\label{fig:two}",
  "\\end{figure}",
  "",
  "See \\ref{fig:two}.",
].join("\n");

describe("a figure's caption is BODY-derived — typing in it re-derives the number", () => {
  it("typing the first character into an empty caption numbers the figure and renumbers the rest", () => {
    const ed = mount(TWO_FIGURES);

    // Baseline: the captionless figure has no number; the captioned one is 1,
    // and the `\ref` to it shows 1.
    const before = figures(ed.state.doc);
    expect(before.map((f) => f.node.attrs.figureNumber)).toEqual([null, 1]);
    expect(refDisplays(ed.state.doc)).toEqual(["1"]);

    const capPos = captionContentPos(ed.state.doc, before[0].pos);
    ed.view.dispatch(ed.state.tr.insertText("A", capPos));

    // The figure now emits a caption, so it takes number 1 — and the SECOND
    // figure, and the `\ref` that resolves through it, move to 2. One table,
    // per the numberer's own doc comment.
    const after = figures(ed.state.doc);
    expect(after.map((f) => f.node.attrs.figureNumber)).toEqual([1, 2]);
    expect(refDisplays(ed.state.doc)).toEqual(["2"]);
  });

  // The diff-level leg. This is the one that fails on the pre-fix inspector:
  // the step range lies strictly inside the caption, so `collectRange` saw the
  // figureBlock on neither side and `changedFigures` came back EMPTY.
  it("…and the transaction reports it as a CHANGED figure, in the same transaction", () => {
    const ed = mount(TWO_FIGURES);
    const capPos = captionContentPos(ed.state.doc, figures(ed.state.doc)[0].pos);

    const tr = ed.state.tr.insertText("A", capPos);
    const diff = inspectSteps(tr, ed.state.doc, tr.doc);

    expect(diff.changedFigures.map((f) => f.emitsCaption)).toEqual([true]);
    // Identity did not change — a body edit is not a birth or a death.
    expect(diff.addedFigures).toHaveLength(0);
    expect(diff.removedFigures).toHaveLength(0);
  });

  // The symmetric leg. `hasCaption` (the attr) records that the SOURCE had a
  // `\\caption` command, and `emitsCaption` is `hasCaption || captionHasContent`
  // — so emptying the caption of a figure whose source HAD one still emits
  // `\\caption{}` and still numbers. The fact only falls back to false for the
  // figure the user captioned by TYPING, which is exactly this round trip.
  it("deleting that same character takes the number back away", () => {
    const ed = mount(TWO_FIGURES);
    const figPos = figures(ed.state.doc)[0].pos;
    const capPos = captionContentPos(ed.state.doc, figPos);

    ed.view.dispatch(ed.state.tr.insertText("A", capPos));
    expect(figures(ed.state.doc).map((f) => f.node.attrs.figureNumber)).toEqual([1, 2]);

    const tr = ed.state.tr.delete(capPos, capPos + 1);
    const diff = inspectSteps(tr, ed.state.doc, tr.doc);
    expect(diff.changedFigures.map((f) => f.emitsCaption)).toEqual([false]);

    ed.view.dispatch(tr);
    expect(figures(ed.state.doc).map((f) => f.node.attrs.figureNumber)).toEqual([null, 1]);
    expect(refDisplays(ed.state.doc)).toEqual(["1"]);
  });

  // Keystroke sanctity. The surgical alternative — widening the numberer's gate
  // to `contentChangedUuids` — would run `buildRefTargetIndexPM` (an O(doc)
  // walk) on EVERY keystroke in the document. Count the calls.
  it("typing in ordinary prose runs no doc walk — while the caption keystroke does", () => {
    const ed = mount(TWO_FIGURES);
    refIndexCalls = 0;

    // The prose paragraph holding the `\ref`.
    let paraPos = -1;
    ed.state.doc.descendants((n, pos) => {
      if (paraPos < 0 && n.type.name === "paragraph") paraPos = pos;
      return true;
    });
    expect(paraPos).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < 8; i++) {
      const tr = ed.state.tr.insertText("z", paraPos + 1);
      const diff = inspectSteps(tr, ed.state.doc, tr.doc);
      expect(diff.changedFigures).toHaveLength(0);
      ed.view.dispatch(tr);
    }
    expect(refIndexCalls).toBe(0);

    // The control: the same probe DOES see the caption keystroke, so "zero"
    // above is a real silence and not a dead counter.
    const capPos = captionContentPos(ed.state.doc, figures(ed.state.doc)[0].pos);
    ed.view.dispatch(ed.state.tr.insertText("A", capPos));
    expect(refIndexCalls).toBeGreaterThan(0);
  });

  // Typing the SECOND character leaves the boolean where it was, so the
  // numberer must stay asleep even though the edit is inside a caption.
  it("typing inside an ALREADY non-empty caption wakes nothing", () => {
    const ed = mount(TWO_FIGURES);
    const secondFigure = figures(ed.state.doc)[1];
    const capPos = captionContentPos(ed.state.doc, secondFigure.pos);
    refIndexCalls = 0;

    const tr = ed.state.tr.insertText("!", capPos);
    const diff = inspectSteps(tr, ed.state.doc, tr.doc);
    expect(diff.changedFigures).toHaveLength(0);

    ed.view.dispatch(tr);
    expect(refIndexCalls).toBe(0);
  });
});
