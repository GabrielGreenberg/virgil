// @vitest-environment jsdom
//
// Task 2026-09-19-652 — `buildInitial` and `inspectSteps` derive the SAME
// entry type from different inputs, and only one of them knew about
// CONTAINMENT.
//
// A `CitationEntry` carries `nestedInContainerId`, the card-bearing block that
// owns the cite. It is an ANCESTOR-derived fact: the load walk has an ancestor
// stack for free, the step path sees an isolated node. So the step path simply
// did not stamp it, and a cite typed or pasted inside an example block reached
// the cards untagged — rendering as a flat top-level card instead of nesting
// under the example's, until the next reload re-ran `buildInitial`. That exact
// symptom had already been found and fixed once, on the CHANGED path
// (`structure-index.ts`, carry-the-prior-tag-forward); the ADDED path was
// missed by that fix, so the same sentence stayed true for a new cite.
//
// The fix is one constructor (`citationEntryAt`) plus an ancestor walk, so the
// tag cannot be present on one path and absent on the other. The guard that
// matters is therefore CONGRUENCE, not a single symptom: every leg below
// rebuilds the final document with `buildInitial` and compares the live
// incremental entry to it FIELD BY FIELD, which is what would have caught this
// bug, its already-fixed twin, and the third one.
//
// Every leg drives the REAL main extension stack over the REAL parse.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  buildInitial,
  readDocStructure,
  type CitationEntry,
} from "@/lib/tiptap/doc-structure";

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

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** `\ex.` is the linguex dialect — the package must be loaded for the parser
 *  to see an example at all (otherwise it stays literal prose). */
