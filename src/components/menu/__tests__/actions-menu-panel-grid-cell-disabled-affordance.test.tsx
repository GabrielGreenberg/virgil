// @vitest-environment jsdom
//
// Task 294 — the lightning grid's two <button>-based cells (FmtBtn +
// ColorGridCell) must paint the SAME disabled affordance when the collab pen is
// held by a partner (canEdit === false → each cell's `disabled` is true).
//
// Pre-294 the color cell's disabled cursor was a `disabled ? "pointer" :
// "pointer"` tautology, so it showed a `pointer` cursor while every FmtBtn cell
// (bold/italic/…) correctly showed `not-allowed`. The fix routes both cell kinds
// through one helper (since task 986, `menuCellToneStyle` in row-tone.ts), so
// this test pins that the
// disabled cursor + ink now MATCH across the two primitives. It goes RED on
// the old tautology (color cell cursor === "pointer") and GREEN once both share
// the shell.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// The nested block-type trigger + block inserters need a live editor; mock them
// (orthogonal to the disabled-affordance axis under test).
vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));
// Task 638: `ActionsMenuPanel` now reads the collab pen through
// `useCollabContext`, and `@/hooks/useCollab` transitively imports `@/lib/storage`
// — whose `require("@/lib/storage-fsa")` does not resolve under vitest (the
// extension-barrel gotcha). Stub it; nothing here touches disk. The former
// `vi.mock("@/lib/tiptap/tex-block", …)` that used to sever this chain is gone
// with the panel's direct `insertTexBlock` import (the `	ex` cell routes
// through `runGridAction` now).
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { ActionsMenuPanel } from "../../ActionsMenuPanel";
import { formatShortcut, keysFromKeybinding } from "../../Kbd";
import { VIRGIL_ACTION_REGISTRY } from "@/lib/actions/action-registry";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

/** Minimal editor stub the panel + the registry `applies()`/`run()` read.
 *  `editable=false` → `canEdit` is false → every grid cell renders disabled. */
function makeEditor(editable: boolean) {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const ret = () => c;
    for (const m of [
      "focus", "unsetTextColor", "setTextColor", "setTextSelection",
      "toggleBold", "toggleItalic", "run",
    ]) {
      c[m] = ret;
    }
    return c;
  };
  const $pos = {
    parent: { type: { name: "paragraph" } },
    blockRange: () => ({
      parent: { child: () => ({ type: { name: "paragraph" } }) },
      startIndex: 0,
      endIndex: 1,
    }),
  };
  const state = {
    selection: { from: 3, to: 9, $from: $pos, $to: $pos },
    doc: { textBetween: () => "" },
  };
  const view = {
    state,
    // `editor.isEditable` IS `view.editable` on a real TipTap editor, and since
    // task 733 the panel asks the surface-editability door, which reads the
    // VIEW. A mock that carried the flag only on the wrapper made this suite's
    // read-only leg unanswerable.
    editable: editable,
    coordsAtPos: () => ({ left: 0, top: 0, bottom: 10, right: 0 }),
  };
  return {
    isEditable: editable,
    isActive: () => false,
    chain,
    state,
    view,
  } as unknown as Parameters<typeof ActionsMenuPanel>[0]["editor"];
}

function renderPanel(editable: boolean) {
  const api = { open: vi.fn(), dispatch: vi.fn() } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  return render(
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={makeEditor(editable)}
        paragraphUuid="p7"
        nodeKind="paragraph"
        range={{ from: 3, to: 9 }}
        mode="selection"
        triggerRect={RECT}
        onClose={() => {}}
      />
    </DragHandleMenuProvider>,
  );
}

const menuEl = () =>
  document.querySelector('[aria-label="Selection actions"]') as HTMLElement | null;
