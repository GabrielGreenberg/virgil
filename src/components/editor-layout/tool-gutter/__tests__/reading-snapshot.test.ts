// @vitest-environment jsdom
//
// Task 1570 — the reading lists resolve every position against the doc it was
// read from. The pane's rows (footnotes, citations) are read at the last
// structural change; typing then shifts the live doc under them. Before the
// fix the lists filed those stale positions against fresh headings and
// resolved them against the LIVE doc: a footnote typed past slid into the
// previous section, and a citation late in the doc whose text above was
// deleted threw a RangeError inside the open bibliography row.
//
// Drives the REAL main extension stack over the REAL parse.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { FootnoteInfo } from "@/components/Editor";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import type { BibEntry } from "@/lib/types";
import { readReadingSnapshot } from "../reading-snapshot";
import { footnoteGroups, type GutterCitation } from "../gutter-lists";
import { sentencePartsAt } from "../BibOpenView";

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

type Json = { type?: string; attrs?: Record<string, unknown>; content?: Json[] };

/** Blocks carry a uuid once the app has loaded a paper; the bare parse does
 *  not stamp one, and the structure index lists only uuid'd headings. */
function stampUuids(node: Json, n = { i: 0 }): Json {
  if (node.type === "heading" || node.type === "paragraph") node.attrs = { ...node.attrs, uuid: `b${++n.i}` };
  node.content?.forEach((c) => stampUuids(c, n));
  return node;
}

function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const parsed = parseLatex(`\\documentclass{article}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: stampUuids(parsed as unknown as Json) as never,
  });
  return editor;
}

const BODY = [
  "\\section{One}",
  "",
  "A first section with a long opening paragraph to delete from.",
  "",
  "\\section{Two}",
  "",
  "Early in two\\footnote{A note.}. Margins speak back \\cite{jackson2001} to readers.",
].join("\n");

const entry = { uid: "j", key: "jackson2001", type: "book", fields: { author: "Jackson", year: "2001" }, raw: "" } as unknown as BibEntry;

/** The rows as the pane reads them — at the last structural change. */
function paneRows(ed: Editor) {
  const footnotes: FootnoteInfo[] = [];
  const citations: GutterCitation[] = [];
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      footnotes.push({ footnoteId: node.attrs.footnoteId, content: node.attrs.content, number: 1, pos } as FootnoteInfo);
    }
    if (node.type.name === "citation") citations.push({ citationId: node.attrs.citationId, keys: ["jackson2001"], pos });
  });
  return { footnotes, citations, examples: [] };
}

/** The first text position inside §1's paragraph. */
function firstParagraphPos(ed: Editor): number {
  let at = -1;
  ed.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === "paragraph") at = pos + 1;
    return at < 0;
  });
  return at;
}

describe("reading lists read ONE positions snapshot (task 1570)", () => {
  it("a footnote typed past stays filed under its own section", () => {
    const ed = mount(BODY);
    const rows = paneRows(ed);
    expect(rows.footnotes).toHaveLength(1);
    // Type 200 characters into §1: no structural change, so the pane's rows
    // keep their old positions.
    ed.commands.insertContentAt(firstParagraphPos(ed), "x".repeat(200));

    const snap = readReadingSnapshot(ed.state, rows);
    expect(snap.sections.map((s) => s.text)).toEqual(["One", "Two"]);
    const groups = footnoteGroups(snap.footnotes, [], [], snap.sections);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toContain("Two");
    expect(groups[0].rows.map((r) => r.entityId)).toEqual([rows.footnotes[0].footnoteId]);
    // The pre-fix mix — the pane's stale row against fresh headings — files
    // it under §1.
    expect(footnoteGroups(rows.footnotes, [], [], snap.sections)[0].label).toContain("One");
  });

  it("a deletion above a late citation never throws, and the line names the right sentence", () => {
    const ed = mount(BODY);
    const rows = paneRows(ed);
    const stale = rows.citations[0].pos;
    const from = firstParagraphPos(ed);
    ed.commands.deleteRange({ from, to: from + 40 });
    // The pane's position now overshoots the end of the live doc — resolving
    // it there is the crash the open bibliography row used to hit.
    expect(() => ed.state.doc.nodeAt(stale)).toThrow(RangeError);

    const snap = readReadingSnapshot(ed.state, rows);
    const pos = snap.citations[0].pos;
    expect(snap.doc.nodeAt(pos)?.type.name).toBe("citation");
    const parts = sentencePartsAt(snap.doc, pos, [entry], () => "Jackson (2001)");
    expect(parts.before).toBe("Margins speak back ");
    expect(parts.cite).toBe("Jackson (2001)");
    expect(parts.after).toBe(" to readers.");
  });

  it("a row the snapshot no longer holds is dropped, not resolved", () => {
    const ed = mount(BODY);
    const rows = paneRows(ed);
    const cite = rows.citations[0];
    ed.commands.deleteRange({ from: cite.pos, to: cite.pos + 1 });
    expect(readReadingSnapshot(ed.state, rows).citations).toEqual([]);
  });

  it("a position from another revision is refused, never resolved", () => {
    const ed = mount(BODY);
    const size = ed.state.doc.content.size;
    expect(() => sentencePartsAt(ed.state.doc, size + 30, [entry])).not.toThrow();
    expect(sentencePartsAt(ed.state.doc, size + 30, [entry])).toEqual({ lead: "", before: "", cite: "", after: "" });
  });
});
