// @vitest-environment jsdom
//
// Task 1196 — the slash commit door runs on a COLLAPSED caret at the end of the
// typed `\name`, or not at all.
//
// THE BUG THIS PINS. The popup door passed `selection.from` as the end of the
// typed name and never looked at `selection.to`, and `reSync` kept the popup
// open under a range. So `\footnote` + Shift+End + Enter deleted `\footnote`
// and the footnote atom REPLACED the rest of the line; a backward range put
// `from` inside the name, so `\tex` + Shift+Left×2 + Enter left `ex` stranded
// in the prose. The popup-less Enter door already refused a range; the popup
// door did not. The rule now lives in `commitSlashCommand` (the ONE door), and
// the popup closes when the selection becomes a range.
//
// Driven through the REAL `buildEditorExtensions("main")` stack and the
// shipped `handleTextInput` / `handleKeyDown` props.
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
import { slashPopupKey, executeSlashSelectionAt } from "@/lib/tiptap/slash-popup";
import { commitSlashCommand } from "@/lib/tiptap/commands";

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

function mount(): Editor {
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
          content: [{ type: "text", text: "alpha beta" }],
        },
      ],
    },
  });
  // Caret right after `alpha` (doc pos 1 + 5).
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
  );
  return editor;
}

function typeSlash(ed: Editor, name: string): void {
  const from = ed.state.selection.from;
  ed.view.someProp("handleTextInput", (f) =>
    f(ed.view, from, from, "\\", () => ed.state.tr),
  );
  ed.commands.insertContentAt(from, "\\");
  for (const ch of name) {
    const at = ed.state.selection.from;
    ed.view.someProp("handleTextInput", (f) =>
      f(ed.view, at, at, ch, () => ed.state.tr),
    );
    ed.commands.insertContentAt(at, ch);
  }
}

function popupOpen(ed: Editor): boolean {
  return slashPopupKey.getState(ed.state)?.open === true;
}

/** The popup plugin's OWN Enter handler — not the editor's keymap. */
function popupEnter(ed: Editor): boolean {
  const plugin = slashPopupKey.get(ed.state)!;
  return (
    plugin.props.handleKeyDown?.call(
      plugin,
      ed.view,
      new KeyboardEvent("keydown", { key: "Enter" }),
    ) ?? false
  );
}

const paraText = (ed: Editor) => ed.state.doc.firstChild!.textContent;

type Dir = "forward" | "backward";

/** Extend the selection from the caret: forward to the line end, backward by 2. */
function extend(ed: Editor, dir: Dir): void {
  const caret = ed.state.selection.from;
  const sel =
    dir === "forward"
      ? TextSelection.create(ed.state.doc, caret, ed.state.doc.firstChild!.nodeSize - 1)
      : TextSelection.create(ed.state.doc, caret, caret - 2);
  ed.view.dispatch(ed.state.tr.setSelection(sel));
}

const CASES: Array<[string, Dir]> = [];
for (const name of ["footnote", "tex", "section", "textbf"]) {
  for (const dir of ["forward", "backward"] as Dir[]) CASES.push([name, dir]);
}

describe("a range selection closes the popup and commits nothing", () => {
  it.each(CASES)("\\%s + %s range", (name, dir) => {
    const ed = mount();
    typeSlash(ed, name);
    expect(popupOpen(ed)).toBe(true);
    const typed = paraText(ed);
    expect(typed).toBe(`alpha\\${name} beta`);

    extend(ed, dir);
    expect(popupOpen(ed)).toBe(false);

    const before = ed.state.doc;
    expect(popupEnter(ed)).toBe(false);
    expect(ed.state.doc.eq(before)).toBe(true);
    expect(paraText(ed)).toBe(typed);
  });
});

describe("the commit door refuses a range by itself", () => {
  it.each(CASES)("\\%s + %s range — a popup forced open still runs nothing", (name, dir) => {
    const ed = mount();
    typeSlash(ed, name);
    const open = slashPopupKey.getState(ed.state)!;
    expect(open.open).toBe(true);
    extend(ed, dir);
    // Force the popup back OPEN under the range (a meta bypasses reSync), so
    // the popup's own commit doors reach `commitSlashCommand` and the DOOR's
    // precondition is what is tested — not merely the popup closing first.
    ed.view.dispatch(ed.state.tr.setMeta(slashPopupKey, open));
    const before = ed.state.doc;
    const idx = (open as { filtered: string[] }).filtered.indexOf(name);
    expect(executeSlashSelectionAt(ed.view, Math.max(0, idx))).toBe(false);
    expect(ed.state.doc.eq(before)).toBe(true);
    expect(popupOpen(ed)).toBe(false);
  });

  it("direct call with a non-empty selection returns false and dispatches nothing", () => {
    const ed = mount();
    typeSlash(ed, "footnote");
    const end = ed.state.selection.from;
    extend(ed, "forward");
    const before = ed.state.doc;
    let dispatched = 0;
    const orig = ed.view.dispatch.bind(ed.view);
    ed.view.dispatch = (tr) => {
      dispatched += 1;
      orig(tr);
    };
    expect(commitSlashCommand(ed.view, "footnote", end - "\\footnote".length, end)).toBe(false);
    expect(dispatched).toBe(0);
    expect(ed.state.doc.eq(before)).toBe(true);
  });

  it("a collapsed caret NOT at the name's end is refused too", () => {
    const ed = mount();
    typeSlash(ed, "textbf");
    const end = ed.state.selection.from;
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end - 2)),
    );
    const before = ed.state.doc;
    expect(commitSlashCommand(ed.view, "textbf", end - "\\textbf".length, end)).toBe(false);
    expect(ed.state.doc.eq(before)).toBe(true);
  });
});

describe("control — a collapsed caret still commits", () => {
  it.each(["footnote", "tex", "section", "textbf"])("\\%s runs and removes the typed name", (name) => {
    const ed = mount();
    typeSlash(ed, name);
    expect(popupOpen(ed)).toBe(true);
    expect(popupEnter(ed)).toBe(true);
    expect(ed.state.doc.textContent.includes(`\\${name}`)).toBe(false);
    expect(ed.state.doc.textContent).toContain("beta");
  });
});
