// @vitest-environment jsdom
//
// Task 1496 — a MODIFIED Enter after a typed `\command` does what it does after
// ordinary text. The popup-less Enter door (`virgilCommands`) gated on
// `isCommitEnter` alone, which leaves modifiers to the caller, and this caller
// never asked: `hello \section` + Shift+Enter turned the paragraph into a
// heading instead of inserting a hard break. Both slash Enter doors now ask
// `isPlainCommitEnter`.
//
// Also pinned: an ESCAPED backslash (`\\section` — a literal `\\` then prose)
// is not a command.
//
// Driven through the REAL `buildEditorExtensions("main")` stack, with keydown
// dispatched on `view.dom`.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { isPlainCommitEnter } from "@/lib/key-intent";

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

function mount(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text }],
        },
      ],
    },
  });
  // Caret at the end of the paragraph.
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + text.length),
    ),
  );
  return editor;
}

type Mods = Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>>;

function pressEnter(ed: Editor, mods: Mods = {}): void {
  ed.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      bubbles: true,
      cancelable: true,
      ...mods,
    }),
  );
}

/** The doc after `mods`+Enter at the end of `text`, as JSON. */
function afterEnter(text: string, mods: Mods): unknown {
  const ed = mount(text);
  pressEnter(ed, mods);
  const json = ed.getJSON();
  ed.destroy();
  editor = null;
  return json;
}

/**
 * A doc's SHAPE: each block's type, its non-text children, and its text with
 * `from` replaced by `to` — so two docs built from different text compare by
 * what the key did, not by the words or by the `latexCommand` carrier mark the
 * typed `\name` keeps.
 */
function shape(json: unknown, from: string, to: string): string {
  type J = { type: string; text?: string; content?: J[] };
  const blocks = ((json as J).content ?? []).map((b) => ({
    type: b.type,
    atoms: (b.content ?? []).filter((c) => c.type !== "text").map((c) => c.type),
    text: (b.content ?? [])
      .map((c) => c.text ?? "")
      .join("")
      .split(from)
      .join(to),
  }));
  return JSON.stringify(blocks);
}

describe("isPlainCommitEnter", () => {
  const base = { key: "Enter", keyCode: 13, isComposing: false };
  it("answers only an unmodified, non-IME Enter", () => {
    expect(isPlainCommitEnter({ ...base, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    for (const m of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      expect(
        isPlainCommitEnter({ ...base, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, [m]: true }),
      ).toBe(false);
    }
    expect(
      isPlainCommitEnter({ ...base, isComposing: true, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }),
    ).toBe(false);
  });
});

describe("modified Enter after a typed \\command (task 1496)", () => {
  it("plain Enter still converts `hello \\section` into a heading", () => {
    const ed = mount("hello \\section");
    pressEnter(ed);
    expect(ed.state.doc.firstChild?.type.name).toBe("heading");
    expect(ed.state.doc.textContent).not.toContain("\\section");
  });

  for (const mods of [
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ] as Mods[]) {
    const label = Object.keys(mods)[0];
    it(`${label}+Enter does exactly what it does after ordinary text`, () => {
      const baseline = afterEnter("hello section!", mods);
      const actual = afterEnter("hello \\section", mods);
      expect(shape(actual, "hello \\section", "X")).toBe(
        shape(baseline, "hello section!", "X"),
      );
      expect(JSON.stringify(actual)).not.toContain('"heading"');
    });
  }

  it("Shift+Enter inserts a hard break and keeps the typed text", () => {
    const ed = mount("hello \\section");
    pressEnter(ed, { shiftKey: true });
    const para = ed.state.doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("hello \\section");
    let breaks = 0;
    para.forEach((n) => {
      if (n.type.name === "hardBreak") breaks++;
    });
    expect(breaks).toBe(1);
  });

  it("an escaped backslash (`\\\\section`) is prose, not a command", () => {
    const baseline = afterEnter("hello xxsection", {});
    const actual = afterEnter("hello \\\\section", {});
    expect(JSON.stringify(actual)).not.toContain('"heading"');
    expect(shape(actual, "hello \\\\section", "X")).toBe(
      shape(baseline, "hello xxsection", "X"),
    );
  });
});