function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(
      `\\documentclass{article}\n\\usepackage{linguex}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

const DOC = [
  "An ordinary paragraph.",
  "",
  "\\ex.\\a. Inside the example.",
  "\\b. Second part.",
].join("\n");

/** Position just AFTER the text node whose content is `needle`. */
function posAfterText(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isText && n.text === needle) found = pos + n.nodeSize;
    return true;
  });
  expect(found, `text node "${needle}" not found`).toBeGreaterThanOrEqual(0);
  return found;
}

function exampleUuid(doc: PMNode): string {
  let uuid = "";
  doc.descendants((n) => {
    if (!uuid && n.type.name === "exampleBlock") uuid = (n.attrs.uuid as string) ?? "";
    return true;
  });
  expect(uuid).toBeTruthy();
  return uuid;
}

function citePos(doc: PMNode, id: string): number {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if (n.type.name === "citation" && n.attrs.citationId === id) at = pos;
    return true;
  });
  expect(at, `citation ${id} not found`).toBeGreaterThanOrEqual(0);
  return at;
}

function makeCite(ed: Editor, id: string, key: string): PMNode {
  return ed.state.schema.nodes.citation.create({
    citationId: id,
    command: `\\cite{${key}}`,
    displayText: key,
  });
}

function liveEntry(ed: Editor, id: string): CitationEntry | undefined {
  return readDocStructure(ed.state).citations.find((c) => c.id === id);
}

/** The oracle: what a fresh load of THIS document would say. */
function loadEntry(ed: Editor, id: string): CitationEntry | undefined {
  return buildInitial(ed.state.doc).citations.find((c) => c.id === id);
}

/** Field-by-field congruence for EVERY citation, not just the one under test —
 *  an entry the incremental path gets right for the wrong reason still fails. */
function expectCongruent(ed: Editor): void {
  const live = readDocStructure(ed.state).citations;
  const load = buildInitial(ed.state.doc).citations;
  expect(live.map((c) => c.id)).toEqual(load.map((c) => c.id));
  for (let i = 0; i < load.length; i++) expect(live[i]).toEqual(load[i]);
}

describe("a citation's container tag is derived on the incremental path too", () => {
  it("a cite INSERTED inside an example nests under it in the same transaction", () => {
    const ed = mount(DOC);
    const exUuid = exampleUuid(ed.state.doc);
    const at = posAfterText(ed.state.doc, "Inside the example.");

    ed.view.dispatch(ed.state.tr.insert(at, makeCite(ed, "c-new", "smith2020")));

    // The reported symptom: this was `undefined` until the next reload.
    expect(liveEntry(ed, "c-new")?.nestedInContainerId).toEqual({
      kind: "example",
      id: exUuid,
    });
    // …and the whole entry equals what a fresh load would build.
    expect(liveEntry(ed, "c-new")).toEqual(loadEntry(ed, "c-new"));
    expectCongruent(ed);
  });

  it("CONTROL — a cite inserted in ordinary prose stays flat", () => {
    const ed = mount(DOC);
    const at = posAfterText(ed.state.doc, "An ordinary paragraph.");

    ed.view.dispatch(ed.state.tr.insert(at, makeCite(ed, "c-flat", "jones1999")));

    expect(liveEntry(ed, "c-flat")?.nestedInContainerId).toBeUndefined();
    expect(liveEntry(ed, "c-flat")).toEqual(loadEntry(ed, "c-flat"));
    expectCongruent(ed);
  });

  it("the nesting survives a later edit to the cite (the CHANGED path agrees)", () => {
    const ed = mount(DOC);
    const exUuid = exampleUuid(ed.state.doc);
    const at = posAfterText(ed.state.doc, "Inside the example.");
    ed.view.dispatch(ed.state.tr.insert(at, makeCite(ed, "c-edit", "smith2020")));

    // A citekey edit in place — `setNodeMarkup` on a leaf atom, which the
    // inspector sees as same-id in both bundles → `changedCitations`.
    const pos = citePos(ed.state.doc, "c-edit");
    ed.view.dispatch(
      ed.state.tr.setNodeMarkup(pos, undefined, {
        citationId: "c-edit",
        command: "\\cite{smith2021}",
        displayText: "smith2021",
      }),
    );

    expect(liveEntry(ed, "c-edit")?.command).toBe("\\cite{smith2021}");
    expect(liveEntry(ed, "c-edit")?.nestedInContainerId).toEqual({
      kind: "example",
      id: exUuid,
    });
    expectCongruent(ed);
  });

  it("a cite MOVED OUT of its example un-nests immediately — no stale tag", () => {
    const ed = mount(DOC);
    const at = posAfterText(ed.state.doc, "Inside the example.");
    ed.view.dispatch(ed.state.tr.insert(at, makeCite(ed, "c-move", "smith2020")));
    expect(liveEntry(ed, "c-move")?.nestedInContainerId).toBeDefined();

    // Delete + re-insert in ordinary prose, one transaction — the atom-MOVE
    // shape. Before task 652 the step path could not see containment at all,
    // so `applyDiff` carried the prior tag forward and the card stayed nested
    // until the next reload (a documented "accepted edge"). It is now derived.
    const from = citePos(ed.state.doc, "c-move");
    const node = ed.state.doc.nodeAt(from)!;
    const target = posAfterText(ed.state.doc, "An ordinary paragraph.");
    const tr = ed.state.tr.delete(from, from + node.nodeSize);
    tr.insert(tr.mapping.map(target), node);
    ed.view.dispatch(tr);

    expect(liveEntry(ed, "c-move")?.nestedInContainerId).toBeUndefined();
    expectCongruent(ed);
  });

  it("a FOOTNOTE-nested cite keeps its load-only tag across an unrelated edit", () => {
    // Footnote nesting is invisible to every step (the cite is a JSONContent
    // literal inside the host footnote's `attrs.content`, not a PM node), so it
    // is stamped once at load and carried forward by `applyDiff`. Splitting the
    // example kind out of that carry-forward must not disturb it.
    const ed = mount(
      "A claim.\\footnote{But see \\citep{smith2020} on this.}\n\n" + DOC,
    );
    const before = readDocStructure(ed.state).citations.find(
      (c) => c.nestedInFootnoteId,
    );
    expect(before?.nestedInContainerId?.kind).toBe("footnote");

    // An edit somewhere else entirely.
    ed.view.dispatch(
      ed.state.tr.insertText("x", posAfterText(ed.state.doc, "An ordinary paragraph.")),
    );

    const after = readDocStructure(ed.state).citations.find(
      (c) => c.id === before!.id,
    );
    expect(after?.nestedInFootnoteId).toBe(before!.nestedInFootnoteId);
    expect(after?.nestedInContainerId).toEqual(before!.nestedInContainerId);
  });
});
