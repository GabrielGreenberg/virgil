// @vitest-environment jsdom
//
// Task 1544 — with the slash popup open, a MODIFIED Tab or Arrow does exactly
// what it does with the popup closed. The popup's `handleKeyDown` answered Tab
// and ArrowUp/Down with any modifier: Shift+Tab after a bare `\` ran the
// highlighted row (`\title` — a `titleField` at the doc top, caret teleported)
// instead of lifting the list item, and Shift/Alt/Cmd+ArrowDown moved the row
// cursor instead of the caret. The popup now asks `hasNoModifiers` — the one
// spelling of "plain" the menu controller and combobox read too — and its
// commit answers the first press only (a held Tab/Enter's repeats are swallowed
// until keyup).
//
// Driven through the REAL `buildEditorExtensions("main")` stack, with keydown
// dispatched on `view.dom` (pattern: `slash-modified-enter.test.ts`).
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { slashPopupKey } from "@/lib/tiptap/slash-popup";
import { hasNoModifiers } from "@/lib/key-intent";

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

const para = (text: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid: "para-A" },
  content: [{ type: "text", text }],
});
const list = (text: string): JSONContent => ({
  type: "bulletList",
  content: [{ type: "listItem", content: [para(text)] }],
});

/** Mount `block`, caret at the end of its text. */
function mount(block: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content: [block] },
  });
  let end = 0;
  ed.state.doc.descendants((n, pos) => {
    if (n.isText) end = pos + n.nodeSize;
  });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end)));
  editor = ed;
  return ed;
}

/** Type `\` the way a keystroke does: `handleTextInput` first, then PM's insert. */
function typeBackslash(ed: Editor): void {
  const view = ed.view;
  const { from, to } = view.state.selection;
  const handled = view.someProp("handleTextInput", (f) =>
    f(view, from, to, "\\", () => view.state.tr.insertText("\\", from, to)),
  );
  if (!handled) view.dispatch(view.state.tr.insertText("\\", from, to));
}

type Mods = Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat", boolean>>;

function press(ed: Editor, key: string, mods: Mods = {}): boolean {
  const ev = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  ed.view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
}

type Open = { open: true; selectedIndex: number; filtered: string[] };
/** The popup's state, typed as open for the row reads (`open` is still asserted). */
const popup = (ed: Editor) => slashPopupKey.getState(ed.state) as unknown as Open | { open: false };
const rows = (ed: Editor) => popup(ed) as Open;
const json = (ed: Editor) => JSON.stringify(ed.getJSON());
/** The doc with minted block uuids blanked — two mounts mint different ones. */
const shape = (ed: Editor) => json(ed).replace(/"uuid":"[^"]*"/g, '"uuid":_');

function openPopup(block: JSONContent): Editor {
  const ed = mount(block);
  typeBackslash(ed);
  expect(popup(ed).open).toBe(true);
  return ed;
}

describe("hasNoModifiers", () => {
  it("is true only with no Shift/Ctrl/Meta/Alt", () => {
    const none = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(hasNoModifiers(none)).toBe(true);
    for (const m of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      expect(hasNoModifiers({ ...none, [m]: true })).toBe(false);
    }
  });
});

describe("slash popup — modified Tab (task 1544)", () => {
  for (const m of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
    it(`${m}+Tab in a paragraph runs no command`, () => {
      const ed = openPopup(para("hi "));
      press(ed, "Tab", { [m]: true });
      expect(json(ed)).not.toContain("titleField");
      expect(ed.state.doc.textContent).toBe("hi \\");
    });
  }

  it("Shift+Tab in a list item lifts the item, exactly as with the popup closed", () => {
    // Baseline: the same doc (backslash already typed) with NO popup open.
    const base = mount(list("hi \\"));
    press(base, "Tab", { shiftKey: true });
    const expected = shape(base);
    base.destroy();
    editor = null;

    const ed = openPopup(list("hi "));
    press(ed, "Tab", { shiftKey: true });
    expect(json(ed)).not.toContain("titleField");
    expect(shape(ed)).toBe(expected);
  });

  it("plain Tab still commits the highlighted row (control)", () => {
    const ed = openPopup(para("hi "));
    const row = rows(ed).filtered[rows(ed).selectedIndex];
    expect(row).toBeTruthy();
    expect(press(ed, "Tab")).toBe(true);
    expect(popup(ed).open).toBe(false);
    expect(ed.state.doc.textContent).not.toContain("\\");
  });
});

describe("slash popup — modified arrows (task 1544)", () => {
  for (const m of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
    it(`${m}+ArrowDown does not move the row cursor and is not consumed`, () => {
      const ed = openPopup(para("hi "));
      const before = rows(ed).selectedIndex;
      const consumed = press(ed, "ArrowDown", { [m]: true });
      expect(consumed).toBe(false);
      const after = popup(ed);
      if (after.open) expect(after.selectedIndex).toBe(before);
    });
  }

  it("plain ArrowDown still moves the row cursor (control)", () => {
    const ed = openPopup(para("hi "));
    const before = rows(ed).selectedIndex;
    expect(press(ed, "ArrowDown")).toBe(true);
    expect(rows(ed).selectedIndex).not.toBe(before);
  });
});

describe("slash popup — held commit key (task 1544)", () => {
  it("a repeat keydown never commits; after a commit, repeats are swallowed until keyup", () => {
    const ed = openPopup(para("hi "));
    // A repeat while still open: consumed, nothing runs.
    expect(press(ed, "Enter", { repeat: true })).toBe(true);
    expect(popup(ed).open).toBe(true);
    expect(ed.state.doc.textContent).toBe("hi \\");

    press(ed, "Enter");
    expect(popup(ed).open).toBe(false);
    const committed = json(ed);
    // The held key's repeats would now reach the editor (splitting the block
    // the command just made) — the window-capture swallow eats them.
    const rep = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    ed.view.dom.dispatchEvent(rep);
    expect(rep.defaultPrevented).toBe(true);
    expect(json(ed)).toBe(committed);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter" }));
  });

  it("a held Escape closes the popup once and its repeats do not reach the editor", () => {
    const ed = openPopup(para("hi "));
    press(ed, "Escape");
    expect(popup(ed).open).toBe(false);
    const rep = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    ed.view.dom.dispatchEvent(rep);
    expect(rep.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape" }));
  });
});
