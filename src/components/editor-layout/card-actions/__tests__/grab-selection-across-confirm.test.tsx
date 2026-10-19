// @vitest-environment jsdom
//
// TASK 1181 — a grab-bar Archive/Delete on a SELECTION ref acts on the passage
// the user selected, not on whatever sits at its old offsets after the confirm.
//
// A selection ref names its passage by nothing but `from`/`to`. The dispatcher
// awaits a confirm (unbounded user time) and then resolved those numbers by
// CLAMPING them to the current doc — so an edit above the passage that landed
// while the dialog was open (an external reload, a cowork apply, an anchor
// mint) made Confirm destroy text the user never selected. The dispatch now
// follows its target across every await (`trackDispatchTarget`): the ref is
// re-issued at its MAPPED span, and a passage that was itself edited or removed
// meanwhile is a loud refusal.
//
// Every leg drives the REAL dispatcher on the REAL main extension stack, with
// the foreign edit dispatched from inside the pending `confirm`.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { cleanup, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import { trackDispatchTarget } from "../grab-menu-target";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

const FIXTURE = (): JSONContent[] => [
  { type: "paragraph", attrs: { uuid: "p-A" }, content: [{ type: "text", text: "alpha beta gamma" }] },
  { type: "paragraph", attrs: { uuid: "p-B" }, content: [{ type: "text", text: "second" }] },
];

/** "beta" — paragraph opens at 0, its text at 1, "alpha " is 6 chars. */
const BETA: DragHandleRef = { kind: "selection", from: 7, to: 11, paragraphId: "p-A" };

function mountHost(): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content: FIXTURE() },
  });
}

function makeHarness(editor: Editor, duringConfirm: () => void) {
  const notify = vi.fn();
  const confirm = vi.fn(async () => {
    duringConfirm();
    return true;
  });
  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation: new Proxy(
      {},
      { get: () => () => ({ id: "card-1", footnoteId: "card-1" }) },
    ) as unknown as DragHandleActionsDeps["cardCreation"],
    cardLifecycle: { get: () => ({ clone: () => "c", delete: () => {} }) },
    anchorRetarget: { retarget: () => [] },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
  };
  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: (a: DragHandleAction, r: DragHandleRef) => result.current.dispatch(a, r),
    notify,
    confirm,
  };
}

const texts = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.textContent));
  return out;
};

beforeEach(installLayoutShims);
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("task 1181 — a selection ref is carried across the confirm await", () => {
  for (const action of ["delete", "archive"] as const) {
    it(`${action}: an insert ABOVE the passage during the confirm → the ORIGINAL passage goes`, async () => {
      const editor = mountHost();
      const h = makeHarness(editor, () => {
        editor.view.dispatch(editor.state.tr.insertText("XYZ ", 1));
      });

      await h.dispatch(action, BETA);

      expect(h.confirm, "the fixture must exercise the confirm gap").toHaveBeenCalledTimes(1);
      // Clamped raw offsets would have cut "pha " out of "XYZ alpha beta gamma".
      expect(texts(editor)).toEqual(["XYZ alpha  gamma", "second"]);
      expect(h.notify).not.toHaveBeenCalled();
      editor.destroy();
    });

    it(`${action}: a whole BLOCK inserted before the passage → still the original passage`, async () => {
      const editor = mountHost();
      const h = makeHarness(editor, () => {
        const para = editor.schema.nodes.paragraph.create(
          { uuid: "p-0" },
          editor.schema.text("inserted above"),
        );
        editor.view.dispatch(editor.state.tr.insert(0, para));
      });

      await h.dispatch(action, BETA);

      expect(texts(editor)).toEqual(["inserted above", "alpha  gamma", "second"]);
      editor.destroy();
    });

    it(`${action}: the passage ITSELF edited during the confirm → loud refusal, nothing removed`, async () => {
      const editor = mountHost();
      const h = makeHarness(editor, () => {
        editor.view.dispatch(editor.state.tr.insertText("!", 9)); // "be!ta"
      });

      await h.dispatch(action, BETA);

      expect(texts(editor)).toEqual(["alpha be!ta gamma", "second"]);
      expect(h.notify, "the user confirmed — the refusal must be loud").toHaveBeenCalledTimes(1);
      expect(String(h.notify.mock.calls[0][0].message)).toMatch(/changed while you were confirming/);
      editor.destroy();
    });
  }

  it("positive control: no edit during the confirm → the passage goes, unchanged behavior", async () => {
    const editor = mountHost();
    const h = makeHarness(editor, () => {});
    await h.dispatch("delete", BETA);
    expect(texts(editor)).toEqual(["alpha  gamma", "second"]);
    editor.destroy();
  });

  it("block ref path unchanged: Delete on a paragraph ref still addresses by uuid", async () => {
    const editor = mountHost();
    const h = makeHarness(editor, () => {
      editor.view.dispatch(editor.state.tr.insertText("XYZ ", 1));
    });
    await h.dispatch("delete", { kind: "paragraph", id: "p-A" });
    expect(texts(editor)).toEqual(["second"]);
    editor.destroy();
  });
});

describe("task 1181 — trackDispatchTarget", () => {
  it("follow() carries a span through edits recorded after a checkpoint; a collapsed span is null", () => {
    const editor = mountHost();
    const tracker = trackDispatchTarget(editor, { kind: "paragraph", id: "p-B" });
    editor.view.dispatch(editor.state.tr.insertText("Q", 1)); // before the mark
    const mark = tracker.checkpoint();
    const span = { from: 19, to: 27 }; // p-B after the first insert
    editor.view.dispatch(editor.state.tr.insertText("RR", 1));
    expect(tracker.follow({ kind: "paragraph", id: "p-B" }, span, mark)).toEqual({ from: 21, to: 29 });
    editor.view.dispatch(editor.state.tr.delete(21, 29));
    expect(tracker.follow({ kind: "paragraph", id: "p-B" }, span, mark)).toBeNull();
    tracker.dispose();
    editor.destroy();
  });

  it("dispose() stops recording — the subscription lives only while the dispatch is in flight", () => {
    const editor = mountHost();
    const tracker = trackDispatchTarget(editor, BETA);
    tracker.dispose();
    editor.view.dispatch(editor.state.tr.insertText("XYZ ", 1));
    expect(tracker.checkpoint()).toBe(0);
    expect(tracker.current()).toBe(BETA);
    editor.destroy();
  });
});
