// @vitest-environment jsdom
//
// Task 734 — the menu keyboard controller over the editable it parks focus in.
//
// Four editor-anchored menus (grab bar, lightning, heading type, selection
// color) never take DOM focus: they leave the caret in the PM view's
// contentEditable and track the active row with roving
// `aria-activedescendant`. `useMenuKeyboard`'s window-CAPTURE source used to
// bail on ANY editable target, which is exactly that designed state — so the
// whole advertised keyboard contract was dead in the browser, and the declined
// key reached ProseMirror instead (pressing the `F` the menu was showing you
// replaced the selected passage with "f").
//
// Every key here is dispatched on the FOCUSED ELEMENT, the way a browser
// dispatches it — never on `window`, which is how the old suite passed by not
// looking (task 731's class).
//
// The two legs that must both hold:
//   - the menu's OWN activedescendant host (the focused contentEditable) →
//     nav, letters, the Backspace/Delete alias all run, and the event is
//     prevented + stopped so ProseMirror never sees it;
//   - any OTHER editable (task 386's defect leg: a plain `<input>`, a
//     `<textarea>`, an unfocused contentEditable) → nothing runs and the event
//     is NOT prevented, so the field keeps its own key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { DragHandleMenu } from "../../DragHandleMenu";
import { cardActionRows } from "@/lib/actions/action-registry";
import { walkFiles } from "../../../lib/__tests__/_source-scan";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap } from "@tiptap/pm/commands";
import { schema } from "@tiptap/pm/schema-basic";
import { editsDocument } from "@/lib/key-intent";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no Range layout; a real PM view's post-dispatch scrollIntoView
// reads it (the task-1180 control below splits a paragraph for real).
const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
Range.prototype.getClientRects ??= (() => []) as unknown as Range["getClientRects"];
Range.prototype.getBoundingClientRect ??= (() => ZERO_RECT) as unknown as Range["getBoundingClientRect"];

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

/** A stand-in for the PM view's contentEditable. jsdom neither derives
 *  `isContentEditable` from the attribute nor focuses a plain div, so both are
 *  forced — the real element is natively focusable and really editable. */
function mountEditable(): HTMLDivElement {
  const el = document.createElement("div");
  el.contentEditable = "true";
  el.tabIndex = 0;
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** Dispatch a keydown the way the browser does: on the focused element, which
 *  bubbles up through the capture-phase window listener. */
function keyOn(el: HTMLElement, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

function menuButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

function activeButton(): HTMLButtonElement | undefined {
  return menuButtons().find((b) => b.getAttribute("data-active") === "");
}

function labelOf(b: HTMLButtonElement | undefined): string {
  if (!b) return "";
  return b.querySelectorAll("span")[1]?.textContent ?? "";
}

describe("task 734 — keys typed into the editable the menu parked focus in", () => {
  it("Down/Up/Home/End move the active row (dispatched on the focused editable)", () => {
    const editable = mountEditable();
    editable.focus();
    expect(document.activeElement).toBe(editable);

    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);
    const rows = cardActionRows("grab");

    keyOn(editable, "ArrowDown");
    expect(labelOf(activeButton())).toBe(rows[0].label);
    keyOn(editable, "ArrowDown");
    expect(labelOf(activeButton())).toBe(rows[1].label);
    keyOn(editable, "ArrowUp");
    expect(labelOf(activeButton())).toBe(rows[0].label);
    keyOn(editable, "End");
    expect(labelOf(activeButton())).toBe(rows[rows.length - 1].label);
    keyOn(editable, "Home");
    expect(labelOf(activeButton())).toBe(rows[0].label);
  });

  it("Enter activates the active row", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(editable, "ArrowDown");
    keyOn(editable, "Enter");
    expect(onSelect).toHaveBeenCalledWith(cardActionRows("grab")[0].id);
  });

  it("the letter fast-path runs its row — and the letter never reaches the document", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const e = keyOn(editable, "f");
    expect(onSelect).toHaveBeenCalledWith("footnote");
    // preventDefault + stopPropagation: PM's handleKeyDown never sees it, so
    // the selected passage is not replaced with "f".
    expect(e.defaultPrevented).toBe(true);
  });

  it("the destructive Backspace/Delete alias runs the delete row", () => {
    const editable = mountEditable();
    editable.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(editable, "Backspace");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    keyOn(editable, "Delete");
    expect(onSelect).toHaveBeenLastCalledWith("delete");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("a consumed key is stopped before the editable's own listener sees it", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);

    keyOn(editable, "f");
    expect(pmHandler).not.toHaveBeenCalled();
  });

  it("a letter NO row claims is swallowed inert — never typed behind the menu (task 1180)", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    // `q` maps to no row on the grab menu. Pre-1180 it reached PM and typed.
    const e = keyOn(editable, "q");
    expect(onSelect).not.toHaveBeenCalled();
    expect(pmHandler).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("a modifier COMMAND (Cmd+Z, Cmd+V) still reaches the editable", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);

    const z = keyOn(editable, "z", { metaKey: true });
    const v = keyOn(editable, "v", { ctrlKey: true });
    expect(pmHandler).toHaveBeenCalledTimes(2);
    expect(z.defaultPrevented).toBe(false);
    expect(v.defaultPrevented).toBe(false);
  });
});

