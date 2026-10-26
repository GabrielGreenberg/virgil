// @vitest-environment jsdom
/**
 * useStructuralRevisions is driven by ONE declared table (task 1301).
 *
 * Each counter bumps exactly when its `STRUCTURAL_REVISION_PREDICATES` row
 * holds for a structural emit. The hand-wired channel list this replaced
 * already disagreed with the predicates it mirrored: `labels` bumped only on
 * `onLabelsAdded` / `onLabelsRemoved`, so a label that MOVED with its owner
 * (`changedLabels`, task 1128) bumped nothing.
 *
 * Pinned:
 *   1. moving a labelled heading bumps `rev.labels` (fails on the old wiring);
 *   2. a hand-built diff carrying ONLY `changedLabels` bumps `labels` and no
 *      other category;
 *   3. every category reacts to its predicate and only to it — the counters
 *      are the table's rows, for every single-field diff;
 *   4. a plain keystroke bumps no counter (keystroke sanctity).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  DocStructureObserver,
  getBus,
  STRUCTURAL_REVISION_PREDICATES,
} from "@/lib/tiptap/doc-structure";
import { asMutable } from "@/lib/tiptap/doc-structure/bus";
import { EMPTY_DIFF, type StructureDiff } from "@/lib/tiptap/doc-structure/types";
import {
  createParagraphWithTitle,
  createHeadingWithLabel,
} from "@/lib/editor-extensions";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";

let rafQueue: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
  rafQueue = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue[id - 1] = () => {};
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
});

function frame() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}

function mountEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p0" },
          content: [{ type: "text", text: "Zero" }],
        },
        {
          type: "heading",
          attrs: { level: 1, uuid: "hB", label: "sec:b" },
          content: [{ type: "text", text: "Beta" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p1" },
          content: [{ type: "text", text: "One" }],
        },
      ],
    },
  });
}

function nodeRange(editor: Editor, uuid: string): [number, number] {
  let from = -1;
  let to = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs?.uuid === uuid) {
      from = offset;
      to = offset + node.nodeSize;
    }
  });
  return [from, to];
}

/** A diff with ONE field set to its non-empty value. */
function singleFieldDiff(field: keyof StructureDiff): StructureDiff {
  const empty = EMPTY_DIFF[field];
  let value: unknown;
  if (typeof empty === "boolean") value = true;
  else if (empty instanceof Set) value = new Set(["x"]);
  else value = [{}];
  return { ...EMPTY_DIFF, [field]: value } as StructureDiff;
}

describe("useStructuralRevisions — counters are the predicate table's rows (task 1301)", () => {
  it("moving a labelled heading bumps rev.labels", () => {
    const editor = mountEditor();
    try {
      const bus = getBus(editor)!;
      let sawChangedLabels = false;
      const off = bus.onAnyChange((d) => {
        if (d.changedLabels.length > 0) sawChangedLabels = true;
      });
      const { result } = renderHook(() => useStructuralRevisions(editor));
      const before = result.current.labels;

      act(() => {
        // Move heading hB (carrying \label{sec:b}) to the end of the doc.
        const [from, to] = nodeRange(editor, "hB");
        const node = editor.state.doc.nodeAt(from)!;
        const tr = editor.state.tr.delete(from, to);
        tr.insert(tr.doc.content.size, node);
        editor.view.dispatch(tr);
        frame();
      });
      off();

      expect(sawChangedLabels).toBe(true);
      expect(result.current.labels).toBe(before + 1);
    } finally {
      editor.destroy();
    }
  });

  it("a changedLabels-only diff bumps labels and nothing else", () => {
    const editor = mountEditor();
    try {
      const bus = asMutable(getBus(editor)!);
      const { result } = renderHook(() => useStructuralRevisions(editor));
      const before = { ...result.current };
      act(() => {
        bus._emit(singleFieldDiff("changedLabels"), bus.structure);
        frame();
      });
      expect(result.current).toEqual({ ...before, labels: before.labels + 1 });
    } finally {
      editor.destroy();
    }
  });

  it("for every single-field diff, exactly the categories whose predicate holds bump", () => {
    const editor = mountEditor();
    try {
      const bus = asMutable(getBus(editor)!);
      const { result } = renderHook(() => useStructuralRevisions(editor));
      for (const field of Object.keys(EMPTY_DIFF) as (keyof StructureDiff)[]) {
        const diff = singleFieldDiff(field);
        const before = { ...result.current };
        act(() => {
          bus._emit(diff, bus.structure);
          frame();
        });
        const expected = { ...before };
        for (const [k, pred] of Object.entries(STRUCTURAL_REVISION_PREDICATES)) {
          if (pred(diff)) expected[k as keyof typeof expected] += 1;
        }
        expect({ field, revs: result.current }).toEqual({ field, revs: expected });
      }
      // The table's keys ARE the hook's keys.
      expect(Object.keys(result.current).sort()).toEqual(
        Object.keys(STRUCTURAL_REVISION_PREDICATES).sort(),
      );
    } finally {
      editor.destroy();
    }
  });

  it("a plain keystroke bumps no counter", () => {
    const editor = mountEditor();
    try {
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useStructuralRevisions(editor);
      });
      const before = { ...result.current };
      const rendersBefore = renders;
      act(() => {
        const [from] = nodeRange(editor, "p0");
        editor.view.dispatch(editor.state.tr.insertText("z", from + 2));
        frame();
      });
      expect(result.current).toEqual(before);
      expect(renders).toBe(rendersBefore);
    } finally {
      editor.destroy();
    }
  });
});
