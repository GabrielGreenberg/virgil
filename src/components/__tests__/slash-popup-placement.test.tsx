// @vitest-environment jsdom
//
// Task 1364 — the `\` command popup is PLACED by the shared menu door
// (`useFloatingMenuPosition`), so it inherits the height cap, the side with
// room, and the viewport clamp every other menu has.
//
// THE BUG THIS PINS. The popup sized itself `rows * 24 + 8` with no cap and
// flipped above the caret whenever "below" did not fit — whether or not
// "above" fit, and with no clamp. A bare `\` lists every command (~31 rows,
// ~750px), so on an ~850px window with the caret at y≈300 it landed at
// top ≈ −456: the default-selected row, and most of the list, painted above
// the window, unreachable by mouse and invisible to the arrow keys.
//
// WHAT IS PROVEN (a REAL editor on the REAL `buildEditorExtensions("main")`
// stack, the shipped `handleTextInput` / `handleKeyDown` props, the shipped
// component; jsdom has no layout, so the popup's natural box and the caret
// rect are stubbed — the stub honours the `maxHeight` the hook writes, as a
// browser would):
//   1. The popup sits inside the viewport margins and carries a max-height
//      with `overflow-y: auto`.
//   2. Arrow-key roving past the visible band scrolls the LIST so the
//      selected row stays inside it.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { slashPopupStore } from "@/lib/slash-popup-store";
import { SlashCommandPopup } from "@/components/SlashCommandPopup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VH = 850;
const MARGIN = 8;
const ROW = 24;
const PAD = 4;
const CARET = { left: 200, right: 200, top: 300, bottom: 318 };

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

const popupEl = () =>
  document.querySelector<HTMLElement>(".slash-command-popup");
const rowCount = (el: HTMLElement) => el.children.length;
/** The popup's box as a browser would lay it out: natural height, capped by
 *  whatever `max-height` the placement hook wrote. */
function popupHeight(el: HTMLElement): number {
  const natural = rowCount(el) * ROW + PAD * 2;
  const cap = parseFloat(el.style.maxHeight);
  return Number.isFinite(cap) ? Math.min(natural, cap) : natural;
}

let restore: Array<() => void> = [];
function stubGetter<T extends object>(proto: T, key: string, get: (this: HTMLElement) => number) {
  const prev = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, get });
  restore.push(() => {
    if (prev) Object.defineProperty(proto, key, prev);
    else delete (proto as Record<string, unknown>)[key];
  });
}

beforeEach(() => {
  const prevH = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VH });
  restore.push(() =>
    Object.defineProperty(window, "innerHeight", { configurable: true, value: prevH }),
  );
  const prevRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (!this.classList.contains("slash-command-popup")) return prevRect.call(this);
    const h = popupHeight(this);
    const w = parseFloat(this.style.width) || 180;
    const top = parseFloat(this.style.top) || 0;
    const left = parseFloat(this.style.left) || 0;
    return { left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} } as DOMRect;
  };
  restore.push(() => {
    HTMLElement.prototype.getBoundingClientRect = prevRect;
  });
  // Row geometry: each row is a button child of the list, 24px tall below the
  // list's 4px top padding; the list's client box is its laid-out height.
  stubGetter(HTMLElement.prototype, "offsetTop", function () {
    const parent = this.parentElement;
    if (!parent?.classList.contains("slash-command-popup")) return 0;
    return PAD + Array.prototype.indexOf.call(parent.children, this) * ROW;
  });
  stubGetter(HTMLElement.prototype, "offsetHeight", function () {
    return this.parentElement?.classList.contains("slash-command-popup") ? ROW : 0;
  });
  stubGetter(HTMLElement.prototype, "clientHeight", function () {
    return this.classList.contains("slash-command-popup") ? popupHeight(this) : 0;
  });
});

const editors: Editor[] = [];
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const r of roots.splice(0)) r.unmount();
  });
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.innerHTML = "";
  for (const r of restore.splice(0).reverse()) r();
});

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
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
  ed.view.coordsAtPos = () => ({ ...CARET });
  editors.push(ed);
  return ed;
}

async function openBareSlash(ed: Editor): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<SlashCommandPopup editor={ed as unknown as ReactEditor} />);
  });
  const pos = ed.state.doc.firstChild!.nodeSize - 1;
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    ed.view.someProp("handleTextInput", (f) => f(ed.view, pos, pos, "\\", () => ed.state.tr));
    ed.commands.insertContentAt(pos, "\\");
  });
  // The hook places on a microtask after its layout effect.
  await act(async () => {
    await Promise.resolve();
  });
  const el = popupEl();
  expect(el).not.toBeNull();
  return el!;
}

function press(ed: Editor, key: string) {
  act(() => {
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key, bubbles: true })),
    );
  });
}

describe("slash popup placement (task 1364)", () => {
  it("a bare `\\` lists more rows than fit on either side of the caret", async () => {
    const el = await openBareSlash(mount());
    const natural = rowCount(el) * ROW + PAD * 2;
    // The precondition the bug needed: neither side holds the whole list.
    expect(natural).toBeGreaterThan(VH - MARGIN - (CARET.bottom + 4));
    expect(natural).toBeGreaterThan(CARET.top - 4 - MARGIN);
  });

  it("sits inside the viewport and caps its height with a scrolling list", async () => {
    const el = await openBareSlash(mount());
    const top = parseFloat(el.style.top);
    expect(el.style.visibility).not.toBe("hidden");
    expect(top).toBeGreaterThanOrEqual(MARGIN);
    expect(top + popupHeight(el)).toBeLessThanOrEqual(VH - MARGIN);
    expect(el.style.maxHeight).not.toBe("");
    expect(el.style.overflowY).toBe("auto");
  });

  it("keeps the arrow-roved row inside the list's visible band", async () => {
    const ed = mount();
    const el = await openBareSlash(ed);
    let scrollTop = 0;
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    const rows = rowCount(el);
    for (let i = 0; i < rows - 1; i++) press(ed, "ArrowDown");
    const sel = slashPopupStore.getState(ed);
    expect(sel.open).toBe(true);
    const selected = sel.open ? sel.selectedIndex : -1;
    // Roving actually travelled past the first screenful…
    const rowTop = PAD + selected * ROW;
    expect(rowTop + ROW).toBeGreaterThan(popupHeight(el));
    // …and the list scrolled to keep the selected row in view.
    expect(rowTop).toBeGreaterThanOrEqual(scrollTop);
    expect(rowTop + ROW).toBeLessThanOrEqual(scrollTop + el.clientHeight);
  });
});
