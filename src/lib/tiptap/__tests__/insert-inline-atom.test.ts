// @vitest-environment jsdom
//
// `insertInlineAtom` is the single no-scroll inline-atom insert primitive. The
// whole point is the documented invariant: inserting an inline atom must NEVER
// force a viewport scroll (footnote/citation are `selectable:false` for exactly
// this reason; the drop-mode helpers "NEVER `.scrollIntoView()`").
//
// The jump came from `.chain().focus()`: TipTap's `focus()` defaults to
// `scrollIntoView: true` and, inside a `requestAnimationFrame`, dispatches a
// deferred `editor.commands.scrollIntoView()` on the post-insert caret. So this
// test must FLUSH the rAF and then assert NO dispatched transaction carries the
// `scrolledIntoView` flag — and a contrast case proves the old `.focus()` pattern
// WOULD scroll, so a regression can't slip back in silently.
//
// (Mounts a real Editor with StarterKit + Footnote + Citation, the same way the
// sibling footnote-nested-citation test does; the storage stub guards the
// barrel/storage gotcha pulled in transitively.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Footnote } from "@/lib/tiptap/footnote";
import { Citation } from "@/lib/tiptap/citation";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";

/** Collected rAF callbacks so the deferred focus-scroll can be flushed
 *  deterministically (jsdom would otherwise never fire it). */
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushRaf() {
  // Drain repeatedly in case a flushed callback schedules another.
  let guard = 0;
  while (rafQueue.length && guard++ < 10) {
    const batch = rafQueue.splice(0);
    for (const cb of batch) cb(0);
  }
}

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, Citation, Footnote],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    },
  });
}

/** Spy on the view's dispatch, returning every transaction it sees so we can
 *  inspect the `scrolledIntoView` flag (set by `tr.scrollIntoView()`). A tr that
 *  asks to scroll is recorded but NOT forwarded — applying it would make PM call
 *  `coordsAtPos`→`getClientRects`, which jsdom doesn't implement. The no-scroll
 *  primitive never produces such a tr, so its txns all forward and apply. */
function spyDispatch(editor: Editor) {
  const seen: import("@tiptap/pm/state").Transaction[] = [];
  const orig = editor.view.dispatch.bind(editor.view);
  vi.spyOn(editor.view, "dispatch").mockImplementation((tr) => {
    seen.push(tr);
    if (tr.scrolledIntoView) return;
    return orig(tr);
  });
  return seen;
}

function countType(editor: Editor, name: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) n++;
    return true;
  });
  return n;
}

describe("insertInlineAtom — never scrolls the viewport", () => {
  it("inserts a footnote with NO scrolledIntoView transaction (even after rAF flush)", () => {
    const editor = mount();
    // Caret in the middle of the paragraph.
    editor.commands.setTextSelection(4);
    const seen = spyDispatch(editor);

    insertInlineAtom({
      editor,
      type: "footnote",
      attrs: { footnoteId: "fn-x", content: { type: "doc", content: [{ type: "paragraph" }] }, number: 0, title: "" },
    });
    flushRaf();

    expect(countType(editor, "footnote")).toBe(1);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(false);
    editor.destroy();
  });

  it("inserts a citation with NO scrolledIntoView transaction", () => {
    const editor = mount();
    editor.commands.setTextSelection(4);
    const seen = spyDispatch(editor);

    insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "cit-x", command: "\\cite{a}", displayText: "A 2020" },
    });
    flushRaf();

    expect(countType(editor, "citation")).toBe(1);
    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(false);
    editor.destroy();
  });

  it("a non-empty selection is replaced by the atom, still no scroll", () => {
    const editor = mount();
    // Select "hello" (positions 1..6 in "hello world").
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const seen = spyDispatch(editor);

    const { pos } = insertInlineAtom({
      editor,
      type: "footnote",
      attrs: { footnoteId: "fn-sel", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] }, number: 0, title: "" },
    });
    flushRaf();

    expect(countType(editor, "footnote")).toBe(1);
    // The selected word was consumed; the returned pos locates the new atom.
    expect(editor.state.doc.textContent).toBe(" world");
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(false);
    editor.destroy();
  });

  it("inserts at the captured `at` position even when the live selection drifted, still no scroll", () => {
    const editor = mount();
    // Trigger captured the caret at position 4 ("hel|lo world"). Then the live
    // selection drifts to the end of the doc (simulating any selection move
    // while a deferred popover was open — the citation create popover case).
    const capturedPos = 4;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const seen = spyDispatch(editor);

    insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "cit-at", command: "\\cite{a}", displayText: "A 2020" },
      at: capturedPos,
    });
    flushRaf();

    expect(countType(editor, "citation")).toBe(1);
    // The atom landed at the CAPTURED position (between "hel" and "lo"), not at
    // the drifted live selection at the doc end.
    const before = editor.state.doc.textBetween(0, capturedPos, " ");
    expect(before).toBe("hel");
    // And the citation node sits exactly at the captured pos.
    const nodeAtCaptured = editor.state.doc.nodeAt(capturedPos);
    expect(nodeAtCaptured?.type.name).toBe("citation");
    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(false);
    editor.destroy();
  });

  it("clamps an out-of-range `at` to the live doc instead of throwing", () => {
    const editor = mount();
    editor.commands.setTextSelection(4);
    const seen = spyDispatch(editor);

    // A wildly stale pos (past the doc end) must clamp, not throw.
    expect(() =>
      insertInlineAtom({
        editor,
        type: "citation",
        attrs: { citationId: "cit-oob", command: "\\cite{a}", displayText: "A" },
        at: 9999,
      }),
    ).not.toThrow();
    flushRaf();

    expect(countType(editor, "citation")).toBe(1);
    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(false);
    editor.destroy();
  });

  it("CONTRAST: the old `.chain().focus().insertContent()` DOES scroll (guards the regression)", () => {
    const editor = mount();
    editor.commands.setTextSelection(4);
    const seen = spyDispatch(editor);

    // The pattern this primitive replaces — focus() defaults scrollIntoView:true.
    editor
      .chain()
      .focus()
      .insertContent({ type: "citation", attrs: { citationId: "cit-old", command: "\\cite{b}", displayText: "B" } })
      .run();
    flushRaf();

    expect(seen.some((tr) => tr.scrolledIntoView)).toBe(true);
    editor.destroy();
  });
});
