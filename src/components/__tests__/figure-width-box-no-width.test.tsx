// @vitest-environment jsdom
/**
 * TASK 537 — a figure whose source carries NO width must not claim one, and
 * whatever the width box displays must be committable.
 *
 * Pre-537 `FigureFullView` derived the box's value as
 * `clampPercent(widthPercent ?? 50)`: for the commonest figure there is —
 * `\includegraphics{a.png}`, which LaTeX renders at its NATURAL size — the
 * box printed 50 while the hug layout (correctly) applied no max-width at all.
 * And the one value the box displayed was the one value it could not set:
 * `applyScale` bails on `clamped === currentPercent`, so typing the displayed
 * 50 and pressing Enter dispatched NOTHING, while 60 worked.
 *
 * The fix has two halves and the leg with teeth needs BOTH: the value is
 * `null` for a width-less source (the box renders empty with an `auto`
 * placeholder), and the zero-change bail — kept, per the task-470 rule — is
 * scoped to a source that HAS a width. A chrome-only leg handed `null`
 * cannot see the first half, because the fabrication lived in the NodeView's
 * DERIVATION, so this suite mounts the REAL NodeView through `EditorContent`
 * over a REAL `figureBlock` / `graphicsBlock` (the `forest-render-cost`
 * harness) and reads the emitted `\includegraphics` back off the document.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
  for (const name of STORAGE_FNS) mod[name] = vi.fn(async () => null);
  return mod;
});

import { useEffect } from "react";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FigureBlock } from "@/lib/tiptap/figure-block";
import { GraphicsBlock } from "@/lib/tiptap/graphics-block";
import { FigureCaption } from "@/lib/tiptap/figure-caption";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { parseWidthSpec } from "@/lib/figures/parse-attrs";
import { FigureChrome } from "@/components/FigureBlockNodeView";

// The NodeView's chrome-placement effect constructs a ResizeObserver
// unconditionally; jsdom has none.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const held: { editor: Editor | null } = { editor: null };

type Fixture =
  | { kind: "figure"; extras: string }
  | { kind: "graphics"; command: string };

function Harness({ fixture }: { fixture: Fixture }) {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      // The REAL nodes with the REAL React NodeView and the REAL derivation.
      FigureBlock.configure({ surface: "main" }),
      GraphicsBlock.configure({ surface: "main" }),
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
                sources: [sourceOf(fixture.extras)],
              },
              content: [
                { type: "figureCaption", content: [{ type: "text", text: "A caption" }] },
              ],
            }
          : {
              type: "graphicsBlock",
              attrs: {
                uuid: "g1g1",
                command: fixture.command,
                source: "a.png",
                sources: [sourceOf(fixture.command)],
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

/** The `FigureSource` a fixture's `\includegraphics` carries, so the
 *  `sources` attr agrees with the bytes — the parser derives exactly this
 *  (`options` + `widthPercent: parseWidthSpec(options)`). */
function sourceOf(text: string) {
  const m = text.match(/\\includegraphics\[([^\]]*)\]/);
  const options = m ? m[1] : "";
  return { path: "a.png", options, widthPercent: parseWidthSpec(options) };
}

async function mount(fixture: Fixture) {
  const utils = render(<Harness fixture={fixture} />);
  await act(async () => {
    await Promise.resolve();
  });
  const input = utils.container.querySelector(
    "input.figure-scale-input",
  ) as HTMLInputElement | null;
  expect(input, "the REAL chrome mounted").toBeTruthy();
  return { ...utils, input: input! };
}

function emitted(): string {
  return serializeBodyOnly(held.editor!.getJSON());
}

function transactionCounter() {
  let n = 0;
  held.editor!.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) n += 1;
  });
  return () => n;
}