describe("task 1180 — over its OWN host, a declined key is swallowed, not handed to the document", () => {
  it("a GREYED row's letter and Backspace/Delete alias are swallowed and run nothing", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    const onSelect = vi.fn();
    // canEdit={false} greys EVERY card row, delete included.
    render(
      <DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" canEdit={false} />,
    );

    const keys = ["f", "d", "Backspace", "Delete", "F"].map((k) =>
      keyOn(editable, k, k === "F" ? { shiftKey: true } : {}),
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(pmHandler).not.toHaveBeenCalled();
    for (const e of keys) expect(e.defaultPrevented).toBe(true);
  });

  it("Enter / Space with NO active row (the opening state) are swallowed inert", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    expect(activeButton()).toBeUndefined();
    const enter = keyOn(editable, "Enter");
    const shiftEnter = keyOn(editable, "Enter", { shiftKey: true });
    const space = keyOn(editable, " ");
    expect(onSelect).not.toHaveBeenCalled();
    expect(pmHandler).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    expect(shiftEnter.defaultPrevented).toBe(true);
    expect(space.defaultPrevented).toBe(true);
  });

  it("on a REAL ProseMirror view: Enter with no active row does not split the paragraph", () => {
    const pmHost = document.createElement("div");
    document.body.appendChild(pmHost);
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hello world")])]),
      plugins: [keymap(baseKeymap)],
    });
    const view = new EditorView(pmHost, {
      state: state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6))),
    });
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(view.dom, "isContentEditable", { value: true, configurable: true });
    view.focus();
    expect(document.activeElement).toBe(view.dom);
    const before = view.state.doc;

    const onSelect = vi.fn();
    render(
      <DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" canEdit={false} />,
    );

    const e = keyOn(view.dom as HTMLElement, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(view.state.doc.eq(before)).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    view.destroy();
  });

  it("control: the same Enter on the same view with NO menu open DOES split (the probe is live)", () => {
    const pmHost = document.createElement("div");
    document.body.appendChild(pmHost);
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hello world")])]),
      plugins: [keymap(baseKeymap)],
    });
    const view = new EditorView(pmHost, {
      state: state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6))),
    });
    view.focus();
    keyOn(view.dom as HTMLElement, "Enter");
    expect(view.state.doc.childCount).toBe(2);
    view.destroy();
  });
});

