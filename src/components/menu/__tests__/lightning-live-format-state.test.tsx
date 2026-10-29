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
  LIGHTNING_GRID,
  LIGHTNING_GRID_CELL_IDS,
} from "../../ActionsMenuPanel";
import { toggledMember, VIRGIL_ACTION_REGISTRY } from "@/lib/actions/action-registry";
import { menuCellToneStyle } from "../row-tone";
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

// By NAME (`aria-label`), not `data-hint`: since task 968 a greyed cell's hint
// also carries WHY it is grey, while its name stays the cell's title.
const cell = (name: string) =>
  document.querySelector(
    `[aria-label="Selection actions"] button[aria-label="${name}"]`,
  ) as HTMLButtonElement;
// Task 1352: the on-state is ANNOUNCED (`aria-checked`), not a private data
// attribute no AT and no CSS read.
const lit = (hint: string) => cell(hint).getAttribute("aria-checked") === "true";
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
    expect(lit("Bold")).toBe(false);

    fireEvent.click(cell("Bold"));
    await frame();
    expect(editor.isActive("bold")).toBe(true);
    expect(lit("Bold")).toBe(true);

    fireEvent.click(cell("Bold"));
    await frame();
    expect(editor.isActive("bold")).toBe(false);
    expect(lit("Bold")).toBe(false);
  });

  it("a toggle dispatched on the editor itself (the Mod-b chord's path) is followed", async () => {
    editor = mount();
    openPanel(editor);
    act(() => {
      editor!.chain().setTextSelection(BETA).toggleItalic().run();
    });
    await frame();
    expect(lit("Italic")).toBe(true);
  });

  it("a transaction that changes a row's applies() re-greys its cell", async () => {
    editor = mount();
    openPanel(editor);
    expect(cell("Bold").disabled).toBe(false);
    // A codeBlock admits no marks — the bold row's applies() now says disabled.
    act(() => {
      editor!.chain().setTextSelection(BETA).setCodeBlock().setTextSelection(BETA).run();
    });
    await frame();
    expect(cell("Bold").disabled).toBe(true);
  });
});

describe("task 1352 — a toggle cell announces its state", () => {
  it("with the caret in bold text: Bold is a checked menuitemcheckbox, Italic unchecked, Example a plain menuitem", () => {
    editor = mount();
    editor.chain().setTextSelection(BETA).toggleBold().run();
    openPanel(editor);
    expect(cell("Bold").getAttribute("role")).toBe("menuitemcheckbox");
    expect(cell("Bold").getAttribute("aria-checked")).toBe("true");
    expect(cell("Italic").getAttribute("role")).toBe("menuitemcheckbox");
    expect(cell("Italic").getAttribute("aria-checked")).toBe("false");
    const example = cell(VIRGIL_ACTION_REGISTRY.example.label);
    expect(example.getAttribute("role")).toBe("menuitem");
    expect(example.hasAttribute("aria-checked")).toBe(false);
  });

  it("the applied cell paints the toggle-on palette, not the hover token (SPECIFIED value — jsdom resolves no vars)", () => {
    const on = menuCellToneStyle({ roving: false, applied: true });
    expect(on.background).toBe("var(--control-selected-tint)");
    expect(on.color).toBe("var(--control-selected-ink)");
    // Roving still wins the fill; disabled still wins the ink (task 986's order).
    expect(menuCellToneStyle({ roving: true, applied: true }).background).toBe("var(--menu-roving-bg)");
    expect(menuCellToneStyle({ roving: false, applied: true, disabled: true }).color).toBe("var(--ink-faint)");
  });
});

describe("task 1352 — the grid's painted reads are DERIVED from its table", () => {
  const SRC = commentsStripped(
    readFileSync(join(resolve(__dirname, "../../../.."), "src/components/ActionsMenuPanel.tsx"), "utf8"),
  );

  it("every toggle cell's active name is its row's `makes`; non-toggles have none", () => {
    for (const id of LIGHTNING_GRID_CELL_IDS) {
      const row = VIRGIL_ACTION_REGISTRY[id];
      const member = toggledMember(row);
      if (row.toggle) {
        expect(row.makes, `${id} is a toggle and must say what it toggles`).toBeDefined();
        const made = "mark" in row.makes! ? row.makes!.mark : row.makes!.node;
        expect(member).toBe(made);
      } else {
        expect(member, `${id} is not a toggle`).toBeNull();
      }
    }
    expect(LIGHTNING_ACTIVE_MARKS.length).toBeGreaterThanOrEqual(8);
    expect([...LIGHTNING_ACTIVE_MARKS].sort()).toEqual(
      LIGHTNING_GRID_CELL_IDS.flatMap((id) => {
        const m = toggledMember(VIRGIL_ACTION_REGISTRY[id]);
        return m === null ? [] : [m];
      }).sort(),
    );
  });

  it("the grid cell ids are the table's, minus the row-less ¶ cell", () => {
    expect(LIGHTNING_GRID_CELL_IDS).toEqual(
      LIGHTNING_GRID.map((c) => c.id).filter((id) => id !== "block-type"),
    );
  });

  it("census: no hand-spelled isActive(\"…\") survives in the panel", () => {
    expect([...SRC.matchAll(/\bisActive\("([A-Za-z-]+)"/g)].map((m) => m[1])).toEqual([]);
  });

  it("census: no literal row/col coordinates — they are derived from the table index", () => {
    expect(SRC).not.toMatch(/\brow=\{\d+\}/);
    expect(SRC).not.toMatch(/\bcol=\{\d+\}/);
  });
});
