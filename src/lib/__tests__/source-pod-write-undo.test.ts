// @vitest-environment jsdom
//
// Source-pod undo — task 1533's contract: undo in MAIN never replaces code
// typed in a popped-out source pod with an older snapshot.
//
// THE BUG: every write to a texBlock/forestBlock was a whole-node
// `setNodeMarkup` (a leaf ReplaceStep whose inverse restores ALL attrs), the
// float's code writes were unrecorded while the float's TITLE write and every
// in-place write were recorded — so a main Cmd-Z replayed an old whole-node
// snapshot over the float's code.
//
// THE FIX: one door, `writeSourcePodAttrs` — recorded in-place writes are
// per-attr AttrSteps; unrecorded float writes stay a whole-node replace, which
// drops main's older AttrStep items for the pod instead of letting them revert.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import {
  writeSourcePodAttrs,
  SOURCE_POD_GROUP_DELAY_MS,
  type SourcePodWriteOrigin,
} from "@/lib/tiptap/source-pod-write";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

const ctx: EditorExtensionsCtx = {
  surface: "main",
  editableRef: { current: true },
  editable: true,
  cardContext: false,
  callbacks: {},
  docIdRef: { current: null },
  anchoredUuidsRef: { current: new Set<string>() },
  host: null,
};

const editors: Editor[] = [];
let now = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  now = 1_000_000;
  vi.setSystemTime(now);
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const POD = "pod-1";

function mount(code = "A"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const content: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-1" }, content: [{ type: "text", text: "Hello" }] },
      { type: "texBlock", attrs: { uuid: POD, code } },
    ],
  };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content,
  });
  editors.push(editor);
  return editor;
}

function pod(editor: Editor) {
  const src = findSourceNodeByUuid(editor.state.doc, POD, "texBlock");
  if (!src) throw new Error("pod missing");
  return src;
}

const FLOAT: SourcePodWriteOrigin = { kind: "float", floatId: `texBlock:${POD}` };
const IN_PLACE: SourcePodWriteOrigin = { kind: "in-place" };

function write(editor: Editor, attrs: Record<string, unknown>, origin: SourcePodWriteOrigin) {
  const src = pod(editor);
  return writeSourcePodAttrs(editor.view, src.start, src.node, attrs, origin);
}

/** Advance the clock past the history group delay. */
function later() {
  now += SOURCE_POD_GROUP_DELAY_MS + 100;
  vi.setSystemTime(now);
}

function soon() {
  now += 50;
  vi.setSystemTime(now);
}

const code = (e: Editor) => pod(e).node.attrs.code as string;
const title = (e: Editor) => pod(e).node.attrs.parTitle as string | null;

describe("source-pod write door — main undo never reverts float-typed code", () => {
  it("member 1: a float title commit then float code writes; main undo keeps the float code", () => {
    const e = mount("A");
    // A prior, unrelated main edit, so undo has something to do.
    e.commands.insertContentAt(1, "x");
    later();
    write(e, { parTitle: "T" }, FLOAT);
    soon();
    write(e, { code: "AB" }, FLOAT);
    soon();
    write(e, { code: "ABC" }, FLOAT);
    later();
    expect(code(e)).toBe("ABC");
    e.commands.undo();
    expect(code(e)).toBe("ABC");
    expect(title(e)).toBe("T");
  });

  it("the float title write is unrecorded and tagged as a float write", () => {
    const e = mount("A");
    let seen: { history: unknown; meta: unknown } | null = null;
    e.on("transaction", ({ transaction }) => {
      seen = {
        history: transaction.getMeta("addToHistory"),
        meta: transaction.getMeta(FLOAT_WRITE_META),
      };
    });
    write(e, { parTitle: "T" }, FLOAT);
    expect(seen).toEqual({ history: false, meta: `texBlock:${POD}` });
  });

  it("member 2: an in-place edit then float edits; main undo does not restore the in-place snapshot", () => {
    const e = mount("A");
    write(e, { code: "A1" }, IN_PLACE);
    later();
    write(e, { code: "A1 float" }, FLOAT);
    later();
    e.commands.undo();
    expect(code(e)).toBe("A1 float");
  });

  it("an in-place title undo touches only the title, never the code", () => {
    const e = mount("A");
    write(e, { parTitle: "T" }, IN_PLACE);
    later();
    write(e, { code: "AZ" }, IN_PLACE);
    later();
    e.commands.undo();
    expect(code(e)).toBe("A");
    expect(title(e)).toBe("T");
    e.commands.undo();
    expect(title(e)).toBe(null);
    expect(code(e)).toBe("A");
    e.commands.redo();
    expect(title(e)).toBe("T");
  });

  it("in-place typing still groups into one undo step within the group delay", () => {
    const e = mount("A");
    write(e, { code: "Ah" }, IN_PLACE);
    soon();
    write(e, { code: "Ahi" }, IN_PLACE);
    soon();
    write(e, { code: "Ahi!" }, IN_PLACE);
    later();
    write(e, { code: "Ahi! more" }, IN_PLACE);
    e.commands.undo();
    expect(code(e)).toBe("Ahi!");
    e.commands.undo();
    expect(code(e)).toBe("A");
  });

  it("an intervening main edit breaks the in-place group", () => {
    const e = mount("A");
    write(e, { code: "Ah" }, IN_PLACE);
    soon();
    e.commands.insertContentAt(1, "x");
    soon();
    write(e, { code: "Ahi" }, IN_PLACE);
    e.commands.undo();
    expect(code(e)).toBe("Ah");
  });

  it("an unchanged write dispatches nothing", () => {
    const e = mount("A");
    const before = e.state;
    expect(write(e, { code: "A" }, IN_PLACE)).toBe("unchanged");
    expect(write(e, { code: "A" }, FLOAT)).toBe("unchanged");
    expect(e.state).toBe(before);
  });
});

describe("a leaf's structural attr edit (Outline rename) is per-attr too", () => {
  it("a recorded pod title rename then float code; main undo keeps the float code", async () => {
    const { editStructuredNodeByUuid } = await import("@/lib/tiptap/structural-edit");
    const e = mount("A");
    expect(
      editStructuredNodeByUuid(e as never, POD, {
        setAttrs: (a) => ({ ...a, parTitle: "Renamed" }),
      }),
    ).toBe(true);
    later();
    write(e, { code: "A typed" }, FLOAT);
    later();
    e.commands.undo();
    expect(code(e)).toBe("A typed");
  });
});
