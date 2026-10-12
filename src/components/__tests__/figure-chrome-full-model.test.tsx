// @vitest-environment jsdom
/**
 * Task 1084 — the figure chrome reads ONE full model of the `\includegraphics`
 * it owns, shared by display and mutation.
 *
 * Two partial models are pinned here, through the REAL NodeView:
 *   1. `width=\linewidth` (no factor) is factor 1.0 of `\linewidth`. The old
 *      regexes required a number, so the stepper PREPENDED a second `width=`
 *      that graphicx's later key overrode — the PDF never changed.
 *   2. A caption-FIRST figure keeps its image in `trailingExtras`. The mutators
 *      read `extras` alone, so the controls were live and every click no-opped;
 *      and a captioned figure with no `\includegraphics` copied the picked file
 *      into `figures/` and then never pointed at it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

const pick = vi.hoisted(() => ({
  importFigureFile: vi.fn(async () => "figures/new.png"),
  pickFigureFile: vi.fn(async () => ({ name: "new.png" })),
}));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(
    { getDocWriteHandle: () => ({}), importFigureFile: pick.importFigureFile },
    { stub: () => vi.fn(async () => null) },
  ),
);
vi.mock("@/lib/figures/pick-file", () => ({ pickFigureFile: pick.pickFigureFile }));
vi.mock("@/hooks/useResolvedFigureUrl", () => ({
  useResolvedFigureUrl: () => ({ url: null, status: "loading", error: null, refresh: () => {} }),
}));

import { FigureBlock } from "@/lib/tiptap/figure-block";
import { GraphicsBlock } from "@/lib/tiptap/graphics-block";
import { FigureCaption } from "@/lib/tiptap/figure-caption";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { extractFigureSources } from "@/lib/figures/parse-attrs";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const held: { editor: Editor | null } = { editor: null };
const docIdRef = { current: "doc1" as string | null };

type Fixture =
  | { kind: "figure"; extras: string; trailingExtras?: string }
  | { kind: "graphics"; command: string };

function Harness({ fixture }: { fixture: Fixture }) {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      FigureBlock.configure({ surface: "main", docIdRef }),
      GraphicsBlock.configure({ surface: "main", docIdRef }),
      FigureCaption,
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        fixture.kind === "figure"
          ? {
              type: "figureBlock",
              attrs: {
                uuid: "f1f1",
                extras: fixture.extras,
                trailingExtras: fixture.trailingExtras ?? "",
                hasCaption: true,
                label: "f",
                sources: extractFigureSources(
                  `${fixture.extras}\n${fixture.trailingExtras ?? ""}`,
                ),
              },
              content: [
                { type: "figureCaption", content: [{ type: "text", text: "X" }] },
              ],
            }
          : {
              type: "graphicsBlock",
              attrs: {
                uuid: "g1g1",
                command: fixture.command,
                source: "a.png",
                sources: extractFigureSources(fixture.command),
              },
            },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
  });
  useEffect(() => {
    held.editor = ed ?? null;
  }, [ed]);
  return ed ? <EditorContent editor={ed} /> : null;
}

async function mount(fixture: Fixture) {
  const utils = render(<Harness fixture={fixture} />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

function emitted(): string {
  return serializeBodyOnly(held.editor!.getJSON());
}

function figureAttrs() {
  let attrs: Record<string, unknown> | null = null;
  held.editor!.state.doc.descendants((n) => {
    if (n.type.name === "figureBlock" || n.type.name === "graphicsBlock") attrs = n.attrs;
  });
  return attrs!;
}

function typeAndEnter(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

async function clickAndSettle(el: Element) {
  await act(async () => {
    fireEvent.click(el);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  held.editor = null;
  pick.importFigureFile.mockClear();
  pick.pickFigureFile.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("factor-less relative width (leg 1)", () => {
  it("`width=\\linewidth` reads as 100 and a step REPLACES it in its own unit", async () => {
    const { container } = await mount({
      kind: "figure",
      extras: "\\centering\n\\includegraphics[width=\\linewidth]{a.png}",
    });
    const input = container.querySelector("input.figure-scale-input") as HTMLInputElement;
    expect(input.value).toBe("100");
    typeAndEnter(input, "50");
    const out = emitted();
    expect(out).toContain("\\includegraphics[width=0.5\\linewidth]{a.png}");
    expect(out.match(/width=/g)?.length).toBe(1);
  });

  it("picture: `width=\\textwidth` gets one width, not two", async () => {
    const { container } = await mount({
      kind: "graphics",
      command: "\\includegraphics[width=\\textwidth]{a.png}",
    });
    const input = container.querySelector("input.figure-scale-input") as HTMLInputElement;
    typeAndEnter(input, "40");
    expect(figureAttrs().command).toBe("\\includegraphics[width=0.4\\textwidth]{a.png}");
  });
});

describe("caption-first figure (leg 2)", () => {
  const CAPTION_FIRST = {
    kind: "figure" as const,
    extras: "",
    trailingExtras: "\\centering\\includegraphics[width=0.5\\textwidth]{a.png}",
  };

  it("the width step patches the `\\includegraphics` in trailingExtras", async () => {
    const { container } = await mount(CAPTION_FIRST);
    const input = container.querySelector("input.figure-scale-input") as HTMLInputElement;
    expect(input.value).toBe("50");
    typeAndEnter(input, "70");
    const a = figureAttrs();
    expect(a.extras).toBe("");
    expect(a.trailingExtras).toBe("\\centering\\includegraphics[width=0.7\\textwidth]{a.png}");
    expect(a.widthPercent).toBe(70);
    expect((a.sources as unknown[]).length).toBe(1);
    const out = emitted();
    expect(out.indexOf("\\caption{X}")).toBeGreaterThan(-1);
    expect(out.indexOf("\\includegraphics[width=0.7\\textwidth]{a.png}")).toBeGreaterThan(
      out.indexOf("\\caption{X}"),
    );
  });

  it("Pick image repoints the trailing `\\includegraphics`", async () => {
    const { container } = await mount(CAPTION_FIRST);
    const btn = container.querySelector('[aria-label="Pick image file"]')!;
    await clickAndSettle(btn);
    expect(pick.importFigureFile).toHaveBeenCalledTimes(1);
    expect(figureAttrs().trailingExtras).toBe(
      "\\centering\\includegraphics[width=0.5\\textwidth]{figures/new.png}",
    );
    expect(figureAttrs().source).toBe("figures/new.png");
  });

  it("a captioned figure with NO `\\includegraphics`: Choose image inserts one", async () => {
    const { container } = await mount({ kind: "figure", extras: "\\centering" });
    const cta = container.querySelector(".figure-empty-cta")!;
    expect(cta).toBeTruthy();
    await clickAndSettle(cta);
    expect(pick.importFigureFile).toHaveBeenCalledTimes(1);
    expect(figureAttrs().extras).toBe("\\centering\n  \\includegraphics{figures/new.png}");
    expect(figureAttrs().source).toBe("figures/new.png");
  });
});
