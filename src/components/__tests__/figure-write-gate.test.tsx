// @vitest-environment jsdom
/**
 * Task 1083 — the figure's label lozenge (`#`, label edit/add, ×) and its
 * chrome writers (width, Remove figure, Pick image) ask ONE write gate
 * (`surfaceEditableNow`) at gesture time AND after every `await`; the label
 * rename door refuses a non-editable target itself (`"read-only"`), so every
 * caller inherits it. The figure's twin of the heading chip's task-1017 gate.
 *
 * The gate is flipped through the pen axis (`setEditable(false)` →
 * `view.editable`), which `surfaceEditableNow` reads on any surface.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { registerEditRefusalVoice, type EditRefusalNotice } from "@/lib/edit-refusal";

const pick = vi.hoisted(() => ({
  importFigureFile: vi.fn(async () => "figures/new.png"),
  pickFigureFile: vi.fn(async (): Promise<unknown> => ({ file: { name: "new.png" }, handle: null })),
}));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(
    { getDocWriteHandle: () => ({}), importFigureFile: pick.importFigureFile },
    { stub: () => vi.fn(async () => null) },
  ),
);
vi.mock("@/lib/figures/pick-file", () => ({
  pickFigureFile: pick.pickFigureFile,
  toIncludableFigure: async (p: unknown) => p,
}));
vi.mock("@/hooks/useResolvedFigureUrl", () => ({
  useResolvedFigureUrl: () => ({ url: null, status: "loading", error: null, refresh: () => {} }),
}));

import { FigureBlock } from "@/lib/tiptap/figure-block";
import { FigureCaption } from "@/lib/tiptap/figure-caption";
import { extractFigureSources } from "@/lib/figures/parse-attrs";
import { renameLabelWithRefs } from "@/lib/tiptap/label-rename";
import { LabelRef } from "@/lib/tiptap/label";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const EXTRAS = "\\centering\n\\includegraphics[width=0.5\\textwidth]{a.png}";
const held: { editor: Editor | null; extras: string } = { editor: null, extras: EXTRAS };
const docIdRef = { current: "doc1" as string | null };
const confirmDelete = vi.fn(async () => true);
const onConfirmFigureDeleteRef = { current: confirmDelete as (() => Promise<boolean>) | undefined };

function Harness() {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      FigureBlock.configure({
        surface: "main",
        docIdRef,
        onConfirmFigureDeleteRef: onConfirmFigureDeleteRef as never,
      }),
      FigureCaption,
      LabelRef,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "labelRef", attrs: { label: "fig:a" } },
          ],
        },
        {
          type: "figureBlock",
          attrs: {
            uuid: "f1f1",
            extras: held.extras,
            hasCaption: true,
            label: "fig:a",
            numbered: true,
            sources: extractFigureSources(held.extras),
          },
          content: [{ type: "figureCaption", content: [{ type: "text", text: "X" }] }],
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

async function mount(extras = EXTRAS) {
  held.extras = extras;
  const utils = render(<Harness />);
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

function figure(): { pos: number; attrs: Record<string, unknown> } | null {
  let hit: { pos: number; attrs: Record<string, unknown> } | null = null;
  held.editor!.state.doc.descendants((n, pos) => {
    if (n.type.name === "figureBlock") hit = { pos, attrs: n.attrs };
  });
  return hit;
}

async function clickAndSettle(el: Element) {
  await act(async () => {
    fireEvent.click(el);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function lockEditor() {
  act(() => {
    held.editor!.setEditable(false);
  });
}

// Task 1436: every refusal AFTER the user acted is announced exactly once
// through the app's refusal voice; gesture-time refusals announce nothing.
let notices: EditRefusalNotice[] = [];
let unregisterVoice: (() => void) | null = null;

beforeEach(() => {
  notices = [];
  unregisterVoice = registerEditRefusalVoice((n) => notices.push(n));
  vi.stubGlobal("ResizeObserver", RO);
  held.editor = null;
  pick.importFigureFile.mockClear();
  pick.pickFigureFile.mockReset();
  pick.pickFigureFile.mockImplementation(async () => ({ file: { name: "new.png" }, handle: null }));
  confirmDelete.mockReset();
  confirmDelete.mockImplementation(async () => true);
});
afterEach(() => {
  unregisterVoice?.();
  cleanup();
  vi.unstubAllGlobals();
});

describe("read-only: every figure verb writes nothing and opens nothing", () => {
  it("lozenge `#`, label edit and × — no dispatch, no modal, no input", async () => {
    const { container } = await mount();
    lockEditor();
    const before = held.editor!.state.doc;

    await clickAndSettle(container.querySelector(".figure-annotation-numbered-toggle")!);
    await clickAndSettle(container.querySelector(".figure-label-text")!);
    expect(container.querySelector("input.figure-label-input")).toBeNull();
    await clickAndSettle(container.querySelector(".figure-annotation-delete")!);
    expect(confirmDelete).not.toHaveBeenCalled();

    expect(held.editor!.state.doc.eq(before)).toBe(true);
    expect(notices).toHaveLength(0);
  });

  it("chrome width / Remove figure / Pick image — no dispatch, no picker, no file", async () => {
    const { container } = await mount();
    lockEditor();
    const before = held.editor!.state.doc;

    const input = container.querySelector("input.figure-scale-input") as HTMLInputElement;
    act(() => {
      input.focus();
      fireEvent.change(input, { target: { value: "70" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);

    expect(pick.pickFigureFile).not.toHaveBeenCalled();
    expect(pick.importFigureFile).not.toHaveBeenCalled();
    expect(held.editor!.state.doc.eq(before)).toBe(true);
    expect(notices).toHaveLength(0);
  });

  it("empty figure: Remove figure and Choose image — no dispatch, no picker", async () => {
    const { container } = await mount("\\centering\n\\includegraphics{}");
    lockEditor();
    const before = held.editor!.state.doc;
    await clickAndSettle(container.querySelector('[aria-label="Delete figure"]')!);
    await clickAndSettle(container.querySelector(".figure-empty-cta")!);
    expect(pick.pickFigureFile).not.toHaveBeenCalled();
    expect(held.editor!.state.doc.eq(before)).toBe(true);
    expect(notices).toHaveLength(0);
  });
});

describe("the gate is re-asked after every await", () => {
  it("the pen taken while the delete confirm is up: nothing deleted", async () => {
    const { container } = await mount();
    confirmDelete.mockImplementation(async () => {
      held.editor!.setEditable(false);
      return true;
    });
    await clickAndSettle(container.querySelector(".figure-annotation-delete")!);
    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(figure()).not.toBeNull();
    // The user answered "Delete" — the refusal SAYS so (task 1436).
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("Figure not deleted");
  });

  it("the pen taken while the OS picker is up: no file written, no edit", async () => {
    const { container } = await mount();
    pick.pickFigureFile.mockImplementation(async () => {
      held.editor!.setEditable(false);
      return { file: { name: "new.png" }, handle: null };
    });
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);
    expect(pick.pickFigureFile).toHaveBeenCalledTimes(1);
    expect(pick.importFigureFile).not.toHaveBeenCalled();
    expect(figure()!.attrs.extras).toBe(EXTRAS);
    // The user picked a file — announced, the pick handed back.
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("Image not added");
    expect(notices[0].draft).toBe("new.png");
  });

  it("an import failure other than an unsafe path is announced, not just logged", async () => {
    const { container } = await mount();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    pick.importFigureFile.mockImplementationOnce(async () => {
      throw new Error("no free name for new.png after 1000 candidates");
    });
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);
    expect(figure()!.attrs.extras).toBe(EXTRAS);
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain("no free name");
    expect(notices[0].draft).toBe("new.png");
    err.mockRestore();
  });

  it("a cancelled pick says nothing", async () => {
    const { container } = await mount();
    pick.pickFigureFile.mockImplementation(async () => null as never);
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);
    expect(pick.importFigureFile).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });

  it("Pick image rebuilds from the LIVE node: an edit made during the picker survives", async () => {
    const { container } = await mount();
    pick.pickFigureFile.mockImplementation(async () => {
      const f = figure()!;
      const ed = held.editor!;
      ed.view.dispatch(
        ed.state.tr.setNodeMarkup(f.pos, undefined, {
          ...f.attrs,
          extras: `% kept\n${EXTRAS}`,
        }),
      );
      return { file: { name: "new.png" }, handle: null };
    });
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);
    expect(pick.importFigureFile).toHaveBeenCalledTimes(1);
    const extras = figure()!.attrs.extras as string;
    expect(extras).toContain("% kept");
    expect(extras).toContain("{figures/new.png}");
  });
});

describe("the rename door refuses a non-editable target (every caller inherits it)", () => {
  const locate = () => {
    const f = figure();
    if (!f) return null;
    return { pos: f.pos, node: held.editor!.state.doc.nodeAt(f.pos)! };
  };

  it("read-only on entry → \"read-only\", nothing written", async () => {
    await mount();
    lockEditor();
    const outcome = await renameLabelWithRefs(held.editor! as never, {
      locate,
      newLabel: "fig:b",
    });
    expect(outcome).toBe("read-only");
    expect(figure()!.attrs.label).toBe("fig:a");
    // Refused before any question — nothing the user answered; silent.
    expect(notices).toHaveLength(0);
  });

  it("pen taken while the confirm is up → \"read-only\", nothing written", async () => {
    await mount();
    const ed = held.editor!;
    // The paragraph's `\ref{fig:a}` is a ref to carry, so the door ASKS.
    const confirm = vi.fn(async () => {
      ed.setEditable(false);
      return "confirm" as const;
    });
    const outcome = await renameLabelWithRefs(ed as never, {
      locate,
      newLabel: "fig:b",
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("read-only");
    expect(figure()!.attrs.label).toBe("fig:a");
    // The user answered "Update references" — announced, the typed key back.
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("Label not renamed");
    expect(notices[0].draft).toBe("fig:b");
  });

  it("the declaration removed while the confirm is up → announced once", async () => {
    await mount();
    const ed = held.editor!;
    const confirm = vi.fn(async () => {
      const f = figure()!;
      ed.view.dispatch(ed.state.tr.delete(f.pos, f.pos + ed.state.doc.nodeAt(f.pos)!.nodeSize));
      return "confirm" as const;
    });
    const outcome = await renameLabelWithRefs(ed as never, { locate, newLabel: "fig:b", confirm });
    expect(outcome).toBe("unresolved");
    expect(notices).toHaveLength(1);
    expect(notices[0].draft).toBe("fig:b");
  });
});

describe("positive control: an editable doc still performs each verb", () => {
  it("empty figure: Remove figure deletes", async () => {
    const { container } = await mount("\\centering\n\\includegraphics{}");
    await clickAndSettle(container.querySelector('[aria-label="Delete figure"]')!);
    expect(figure()).toBeNull();
  });

  it("`#` toggles, Pick image imports, × deletes", async () => {
    const { container } = await mount();
    await clickAndSettle(container.querySelector(".figure-annotation-numbered-toggle")!);
    expect(figure()!.attrs.numbered).toBe(false);
    await clickAndSettle(container.querySelector('[aria-label="Pick image file"]')!);
    expect(pick.importFigureFile).toHaveBeenCalledTimes(1);
    await clickAndSettle(container.querySelector(".figure-annotation-delete")!);
    expect(confirmDelete).toHaveBeenCalledTimes(1);
    expect(figure()).toBeNull();
    expect(notices).toHaveLength(0);
  });

  it("the rename door still renames an editable target", async () => {
    await mount();
    const outcome = await renameLabelWithRefs(held.editor! as never, {
      locate: () => {
        const f = figure()!;
        return { pos: f.pos, node: held.editor!.state.doc.nodeAt(f.pos)! };
      },
      newLabel: "fig:b",
    });
    expect(outcome).toBe("renamed");
    expect(figure()!.attrs.label).toBe("fig:b");
  });
});
