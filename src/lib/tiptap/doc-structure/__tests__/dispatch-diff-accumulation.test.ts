// @vitest-environment jsdom
//
// Task 650 — ONE DISPATCH IS NOT ONE TRANSACTION.
//
// ProseMirror runs the whole `appendTransaction` loop inside a single
// `state.applyTransaction`, so the observer's `apply` runs once per
// TRANSACTION while its view hook runs once per DISPATCH. The plugin kept the
// diff in a single slot, so the last transaction's diff overwrote every
// earlier one — applied to the index, then silently discarded. Deleting a
// paragraph that contains a footnote provokes the footnote renumber appender,
// so the single most ordinary edit in a paper with footnotes published NO
// structural removal at all: no `onBlocksRemoved`, no `onFootnotesRemoved`.
//
// Both legs below run against the real `buildEditorExtensions("main")` stack.
// The CONTROL (an identical deletion with no footnote anywhere, so no appended
// transaction) passes on the pre-fix code — it is here so this file cannot go
// green by the detector going silent.

import { describe, it, expect, vi } from "vitest";

// Same storage stub as pending-diff-in-apply.test.ts — the extension barrel
// transitively imports `@/lib/storage` via the figure/tex NodeView components,
// and storage.ts picks its backend with a raw require vitest can't follow.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { getBus, readPendingDiff } from "@/lib/tiptap/doc-structure";
import type { BlockEntry, FootnoteEntry, StructureDiff } from "@/lib/tiptap/doc-structure/types";

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

/** A paragraph carrying `text`, plus a footnote atom when `footnoteId` is given. */
function para(uuid: string, text: string, footnoteId?: string, number = 1) {
  const content: Record<string, unknown>[] = [{ type: "text", text }];
  if (footnoteId) {
    content.push({
      type: "footnote",
      attrs: { footnoteId, linkId: footnoteId, number, content: null },
    });
  }
  return { type: "paragraph", attrs: { uuid }, content };
}

interface Capture {
  removedBlocks: string[][];
  removedFootnotes: string[][];
}

function watch(editor: Editor): Capture {
  const bus = getBus(editor)!;
  const cap: Capture = { removedBlocks: [], removedFootnotes: [] };
  bus.onBlocksRemoved((entries: readonly BlockEntry[]) =>
    cap.removedBlocks.push(entries.map((e) => e.uuid)),
  );
  bus.onFootnotesRemoved((entries: readonly FootnoteEntry[]) =>
    cap.removedFootnotes.push(entries.map((e) => e.id)),
  );
  return cap;
}

/** Delete the whole first top-level block. */
function deleteFirstBlock(editor: Editor) {
  const first = editor.state.doc.firstChild!;
  editor.view.dispatch(editor.state.tr.delete(0, first.nodeSize));
}

describe("a dispatch publishes every transaction's structural work (task 650)", () => {
  it("deleting a paragraph that contains a footnote emits BOTH the block removal and the footnote removal", () => {
    // The footnote renumber appender fires (deleting #1 of 2 shifts #2), so
    // this dispatch carries a SECOND transaction. Pre-fix, its diff clobbered
    // the deletion's and both emissions below were empty.
    const editor = new Editor({
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          para("p-one", "alpha", "fn-a", 1),
          para("p-two", "beta", "fn-b", 2),
          para("p-three", "gamma"),
        ],
      },
    });
    try {
      const cap = watch(editor);
      deleteFirstBlock(editor);

      expect(cap.removedBlocks.flat()).toContain("p-one");
      expect(cap.removedFootnotes.flat()).toContain("fn-a");
      // The index was always right; assert it stays right.
      const uuids = [...getBus(editor)!.structure.blocks.keys()];
      expect(uuids).toEqual(["p-two", "p-three"]);
    } finally {
      editor.destroy();
    }
  });

  it("CONTROL — the same deletion with no footnote anywhere (no appended tx) still emits the block removal", () => {
    const editor = new Editor({
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [para("c-one", "alpha"), para("c-two", "beta"), para("c-three", "gamma")],
      },
    });
    try {
      const cap = watch(editor);
      deleteFirstBlock(editor);
      expect(cap.removedBlocks.flat()).toContain("c-one");
    } finally {
      editor.destroy();
    }
  });

  it("one dispatch stays ONE structural emit even when it carries several transactions", () => {
    const editor = new Editor({
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          para("q-one", "alpha", "qfn-a", 1),
          para("q-two", "beta", "qfn-b", 2),
        ],
      },
    });
    try {
      const bus = getBus(editor)!;
      const before = bus.emitCount;
      deleteFirstBlock(editor);
      // Merge-and-emit-once, not emit-per-transaction: `emitCount` is defined
      // per USER GESTURE by the keystroke-sanctity law's probe.
      expect(bus.emitCount - before).toBe(1);
    } finally {
      editor.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Appended transactions that are themselves structurally silent.
// ---------------------------------------------------------------------------

/**
 * Records what `readPendingDiff` answers on EVERY transaction of a dispatch —
 * the shape a plugin `apply` reader has (`section-folding.ts`), deliberately
 * UNGATED so the doc-unchanged appended transaction is actually observed.
 *
 * Today's five `readPendingDiff` callers all open with
 * `transactions.some((tr) => tr.docChanged)` (or `if (!tr.docChanged)` in an
 * `apply`), and ProseMirror re-invokes an appender with only the transactions
 * it has not yet seen — so a doc-unchanged appended transaction returns them
 * early and none of them reaches the read. That is why this half of task 650
 * was LATENT rather than firing. It is pinned anyway, at the contract rather
 * than at today's callers: `null` is the signal reserved for "no observer
 * installed", whose fallback is a full doc walk, and a transaction that
 * produced no diff must not be able to forge it.
 */
const seenPerTx: (StructureDiff | null)[] = [];
const ProbeEveryTx = Extension.create({
  name: "test-probe-every-tx",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        state: {
          init: () => null,
          apply(_tr, value, _old, newState) {
            seenPerTx.push(readPendingDiff(newState));
            return value;
          },
        },
      }),
    ];
  },
});

