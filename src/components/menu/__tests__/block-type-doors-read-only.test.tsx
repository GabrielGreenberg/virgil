// @vitest-environment jsdom
//
// Task 1017 — every block-type door ANSWERS the read-only question before it
// offers anything. Before: the lightning grid greyed every cell on `!canEdit`
// except ¶, whose dropdown opened Body text / Section / Part looking live, and
// the heading chip opened its type menu, flipped `#` and asked its × confirm —
// each pick then dropped by `pickBlockType`'s / the read-only enforcer's gate,
// with no grey and no reason.
//
//  1. Panel wiring: `ActionsMenuPanel` hands ¶ the SAME `!canEdit` every
//     sibling cell greys on, plus the read-only reason.
//  2. The dropdown itself: disabled → native-disabled trigger, the reason in
//     its hint + accessible description, and a click opens no rows.
//  3. The heading chip: on a read-only surface no chip verb opens its menu or
//     dispatches; the editable CANARY proves the same clicks do act.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockTypeDropdown } from "../../MenuBar";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { createHeadingWithLabel, createParagraphWithTitle } from "@/lib/editor-extensions";

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this; },
} as DOMRect;
for (const proto of [Range.prototype, Text.prototype as unknown as Range]) {
  const p = proto as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  if (typeof p.getClientRects !== "function") {
    p.getClientRects = () => Object.assign([ZERO_RECT], { item: () => ZERO_RECT });
  }
  if (typeof p.getBoundingClientRect !== "function") p.getBoundingClientRect = () => ZERO_RECT;
}

let editors: Editor[] = [];
afterEach(() => {
  cleanup();
  for (const e of editors) e.destroy();
  editors = [];
  document.body.innerHTML = "";
});

function buildEditor(
  editable: boolean,
  opener?: (p: unknown) => void,
) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    editable,
    extensions: [
      StarterKit.configure({
        heading: false, paragraph: false, bulletList: false, orderedList: false,
        listItem: false, blockquote: false, codeBlock: false, dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      createHeadingWithLabel(
        { onOpenHeadingTypeMenuRef: { current: opener as never } },
        { surface: "main" },
      ),
    ],
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, uuid: "h-1", numbered: true }, content: [{ type: "text", text: "Intro" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body." }] },
      ],
    },
  });
  editors.push(editor);
  return { editor, el };
}

describe("Task 1017 — the ¶ block-type dropdown greys on a read-only surface", () => {
  it("disabled: native-disabled trigger carrying the reason; a click opens no rows", () => {
    const { editor } = buildEditor(false);
    const { container } = render(
      <BlockTypeDropdown
        editor={editor as never}
        disabled
        disabledReason="Your co-author has the pen"
      />,
    );
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Block type"]')!;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("data-hint")).toContain("Your co-author has the pen");
    expect(trigger.getAttribute("aria-description")).toBe("Your co-author has the pen");
    fireEvent.click(trigger);
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull();
  });

  it("CANARY — enabled: the same click opens the rows", () => {
    const { editor } = buildEditor(true);
    const { container } = render(<BlockTypeDropdown editor={editor as never} />);
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Block type"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.hasAttribute("aria-description")).toBe(false);
    fireEvent.click(trigger);
    expect(document.querySelectorAll('[role="menuitemradio"]').length).toBeGreaterThan(0);
  });
});

describe("Task 1017 — the heading chip's verbs are gated on surface editability", () => {
  const annotOf = (el: HTMLElement) =>
    el.querySelector<HTMLElement>('[data-uuid="h-1"] .heading-annotation')!;
  const click = (el: HTMLElement, action: string) =>
    fireEvent.click(annotOf(el).querySelector<HTMLElement>(`[data-action="${action}"]`)!);

  it("read-only: the type menu does not open and # dispatches nothing", () => {
    const opener = vi.fn();
    const { editor, el } = buildEditor(false, opener);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    click(el, "type-menu");
    click(el, "toggle-numbered");
    expect(opener).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild!.attrs.numbered).toBe(true);
  });

  it("CANARY — editable: the type menu opens and # flips numbered", () => {
    const opener = vi.fn();
    const { editor, el } = buildEditor(true, opener);
    click(el, "type-menu");
    expect(opener).toHaveBeenCalledTimes(1);
    click(el, "toggle-numbered");
    expect(editor.state.doc.firstChild!.attrs.numbered).toBe(false);
  });

  it("a pick delivered after the surface turned read-only is refused in the verb", () => {
    let onPick: ((p: unknown) => void) | undefined;
    const opener = vi.fn((p: { onPick: (x: unknown) => void }) => { onPick = p.onPick; });
    const { editor, el } = buildEditor(true, opener as never);
    click(el, "type-menu");
    editor.setEditable(false);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    onPick!({ kind: "no-heading" });
    onPick!({ kind: "heading", level: 2 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
  });
});