// By NAME (`aria-label`), not `data-hint`: since task 968 a greyed cell's hint
// also carries WHY it is grey, while its name stays the cell's title.
const cell = (name: string) =>
  menuEl()!.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement | null;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Task 294 — grid cells share one disabled affordance", () => {
  it("both the color cell and a FmtBtn cell paint not-allowed + the menu's disabled ink when disabled", () => {
    renderPanel(/* editable */ false);

    const color = cell("Text color");
    const bold = cell("Bold");
    expect(color).toBeTruthy();
    expect(bold).toBeTruthy();

    // The native disabled attribute is set on both button cells.
    expect(color!.disabled).toBe(true);
    expect(bold!.disabled).toBe(true);

    // The color cell no longer shows the tautological `pointer` — it matches
    // FmtBtn's `not-allowed`, and both carry the menu's ONE disabled grey —
    // `--ink-faint`, no dimming opacity (task 986: the cells used to dim to
    // 0.4, a second grey beside the registry rows' `text-ink-faint`).
    expect(color!.style.cursor).toBe("not-allowed");
    expect(bold!.style.cursor).toBe("not-allowed");
    expect(color!.style.cursor).toBe(bold!.style.cursor);
    expect(color!.style.opacity).toBe("");
    expect(bold!.style.opacity).toBe("");
    expect(color!.style.color).toBe("var(--ink-faint)");
    expect(bold!.style.color).toBe("var(--ink-faint)");

    // Task 968: and both SAY why — the reason follows the name in the hint and
    // is the cell's accessible description; the name itself is unchanged.
    for (const [el, name] of [[color!, "Text color"], [bold!, "Bold"]] as const) {
      expect(el.getAttribute("aria-label")).toBe(name);
      expect(el.getAttribute("aria-description")).toBe("Your co-author has the pen");
      expect(el.getAttribute("data-hint")).toBe(`${name} — Your co-author has the pen`);
    }
  });

  it("enabled state keeps the pointer cursor on both cells (no behavior change)", () => {
    renderPanel(/* editable */ true);

    const color = cell("Text color");
    const bold = cell("Bold");
    expect(color!.style.cursor).toBe("pointer");
    expect(bold!.style.cursor).toBe("pointer");
    expect(color!.style.opacity).toBe("");
    expect(bold!.style.opacity).toBe("");
    expect(bold!.style.color).not.toBe("var(--ink-faint)");
    // An enabled cell's hint is its name alone, with no description.
    expect(bold!.getAttribute("data-hint")).toBe("Bold");
    expect(bold!.hasAttribute("aria-description")).toBe(false);
  });
});

describe("Task 985 — a grid cell's name and chord come from its registry row", () => {
  it("every chorded cell advertises the row's keybinding as data-hint-keys; no name carries a glyph", () => {
    renderPanel(/* editable */ true);
    const chorded = Object.values(VIRGIL_ACTION_REGISTRY).filter(
      (r) => r?.surfaces.lightning && r.keybinding,
    );
    // all eight toggle rows: five marks + three wrappers
    expect(chorded.map((r) => r!.id).sort()).toEqual(
      ["blockquote", "bold", "bullet-list", "code", "italic", "ordered-list", "small-caps", "strike"],
    );
    for (const row of chorded) {
      const el = cell(row!.label);
      expect(el, row!.id).toBeTruthy();
      expect(el!.getAttribute("data-hint"), row!.id).toBe(row!.label);
      expect(el!.getAttribute("data-hint-keys"), row!.id).toBe(keysFromKeybinding(row!.keybinding!));
    }
    for (const el of menuEl()!.querySelectorAll("button[aria-label]")) {
      expect(el.getAttribute("aria-label")).not.toMatch(/[⌘⇧⌥]/);
    }
  });

  it("keysFromKeybinding translates the PM form to Kbd's portable form", () => {
    expect(keysFromKeybinding("Mod-Shift-s")).toBe("Mod+Shift+s");
    expect(keysFromKeybinding("Mod-b")).toBe("Mod+b");
    expect(keysFromKeybinding("Mod--")).toBe("Mod+-");
    expect(formatShortcut(keysFromKeybinding("Mod-Shift-s"), true)).toBe("⌘⇧S");
    expect(formatShortcut(keysFromKeybinding("Mod-Shift-s"), false)).toBe("Ctrl+Shift+S");
  });
});
