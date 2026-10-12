// @vitest-environment jsdom
//
// Task 1072 — AN APPENDER IS HANDED EVERY TRANSACTION IT HAS NOT SEEN.
//
// ProseMirror calls each `appendTransaction` with `trs.slice(n)` — all the
// transactions that plugin has not yet seen. So whenever an EARLIER appender
// appends (the footnote renumber, BlockUuidBackfill's uuid mint, …), every
// LATER appender is handed `[userTr, appendedTr]`. The consumer door used to
// answer "the LAST transaction's diff" — the appended one's — so the user's own
// structural change was invisible: delete a heading together with footnote #1
// and the section numberer (which runs after the footnote renumber) gated
// itself off, leaving the next heading numbered "2".
//
// Both "REAL stack" and "after the backfill" legs fail on the pre-fix slot.
// The footnote leg pins the orphan payload: a removed footnote's body now rides
// in its diff entry instead of being re-resolved against `oldState`.
//
// Runs against the real `buildEditorExtensions("main")` stack.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { readDiffFor } from "@/lib/tiptap/doc-structure";
import type { StructureDiff } from "@/lib/tiptap/doc-structure/types";

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

const BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "the note body" }] }],
};

function para(uuid: string, text: string, footnoteId?: string, number = 1) {
  const content: Record<string, unknown>[] = [{ type: "text", text }];
  if (footnoteId) {
    content.push({
      type: "footnote",
      attrs: { footnoteId, linkId: footnoteId, number, content: BODY },
    });
  }
  return { type: "paragraph", attrs: { uuid }, content };
}

/** Replace the whole first block with a fresh, UUID-LESS paragraph — one
 *  ReplaceStep that deletes the footnote-bearing block and provokes the
 *  backfill mint, the shape of a paste over a selection holding a footnote. */
function replaceFirstWithUnmintedBlock(editor: Editor) {
  const { state } = editor;
  const first = state.doc.firstChild!;
  const fresh = state.schema.nodes.paragraph.create(
    { uuid: null },
    state.schema.text("pasted"),
  );
  editor.view.dispatch(state.tr.replaceWith(0, first.nodeSize, fresh));
}

function footnoteNumbers(editor: Editor): Record<string, number> {
  const out: Record<string, number> = {};
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") out[node.attrs.footnoteId] = node.attrs.number;
    return true;
  });
  return out;
}

/** A test appender placed LAST in the array — after BlockUuidBackfill — that
 *  records what the door answers for the transactions it was handed. */
const handed: { count: number; diff: StructureDiff | null }[] = [];
const ProbeAppender = Extension.create({
  name: "test-probe-appender",
  // Lowest priority = LAST in the plugin array (TipTap sorts by priority),
  // so this appender runs after BlockUuidBackfill like the real consumers.
  priority: 1,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("test-probe-appender"),
        appendTransaction(transactions, _old, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          handed.push({ count: transactions.length, diff: readDiffFor(transactions, newState) });
          return null;
        },
      }),
    ];
  },
});

function makeEditor(extra: Extension[] = []) {
  return new Editor({
    extensions: [...buildEditorExtensions(mainCtx()), ...extra],
    content: {
      type: "doc",
      content: [
        para("p-one", "alpha", "fn-a", 1),
        para("p-two", "beta", "fn-b", 2),
        para("p-three", "gamma"),
      ],
    },
  });
}

