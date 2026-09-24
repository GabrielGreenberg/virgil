// @vitest-environment jsdom
//
// TASK 738 — the lightning grid's painted state FOLLOWS the live editor while
// the panel is open.
//
// A format click keeps the panel open by design and sets no React state, and
// nothing above the panel re-renders on a mark toggle, so each cell's `active`
// and `disabled` used to be a snapshot of the panel's last render: click B, the
// word turns bold, the B cell stays unlit. The sibling suites stub
// `isActive: () => false`, so none of them could see it — this one mounts a
// REAL editor.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it.)
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  ActionsMenuPanel,
  LIGHTNING_ACTIVE_MARKS,
  LIGHTNING_GRID_CELL_IDS,
} from "../../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// The cells' `focus()` defers a scrollIntoView; jsdom has no layout, so give
// PM's scroll math zero rects to read.
const ZERO_RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
rangeProto.getClientRects ??= () => [] as unknown as DOMRectList;
rangeProto.getBoundingClientRect ??= () => ZERO_RECT as DOMRect;

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

function mount(): Editor {
  const editableRef: RefObject<boolean> = { current: true };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p-A" }, content: [{ type: "text", text: "alpha beta gamma" }] },
      ],
    },
  });
}

/** "beta" inside p-A. */
const BETA = { from: 7, to: 11 };

let editor: Editor | null = null;

function openPanel(ed: Editor) {
  ed.commands.setTextSelection(BETA);
  const api = { open: vi.fn(), dispatch: vi.fn() } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  render(
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={ed as unknown as ReactEditor}
        paragraphUuid="p-A"
        nodeKind="paragraph"
        range={BETA}
        mode="selection"
        triggerRect={RECT}
        onClose={() => {}}
      />
    </DragHandleMenuProvider>,
  );
}

const cell = (hint: string) =>
  document.querySelector(
    `[aria-label="Selection actions"] button[data-hint="${hint}"]`,
  ) as HTMLButtonElement;
const lit = (hint: string) => cell(hint).getAttribute("data-format-active") === "true";
const frame = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("task 738 — the open lightning grid follows the live editor", () => {
  it("clicking the Bold cell lights it; clicking again unlights it", async () => {
    editor = mount();
    openPanel(editor);
    expect(lit("Bold (⌘B)")).toBe(false);

    fireEvent.click(cell("Bold (⌘B)"));
    await frame();
    expect(editor.isActive("bold")).toBe(true);
    expect(lit("Bold (⌘B)")).toBe(true);

    fireEvent.click(cell("Bold (⌘B)"));
    await frame();
    expect(editor.isActive("bold")).toBe(false);
    expect(lit("Bold (⌘B)")).toBe(false);
  });

  it("a toggle dispatched on the editor itself (⌘B's path) is followed", async () => {
    editor = mount();
    openPanel(editor);
    act(() => {
      editor!.chain().setTextSelection(BETA).toggleItalic().run();
    });
    await frame();
    expect(lit("Italic (⌘I)")).toBe(true);
  });

  it("a transaction that changes a row's applies() re-greys its cell", async () => {
    editor = mount();
    openPanel(editor);
    expect(cell("Bold (⌘B)").disabled).toBe(false);
    // A codeBlock admits no marks — the bold row's applies() now says disabled.
    act(() => {
      editor!.chain().setTextSelection(BETA).setCodeBlock().setTextSelection(BETA).run();
    });
    await frame();
    expect(cell("Bold (⌘B)").disabled).toBe(true);
  });
});

describe("task 738 — the live signature covers every painted read", () => {
  const SRC = commentsStripped(
    readFileSync(join(resolve(__dirname, "../../../.."), "src/components/ActionsMenuPanel.tsx"), "utf8"),
  );
  const literals = (fn: string) =>
    [...SRC.matchAll(new RegExp(`\\b${fn}\\("([A-Za-z-]+)"\\)`, "g"))].map((m) => m[1]!);

  it("every isActive(\"…\") the render makes is in LIGHTNING_ACTIVE_MARKS", () => {
    const seen = literals("isActive");
    expect(seen.length).toBeGreaterThanOrEqual(7);
    expect([...new Set(seen)].sort()).toEqual([...LIGHTNING_ACTIVE_MARKS].sort());
  });

  it("every gridCellDisabled(\"…\") the render makes is in LIGHTNING_GRID_CELL_IDS", () => {
    const seen = literals("gridCellDisabled");
    expect(seen.length).toBeGreaterThanOrEqual(15);
    expect([...new Set(seen)].sort()).toEqual([...LIGHTNING_GRID_CELL_IDS].sort());
  });
});
