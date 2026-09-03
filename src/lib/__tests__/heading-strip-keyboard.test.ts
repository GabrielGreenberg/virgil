// @vitest-environment jsdom
/**
 * TASK 536 — the heading strip is the figure lozenge's vanilla twin, and it
 * carried the same false promise: `#`, the type chip and `×` announced
 * `role="button"` through `setAttribute` (invisible to a JSX grep) while
 * being neither focusable nor key-bound, and the label text / `Label +` were
 * bare spans. Every affordance is a real `<button type="button">` now.
 *
 * This is the twin whose NodeView mounts HEADLESSLY, so it is where the one
 * keystroke fact jsdom can see is pinned: a key pressed on a strip button
 * never reaches ProseMirror. The heading NodeView's `stopEvent` answers true
 * for anything inside the strip, so PM's `eventBelongsToView` declines the
 * keydown and the browser's native button activation is the only thing that
 * runs. The CANARY dispatches the identical keydown at the heading's TEXT and
 * requires PM to act on it (the Enter keymap splits the block), so a green
 * routing leg can never mean "the probe is blind".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { createHeadingWithLabel, createParagraphWithTitle } from "@/lib/editor-extensions";

/** jsdom has no layout; PM's scroll math throws without a rect. */
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this; },
} as DOMRect;
function installLayoutShim() {
  const list = Object.assign([ZERO_RECT], { item: () => ZERO_RECT }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Text.prototype as unknown as Range]) {
    if (typeof (proto as { getClientRects?: unknown }).getClientRects !== "function") {
      (proto as { getClientRects?: unknown }).getClientRects = () => list;
    }
    if (typeof (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect !== "function") {
      (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => ZERO_RECT;
    }
  }
}

let editors: Editor[] = [];
beforeEach(() => { installLayoutShim(); });
afterEach(() => { for (const e of editors) e.destroy(); editors = []; document.body.innerHTML = ""; });

function buildEditor(label: string | null = null, numbered = true) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false, paragraph: false, bulletList: false, orderedList: false,
        listItem: false, blockquote: false, codeBlock: false, dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, uuid: "h-1", label, numbered }, content: [{ type: "text", text: "Introduction" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body." }] },
      ],
    },
  });
  editors.push(editor);
  return { editor, el };
}

const annotOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-uuid="h-1"] .heading-annotation')!;
const headingAttrs = (editor: Editor) => editor.state.doc.firstChild!.attrs;
const blockCount = (editor: Editor) => editor.state.doc.childCount;

function expectOperableButton(el: Element | null, what: string) {
  expect(el, `${what} is rendered`).not.toBeNull();
  const b = el as HTMLButtonElement;
  expect(b.tagName, `${what} is a real <button>`).toBe("BUTTON");
  expect(b.type, `${what} is type="button"`).toBe("button");
  expect(b.hasAttribute("role"), `${what} spells no hand-rolled role`).toBe(false);
  expect(b.classList.contains("focus-ring"), `${what} carries the focus indicator`).toBe(true);
  b.focus();
  expect(document.activeElement, `${what} takes focus`).toBe(b);
}

function pressEnterOn(target: Element): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

describe("DEFECT: every strip affordance is a keyboard-operable control", () => {
  it("type chip, #, Label + and × are real buttons with no hand-rolled role", () => {
    const { el } = buildEditor(null);
    const annot = annotOf(el);
    expectOperableButton(annot.querySelector(".heading-annotation-type-chip"), "the type chip");
    expect(annot.querySelector(".heading-annotation-type-chip")!.getAttribute("aria-haspopup")).toBe("menu");
    expectOperableButton(annot.querySelector(".heading-annotation-numbered-toggle"), "the # toggle");
    expectOperableButton(annot.querySelector(".heading-label-add"), "Label +");
    expectOperableButton(annot.querySelector(".heading-annotation-delete"), "the × delete");
    expect(annot.querySelectorAll("[role]").length).toBe(0);
  });

  it("a labelled heading renders the label as a button too", () => {
    const { el } = buildEditor("sec:intro");
    const annot = annotOf(el);
    const lbl = annot.querySelector(".heading-label-text");
    expectOperableButton(lbl, "the label text");
    expect(lbl!.textContent).toBe("sec:intro");
    (lbl as HTMLElement).click();
    expect(annot.querySelector("input.heading-label-input")).not.toBeNull();
  });

  it("# keeps a stable name and an aria-pressed state; activating it flips the number", () => {
    const { editor, el } = buildEditor();
    const toggle = annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-numbered-toggle")!;
    expect(toggle.getAttribute("aria-label")).toBe("Section number");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    toggle.click();
    expect(headingAttrs(editor).numbered).toBe(false);
    const after = annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-numbered-toggle")!;
    expect(after.getAttribute("aria-pressed")).toBe("false");
    expect(after.getAttribute("aria-label")).toBe("Section number");
  });

  it("the rebuild a toggle triggers hands focus to the toggle's successor", () => {
    const { el } = buildEditor();
    const before = annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-numbered-toggle")!;
    before.focus();
    expect(document.activeElement).toBe(before);
    before.click();
    const after = annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-numbered-toggle")!;
    expect(after).not.toBe(before);
    expect(after.isConnected).toBe(true);
    expect(before.isConnected).toBe(false);
    // Focus followed the affordance, not the element: a keyboard user who
    // pressed # is still on # and can press it again.
    expect(document.activeElement).toBe(after);
  });

  it("× deletes the heading", () => {
    const { editor, el } = buildEditor();
    expect(blockCount(editor)).toBe(2);
    annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-delete")!.click();
    return new Promise<void>((r) => setTimeout(r, 0)).then(() => {
      expect(blockCount(editor)).toBe(1);
      expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    });
  });
});

describe("a key on a strip button never reaches the document", () => {
  it("CANARY: the probe can see PM act — Enter at the heading's text splits it", () => {
    const { editor, el } = buildEditor();
    const text = el.querySelector<HTMLElement>('[data-uuid="h-1"] h1')!;
    expect(text).not.toBeNull();
    const before = blockCount(editor);
    const ev = pressEnterOn(text);
    // PM's Enter keymap took it: one more block, and the event consumed.
    expect(blockCount(editor)).toBe(before + 1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Enter on the # button leaves the document alone and is not consumed by PM", () => {
    const { editor, el } = buildEditor();
    const toggle = annotOf(el).querySelector<HTMLButtonElement>(".heading-annotation-numbered-toggle")!;
    toggle.focus();
    const docBefore = editor.state.doc;
    const ev = pressEnterOn(toggle);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
    // Not `preventDefault`ed by anything in the page, so the browser's native
    // button activation (the click) is what the keystroke becomes.
    expect(ev.defaultPrevented).toBe(false);
  });
});