describe("task 1189 — the owned-host rule decides by EFFECT, not by modifier", () => {
  function pmView(from: number, to: number) {
    const pmHost = document.createElement("div");
    document.body.appendChild(pmHost);
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hello world")])]),
      plugins: [keymap(baseKeymap)],
    });
    const view = new EditorView(pmHost, {
      state: state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))),
    });
    Object.defineProperty(view.dom, "isContentEditable", { value: true, configurable: true });
    view.focus();
    return view;
  }

  it("Option/AltGr characters and modified deletes are swallowed behind the open menu", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const keys = [
      keyOn(editable, "å", { altKey: true }), // Mac Option+a
      keyOn(editable, "™", { altKey: true }), // Mac Option+2
      keyOn(editable, "@", { ctrlKey: true, altKey: true }), // AltGr+q (German)
      keyOn(editable, "Backspace", { altKey: true }), // delete word
      keyOn(editable, "Backspace", { metaKey: true }), // delete to line start
      keyOn(editable, "Delete", { altKey: true }), // delete word forward
      keyOn(editable, "Backspace", { ctrlKey: true }), // pc delete word
    ];
    expect(onSelect).not.toHaveBeenCalled();
    expect(pmHandler).not.toHaveBeenCalled();
    for (const e of keys) expect(e.defaultPrevented).toBe(true);
  });

  it("commands still pass: undo/redo, clipboard, select-all", () => {
    const editable = mountEditable();
    editable.focus();
    const pmHandler = vi.fn();
    editable.addEventListener("keydown", pmHandler);
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);

    const keys = [
      keyOn(editable, "z", { metaKey: true }),
      keyOn(editable, "z", { metaKey: true, shiftKey: true }),
      keyOn(editable, "c", { ctrlKey: true }),
      keyOn(editable, "x", { metaKey: true }),
      keyOn(editable, "v", { ctrlKey: true }),
      keyOn(editable, "a", { metaKey: true }),
    ];
    expect(pmHandler).toHaveBeenCalledTimes(keys.length);
    for (const e of keys) expect(e.defaultPrevented).toBe(false);
  });

  it("on a REAL ProseMirror view: Mod+Backspace over a selection deletes nothing", () => {
    const view = pmView(1, 6);
    const before = view.state.doc;
    render(<DragHandleMenu anchorRect={RECT} onSelect={() => {}} onClose={() => {}} kind="selection" />);
    // jsdom is not a Mac, so PM's keymap reads Mod as Ctrl.
    const e = keyOn(view.dom as HTMLElement, "Backspace", { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    view.destroy();
  });

  it("control: the same Mod+Backspace with NO menu open DOES delete (the probe is live)", () => {
    const view = pmView(1, 6);
    keyOn(view.dom as HTMLElement, "Backspace", { ctrlKey: true });
    expect(view.state.doc.textContent).toBe(" world");
    view.destroy();
  });

  it("editsDocument: the predicate's table, both platforms", () => {
    const k = (key: string, m: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({
      key,
      keyCode: 0,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...m,
    });
    for (const mac of [true, false]) {
      expect(editsDocument(k("q"), mac)).toBe(true);
      expect(editsDocument(k("å", { altKey: true }), mac)).toBe(true);
      expect(editsDocument(k("@", { ctrlKey: true, altKey: true }), mac)).toBe(true);
      expect(editsDocument(k("Backspace", { metaKey: true }), mac)).toBe(true);
      expect(editsDocument(k("Delete", { altKey: true }), mac)).toBe(true);
      expect(editsDocument(k("Enter", { shiftKey: true } as never), mac)).toBe(true);
      expect(editsDocument(k("Enter", { metaKey: true }), mac)).toBe(false);
      expect(editsDocument(k("z", { metaKey: true }), mac)).toBe(false);
      expect(editsDocument(k("v", { ctrlKey: true }), mac)).toBe(false);
      expect(editsDocument(k("ArrowLeft", { altKey: true }), mac)).toBe(false);
      expect(editsDocument(k("Escape"), mac)).toBe(false);
      // An IME-composing key is the IME's (task 994/1188).
      expect(editsDocument({ ...k("a"), keyCode: 229 }, mac)).toBe(false);
    }
    // macOS Cocoa Ctrl text bindings delete/insert; elsewhere Ctrl+H/D/K are commands.
    for (const key of ["h", "d", "k", "o", "t"]) {
      expect(editsDocument(k(key, { ctrlKey: true }), true)).toBe(true);
      expect(editsDocument(k(key, { ctrlKey: true }), false)).toBe(false);
    }
    expect(editsDocument(k("a", { ctrlKey: true }), true)).toBe(false);
  });
});

describe("task 386's protection (the defect leg, re-run against the new predicate)", () => {
  it("a bare Backspace typed into an unrelated <input> does NOT run the delete row", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const back = keyOn(input, "Backspace");
    const letter = keyOn(input, "f");
    expect(onSelect).not.toHaveBeenCalled();
    // The field keeps its own keys.
    expect(back.defaultPrevented).toBe(false);
    expect(letter.defaultPrevented).toBe(false);
  });

  it("a bare key typed into an unrelated <textarea> does NOT run a row", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    keyOn(ta, "Delete");
    keyOn(ta, "ArrowDown");
    expect(onSelect).not.toHaveBeenCalled();
    expect(activeButton()).toBeUndefined();
  });

  it("an editable that is NOT the menu's host (focus elsewhere) does NOT run a row", () => {
    // A second contentEditable — e.g. a card body — that does not hold focus.
    // Ownership is the FOCUSED host, not "any contentEditable".
    const other = mountEditable();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const onSelect = vi.fn();
    render(<DragHandleMenu anchorRect={RECT} onSelect={onSelect} onClose={() => {}} kind="selection" />);

    const e = keyOn(other, "f");
    expect(onSelect).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

// ── census ──
// The host getter is no longer an ARIA detail: it is the ownership statement
// the keyboard controller reads. Four menus used to carry a character-identical
// private copy of it, which is how the FOURTH shipped — and how a fifth would.
// There is now ONE resolver; nothing else may re-derive "the focused
// contentEditable".
describe("census — one resolver for the focused contentEditable", () => {
  it("no production file but caret-host.ts pairs document.activeElement with isContentEditable", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const SRC = resolve(__dirname, "../../..");
    const ALLOWED = resolve(SRC, "components/menu/caret-host.ts");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) {
        if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
      }
    };
    walk(SRC);

    // Comments describe the rule; only CODE may break it.
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const offenders = files.filter((p) => {
      if (p === ALLOWED) return false;
      const code = stripComments(readFileSync(p, "utf8"));
      return code.includes("activeElement") && code.includes("isContentEditable");
    });

    expect(offenders.map((p) => p.slice(SRC.length + 1))).toEqual([]);
  });

  it("every editor-anchored menu passes the shared resolver as its host", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const SRC = resolve(__dirname, "../../..");
    for (const f of [
      "components/DragHandleMenu.tsx",
      "components/ActionsMenuPanel.tsx",
      "components/HeadingTypeMenu.tsx",
      "components/SelectionColorPopover.tsx",
    ]) {
      const src = readFileSync(resolve(SRC, f), "utf8");
      expect(src, f).toContain("getActiveDescendantHost={caretEditableHost}");
    }
  });
});
