// @vitest-environment jsdom
/**
 * Task 1265 — a figure's two delete controls (the lozenge's × and the
 * empty-state chrome's button) are ONE door: `requestFigureDelete`
 * (`@/lib/figures/delete-figure`). One confirm rule — ask iff the block
 * carries a caption, a `[short]` caption or a `\label`; a bare stub (and every
 * graphicsBlock) deletes at once — and one copy vocabulary ("Delete figure" /
 * "Delete image"). Before this, the empty-state "Remove figure" deleted a
 * captioned, labelled figure with no question asked, and a bare
 * `\includegraphics` was called a "figure".
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(
    { getDocWriteHandle: () => ({}), importFigureFile: vi.fn(async () => null) },
    { stub: () => vi.fn(async () => null) },
  ),
);
vi.mock("@/lib/figures/pick-file", () => ({ pickFigureFile: vi.fn(async () => null) }));
vi.mock("@/hooks/useResolvedFigureUrl", () => ({
  useResolvedFigureUrl: () => ({ url: null, status: "loading", error: null, refresh: () => {} }),
}));

import { FigureBlock } from "@/lib/tiptap/figure-block";
import { FigureCaption } from "@/lib/tiptap/figure-caption";
import { GraphicsBlock } from "@/lib/tiptap/graphics-block";
import { extractFigureSources } from "@/lib/figures/parse-attrs";
import { figureDeleteNeedsConfirm } from "@/lib/figures/delete-figure";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const EMPTY = "\\centering\n\\includegraphics{}";
const held: { editor: Editor | null; block: JSONContent } = {
  editor: null,
  block: { type: "paragraph" },
};
const confirmDelete = vi.fn(async () => true);
const confirmRef = { current: confirmDelete as (() => Promise<boolean>) | undefined };

function emptyFigure(opts: { label?: string; caption?: JSONContent[]; shortCaption?: string }) {
  return {
    type: "figureBlock",
    attrs: {
      uuid: "f1f1",
      extras: EMPTY,
      hasCaption: true,
      label: opts.label ?? "",
      shortCaption: opts.shortCaption ?? null,
      sources: extractFigureSources(EMPTY),
    },
    content: [{ type: "figureCaption", content: opts.caption ?? [] }],
  };
}

function Harness() {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      FigureBlock.configure({
        surface: "main",
        docIdRef: { current: "doc1" },
        onConfirmFigureDeleteRef: confirmRef as never,
      }),
      FigureCaption,
      GraphicsBlock.configure({
        surface: "main",
        docIdRef: { current: "doc1" },
        onConfirmFigureDeleteRef: confirmRef as never,
      }),
    ],
    content: {
      type: "doc",
      content: [held.block, { type: "paragraph", content: [{ type: "text", text: "after" }] }],
    },
  });
  useEffect(() => {
    held.editor = ed ?? null;
  }, [ed]);
  return ed ? <EditorContent editor={ed} /> : null;
}

async function mount(block: JSONContent) {
  held.block = block;
  const utils = render(<Harness />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

function count(typeName: string): number {
  let n = 0;
  held.editor!.state.doc.descendants((node) => {
    if (node.type.name === typeName) n++;
  });
  return n;
}

async function clickAndSettle(el: Element) {
  await act(async () => {
    fireEvent.click(el);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  held.editor = null;
  confirmDelete.mockReset();
  confirmDelete.mockImplementation(async () => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the empty-state delete asks the shared confirm rule", () => {
  it("an empty figure WITH a caption asks first, and a refusal deletes nothing", async () => {
    confirmDelete.mockImplementation(async () => false);
    const { container } = await mount(
      emptyFigure({ caption: [{ type: "text", text: "A typed caption" }] }),
    );
    await clickAndSettle(container.querySelector('[aria-label="Delete figure"]')!);
    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(count("figureBlock")).toBe(1);
  });

  it("an empty figure WITH a label asks first, and a yes deletes it", async () => {
    const { container } = await mount(emptyFigure({ label: "fig:a" }));
    await clickAndSettle(container.querySelector('[aria-label="Delete figure"]')!);
    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(count("figureBlock")).toBe(0);
  });

  it("a bare stub (no caption, no label) deletes without a dialog", async () => {
    const { container } = await mount(emptyFigure({}));
    await clickAndSettle(container.querySelector('[aria-label="Delete figure"]')!);
    expect(confirmDelete).not.toHaveBeenCalled();
    expect(count("figureBlock")).toBe(0);
  });

  it("an empty graphicsBlock is an IMAGE, and deletes without a dialog", async () => {
    const { container } = await mount({
      type: "graphicsBlock",
      attrs: { uuid: "g1g1", command: "\\includegraphics{}", source: "" },
    });
    expect(container.querySelector('[aria-label="Delete figure"]')).toBeNull();
    const btn = container.querySelector('[aria-label="Delete image"]');
    expect(btn).not.toBeNull();
    await clickAndSettle(btn!);
    expect(confirmDelete).not.toHaveBeenCalled();
    expect(count("graphicsBlock")).toBe(0);
  });
});

describe("figureDeleteNeedsConfirm — the one rule", () => {
  it("counts non-text caption content and the [short] caption", async () => {
    await mount(emptyFigure({ shortCaption: "Short" }));
    const fig = held.editor!.state.doc.firstChild!;
    expect(figureDeleteNeedsConfirm(fig)).toBe(true);
    const bare = held.editor!.schema.nodes.figureBlock.create(
      { extras: EMPTY },
      held.editor!.schema.nodes.figureCaption.create(),
    );
    expect(figureDeleteNeedsConfirm(bare)).toBe(false);
    const hardBreakOnly = held.editor!.schema.nodes.figureBlock.create(
      { extras: EMPTY },
      held.editor!.schema.nodes.figureCaption.create(null, held.editor!.schema.nodes.hardBreak.create()),
    );
    expect(figureDeleteNeedsConfirm(hardBreakOnly)).toBe(true);
  });
});