describe("appenders see every transaction they were handed (task 1072)", () => {
  it("a footnote replaced away by an unminted block orphans WITH its body (carried in the diff) and renumbers in the same dispatch", async () => {
    const editor = makeEditor();
    const orphaned: { footnoteId: string; content: unknown }[] = [];
    const onOrphan = (e: Event) => orphaned.push((e as CustomEvent).detail);
    window.addEventListener("virgil-footnote-orphaned", onOrphan);
    try {
      replaceFirstWithUnmintedBlock(editor);

      // The backfill mint really did run (otherwise this leg proves nothing).
      expect(editor.state.doc.firstChild!.attrs.uuid).toBeTruthy();
      // Renumber ran in THIS dispatch: the surviving footnote is now #1.
      expect(footnoteNumbers(editor)).toEqual({ "fn-b": 1 });

      await new Promise((r) => setTimeout(r, 0));
      expect(orphaned.map((d) => d.footnoteId)).toEqual(["fn-a"]);
      expect(orphaned[0].content).toEqual(BODY);
    } finally {
      window.removeEventListener("virgil-footnote-orphaned", onOrphan);
      editor.destroy();
    }
  });

  it("REAL stack: a numberer that runs after the footnote renumber still sees the heading it was handed", () => {
    // Plugin order (real stack): footnoteOrphanDetector runs BEFORE
    // sectionNumbers. Deleting heading 1 together with footnote #1 makes the
    // footnote appender append a renumber, so sectionNumbers is handed
    // [delete, renumber]. Pre-fix it read only the renumber's diff — footnote
    // changes, no heading — gated itself off, and heading 2 kept "2".
    const heading = (uuid: string, text: string, sectionNumber: string) => ({
      type: "heading",
      attrs: { uuid, level: 1, sectionNumber },
      content: [{ type: "text", text }],
    });
    const editor = new Editor({
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          heading("h-one", "First", "1"),
          para("s-one", "alpha", "sfn-a", 1),
          heading("h-two", "Second", "2"),
          para("s-two", "beta", "sfn-b", 2),
        ],
      },
    });
    try {
      const { doc } = editor.state;
      const cut = doc.child(0).nodeSize + doc.child(1).nodeSize;
      editor.view.dispatch(editor.state.tr.delete(0, cut));
      // The footnote renumber really appended (else this leg proves nothing).
      expect(footnoteNumbers(editor)).toEqual({ "sfn-b": 1 });
      const first = editor.state.doc.firstChild!;
      expect(first.attrs.uuid).toBe("h-two");
      expect(first.attrs.sectionNumber).toBe("1");
    } finally {
      editor.destroy();
    }
  });

  it("an appender after the backfill is handed [user, mint] and the door reports the user's removal", () => {
    handed.length = 0;
    const editor = makeEditor([ProbeAppender]);
    try {
      replaceFirstWithUnmintedBlock(editor);
      // The first call is the multi-transaction case this task is about.
      const first = handed[0];
      expect(first.count).toBeGreaterThanOrEqual(2);
      expect(first.diff).not.toBeNull();
      expect(first.diff!.removedFootnotes.map((f) => f.id)).toEqual(["fn-a"]);
      expect(first.diff!.removedBlocks.map((b) => b.uuid)).toContain("p-one");
      // A removed footnote carries the body it left with.
      expect(first.diff!.removedFootnotes[0].removedContent).toEqual(BODY);
      // Round 2+ is handed only the appends — never re-told round 1's removal
      // (task 650's no-re-append invariant).
      for (const later of handed.slice(1)) {
        expect(later.diff?.removedFootnotes ?? []).toEqual([]);
        expect(later.diff?.removedBlocks ?? []).toEqual([]);
      }
    } finally {
      editor.destroy();
    }
  });

  it("a plain keystroke hands the appender ONE transaction and the door answers for it", () => {
    handed.length = 0;
    const editor = makeEditor([ProbeAppender]);
    try {
      // A plain keystroke: one transaction, no appender behind it.
      const end = editor.state.doc.child(0).nodeSize - 1;
      editor.view.dispatch(editor.state.tr.insertText("x", end - 1));
      expect(handed).toHaveLength(1);
      expect(handed[0].count).toBe(1);
      expect(handed[0].diff).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("no observer installed → null (the caller's walk fallback), never a forged EMPTY_DIFF", () => {
    const editor = new Editor({
      extensions: [...buildEditorExtensions(mainCtx()).filter((e) => e.name !== "docStructureObserver")],
      content: { type: "doc", content: [para("n-one", "alpha")] },
    });
    try {
      const tr = editor.state.tr.insertText("x", 1);
      const next = editor.state.apply(tr);
      expect(readDiffFor([tr], next)).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