/**
 * A test-only appender. `mode: "meta"` appends a DOC-UNCHANGED transaction
 * (the latent half — no such appender exists in `src` today, and nothing
 * guarded against one); `mode: "attr"` appends a doc-changing but
 * structurally-null one (an `EMPTY_DIFF` transaction, the footnote renumber's
 * shape).
 */
function appenderExtension(mode: "meta" | "attr") {
  return Extension.create({
    name: "test-appender",
    addProseMirrorPlugins() {
      const key = new PluginKey("test-appender");
      let armed = true;
      return [
        new Plugin({
          key,
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            if (!armed) return null;
            armed = false;
            if (mode === "meta") return newState.tr.setMeta("test-appender", true);
            // Re-stamp a footnote's `number` with the value it already has:
            // docChanged, attr-only, structurally AND content null → EMPTY_DIFF.
            let found = -1;
            newState.doc.descendants((node, p) => {
              if (found === -1 && node.type.name === "footnote") found = p;
              return true;
            });
            if (found === -1) return null;
            return newState.tr.setNodeAttribute(
              found,
              "number",
              newState.doc.nodeAt(found)!.attrs.number,
            );
          },
        }),
      ];
    },
  });
}

describe("a structurally-silent appended transaction cannot erase the dispatch's diff", () => {
  function run(mode: "meta" | "attr") {
    seenPerTx.length = 0;
    const editor = new Editor({
      extensions: [
        ...buildEditorExtensions(mainCtx()),
        appenderExtension(mode),
        ProbeEveryTx,
      ],
      content: {
        type: "doc",
        content: [
          para("a-one", "alpha"),
          para("a-two", "beta", "afn-b", 1),
          para("a-three", "gamma"),
        ],
      },
    });
    const cap = watch(editor);
    seenPerTx.length = 0;
    deleteFirstBlock(editor);
    return { editor, cap };
  }

  it("a DOC-UNCHANGED appended transaction (meta-only) — the removal is still published", () => {
    const { editor, cap } = run("meta");
    try {
      expect(cap.removedBlocks.flat()).toContain("a-one");
    } finally {
      editor.destroy();
    }
  });

  it("…and a same-dispatch `readPendingDiff` consumer is never handed `null`", () => {
    // Pre-fix the doc-unchanged appended tx nulled the slot, so a consumer
    // reading after it saw `null` and took its observer-absent full-doc-walk
    // fallback. The dispatch carries two transactions (the delete, then the
    // appended meta-only one), so the probe reads at least twice.
    const { editor } = run("meta");
    try {
      expect(seenPerTx.length).toBeGreaterThanOrEqual(2);
      for (const diff of seenPerTx) expect(diff).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("an EMPTY_DIFF appended transaction (attr-only) — the removal is still published", () => {
    // Pre-fix this was total loss: the slot held EMPTY_DIFF, so the view hook
    // returned early and the dispatch emitted nothing whatsoever.
    const { editor, cap } = run("attr");
    try {
      expect(cap.removedBlocks.flat()).toContain("a-one");
    } finally {
      editor.destroy();
    }
  });
});

describe("keystroke sanctity is unchanged by the accumulation", () => {
  it("typing N plain characters leaves emitCount flat", () => {
    const editor = new Editor({
      extensions: buildEditorExtensions(mainCtx()),
      content: { type: "doc", content: [para("t-one", "alpha")] },
    });
    try {
      const bus = getBus(editor)!;
      const before = bus.emitCount;
      for (let i = 0; i < 12; i++) {
        editor.view.dispatch(editor.state.tr.insertText("x", 3, 3));
      }
      expect(bus.emitCount).toBe(before);
    } finally {
      editor.destroy();
    }
  });
});