function typeAndEnter(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  held.editor = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BARE_FIGURE: Fixture = { kind: "figure", extras: "\\centering\n\\includegraphics{a.png}\n" };
const HALF_FIGURE: Fixture = {
  kind: "figure",
  extras: "\\centering\n\\includegraphics[width=0.5\\textwidth]{a.png}\n",
};
const BARE_PICTURE: Fixture = { kind: "graphics", command: "\\includegraphics{a.png}" };

describe("figure width box — a width-less source does not claim a width", () => {
  it("figure: the box is EMPTY with an `auto` placeholder, not a fabricated 50", async () => {
    const { input } = await mount(BARE_FIGURE);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("auto");
    expect(input.getAttribute("data-natural-size")).toBe("true");
    expect(input.getAttribute("aria-label")).toMatch(/natural size/);
  });

  it("picture: the same — a bare `\\includegraphics` shows no number", async () => {
    const { input } = await mount(BARE_PICTURE);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("auto");
  });

  it("CONTROL — a source WITH a width shows it, and no placeholder", async () => {
    const { input } = await mount(HALF_FIGURE);
    expect(input.value).toBe("50");
    expect(input.placeholder).toBe("");
    expect(input.getAttribute("data-natural-size")).toBeNull();
  });
});

describe("figure width box — whatever it can display, it can commit", () => {
  // The leg with teeth (Gabriel's audit probe, driven through the real
  // NodeView): pre-537 the box showed 50 and typing 50 dispatched NOTHING.
  it("figure: typing 50 from the no-width state reaches the document", async () => {
    const { input } = await mount(BARE_FIGURE);
    const count = transactionCounter();
    typeAndEnter(input, "50");
    expect(count()).toBe(1);
    expect(emitted()).toContain("\\includegraphics[width=0.5\\textwidth]{a.png}");
    // …and the box now shows the width the document holds.
    expect(input.value).toBe("50");
    expect(input.placeholder).toBe("");
  });

  it("picture: typing 50 from the no-width state reaches the document", async () => {
    const { input } = await mount(BARE_PICTURE);
    const count = transactionCounter();
    typeAndEnter(input, "50");
    expect(count()).toBe(1);
    expect(emitted()).toContain("\\includegraphics[width=0.5\\textwidth]{a.png}");
  });

  it("CONTROL — any other value from the no-width state still lands (60)", async () => {
    const { input } = await mount(BARE_FIGURE);
    typeAndEnter(input, "60");
    expect(emitted()).toContain("\\includegraphics[width=0.6\\textwidth]{a.png}");
  });

  it("an EMPTY commit on a width-less figure sets nothing — natural size stays", async () => {
    const { input } = await mount(BARE_FIGURE);
    const count = transactionCounter();
    typeAndEnter(input, "");
    expect(count()).toBe(0);
    expect(emitted()).toContain("\\includegraphics{a.png}");
    expect(input.value).toBe("");
  });

  // The task-470 zero-move rule survives where it belongs: a source that HAS
  // a width, re-committed unchanged, persists nothing.
  it("CONTROL — re-committing the width a source already has dispatches nothing", async () => {
    const { input } = await mount(HALF_FIGURE);
    const count = transactionCounter();
    typeAndEnter(input, "50");
    expect(count()).toBe(0);
    expect(emitted()).toContain("\\includegraphics[width=0.5\\textwidth]{a.png}");
  });
});

describe("figure width box — the steppers from the no-width state are unchanged", () => {
  // Pre-537 they stepped off the fabricated 50 to 40 / 60; they still do,
  // now off the stated `DEFAULT_SCALE_PERCENT` seed. A passing control.
  it("+ seeds to 60", async () => {
    const { container } = await mount(BARE_FIGURE);
    const plus = container.querySelector('button[aria-label="Increase width"]') as HTMLButtonElement;
    expect(plus.disabled).toBe(false);
    act(() => {
      fireEvent.click(plus);
    });
    expect(emitted()).toContain("\\includegraphics[width=0.6\\textwidth]{a.png}");
  });

  it("− seeds to 40", async () => {
    const { container } = await mount(BARE_FIGURE);
    const minus = container.querySelector('button[aria-label="Decrease width"]') as HTMLButtonElement;
    expect(minus.disabled).toBe(false);
    act(() => {
      fireEvent.click(minus);
    });
    expect(emitted()).toContain("\\includegraphics[width=0.4\\textwidth]{a.png}");
  });
});

describe("FigureChrome alone — the chrome's own contract for `null`", () => {
  function renderChrome(currentPercent: number | null) {
    const onScale = vi.fn();
    const utils = render(
      <FigureChrome
        currentPercent={currentPercent}
        canScale
        onScale={onScale}
        onPickFile={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const input = utils.container.querySelector("input.figure-scale-input") as HTMLInputElement;
    return { onScale, input, ...utils };
  }

  it("renders empty for null and commits the first typed value once", () => {
    const { onScale, input } = renderChrome(null);
    expect(input.value).toBe("");
    input.focus();
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(50);
  });

  it("Escape on a width-less figure restores the EMPTY box, not a number", () => {
    const { onScale, input } = renderChrome(null);
    input.focus();
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onScale).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });
});
