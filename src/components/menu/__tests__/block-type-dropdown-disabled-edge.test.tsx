// @vitest-environment jsdom
//
// Task 1369 — the ¶ block-type dropdown CLOSES on its grey edge, exactly as the
// lightning grid's colour popover does (task 1168), through the ONE
// `useCloseOnDisabledEdge` rule in `menu/menu-trigger.ts`. Before: the menu was
// MASKED (`open && !disabled`) — hidden while greyed but still `open`, so the
// trigger announced `aria-expanded="true"` over nothing and, when the pen came
// back, the menu reappeared unbidden with its window-capture keyboard re-armed.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

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

const rows = () => document.querySelectorAll('[role="menuitemradio"]').length;

describe("Task 1369 — the ¶ dropdown closes on its grey edge", () => {
  it("open → greyed: menu gone and aria-expanded honest; un-greyed: STAYS closed until clicked", () => {
    const { editor } = buildEditor(true);
    const { container, rerender } = render(
      <BlockTypeDropdown editor={editor as never} disabled={false} />,
    );
    const trigger = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Block type"]')!;

    fireEvent.click(trigger());
    expect(rows()).toBeGreaterThan(0);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    // The partner takes the pen.
    act(() => {
      rerender(
        <BlockTypeDropdown
          editor={editor as never}
          disabled
          disabledReason="Your co-author has the pen"
        />,
      );
    });
    expect(rows()).toBe(0);
    expect(trigger().getAttribute("aria-expanded")).not.toBe("true");

    // The pen comes back — no gesture, so no menu.
    act(() => {
      rerender(<BlockTypeDropdown editor={editor as never} disabled={false} />);
    });
    expect(rows()).toBe(0);
    expect(trigger().getAttribute("aria-expanded")).not.toBe("true");

    // Only the user's own click reopens it.
    fireEvent.click(trigger());
    expect(rows()).toBeGreaterThan(0);
  });
});
