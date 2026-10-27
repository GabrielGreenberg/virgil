// @vitest-environment jsdom
//
// TASK 1071 — the atom edit popovers (math, `\ref`, figure) ask ONE door.
//
// Leg 1: MAIN pins `view.editable = true` for its whole life; read-only (the
// Library Reader) and the cowork pen live in `readOnlyEnforcer`. The math click
// gated on `editor.isEditable` — a constant on MAIN — so a read-only doc opened
// the popover and its save was silently filtered; `\ref` had no gate at all.
// Every leg builds the Reader's shape (`editable: true` + host ref `false`) on a
// REAL extension stack and is paired with a positive control.
//
// Leg 2: the math save wrote "whatever math now sits at `pos`". Doc `$a$ $b$`:
// click `$a$`, an external write removes it, `$b$` slides onto `pos`, Save
// overwrote `$b$`. The commit now names the CLICKED formula (kind + latex).
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import type { RefObject } from "react";
import { Editor, type JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { REF_CLICK_EVENT } from "@/lib/tiptap/label";
import {
  applyMathEdit,
  atomPopoverMayOpen,
  resolveAtomEditTarget,
  trackAtomPos,
} from "@/lib/tiptap/atom-edit-target";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeAll(() => {
  const empty = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => empty;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => zero;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => empty;
});

const mounted: Editor[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.destroy();
  document.body.innerHTML = "";
});

const TWO_MATHS: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "p-1" },
      content: [
        { type: "inlineMath", attrs: { latex: "a" } },
        { type: "text", text: " " },
        { type: "inlineMath", attrs: { latex: "b" } },
      ],
    },
  ],
};

const A_REF: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "p-1" },
      content: [
        { type: "text", text: "see " },
        { type: "labelRef", attrs: { label: "sec:intro", refCommand: "ref" } },
      ],
    },
  ],
};

function mountMain(hostEditable: boolean, content: JSONContent) {
  const editableRef: RefObject<boolean> = { current: hostEditable };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true, // MAIN's pin, the Reader's shape
    extensions: buildEditorExtensions(ctx),
    content,
  });
  mounted.push(editor);
  return { editor, editableRef };
}

function posesOf(editor: Editor, typeName: string): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === typeName) out.push(p);
  });
  return out;
}

