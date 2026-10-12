// @vitest-environment jsdom
/**
 * Task 1076 — the example keymaps mint and reshape example blocks through the
 * ONE attrs door (`src/lib/example-block-attrs.ts`):
 *
 *  - DIALECT: Enter-escape and Shift-Tab promote inherit the dialect of the
 *    block they leave, so a linguex paper keeps getting `\ex.` (they used to
 *    hand-list attrs with no `dialect`, defaulting to expex `\ex … \xe`).
 *  - KIND: Enter on an empty trailing item that deletes the block's last item
 *    list re-derives `kind` to "single" (it used to stay "multi" and serialize
 *    a `\pex` with no parts).
 *
 * Drives the REAL `buildEditorExtensions("main")` stack through
 * `handleKeyDown` — a direct tr cannot see which command a keymap chooses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";

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

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function mount(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(ed);
  return ed;
}

function press(ed: Editor, key: string, opts: KeyboardEventInit = {}): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key, ...opts })),
    ) ?? false
  );
}

/** Caret at the END (or start) of the first textblock whose text is `text`. */
function caret(ed: Editor, text: string, at: "start" | "end" = "end") {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) {
      pos = at === "start" ? p + 1 : p + 1 + n.content.size;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no textblock "${text}"`);
  ed.commands.setTextSelection(pos);
}

function examples(ed: Editor): PMNode[] {
  const out: PMNode[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === "exampleBlock") out.push(n);
    return true;
  });
  return out;
}

const para = (text?: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };

const item = (text?: string): JSONContent => ({
  type: "exampleItem",
  attrs: { tag: "", label: "", subLabel: "" },
  content: [para(text)],
});

const block = (
  dialect: "expex" | "linguex",
  kind: "single" | "multi",
  content: JSONContent[],
  uuid: string,
): JSONContent => ({
  type: "exampleBlock",
  attrs: { uuid, kind, dialect, tag: "", label: "" },
  content,
});

describe("task 1076 — Enter-escape mints in the escaped block's dialect", () => {
  it("a linguex example escapes into a linguex sibling (serializes \\ex., never \\xe)", () => {
    const ed = mount([block("linguex", "single", [para("Susan left.")], "exA1")]);
    caret(ed, "Susan left.");
    expect(press(ed, "Enter")).toBe(true);
    const ex = examples(ed);
    expect(ex).toHaveLength(2);
    expect(ex[1].attrs.dialect).toBe("linguex");
    expect(ex[1].attrs.kind).toBe("single");
    const tex = serializeBodyOnly(ed.getJSON());
    expect(tex).not.toContain("\\xe");
  });

  it("an expex example still escapes into an expex sibling", () => {
    const ed = mount([block("expex", "single", [para("Susan left.")], "exB1")]);
    caret(ed, "Susan left.");
    expect(press(ed, "Enter")).toBe(true);
    const ex = examples(ed);
    expect(ex).toHaveLength(2);
    expect(ex[1].attrs.dialect).toBe("expex");
  });
});

describe("task 1076 — Shift-Tab promote mints in the source block's dialect", () => {
  it("promoting a linguex sub-item yields a linguex block", () => {
    const ed = mount([
      block("linguex", "multi", [{ type: "exampleItemList", content: [item("one"), item("two")] }], "exC1"),
    ]);
    caret(ed, "two", "start");
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    const ex = examples(ed);
    expect(ex).toHaveLength(2);
    expect(ex[1].attrs.dialect).toBe("linguex");
    expect(ex[1].attrs.kind).toBe("single");
    expect(serializeBodyOnly(ed.getJSON())).not.toContain("\\xe");
  });
});

describe("task 1076 — Enter-escape re-derives kind from content", () => {
  it("[para, list[empty item]] + Enter → kind single, serializes \\ex (no part-less \\pex)", () => {
    const ed = mount([
      block("expex", "multi", [para("Context:"), { type: "exampleItemList", content: [item()] }], "exD1"),
    ]);
    // caret into the empty item paragraph
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "paragraph" && n.content.size === 0) pos = p + 1;
      return true;
    });
    ed.commands.setTextSelection(pos);
    expect(press(ed, "Enter")).toBe(true);
    const first = examples(ed)[0];
    let hasList = false;
    first.forEach((c) => {
      if (c.type.name === "exampleItemList") hasList = true;
    });
    expect(hasList).toBe(false);
    expect(first.attrs.kind).toBe("single");
    const tex = serializeBodyOnly(ed.getJSON());
    expect(tex).not.toMatch(/\\pex/);
    expect(tex).toMatch(/\\ex\b/);
  });
});
