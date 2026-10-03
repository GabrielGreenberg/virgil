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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Footnote } from "@/lib/tiptap/footnote";
import { Citation } from "@/lib/tiptap/citation";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { SURFACE_EDITABLE_STORAGE_KEY } from "@/lib/tiptap/surface-editable";

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

// ── TASK 911 — the report is the EFFECT, not the attempt ───────────────────
//
// `commitCitationCreate` and the footnote creators register a card on
// `refused: false` ("the report is the permission"). On MAIN `view.editable` is
// pinned `true` and the read-only answer lives in `editableRef`, so the old
// pen-only gate (`collabReadOnly`) passed a read-only commit through to a
// transaction `readOnlyEnforcer` then dropped — and the door still reported a
// landed atom (with `pos` naming whatever sat before the caret).

/** A MAIN-shaped editor: `view.editable` stays true; the host's answer is an
 *  `editableRef` the enforcer both PUBLISHES (storage) and FILTERS on — the
 *  same shape `editor-extensions.ts` mounts. */
function mountMainShaped(editableRef: { current: boolean }): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const Enforcer = Extension.create({
    name: SURFACE_EDITABLE_STORAGE_KEY,
    addStorage: () => ({ editableRef }),
    addProseMirrorPlugins: () => [
      new Plugin({
        key: new PluginKey("testReadOnlyEnforcer"),
        filterTransaction: (tr) => editableRef.current || !tr.docChanged,
      }),
    ],
  });
  return new Editor({
    element,
    extensions: [StarterKit, Citation, Footnote, Enforcer],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    },
  });
}

/** An editor whose EVERY doc-changing transaction is vetoed by a filter the
 *  door has no gate for — the "any future filter" case. Editable by every
 *  gate's account, so only the landing measurement can catch it. */
function mountWithBlanketFilter(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const Veto = Extension.create({
    name: "testBlanketVeto",
    addProseMirrorPlugins: () => [
      new Plugin({
        key: new PluginKey("testBlanketVeto"),
        filterTransaction: (tr) => !tr.docChanged,
      }),
    ],
  });
  return new Editor({
    element,
    extensions: [StarterKit, Citation, Footnote, Veto],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    },
  });
}

describe("insertInlineAtom — reports only an insert that LANDED (task 911)", () => {
  it("MAIN-shaped read-only host (editableRef=false, view.editable=true): refuses, pos -1, doc untouched", () => {
    const ref = { current: true };
    const editor = mountMainShaped(ref);
    expect(editor.view.editable).toBe(true);
    ref.current = false; // the pen passes while the create popover is open
    const before = editor.state.doc;

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "cit-ro", command: "\\cite{a}", displayText: "" },
      at: 4,
    });
    flushRaf();

    expect(landed).toEqual({ pos: -1, refused: true });
    expect(editor.state.doc).toBe(before);
    expect(countType(editor, "citation")).toBe(0);
    editor.destroy();
  });

  it("a filter the door has no gate for vetoes the insert: refuses, pos -1, doc untouched", () => {
    const editor = mountWithBlanketFilter();
    editor.commands.setTextSelection(4);
    const before = editor.state.doc;

    const landed = insertInlineAtom({
      editor,
      type: "footnote",
      attrs: { footnoteId: "fn-veto", content: null, number: 0, title: "" },
    });
    flushRaf();

    expect(landed).toEqual({ pos: -1, refused: true });
    expect(editor.state.doc).toBe(before);
    expect(countType(editor, "footnote")).toBe(0);
    editor.destroy();
  });

  it("a landed insert reports the ATOM's own position, found by identity", () => {
    const ref = { current: true };
    const editor = mountMainShaped(ref);

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "cit-ok", command: "\\cite{a}", displayText: "" },
      at: 4,
    });
    flushRaf();

    expect(landed.refused).toBe(false);
    const node = editor.state.doc.nodeAt(landed.pos);
    expect(node?.type.name).toBe("citation");
    expect(node?.attrs.citationId).toBe("cit-ok");
    editor.destroy();
  });

  it("`commitCitationCreate`'s shape: no card registers when the pen passes mid-popover", () => {
    // The caller's seam, verbatim in shape: mint an id, commit at the captured
    // pos, and register the card ONLY on `!landed.refused` (pinned in source by
    // inline-atom-container-census "THE REPORT IS THE PERMISSION").
    const ref = { current: true };
    const editor = mountMainShaped(ref);
    const register = vi.fn();
    ref.current = false; // open-time gate passed; the pen flips before commit

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "cit-commit", command: "\\cite{k}", displayText: "" },
      at: 4,
    });
    if (!landed.refused) register("cit-commit");

    expect(register).not.toHaveBeenCalled();
    expect(countType(editor, "citation")).toBe(0);
    editor.destroy();
  });
});