function clickCount(editor: Editor, selector: string, event: string): number {
  let fired = 0;
  const on = () => fired++;
  window.addEventListener(event, on);
  try {
    const el = editor.view.dom.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error(`${selector} did not mount`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  } finally {
    window.removeEventListener(event, on);
  }
  return fired;
}

describe("atom popover door — read-only MAIN (task 1071, leg 1)", () => {
  it("the door reads the HOST axis isEditable cannot see", () => {
    const ro = mountMain(false, TWO_MATHS);
    expect(ro.editor.isEditable).toBe(true); // the lie the old gate asked
    expect(atomPopoverMayOpen(ro.editor)).toBe(false);
    const rw = mountMain(true, TWO_MATHS);
    expect(atomPopoverMayOpen(rw.editor)).toBe(true);
  });

  it("a math click on a read-only MAIN dispatches no virgil-math-click (control: editable fires)", () => {
    const ro = mountMain(false, TWO_MATHS);
    expect(clickCount(ro.editor, ".inline-math", "virgil-math-click")).toBe(0);
    const rw = mountMain(true, TWO_MATHS);
    expect(clickCount(rw.editor, ".inline-math", "virgil-math-click")).toBe(1);
  });

  it("a \\ref click on a read-only MAIN opens nothing (control: editable fires)", () => {
    const ro = mountMain(false, A_REF);
    expect(clickCount(ro.editor, ".label-ref-node", REF_CLICK_EVENT)).toBe(0);
    const rw = mountMain(true, A_REF);
    expect(clickCount(rw.editor, ".label-ref-node", REF_CLICK_EVENT)).toBe(1);
  });

  it("a commit refuses when the pen/host flips read-only while the popover is open", () => {
    const m = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(m.editor, "inlineMath");
    m.editableRef.current = false;
    expect(applyMathEdit(m.editor, trackAtomPos(m.editor, posA), { kind: "inline", latex: "a" }, "z")).toBe(false);
    const [refPos] = posesOf(mountMain(false, A_REF).editor, "labelRef");
    const ro = mounted[mounted.length - 1];
    expect(
      resolveAtomEditTarget(ro, trackAtomPos(ro, refPos), (n) => n.type.name === "labelRef"),
    ).toBeNull();
    // Control: editable again → the same commit lands.
    m.editableRef.current = true;
    expect(applyMathEdit(m.editor, trackAtomPos(m.editor, posA), { kind: "inline", latex: "a" }, "z")).toBe(true);
    expect(m.editor.state.doc.nodeAt(posA)?.attrs.latex).toBe("z");
  });
});

describe("math save addresses the CLICKED formula (task 1071, leg 2)", () => {
  it("`$a$ $b$`: click $a$, external write deletes it, Save leaves $b$ unchanged", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    const clicked = { kind: "inline" as const, latex: "a" };
    const at = trackAtomPos(editor, posA); // started at click, as the bridge does
    // The external write: remove `$a$ ` — `$b$` slides onto posA.
    editor.view.dispatch(editor.state.tr.delete(posA, posA + 2));
    expect(editor.state.doc.nodeAt(posA)?.attrs.latex).toBe("b");
    expect(applyMathEdit(editor, at, clicked, "z")).toBe(false);
    expect(editor.state.doc.nodeAt(posA)?.attrs.latex).toBe("b");
  });

  it("an inline↔display swap at pos is refused", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    expect(applyMathEdit(editor, trackAtomPos(editor, posA), { kind: "display", latex: "a" }, "z")).toBe(false);
    expect(editor.state.doc.nodeAt(posA)?.attrs.latex).toBe("a");
  });

  it("control: the unmoved clicked formula saves", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [, posB] = posesOf(editor, "inlineMath");
    expect(applyMathEdit(editor, trackAtomPos(editor, posB), { kind: "inline", latex: "b" }, "z")).toBe(true);
    expect(editor.state.doc.nodeAt(posB)?.attrs.latex).toBe("z");
  });

  it("a stale pos past the doc end is a safe no-op", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    expect(applyMathEdit(editor, trackAtomPos(editor, 9999), { kind: "inline", latex: "a" }, "z")).toBe(false);
  });
});

describe("the edit popovers FOLLOW the document (task 1314)", () => {
  it("math: an insertion BEFORE the clicked formula while the popover is open → Save lands on it", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    const at = trackAtomPos(editor, posA); // the click
    editor.commands.insertContentAt(1, "xyz"); // an upstream edit lands meanwhile
    expect(applyMathEdit(editor, at, { kind: "inline", latex: "a" }, "z")).toBe(true);
    const [a, b] = posesOf(editor, "inlineMath").map((p) => editor.state.doc.nodeAt(p)?.attrs.latex);
    expect([a, b]).toEqual(["z", "b"]);
    at.dispose();
  });

  it("an insertion exactly AT the atom's start goes before it — the address stays on the clicked atom", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [, posB] = posesOf(editor, "inlineMath");
    const at = trackAtomPos(editor, posB);
    editor.commands.insertContentAt(posB, "q");
    expect(at.get()).toBe(posB + 1);
    expect(applyMathEdit(editor, at, { kind: "inline", latex: "b" }, "z")).toBe(true);
    at.dispose();
  });

  it("the clicked formula deleted meanwhile → refused (the caller announces it), no write", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    const at = trackAtomPos(editor, posA);
    editor.view.dispatch(editor.state.tr.delete(posA, posA + 1));
    expect(applyMathEdit(editor, at, { kind: "inline", latex: "a" }, "z")).toBe(false);
    expect(posesOf(editor, "inlineMath").map((p) => editor.state.doc.nodeAt(p)?.attrs.latex)).toEqual(["b"]);
  });

  it("a whole-document replacement nulls the tracker → refused", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    const at = trackAtomPos(editor, posA);
    editor.commands.setContent(TWO_MATHS);
    expect(at.get()).toBeNull();
    expect(applyMathEdit(editor, at, { kind: "inline", latex: "a" }, "z")).toBe(false);
  });

  it("a disposed tracker stops following (no subscriber outlives the popover)", () => {
    const { editor } = mountMain(true, TWO_MATHS);
    const [posA] = posesOf(editor, "inlineMath");
    const at = trackAtomPos(editor, posA);
    at.dispose();
    editor.commands.insertContentAt(1, "xyz");
    expect(at.get()).toBe(posA);
  });
});
